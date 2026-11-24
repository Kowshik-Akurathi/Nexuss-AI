/**
 * Stage 2 — Installing OpenCode.
 *
 * Runs a real installer chosen from the allowlist, streams its output into the
 * progress UI as activity/log lines, supports cancellation (killing only the
 * process tree this manager spawned) and refuses to escalate without an
 * explicit user confirmation.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { LabError } from "@/server/errors";
import {
  brewInstallCommand,
  npmInstallCommand,
  scriptInstallCommand,
  selectMethod,
  sudoPrefix,
  taskkillTree,
  type CommandSpec,
} from "./allowlist";
import type { EnvironmentReport } from "./types";

export interface InstallRunOptions {
  signal: AbortSignal;
  elevated?: boolean;
  onActivity: (msg: string) => void;
  onLog: (line: string) => void;
}

export interface InstallOutcome {
  method: string;
  commandLabel: string;
  output: string[];
  durationMs: number;
}

export class InstallCancelledError extends Error {
  constructor() {
    super("Installation cancelled.");
    this.name = "InstallCancelledError";
  }
}

function nowStamp(): string {
  return new Date().toISOString().slice(11, 19);
}

function specLabel(spec: CommandSpec): string {
  return spec.shellCommand ? spec.shellCommand : `${spec.file} ${spec.args.join(" ")}`;
}

/** Validate + build the argv for the selected method (allowlist only). */
export function buildInstallSpec(
  env: EnvironmentReport,
  elevated: boolean
): { spec: CommandSpec; method: string } {
  const method = selectMethod({
    npm: env.methods.find((m) => m.id === "npm")?.available ?? false,
    npmVersion: env.npm,
    npmPrefix: null,
    curl: env.methods.find((m) => m.id === "script")?.detail?.includes("curl") ?? false,
    wget: false,
    bash: env.methods.find((m) => m.id === "script")?.available ?? false,
    brew: env.methods.find((m) => m.id === "brew")?.available ?? false,
  });

  if (!method) {
    throw new LabError({
      code: "UNKNOWN",
      status: 500,
      message: "No supported OpenCode installation method is available on this device.",
      detail: env.methods.map((m) => `${m.id}: ${m.available ? "available" : "unavailable"} (${m.detail ?? ""})`).join("\n"),
      recovery:
        "Install OpenCode manually (npm install -g opencode-ai, or the official script from https://opencode.ai), then press Re-detect.",
    });
  }

  let spec: CommandSpec;
  if (method === "npm") spec = npmInstallCommand();
  else if (method === "script") spec = scriptInstallCommand();
  else spec = brewInstallCommand();

  const elevationNeeded = env.requiresElevation && method !== "script";
  if (elevationNeeded) {
    if (!elevated) {
      throw new LabError({
        code: "UNKNOWN",
        status: 403,
        message: "Installing OpenCode needs permission to write to the global install location.",
        detail: env.dependencies.find((d) => d.name === "Writable install target")?.detail,
        recovery:
          "Confirm the elevated install to continue (sudo runs non-interactively), or install manually with the command in the technical details.",
        // surfaced to the UI as a confirmation prompt
        cause: { confirmationRequired: true, code: "ELEVATION_REQUIRED" },
      });
    }
    spec = sudoPrefix(spec);
  }

  return { spec, method };
}

/** Kill ONLY the process tree this manager started. */
async function killTree(child: ChildProcess): Promise<void> {
  const pid = child.pid;
  if (!pid) return;
  if (process.platform === "win32") {
    try {
      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      await promisify(execFile)("taskkill", ["/pid", String(pid), "/T", "/F"], {
        windowsHide: true,
        timeout: 8000,
      }).catch(() => undefined);
    } catch {
      /* already gone */
    }
    try {
      child.kill();
    } catch {
      /* already gone */
    }
    return;
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      child.kill("SIGTERM");
    } catch {
      /* already gone */
    }
  }
  await new Promise((r) => setTimeout(r, 1500));
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    /* already gone */
  }
}

