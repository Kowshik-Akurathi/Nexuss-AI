import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import os from "node:os";
import { LabError } from "./errors";
import type { FileStatus, VcsFileStatus } from "./opencode/types";
import type { OpenCodeClient } from "./opencode/client";

export interface ProjectRoot {
  path: string;
  label: string;
  source: "lab" | "env" | "lab-created";
}

export interface ProjectInfoView {
  path: string;
  label: string;
  exists: boolean;
  isDirectory: boolean;
  fileCount: number;
  git: boolean;
  branch?: string;
  files: Array<{ name: string; type: "file" | "dir"; size?: number }>;
  changes: VcsFileStatus[];
  fileChanges: FileStatus[];
  warnings: string[];
}

/** The Lab's own root - everything else must be explicitly allowed. */
export const LAB_ROOT = path.resolve(/* turbopackIgnore: true */ process.cwd());

function envRoots(): string[] {
  const raw = process.env.LAB_EXTRA_PROJECT_ROOTS || "";
  return raw
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((p) => path.resolve(/* turbopackIgnore: true */ p));
}

/** Roots the Lab is permitted to expose as project directories. */
export function allowedRoots(): ProjectRoot[] {
  const roots: ProjectRoot[] = [
    { path: LAB_ROOT, label: "Nexuss Proxy", source: "lab" },
    // Scratch space used by automated tests.
    { path: path.join(LAB_ROOT, ".lab"), label: "Lab workspace", source: "lab" },
  ];
  for (const p of envRoots()) roots.push({ path: p, label: path.basename(p) || p, source: "env" });
  return roots;
}

/**
 * Resolve and validate a candidate project directory.
 *
 * Security rules enforced here (all unit-tested):
 *  - must be an existing directory
 *  - must be absolute after resolution (no relative escapes)
 *  - must sit inside one of the allowed roots
 *  - `..` traversal is resolved BEFORE the containment check
 *  - symlinks are resolved so a link cannot smuggle access outside a root
 */
export async function resolveProjectDirectory(candidate: string): Promise<string> {
  if (!candidate || typeof candidate !== "string" || !candidate.trim()) {
    throw new LabError({
      code: "INVALID_PROJECT_DIRECTORY",
      status: 400,
      message: "No project directory was provided.",
      recovery: "Select a directory in the project picker.",
    });
  }
  if (candidate.includes("\0")) {
    throw new LabError({
      code: "PATH_TRAVERSAL_BLOCKED",
      status: 400,
      message: "Directory path contains an illegal null byte.",
      recovery: "Choose the directory again from the picker.",
    });
  }

  const resolved = path.resolve(candidate);

  let stat: fsSync.Stats;
  try {
    stat = await fs.stat(resolved);
  } catch (e) {
    throw new LabError({
      code: "INVALID_PROJECT_DIRECTORY",
      status: 400,
      message: `Directory does not exist or is not readable: ${resolved}`,
      detail: (e as Error).message,
      recovery: "Create the folder or pick an existing one.",
    });
  }
  if (!stat.isDirectory()) {
    throw new LabError({
      code: "INVALID_PROJECT_DIRECTORY",
      status: 400,
      message: `Not a directory: ${resolved}`,
      recovery: "Pick a folder, not a file.",
    });
  }

  // Resolve symlinks so a link inside a root cannot point outside it.
  let real: string;
  try {
    real = await fs.realpath(resolved);
  } catch {
    real = resolved;
  }

  const roots = allowedRoots().map((r) => {
    try {
      return fsSync.realpathSync(/* turbopackIgnore: true */ r.path);
    } catch {
      return r.path;
    }
  });

  const inside = roots.some((root) => isInside(root, real));
  if (!inside) {
    throw new LabError({
      code: "PROJECT_OUTSIDE_ROOT",
      status: 403,
      message: "That directory is outside the Lab's allowed roots.",
      detail: `requested=${real}\nallowed=${roots.join("\n")}`,
      recovery:
        "The Lab only opens folders under its own directory (or roots listed in LAB_EXTRA_PROJECT_ROOTS). " +
        "Add the folder to LAB_EXTRA_PROJECT_ROOTS in .env.local if you intentionally want to allow it.",
    });
  }
  return real;
}

