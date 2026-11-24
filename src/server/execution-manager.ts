import { LabError } from "./errors";
import { store } from "./store";
import type { OpenCodeClient } from "./opencode/client";
import type { EventEnvelope } from "./opencode/types";
import { finalAssistantText, type SessionManager } from "./opencode/session-manager";
import { getEventHub } from "./opencode/event-stream";

export type ExecutionPhase =
  | "idle"
  | "submitting"
  | "running"
  | "awaiting-permission"
  | "interrupting"
  | "completed"
  | "failed"
  | "interrupted";

export interface ExecutionRecord {
  id: string;
  sessionID: string;
  directory: string;
  prompt: string;
  agent?: string;
  model?: string;
  phase: ExecutionPhase;
  /** sync = V1 blocking prompt; async = V2 prompt + SSE completion. */
  mode: "sync" | "async";
  startedAt: number;
  endedAt?: number;
  /** Real OpenCode events observed while running (no synthetic progress %). */
  events: Array<{ type: string; at: number; summary: string }>;
  toolCalls: Array<{ tool: string; state: string; at: number; input?: unknown }>;
  permissionRequests: string[];
  /** File paths observed via file.edited / write-tool inputs / session.diff. */
  filesTouched: string[];
  /** Diff stats reported by OpenCode's session.diff events (git checkouts). */
  diffStats?: { additions: number; deletions: number };
  error?: string;
  finalText?: string;
  interruptedByUser?: boolean;
}

export interface SubmitOptions {
  sessionID: string;
  directory: string;
  text: string;
  agent?: string;
  model?: { providerID: string; modelID: string };
  /** Use the V2 async prompt (streaming) instead of the V1 blocking prompt. */
  async?: boolean;
}

const MAX_EVENTS = 400;

const TERMINAL: ReadonlySet<ExecutionPhase> = new Set(["completed", "failed", "interrupted"]);

function isTerminal(phase: ExecutionPhase): boolean {
  return TERMINAL.has(phase);
}

/**
 * Drives a single agent turn and records what ACTUALLY happened.
 *
 * Progress is derived only from real OpenCode events; no fabricated
 * percentages or timers are ever reported.
 */
export class ExecutionManager {
  private records = new Map<string, ExecutionRecord>();
  private active = new Map<string, ExecutionRecord>(); // keyed by sessionID
  private persisted = new Set<string>();
  private seq = 0;
  private unsubscribe: (() => void) | null = null;

  constructor(
    private client: OpenCodeClient,
    private sessions: SessionManager
  ) {}

  /** Attach to the shared event hub so tool/permission events are captured. */
  attach(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = getEventHub().subscribe((e) => this.onEvent(e));
  }

