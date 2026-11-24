import fs from "node:fs/promises";
import path from "node:path";
import type { OpenCodeClient } from "./opencode/client";
import type { FileStatus, VcsFileStatus } from "./opencode/types";
import type { ExecutionRecord } from "./execution-manager";

export interface ResultSummary {
  executionId: string;
  sessionID: string;
  directory: string;
  status: "completed" | "failed" | "interrupted" | "unknown";
  finalText: string;
  /** Files changed on disk, verified via OpenCode's VCS/file status. */
  filesCreated: string[];
  filesModified: string[];
  filesDeleted: string[];
  /** Files observed through live events (not necessarily in git status). */
  filesObserved: string[];
  /** Diff stats when the project is a git checkout. */
  additions: number;
  deletions: number;
  toolsUsed: Array<{ tool: string; state: string }>;
  commands: string[];
  errors: string[];
  verifiedOnDisk: boolean;
  /** Per-file on-disk existence check for files the agent claimed to write. */
  fileChecks: Array<{ path: string; exists: boolean; size?: number }>;
  durationMs?: number;
  summary: string;
}

interface CachedResult {
  summary: ResultSummary;
  phase: string;
}

function classify(changes: VcsFileStatus[] | FileStatus[]) {
  const created: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];
  let additions = 0;
  let deletions = 0;
  for (const c of changes) {
    const file = "file" in c ? c.file : c.path;
    const add = "additions" in c ? c.additions : c.added;
    const del = "deletions" in c ? c.deletions : c.removed;
    additions += add ?? 0;
    deletions += del ?? 0;
    if (c.status === "added") created.push(file);
    else if (c.status === "deleted") deleted.push(file);
    else modified.push(file);
  }
  return { created, modified, deleted, additions, deletions };
}

/**
 * Builds an execution result report from ACTUAL filesystem / git state plus
 * the recorded execution. Never claims success from the agent's prose alone -
 * `verifiedOnDisk` reports whether the change was independently observed.
 *
 * Results are cached per execution and only rebuilt when the execution phase changes.
 */
export class ResultsManager {
  private cache = new Map<string, CachedResult>();

  constructor(private client: OpenCodeClient) {}

  async build(rec: ExecutionRecord): Promise<ResultSummary> {
    const cached = this.cache.get(rec.id);
    if (cached && cached.phase === rec.phase) {
      return cached.summary;
    }
    const errors: string[] = [];
    if (rec.error) errors.push(rec.error);

    // Parallelize independent upstream calls
    const [changesResult, fileChangesResult] = await Promise.all([
      this.client.vcsStatus({ directory: rec.directory }).catch((e) => {
        errors.push(`vcs status: ${(e as Error).message}`);
        return [] as VcsFileStatus[];
      }),
      this.client.fileStatus({ directory: rec.directory }).catch((e) => {
        errors.push(`file status: ${(e as Error).message}`);
        return [] as FileStatus[];
      }),
    ]);

    const fromVcs = classify(changesResult);
    const fromFiles = classify(fileChangesResult);
    const created = unique([...fromVcs.created, ...fromFiles.created]);
    const modified = unique([...fromVcs.modified, ...fromFiles.modified]);
    const deleted = unique([...fromVcs.deleted, ...fromFiles.deleted]);
    // Files observed through real events (write tools / file.edited / session.diff).
    // Used when the project has no git checkout, where VCS status is empty.
    const observed = unique(rec.filesTouched ?? []);
    const touched = unique([...created, ...modified, ...observed]).filter((f) => !deleted.includes(f));

    // Extract shell commands the agent actually ran (from tool calls).
    const commands: string[] = [];
    for (const t of rec.toolCalls) {
      if (t.tool === "bash" || t.tool === "shell" || t.tool === "run") {
        const input = t.input as { command?: string; cmd?: string } | undefined;
        const cmd = input?.command ?? input?.cmd;
        if (typeof cmd === "string") commands.push(cmd);
      }
    }

    // Independently verify files the agent reported touching.
    const candidates = unique([...touched]).slice(0, 50);
    const fileChecks = await Promise.all(
      candidates.map(async (rel) => {
        const abs = path.isAbsolute(rel) ? rel : path.join(rec.directory, rel);
        try {
          const st = await fs.stat(abs);
          return { path: rel, exists: st.isFile(), size: st.size };
        } catch {
          return { path: rel, exists: false };
        }
      }),
    );

    const verifiedOnDisk = fileChecks.some((f) => f.exists);

    const status: ResultSummary["status"] =
      rec.phase === "completed" ? "completed" : rec.phase === "interrupted" ? "interrupted" : rec.phase === "failed" ? "failed" : "unknown";

    const additions = fromVcs.additions || fromFiles.additions || rec.diffStats?.additions || 0;
    const deletions = fromVcs.deletions || fromFiles.deletions || rec.diffStats?.deletions || 0;

    const parts: string[] = [];
    parts.push(`Execution ${status}.`);
    if (created.length) parts.push(`Created ${created.length} file(s).`);
    if (modified.length) parts.push(`Modified ${modified.length} file(s).`);
    if (deleted.length) parts.push(`Deleted ${deleted.length} file(s).`);
    if (!created.length && !modified.length && observed.length) {
      parts.push(`Observed edits to ${observed.length} file(s) via live events.`);
    }
    if (commands.length) parts.push(`Ran ${commands.length} shell command(s).`);
    if (rec.toolCalls.length) parts.push(`${rec.toolCalls.length} tool invocation(s) observed.`);
    if (errors.length) parts.push(`${errors.length} error(s).`);
    if (!created.length && !modified.length && !deleted.length && !observed.length)
      parts.push("No file changes detected by OpenCode's VCS/file status or live events.");

    const summary: ResultSummary = {
      executionId: rec.id,
      sessionID: rec.sessionID,
      directory: rec.directory,
      status,
      finalText: rec.finalText ?? "",
      filesCreated: created,
      filesModified: modified,
      filesDeleted: deleted,
      filesObserved: observed,
      additions,
      deletions,
      toolsUsed: rec.toolCalls.map((t) => ({ tool: t.tool, state: t.state })),
      commands,
      errors,
      verifiedOnDisk,
      fileChecks,
      durationMs: rec.endedAt ? rec.endedAt - rec.startedAt : undefined,
      summary: parts.join(" "),
    };
    this.cache.set(rec.id, { summary, phase: rec.phase });
    return summary;
  }
}

function unique(a: string[]): string[] {
  return [...new Set(a.filter(Boolean))];
}