function runSpec(
  spec: CommandSpec,
  opts: InstallRunOptions,
  onChild: (c: ChildProcess) => void
): Promise<{ code: number | null; output: string[] }> {
  return new Promise((resolve, reject) => {
    const output: string[] = [];
    const child = spawn(spec.file, spec.args, {
      cwd: process.cwd(),
      env: process.env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      // Own process group on POSIX so cancellation can stop the whole tree.
      detached: process.platform !== "win32",
    });
    onChild(child);

    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    const handleLine = (raw: string) => {
      const line = raw.replace(/\s+$/, "");
      if (!line) return;
      output.push(line);
      if (output.length > 500) output.splice(0, output.length - 500);
      opts.onLog(line);
    };

    child.stdout?.on("data", (buf: Buffer) => {
      for (const l of buf.toString().split(/\r?\n/)) handleLine(l);
    });
    child.stderr?.on("data", (buf: Buffer) => {
      for (const l of buf.toString().split(/\r?\n/)) handleLine(l);
    });

    const onAbort = () => {
      void killTree(child).then(() =>
        finish(() => reject(new InstallCancelledError()))
      );
    };
    if (opts.signal.aborted) {
      queueMicrotask(onAbort);
    } else {
      opts.signal.addEventListener("abort", onAbort, { once: true });
    }

    child.on("error", (e) => {
      opts.signal.removeEventListener("abort", onAbort);
      finish(() =>
        reject(
          new LabError({
            code: "UNKNOWN",
            message: `Could not run the installer (${spec.file}): ${e.message}`,
            detail: specLabel(spec),
            recovery:
              spec.file === "npm"
                ? "Make sure npm is installed and on PATH, then retry."
                : "Check that the required tool is installed and on PATH, then retry.",
          })
        )
      );
    });

    child.on("close", (code) => {
      opts.signal.removeEventListener("abort", onAbort);
      finish(() => resolve({ code, output }));
    });
  });
}

/**
 * Execute the installation. Returns only after the installer exits successfully;
 * otherwise throws a LabError carrying the captured output.
 */
export async function runInstallation(
  env: EnvironmentReport,
  opts: InstallRunOptions
): Promise<InstallOutcome> {
  const started = Date.now();
  const { spec, method } = buildInstallSpec(env, Boolean(opts.elevated));
  const label = specLabel(spec);

  opts.onActivity(
    method === "npm"
      ? "Downloading and installing the official opencode-ai package…"
      : method === "script"
        ? "Running the official OpenCode install script…"
        : "Installing OpenCode with Homebrew…"
  );
  opts.onLog(`[installer] ${label}`);

  let child: ChildProcess | null = null;
  const { code, output } = await runSpec(spec, opts, (c) => {
    child = c;
    if (c.pid) opts.onLog(`[installer] started pid ${c.pid}`);
  });

  if (opts.signal.aborted) throw new InstallCancelledError();

  if (code !== 0) {
    const tail = output.slice(-40).join("\n");
    const networkish = output.some((l) =>
      /ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|network|EAI_AGAIN|fetch failed|registry/i.test(l)
    );
    const permissionish = output.some((l) =>
      /EACCES|EPERM|permission denied|operation not permitted|access is denied/i.test(l)
    );
    throw new LabError({
      code: "UNKNOWN",
      status: networkish ? 502 : permissionish ? 403 : 500,
      message: networkish
        ? "The installer could not reach the package registry — check your network connection and retry."
        : permissionish
          ? "The installer was denied permission to write to the install location."
          : `The installer exited with code ${code}.`,
      detail: tail || "(no installer output captured)",
      recovery: networkish
        ? "Reconnect to the internet and press Retry — completed stages are preserved."
        : permissionish
          ? "Retry with elevated permissions, or install OpenCode manually and press Re-detect."
          : "Expand the technical details to inspect the installer output, then retry.",
      cause: { permissionish, networkish },
    });
  }

  opts.onActivity("Installer finished — verifying the result next…");
  return { method, commandLabel: label, output, durationMs: Date.now() - started };
}