  detach(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private summaryFor(e: EventEnvelope): string {
    const p = (e.properties ?? {}) as Record<string, unknown>;
    switch (e.type) {
      case "session.status": {
        const s = p.status as { type?: string } | undefined;
        return `status: ${s?.type ?? "unknown"}`;
      }
      case "session.idle":
        return "session idle";
      case "message.part.delta":
        return `streaming ${String(p.field ?? "text")}`;
      case "message.part.updated": {
        const part = p.part as { type?: string; tool?: string; state?: { status?: string } } | undefined;
        if (part?.type === "tool") return `tool ${part.tool} -> ${part.state?.status ?? "?"}`;
        return `part ${part?.type ?? "?"}`;
      }
      case "message.updated": {
        const info = p.info as { role?: string } | undefined;
        return `message ${info?.role ?? "?"}`;
      }
      case "permission.asked":
      case "permission.v2.asked":
        return `permission requested: ${String(p.permission ?? p.action ?? "")}`;
      case "permission.replied":
      case "permission.v2.replied":
        return `permission ${String(p.response ?? p.reply ?? "answered")}`;
      case "session.error":
        return "session error";
      case "file.edited":
        return `file edited: ${String(p.file ?? "")}`;
      case "session.diff": {
        const diff = (p.diff ?? []) as Array<{ file?: string; additions?: number; deletions?: number }>;
        const adds = diff.reduce((n, d) => n + (d.additions ?? 0), 0);
        const dels = diff.reduce((n, d) => n + (d.deletions ?? 0), 0);
        return `diff updated (${diff.length} file(s), +${adds}/−${dels})`;
      }
      default:
        return e.type;
    }
  }

  private onEvent(e: EventEnvelope): void {
    const p = (e.properties ?? {}) as Record<string, unknown>;
    const sessionID = typeof p.sessionID === "string" ? p.sessionID : undefined;
    if (!sessionID) return;
    const rec = this.active.get(sessionID);
    if (!rec) return;

    rec.events.push({ type: e.type, at: Date.now(), summary: this.summaryFor(e) });
    if (rec.events.length > MAX_EVENTS) rec.events.splice(0, rec.events.length - MAX_EVENTS);

    if (e.type === "message.part.updated") {
      const part = p.part as
        | { type?: string; tool?: string; state?: { status?: string; input?: unknown } }
        | undefined;
      if (part?.type === "tool") {
        const state = part.state?.status ?? "unknown";
        const existing = rec.toolCalls.find((t) => t.tool === part.tool && t.state === "running");
        if (state === "running") {
          rec.toolCalls.push({ tool: part.tool ?? "?", state, at: Date.now(), input: part.state?.input });
        } else if (existing) {
          existing.state = state;
        } else {
          rec.toolCalls.push({ tool: part.tool ?? "?", state, at: Date.now() });
        }
        for (const f of filePathsFromInput(part.state?.input)) this.touch(rec, f);
      }
    }

    if (e.type === "file.edited") {
      const file = typeof p.file === "string" ? p.file : undefined;
      if (file) this.touch(rec, file);
    }

    if (e.type === "session.diff") {
      const diff = (p.diff ?? []) as Array<{ file?: string; path?: string; additions?: number; deletions?: number }>;
      let additions = 0;
      let deletions = 0;
      for (const d of diff) {
        additions += d.additions ?? 0;
        deletions += d.deletions ?? 0;
        const f = d.file ?? d.path;
        if (f) this.touch(rec, f);
      }
      if (diff.length) rec.diffStats = { additions, deletions };
    }

    if (e.type === "permission.asked" || e.type === "permission.v2.asked") {
      rec.phase = "awaiting-permission";
      const id = typeof p.id === "string" ? p.id : "";
      if (id && !rec.permissionRequests.includes(id)) rec.permissionRequests.push(id);
    }

    if (e.type === "permission.replied" || e.type === "permission.v2.replied") {
      if (rec.phase === "awaiting-permission") rec.phase = "running";
    }

    if (e.type === "session.error") {
      rec.error = JSON.stringify(p.error ?? "unknown error").slice(0, 1000);
    }

    if (e.type === "session.idle") {
      // Backup completer for async turns whose blocking call has not returned yet.
      if (rec.mode === "async" && rec.phase === "running") this.markCompleted(sessionID);
    }
  }

  private touch(rec: ExecutionRecord, file: string): void {
    if (!file || rec.filesTouched.includes(file)) return;
    rec.filesTouched.push(file);
    if (rec.filesTouched.length > 200) rec.filesTouched.splice(0, rec.filesTouched.length - 200);
  }

  get(id: string): ExecutionRecord {
    const r = this.records.get(id);
    if (!r) {
      throw new LabError({ code: "SESSION_NOT_FOUND", status: 404, message: `Execution ${id} not found.` });
    }
    return r;
  }

  getBySession(sessionID: string): ExecutionRecord | undefined {
    return [...this.records.values()].find((r) => r.sessionID === sessionID && r.phase !== "idle")
      ?? [...this.records.values()].reverse().find((r) => r.sessionID === sessionID);
  }

  list(limit = 50): ExecutionRecord[] {
    return [...this.records.values()].sort((a, b) => b.startedAt - a.startedAt).slice(0, limit);
  }

  isActive(sessionID: string): boolean {
    const r = this.active.get(sessionID);
    return Boolean(r && ["submitting", "running", "awaiting-permission", "interrupting"].includes(r.phase));
  }

  /**
   * Submit a prompt. When `async` is set the V2 prompt endpoint is used so the
   * call returns immediately and progress arrives over SSE; otherwise the V1
   * blocking prompt is awaited and its result is used directly.
   */
  async submit(opts: SubmitOptions): Promise<ExecutionRecord> {
    if (this.isActive(opts.sessionID)) {
      throw new LabError({
        code: "SESSION_BUSY",
        status: 409,
        message: "This session is already running a task.",
        recovery: "Interrupt the running task or wait for it to finish.",
      });
    }
    if (!opts.text?.trim()) {
      throw new LabError({
        code: "INVALID_REQUEST",
        status: 400,
        message: "Prompt text is empty.",
        recovery: "Type an instruction before sending.",
      });
    }

    this.attach();
    const id = `exec_${++this.seq}_${Date.now()}`;
    const rec: ExecutionRecord = {
      id,
      sessionID: opts.sessionID,
      directory: opts.directory,
      prompt: opts.text,
      agent: opts.agent,
      model: opts.model ? `${opts.model.providerID}/${opts.model.modelID}` : undefined,
      phase: "submitting",
      mode: opts.async ? "async" : "sync",
      startedAt: Date.now(),
      events: [],
      toolCalls: [],
      permissionRequests: [],
      filesTouched: [],
    };
    this.records.set(id, rec);
    this.active.set(opts.sessionID, rec);

    try {
      if (opts.agent) await this.sessions.setAgent(opts.sessionID, opts.agent);

      if (opts.async) {
        // This build's V2 /prompt admission never starts the agent loop (verified:
        // steer/queue/no-delivery all admit but produce zero tokens), so the async
        // path still drives the real V1 blocking prompt - detached, so submit()
        // returns immediately and progress arrives over SSE.
        rec.phase = "running";
        rec.events.push({ type: "prompt.submitted", at: Date.now(), summary: "prompt submitted (background turn)" });
        void this.runTurn(opts, rec);
        return rec;
      }

      rec.phase = "running";
      const result = await this.client.prompt(
        opts.sessionID,
        {
          parts: [{ type: "text", text: opts.text }],
          agent: opts.agent,
          model: opts.model,
        },
        { directory: opts.directory, timeoutMs: 300_000 }
      );
      rec.phase = "completed";
      rec.endedAt = Date.now();
      rec.finalText = extractText(result);
      if (!rec.finalText) {
        const history = await this.sessions.history(opts.sessionID, opts.directory);
        rec.finalText = finalAssistantText(history);
      }
      this.persist(rec);
    } catch (e) {
      rec.endedAt = Date.now();
      if (rec.interruptedByUser || (e as Error)?.message?.toLowerCase().includes("abort")) {
        rec.phase = "interrupted";
        rec.error = "Execution interrupted.";
      } else {
        rec.phase = "failed";
        rec.error = e instanceof LabError ? `${e.code}: ${e.message}` : (e as Error).message;
        rec.events.push({ type: "lab.error", at: Date.now(), summary: rec.error });
      }
      this.persist(rec);
      this.active.delete(opts.sessionID);
      throw e;
    }

    this.active.delete(opts.sessionID);
    return rec;
  }

  /** Detached agent turn used by async submits. Terminal phases are idempotent. */
  private async runTurn(opts: SubmitOptions, rec: ExecutionRecord): Promise<void> {
    try {
      const result = await this.client.prompt(
        opts.sessionID,
        {
          parts: [{ type: "text", text: opts.text }],
          agent: opts.agent,
          model: opts.model,
        },
        { directory: opts.directory, timeoutMs: 300_000 }
      );
      if (isTerminal(rec.phase)) return;
      rec.phase = "completed";
      rec.endedAt = Date.now();
      rec.finalText = extractText(result);
      if (!rec.finalText) {
        try {
          const history = await this.sessions.history(opts.sessionID, opts.directory);
          rec.finalText = finalAssistantText(history);
        } catch {
          /* keep what we have */
        }
      }
      this.persist(rec);
      this.active.delete(opts.sessionID);
    } catch (e) {
      if (isTerminal(rec.phase)) return;
      rec.endedAt = Date.now();
      if (rec.interruptedByUser || (e as Error)?.message?.toLowerCase().includes("abort")) {
        rec.phase = "interrupted";
        rec.error = "Execution interrupted.";
      } else {
        rec.phase = "failed";
        rec.error = e instanceof LabError ? `${e.code}: ${e.message}` : (e as Error).message;
        rec.events.push({ type: "lab.error", at: Date.now(), summary: rec.error });
      }
      this.persist(rec);
      this.active.delete(opts.sessionID);
    }
  }

  /**
   * Write a terminal execution summary to Lab SQLite so the Monitor's history
   * survives a server restart. Idempotent; never throws into a turn.
   */
  private persist(rec: ExecutionRecord): void {
    if (!isTerminal(rec.phase) || this.persisted.has(rec.id)) return;
    this.persisted.add(rec.id);
    try {
      store().insertExecution({
        id: rec.id,
        session_id: rec.sessionID,
        directory: rec.directory,
        prompt: rec.prompt,
        status: rec.phase,
        started_at: rec.startedAt,
        ended_at: rec.endedAt ?? rec.startedAt,
        tools_used: rec.toolCalls.length,
        files_changed: rec.filesTouched.length,
        error: rec.error ?? null,
      });
    } catch {
      /* history must never break a turn */
    }
  }

  /** Resolves once the execution reaches a terminal phase (or the timeout elapses). */  whenSettled(id: string, timeoutMs = 320_000): Promise<ExecutionRecord> {
    return new Promise((resolve) => {
      const started = Date.now();
      const tick = () => {
        const rec = this.records.get(id);
        if (!rec || isTerminal(rec.phase) || Date.now() - started > timeoutMs) {
          resolve(rec ?? ({ id, phase: "failed", error: "Execution record vanished." } as ExecutionRecord));
          return;
        }
        setTimeout(tick, 500);
      };
      tick();
    });
  }

  /** Called when the async path observes session.idle. */
  markCompleted(sessionID: string): void {
    const rec = this.active.get(sessionID);
    if (!rec || isTerminal(rec.phase)) return;
    rec.phase = "completed";
    rec.endedAt = Date.now();
    this.active.delete(sessionID);
    void this.finalize(rec).finally(() => this.persist(rec));
  }

  private async finalize(rec: ExecutionRecord): Promise<void> {
    try {
      const history = await this.sessions.history(rec.sessionID, rec.directory);
      rec.finalText = finalAssistantText(history);
    } catch {
      /* keep whatever we have */
    }
  }

  async interrupt(sessionID: string): Promise<void> {
    const rec = this.active.get(sessionID);
    if (rec) {
      rec.interruptedByUser = true;
      rec.phase = "interrupting";
      rec.events.push({ type: "lab.interrupt", at: Date.now(), summary: "user requested interrupt" });
    }
    await this.sessions.interrupt(sessionID);
    if (rec) {
      rec.phase = "interrupted";
      rec.endedAt = Date.now();
      rec.error = rec.error ?? "Execution interrupted by user.";
      this.persist(rec);
      this.active.delete(sessionID);
    }
  }
}

/** Best-effort extraction of file paths from a tool call's input payload. */
function filePathsFromInput(input: unknown): string[] {
  if (!input || typeof input !== "object") return [];
  const out: string[] = [];
  const obj = input as Record<string, unknown>;
  for (const key of ["filePath", "file", "path", "filename", "targetFile", "notebookPath"]) {
    const v = obj[key];
    if (typeof v === "string" && v && !v.includes("\n")) out.push(v);
  }
  for (const key of ["files", "edits", "changes"]) {
    const arr = obj[key];
    if (Array.isArray(arr)) {
      for (const item of arr) {
        if (typeof item === "string") out.push(item);
        else if (item && typeof item === "object") {
          const nested = filePathsFromInput(item);
          out.push(...nested);
        }
      }
    }
  }
  return out;
}

function extractText(result: { parts?: unknown[] } | undefined): string {
  if (!result?.parts) return "";
  return result.parts
    .map((p) => p as { type?: string; text?: string })
    .filter((p) => p.type === "text" && typeof p.text === "string")
    .map((p) => p.text)
    .join("\n");
}