/** Case-insensitive, separator-normalized containment check. */
export function isInside(root: string, target: string): boolean {
  const norm = (p: string) => path.resolve(p).replace(/[\\/]+$/, "").replace(/\//g, "\\").toLowerCase();
  const r = norm(root);
  const t = norm(target);
  if (t === r) return true;
  return t.startsWith(r + "\\");
}

export function assertNoTraversal(input: string): void {
  if (input.includes("\0")) {
    throw new LabError({ code: "PATH_TRAVERSAL_BLOCKED", status: 400, message: "Illegal null byte in path." });
  }
  const segments = input.split(/[\\/]/);
  if (segments.includes("..")) {
    throw new LabError({
      code: "PATH_TRAVERSAL_BLOCKED",
      status: 400,
      message: "Path traversal sequences ('..') are not allowed.",
      recovery: "Use the directory picker instead of typing a path.",
    });
  }
}

export class ProjectManager {
  constructor(private client: OpenCodeClient | null) {}

  roots(): ProjectRoot[] {
    return allowedRoots();
  }

  /** Directories directly under a root, for the project picker. */
  async browse(rootPath: string): Promise<Array<{ name: string; path: string; hasGit: boolean }>> {
    const root = await resolveProjectDirectory(rootPath);
    const entries = await fs.readdir(root, { withFileTypes: true });
    const out: Array<{ name: string; path: string; hasGit: boolean }> = [];
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name.startsWith(".") && e.name !== ".lab") continue;
      const full = path.join(root, e.name);
      out.push({ name: e.name, path: full, hasGit: fsSync.existsSync(path.join(full, ".git")) });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Deep-ish listing for the inspector (bounded). */
  async inspect(dirPath: string, sub = ""): Promise<ProjectInfoView> {
    const dir = await resolveProjectDirectory(dirPath);
    if (sub) assertNoTraversal(sub);
    const target = sub ? path.join(dir, sub) : dir;
    if (!isInside(dir, path.resolve(target))) {
      throw new LabError({
        code: "PATH_TRAVERSAL_BLOCKED",
        status: 403,
        message: "Requested sub-path escapes the selected project directory.",
        recovery: "Browse within the selected project only.",
      });
    }

    const warnings: string[] = [];
    let files: ProjectInfoView["files"] = [];
    try {
      const entries = await fs.readdir(target, { withFileTypes: true });
      files = entries
        .map((e) => ({ name: e.name, type: e.isDirectory() ? ("dir" as const) : ("file" as const) }))
        .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1))
        .slice(0, 400);
    } catch (e) {
      warnings.push(`Could not list directory: ${(e as Error).message}`);
    }

    const git = fsSync.existsSync(path.join(dir, ".git"));
    let branch: string | undefined;
    if (git) {
      try {
        const head = await fs.readFile(path.join(dir, ".git", "HEAD"), "utf8");
        branch = head.match(/ref: refs\/heads\/(.+)/)?.[1]?.trim();
      } catch {
        /* detached or unreadable */
      }
    }

    let changes: VcsFileStatus[] = [];
    let fileChanges: FileStatus[] = [];
    if (this.client) {
      try {
        changes = (await this.client.vcsStatus({ directory: dir })) ?? [];
      } catch (e) {
        warnings.push(`VCS status unavailable: ${(e as Error).message}`);
      }
      try {
        fileChanges = (await this.client.fileStatus({ directory: dir })) ?? [];
      } catch (e) {
        warnings.push(`File status unavailable: ${(e as Error).message}`);
      }
    }

    let fileCount = 0;
    try {
      fileCount = (await countFiles(dir, 3000)).count;
    } catch {
      fileCount = files.length;
    }

    return {
      path: dir,
      label: path.basename(dir) || dir,
      exists: true,
      isDirectory: true,
      fileCount,
      git,
      branch,
      files,
      changes,
      fileChanges,
      warnings,
    };
  }

  /** Create a scratch project inside the Lab root (used by tests / demos). */
  async createLabProject(name: string): Promise<string> {
    if (!/^[a-zA-Z0-9._-]+$/.test(name)) {
      throw new LabError({
        code: "INVALID_REQUEST",
        status: 400,
        message: "Project name may only contain letters, digits, dot, dash and underscore.",
        recovery: "Use a simple name such as `hello-project`.",
      });
    }
    const base = path.join(LAB_ROOT, ".lab", "projects");
    const dir = path.join(base, name);
    if (fsSync.existsSync(dir) && !fsSync.existsSync(path.join(dir, ".git"))) {
      // Non-destructive: never wipe an existing folder.
      const existing = await fs.readdir(dir);
      if (existing.length > 0) {
        throw new LabError({
          code: "INVALID_REQUEST",
          status: 409,
          message: `Folder already exists and is not empty: ${dir}`,
          recovery: "Pick a different name; the Lab never deletes existing files.",
        });
      }
    }
    await fs.mkdir(dir, { recursive: true });
    return dir;
  }

  home(): string {
    return os.homedir();
  }
}

async function countFiles(dir: string, limit: number): Promise<{ count: number; capped: boolean }> {
  let count = 0;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop()!;
    let entries: fsSync.Dirent[];
    try {
      entries = await fs.readdir(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.name === "node_modules" || e.name === ".next" || e.name === ".git") continue;
      if (e.isDirectory()) stack.push(path.join(cur, e.name));
      else {
        count++;
        if (count >= limit) return { count, capped: true };
      }
    }
  }
  return { count, capped: false };
}
