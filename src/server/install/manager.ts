/**
 * Installation manager — orchestrates the eight real installation stages,
 * owns the process-wide installation state, persists it so a browser refresh
 * never misreports a running install, and fans progress out to SSE clients.
 *
 * Design rules:
 *  - Stages are real operations (probe, spawn, HTTP health check, discovery).
 *  - Progress is derived from completed stages only — never from timers.
 *  - Cancellation only ever terminates processes this manager spawned.
 *  - Retry re-runs the first unsuccessful stage and preserves completed work.
 */
import { randomUUID } from "node:crypto";
import { getConnection } from "@/server/opencode/connection";
import { detectInstallation } from "@/server/opencode/detector";
import { listAgents } from "@/server/opencode/agent-manager";
import { listModels, availableModels } from "@/server/opencode/model-manager";
import { getSelections } from "@/server/lab-state";
import { store } from "@/server/store";
import { audit } from "@/server/audit-logger";
import { LabError } from "@/server/errors";
import { collectEnvironment } from "./environment";
import { runInstallation, InstallCancelledError } from "./installer";
import { checkAuthentication } from "./auth-check";
import {
  STAGE_ORDER,
  STAGE_STATUS,
  STAGE_TITLES,
  computeProgress,
  emptyInstallState,
  type InstallStageId,
  type InstallState,
  type StageState,
} from "./types";

const SNAPSHOT_KEY = "install.snapshot";
const MAX_LOGS = 400;
const PERSIST_THROTTLE_MS = 700;

/** Thrown by the auth stage when no provider credential exists yet. */
class AwaitAuthenticationSignal extends Error {
  constructor() {
    super("Provider authentication is required.");
    this.name = "AwaitAuthenticationSignal";
  }
}

class CancelledSignal extends Error {
  constructor() {
    super("Installation cancelled.");
    this.name = "CancelledSignal";
  }
}

interface StageContext {
  signal: AbortSignal;
  elevated: boolean;
  activity: (msg: string) => void;
  log: (line: string) => void;
  detail: (d: Record<string, unknown>) => void;
}

function stamp(): string {
  return new Date().toISOString().slice(11, 19);
}

function toStageError(e: unknown): {
  code: string;
  message: string;
  detail?: string;
  recovery?: string;
  confirmationRequired?: boolean;
} {
  if (e instanceof LabError) {
    const cause = e.cause as { confirmationRequired?: boolean; code?: string } | undefined;
    return {
      code: cause?.code ?? e.code,
      message: e.message,
      detail: e.detail,
      recovery: e.recovery,
      confirmationRequired: cause?.confirmationRequired,
    };
  }
  return {
    code: "UNKNOWN",
    message: (e as Error)?.message || "Unexpected failure.",
    detail: (e as Error)?.stack?.slice(0, 800),
    recovery: "Expand the technical details, then retry the stage.",
  };
}

export class InstallManager {
  private state: InstallState;
  private listeners = new Set<(state: InstallState) => void>();
  private abort: AbortController | null = null;
  private running: Promise<void> | null = null;
  private lastPersist = 0;

  constructor() {
    this.state = this.loadSnapshot();
  }

  // ------------------------------------------------------------ state & events
  getState(): InstallState {
    return structuredClone(this.state);
  }

  subscribe(fn: (state: InstallState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(persist = true): void {
    this.state.updatedAt = Date.now();
    this.state.progress = computeProgress(this.state.stages);
    const snapshot = structuredClone(this.state);
    for (const fn of this.listeners) {
      try {
        fn(snapshot);
      } catch {
        /* a broken subscriber must not break the install */
      }
    }
    const terminal =
      this.state.status === "completed" ||
      this.state.status === "failed" ||
      this.state.status === "cancelled" ||
      this.state.status === "awaiting-auth" ||
      this.state.status === "idle";
    const now = Date.now();
    if (persist && (terminal || now - this.lastPersist > PERSIST_THROTTLE_MS)) {
      this.lastPersist = now;
      try {
        store().setSetting(SNAPSHOT_KEY, this.state);
      } catch {
        /* persistence is best-effort */
      }
    }
  }

  private loadSnapshot(): InstallState {
    const fresh = emptyInstallState();
    let saved: InstallState | null = null;
    try {
      saved = store().getSetting<InstallState | null>(SNAPSHOT_KEY, null);
    } catch {
      saved = null;
    }
    if (!saved || !Array.isArray(saved.stages) || saved.stages.length === 0) return fresh;

    // A snapshot that claims to be in flight can only exist if the backend died
    // mid-install (children do not outlive the manager). Report it honestly as
    // an interruption instead of leaving the UI stuck or calling it failed
    // while something is still running.
    const active =
      saved.status === "checking" ||
      saved.status === "installing" ||
      saved.status === "verifying" ||
      saved.status === "configuring" ||
      saved.status === "connecting" ||
      saved.status === "discovering" ||
      saved.status === "cancelling";

    const restored: InstallState = { ...fresh, ...saved, cancelRequested: false, updatedAt: Date.now() };
    if (active) {
      const stage = saved.currentStage ?? "environment";
      const interruption = {
        stage,
        code: "INTERRUPTED",
        message: "The setup was interrupted when the Nexuss backend stopped.",
        detail: `Last known stage: ${stage}. Completed stages were preserved.`,
        recovery: "Press Retry to resume from the interrupted stage.",
      };
      restored.status = "failed";
      restored.error = interruption;
      const idx = STAGE_ORDER.indexOf(stage);
      restored.stages = restored.stages.map((s, i) => {
        if (i < idx && (s.status === "completed" || s.status === "skipped")) return s;
        if (i === idx) return { ...s, status: "failed" as const, error: interruption, endedAt: Date.now() };
        return s.status === "pending" ? s : { ...s, status: "pending" as const };
      });
      restored.currentStage = stage;
    }
    return restored;
  }

  private log(line: string): void {
    this.state.logs.push(`[${stamp()}] ${line}`);
    if (this.state.logs.length > MAX_LOGS) {
      this.state.logs.splice(0, this.state.logs.length - MAX_LOGS);
    }
  }

  private setStage(id: InstallStageId, patch: Partial<StageState>): void {
    const idx = this.state.stages.findIndex((s) => s.id === id);
    if (idx < 0) return;
    this.state.stages[idx] = { ...this.state.stages[idx], ...patch };
  }

  private stage(id: InstallStageId): StageState {
    return this.state.stages.find((s) => s.id === id)!;
  }

  // --------------------------------------------------------------- public API
  /**
   * Start a fresh installation. Returns immediately — progress is delivered
   * through `subscribe()` / SSE. Use `settle()` to await completion (tests).
   */
  start(opts: { elevated?: boolean } = {}): InstallState {
    if (this.running) return this.getState();
    if (this.state.status === "completed") this.reset(false);

    const id = randomUUID();
    this.state = {
      ...emptyInstallState(),
      id,
      startedAt: Date.now(),
      status: "checking",
      logs: [],
    };
    this.log(`installation ${id} started (platform ${process.platform}/${process.arch})`);
    audit().info("install", `Installation ${id} started`);
    this.emit();

    void this.runFrom(0, opts);
    return this.getState();
  }

  /** Await the in-flight run (used by tests and by callers that want to block). */
  async settle(): Promise<InstallState> {
    while (this.running) {
      await this.running.catch(() => undefined);
    }
    return this.getState();
  }

  /** Resume from the first unsuccessful stage, preserving completed work. */
  retry(opts: { elevated?: boolean } = {}): InstallState {
    if (this.running) return this.getState();
    if (!this.state.id) return this.start(opts);

    const idx = this.state.stages.findIndex(
      (s) => s.status === "failed" || s.status === "awaiting" || s.status === "cancelled"
    );
    const from = idx >= 0 ? idx : 0;
    this.state.stages = this.state.stages.map((s, i) =>
      i >= from && s.status !== "completed" && s.status !== "skipped"
        ? { ...s, status: "pending", error: undefined, activity: "Waiting", startedAt: undefined, endedAt: undefined }
        : s
    );
    this.state.error = null;
    this.state.cancelRequested = false;
    this.state.status = STAGE_STATUS[this.state.stages[from].id];
    this.state.endedAt = null;
    this.log(`retrying from stage "${this.state.stages[from].title}"`);
    this.emit();

    void this.runFrom(from, opts);
    return this.getState();
  }

  /** Re-run only the authentication stage (used after the user logs in). */
  recheckAuthentication(): InstallState {
    if (this.running) return this.getState();
    const from = STAGE_ORDER.indexOf("auth");
    this.state.stages = this.state.stages.map((s, i) =>
      i >= from && s.status !== "completed" && s.status !== "skipped"
        ? { ...s, status: "pending", error: undefined, activity: "Waiting", startedAt: undefined, endedAt: undefined }
        : s
    );
    this.state.error = null;
    this.state.status = "connecting";
    this.log("re-checking provider authentication");
    this.emit();
    void this.runFrom(from, {});
    return this.getState();
  }

  /** Explicitly continue when the user has no provider credentials yet. */
  continueWithoutAuthentication(): InstallState {
    if (this.running) return this.getState();
    this.setStage("auth", {
      status: "skipped",
      activity: "Skipped by user — no provider credential configured",
      endedAt: Date.now(),
      detail: { skipped: true },
    });
    this.state.auth = { checked: true, authenticated: false, providers: [] };
    this.state.status = "discovering";
    this.log("continuing without provider authentication (models will be unavailable)");
    this.emit();
    void this.runFrom(STAGE_ORDER.indexOf("discover"), {});
    return this.getState();
  }

  async cancel(): Promise<InstallState> {
    if (!this.running) {
      if (this.state.status !== "idle") {
        this.state.status = "cancelled";
        this.state.cancelRequested = true;
        this.state.endedAt = Date.now();
        this.state.stages = this.state.stages.map((s) =>
          s.status === "pending" || s.status === "running"
            ? { ...s, status: "cancelled", activity: "Cancelled", endedAt: Date.now() }
            : s
        );
        this.emit();
      }
      return this.getState();
    }
    this.state.cancelRequested = true;
    this.state.status = "cancelling";
    this.log("cancellation requested — stopping the current step");
    this.emit();
    this.abort?.abort();
    await this.settle();
    return this.getState();
  }

  reset(notify = true): void {
    this.state = emptyInstallState();
    try {
      store().setSetting(SNAPSHOT_KEY, null);
    } catch {
      /* best-effort */
    }
    if (notify) this.emit(false);
  }

  /**
   * Launch the supported OpenCode authentication process in a real terminal
   * window so the user can complete it without Nexuss ever touching a
   * credential. Returns instructions when no terminal can be opened.
   */
  async startAuthentication(): Promise<{ started: boolean; detail: string }> {
    const info = await detectInstallation().catch(() => null);
    if (!info?.installed || !info.path) {
      return {
        started: false,
        detail: "OpenCode is not installed, so its login command is unavailable.",
      };
    }
    const bin = info.path;
    const { spawn } = await import("node:child_process");
    const detached = { detached: true, stdio: "ignore" as const, windowsHide: false };

    try {
      if (process.platform === "win32") {
        // Fixed argv — the binary comes from the detector, never from a request.
        spawn("cmd", ["/c", "start", "OpenCode Authentication", "cmd", "/k", `"${bin}" auth login`], {
          ...detached,
        }).unref();
        return {
          started: true,
          detail: "Opened a terminal running `opencode auth login`. Complete it there, then press Recheck.",
        };
      }
      if (process.platform === "darwin") {
        spawn("osascript", [
          "-e",
          `tell application "Terminal" to do script "${bin.replace(/"/g, '\\"')} auth login"`,
        ], detached).unref();
        return {
          started: true,
          detail: "Opened Terminal running `opencode auth login`. Complete it there, then press Recheck.",
        };
      }
      const terminals: Array<[string, string[]]> = [
        ["x-terminal-emulator", ["-e", bin, "auth", "login"]],
        ["gnome-terminal", ["--", bin, "auth", "login"]],
        ["konsole", ["-e", bin, "auth", "login"]],
        ["xterm", ["-e", bin, "auth", "login"]],
      ];
      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const execFileAsync = promisify(execFile);
      for (const [term, args] of terminals) {
        try {
          await execFileAsync("which", [term], { timeout: 5000 });
          spawn(term, args, detached).unref();
          return {
            started: true,
            detail: `Opened ${term} running \`opencode auth login\`. Complete it there, then press Recheck.`,
          };
        } catch {
          /* try the next terminal */
        }
      }
    } catch (e) {
      return {
        started: false,
        detail: `Could not open a terminal: ${(e as Error).message}. Run \`opencode auth login\` yourself, then press Recheck.`,
      };
    }
    return {
      started: false,
      detail: `No supported terminal was found. Run \`opencode auth login\` in your own terminal, then press Recheck.`,
    };
  }

  // ---------------------------------------------------------------- run loop
  private async runFrom(from: number, opts: { elevated?: boolean }): Promise<void> {
    const controller = new AbortController();
    this.abort = controller;
    const elevated = Boolean(opts.elevated);

    const run = (async () => {
      for (let i = from; i < STAGE_ORDER.length; i++) {
        const id = STAGE_ORDER[i];
        const existing = this.stage(id);
        if (existing.status === "completed" || existing.status === "skipped") continue;

        if (controller.signal.aborted) throw new CancelledSignal();

        this.state.status = STAGE_STATUS[id];
        this.state.currentStage = id;
        this.setStage(id, {
          status: "running",
          activity: "Starting…",
          startedAt: Date.now(),
          endedAt: undefined,
          error: undefined,
        });
        this.log(`stage "${STAGE_TITLES[id]}" started`);
        this.emit();

        const ctx: StageContext = {
          signal: controller.signal,
          elevated,
          activity: (msg) => {
            this.setStage(id, { activity: msg });
            this.emit();
          },
          log: (line) => this.log(line),
          detail: (d) => {
            const s = this.stage(id);
            this.setStage(id, { detail: { ...(s.detail ?? {}), ...d } });
          },
        };

        try {
          await this.runStage(id, ctx);
          if (controller.signal.aborted) throw new CancelledSignal();
          const after = this.stage(id);
          if (after.status === "skipped") {
            this.setStage(id, { endedAt: Date.now() });
            this.log(`stage "${STAGE_TITLES[id]}" skipped`);
          } else {
            this.setStage(id, { status: "completed", endedAt: Date.now(), activity: "Completed" });
            this.log(`stage "${STAGE_TITLES[id]}" completed`);
          }
          this.emit();
        } catch (e) {
          if (e instanceof CancelledSignal || e instanceof InstallCancelledError || controller.signal.aborted) {
            this.markCancelled(i);
            return;
          }
          if (e instanceof AwaitAuthenticationSignal) {
            this.setStage(id, {
              status: "awaiting",
              endedAt: Date.now(),
              activity: "Waiting for provider authentication",
            });
            this.state.status = "awaiting-auth";
            this.state.currentStage = id;
            this.log("provider authentication required — waiting for the user");
            this.emit();
            return;
          }
          const err = toStageError(e);
          this.setStage(id, {
            status: "failed",
            endedAt: Date.now(),
            activity: err.message,
            error: err,
          });
          this.state.status = "failed";
          this.state.error = { stage: id, ...err };
          this.log(`stage "${STAGE_TITLES[id]}" failed: ${err.message}`);
          audit().error("install", `Stage ${id} failed: ${err.message}`, { code: err.code });
          this.emit();
          return;
        }
      }

      this.state.status = "completed";
      this.state.currentStage = null;
      this.state.endedAt = Date.now();
      this.state.error = null;
      this.log("installation completed successfully");
      audit().info("install", `Installation ${this.state.id} completed`);
      this.emit();
    })();

    this.running = run.finally(() => {
      this.running = null;
      this.abort = null;
    });
    await this.running;
  }

  private markCancelled(fromIndex: number): void {
    this.state.status = "cancelled";
    this.state.cancelRequested = true;
    this.state.endedAt = Date.now();
    this.state.stages = this.state.stages.map((s, i) => {
      if (i < fromIndex && (s.status === "completed" || s.status === "skipped")) return s;
      if (s.status === "running" || s.status === "pending") {
        return { ...s, status: "cancelled", activity: "Cancelled", endedAt: Date.now() };
      }
      if (s.status === "failed" && i > fromIndex) {
        return { ...s, status: "pending", error: undefined };
      }
      return s;
    });
    this.log("installation cancelled — completed stages were preserved");
    audit().info("install", "Installation cancelled by the user");
    this.emit();
  }

  // ------------------------------------------------------------ stage runners
  private async runStage(id: InstallStageId, ctx: StageContext): Promise<void> {
    switch (id) {
      case "environment":
        return this.stageEnvironment(ctx);
      case "install":
        return this.stageInstall(ctx);
      case "verify":
        return this.stageVerify(ctx);
      case "server":
        return this.stageServer(ctx);
      case "connect":
        return this.stageConnect(ctx);
      case "auth":
        return this.stageAuth(ctx);
      case "discover":
        return this.stageDiscover(ctx);
      case "complete":
        return this.stageComplete(ctx);
    }
  }

  private async stageEnvironment(ctx: StageContext): Promise<void> {
    const report = await collectEnvironment({
      onActivity: ctx.activity,
      signal: ctx.signal,
    });
    if (ctx.signal.aborted) throw new CancelledSignal();
    this.state.environment = report;
    ctx.detail({
      platform: `${report.platformLabel} ${report.platformRelease} (${report.arch})`,
      node: report.node,
      npm: report.npm ?? "not found",
      methods: report.methods.map((m) => `${m.id}: ${m.available ? "available" : "unavailable"}`),
      ports:
        report.ports
          .filter((p) => p.inUse)
          .map((p) => `${p.port} in use`)
          .join(", ") || "probe ports free",
      installations: report.existingInstallations.map((i) => `${i.path} (${i.version ?? "?"})`),
      servers: report.existingServers.map((s) => s.url),
      configFiles: report.configFiles.filter((c) => c.exists).map((c) => c.path),
    });
    for (const note of report.notes) ctx.log(`[env] ${note}`);

    const alreadyInstalled = report.existingInstallations.length > 0;
    if (!alreadyInstalled && !report.canInstall) {
      throw new LabError({
        code: "UNKNOWN",
        message: "This device has no supported automatic OpenCode installation method.",
        detail: report.methods.map((m) => `${m.label}: ${m.detail ?? ""}`).join("\n"),
        recovery:
          "Install OpenCode manually with npm install -g opencode-ai (or the official script), then press Re-detect.",
      });
    }
    ctx.activity(
      alreadyInstalled
        ? `Environment ready — existing installation at ${report.existingInstallations[0].path}`
        : `Environment ready — ${report.platformLabel}/${report.arch}, will install via ${report.methods.find((m) => m.selected)?.label ?? "detected method"}`
    );
  }

  private async stageInstall(ctx: StageContext): Promise<void> {
    const env = this.state.environment;
    if (!env) throw new LabError({ code: "UNKNOWN", message: "Environment was not checked." });

    const existing = env.existingInstallations.length > 0 ? env.existingInstallations[0] : null;
    if (existing) {
      this.log(`[install] existing installation found at ${existing.path} — skipping reinstall`);
      ctx.activity("Existing installation found — nothing to install");
      ctx.detail({ skipped: true, existing });
      this.setStage("install", { status: "skipped" });
      return;
    }

    ctx.activity("Preparing the installer…");
    const outcome = await runInstallation(env, {
      signal: ctx.signal,
      elevated: ctx.elevated,
      onActivity: ctx.activity,
      onLog: ctx.log,
    });
    if (ctx.signal.aborted) throw new CancelledSignal();
    ctx.detail({
      method: outcome.method,
      command: outcome.commandLabel,
      durationMs: outcome.durationMs,
      outputTail: outcome.output.slice(-25),
    });
    this.log(`[install] ${outcome.method} finished in ${outcome.durationMs}ms`);
    ctx.activity("Installer finished");
  }

  private async stageVerify(ctx: StageContext): Promise<void> {
    ctx.activity("Locating the OpenCode executable…");
    const info = await detectInstallation();
    if (ctx.signal.aborted) throw new CancelledSignal();
    if (!info.installed || !info.path) {
      throw new LabError({
        code: "OPENCODE_NOT_INSTALLED",
        message: "OpenCode could not be found after installation.",
        detail: info.diagnostics.join("\n"),
        recovery:
          "The installer may have failed silently or PATH was not updated. Expand the technical details, retry the stage, or reinstall manually.",
      });
    }

    ctx.activity(`Verifying ${info.path} responds to --version…`);
    if (!info.version) {
      throw new LabError({
        code: "OPENCODE_BINARY_UNRESOLVED",
        message: "The OpenCode executable was found but did not report a version.",
        detail: info.diagnostics.join("\n"),
        recovery: "Retry verification; if it keeps failing, reinstall OpenCode.",
      });
    }

    const onPath = info.diagnostics.some((d) => d.startsWith("PATH lookup resolved"));
    this.state.installation = { path: info.path, version: info.version, method: info.method };
    ctx.detail({
      path: info.path,
      version: info.version,
      method: info.method,
      onPath,
      pathRefreshRequired: !onPath,
      diagnostics: info.diagnostics.slice(-8),
    });
    if (!onPath) {
      ctx.log("[verify] binary is not on PATH yet — a terminal/app restart may be needed for new shells");
    }
    ctx.activity(`Verified OpenCode ${info.version} at ${info.path}`);
  }

  private async stageServer(ctx: StageContext): Promise<void> {
    const conn = getConnection();
    ctx.activity("Detecting a running server, otherwise starting a private one…");
    const state = await conn.connect({ portFallback: true });
    if (ctx.signal.aborted) throw new CancelledSignal();

    const s = state.server;
    if (s.state !== "running" || !state.baseUrl) {
      const portBusy = Boolean(s.portConflict) || /port \d+ is already in use/i.test(s.error ?? "");
      throw new LabError({
        code: portBusy ? "SERVER_PORT_IN_USE" : s.state === "not-installed" ? "OPENCODE_NOT_INSTALLED" : "SERVER_START_FAILED",
        message: s.error || `OpenCode server did not start (state: ${s.state}).`,
        detail: s.logs?.slice(-20).join("\n"),
        recovery:
          s.state === "not-installed"
            ? "OpenCode is not installed — retry the installation."
            : portBusy
              ? "The preferred port is still busy. Nexuss never terminates unrelated processes; retry to pick another free port."
              : "Check the technical detail, then retry. Nexuss never terminates unrelated processes.",
      });
    }

    this.state.server = {
      baseUrl: state.baseUrl,
      port: s.port ?? Number(new URL(state.baseUrl).port),
      pid: s.pid,
      owned: s.owned,
      state: s.state,
    };
    ctx.detail({
      baseUrl: state.baseUrl,
      port: s.port,
      pid: s.pid,
      owned: s.owned,
      adopted: !s.owned,
      logTail: s.logs?.slice(-12),
    });
    this.log(`[server] ${s.owned ? "started" : "adopted"} at ${state.baseUrl} pid=${s.pid ?? "?"}`);
    ctx.activity(s.owned ? `Server started at ${state.baseUrl}` : `Adopted existing server at ${state.baseUrl}`);
  }

  private async stageConnect(ctx: StageContext): Promise<void> {
    const conn = getConnection();
    ctx.activity("Checking that Nexuss can reach the OpenCode API…");
    let state = conn.getState();
    if (!state.clientAvailable || !state.baseUrl) {
      state = await conn.connect({ portFallback: true });
    }
    if (ctx.signal.aborted) throw new CancelledSignal();
    if (!state.clientAvailable || !state.baseUrl) {
      throw new LabError({
        code: "NOT_CONNECTED",
        message: "Nexuss could not establish a connection to the OpenCode server.",
        detail: state.server.error ?? state.server.message,
        recovery: "Retry the stage; if it persists, check the server log in the technical details.",
      });
    }

    ctx.activity("Running a health check against the server…");
    const health = await conn.health();
    if (ctx.signal.aborted) throw new CancelledSignal();
    if (!health.reachable) {
      throw new LabError({
        code: "SERVER_UNREACHABLE",
        message: "The OpenCode server is not answering health checks.",
        detail: health.error,
        recovery: "Wait a moment and retry — the server may still be loading providers.",
      });
    }

    this.state.connection = { connected: true, latencyMs: health.latencyMs };
    ctx.detail({ baseUrl: state.baseUrl, latencyMs: health.latencyMs, health: "reachable" });
    this.log(`[connect] health check OK (${health.latencyMs ?? "?"}ms)`);
    ctx.activity(`Connected to ${state.baseUrl}`);
  }

  private async stageAuth(ctx: StageContext): Promise<void> {
    ctx.activity("Checking provider authentication…");
    const conn = getConnection();
    const directory = getSelections().directory || undefined;
    const auth = await checkAuthentication(conn.getClientOrNull(), directory);
    if (ctx.signal.aborted) throw new CancelledSignal();

    this.state.auth = {
      checked: auth.checked,
      authenticated: auth.authenticated,
      providers: auth.providers,
    };
    ctx.detail({ sources: auth.sources, providers: auth.providers });

    if (!auth.authenticated) {
      this.log("[auth] no provider credential found");
      ctx.activity("No provider credential found — authentication required");
      throw new AwaitAuthenticationSignal();
    }
    this.log(`[auth] authenticated providers: ${auth.providers.join(", ") || "yes"}`);
    ctx.activity(`Authenticated: ${auth.providers.join(", ") || "provider credential present"}`);
  }

  private async stageDiscover(ctx: StageContext): Promise<void> {
    const conn = getConnection();
    const client = conn.getClientOrNull();
    if (!client) {
      throw new LabError({
        code: "NOT_CONNECTED",
        message: "Cannot discover agents and models without a connection.",
        recovery: "Retry the stage to reconnect, then discovery will run again.",
      });
    }
    const directory = getSelections().directory || undefined;

    ctx.activity("Retrieving available agents…");
    const agentsRes = await listAgents(client, directory).then(
      (v) => ({ ok: true as const, value: v }),
      (e) => ({ ok: false as const, error: (e as Error).message })
    );
    if (ctx.signal.aborted) throw new CancelledSignal();

    ctx.activity("Retrieving available models and providers…");
    const modelsRes = await listModels(client, directory).then(
      (v) => ({ ok: true as const, value: v }),
      (e) => ({ ok: false as const, error: (e as Error).message })
    );
    if (ctx.signal.aborted) throw new CancelledSignal();

    if (!agentsRes.ok) {
      throw new LabError({
        code: "AGENT_UNAVAILABLE",
        message: "Agent discovery failed.",
        detail: agentsRes.error,
        recovery: "Retry the stage; check Diagnostics for the OpenCode capability matrix.",
      });
    }
    if (!modelsRes.ok) {
      throw new LabError({
        code: "MODEL_UNAVAILABLE",
        message: "Model discovery failed.",
        detail: modelsRes.error,
        recovery:
          this.state.auth?.authenticated === false
            ? "Add a provider credential and re-check authentication, then retry."
            : "Retry the stage; check Diagnostics for the OpenCode capability matrix.",
      });
    }

    const agents = agentsRes.value;
    if (agents.length === 0) {
      throw new LabError({
        code: "AGENT_UNAVAILABLE",
        message: "The connected OpenCode instance reported no agents.",
        recovery: "Retry the stage; if it persists, check the OpenCode installation with `opencode agent list`.",
      });
    }

    const catalogue = modelsRes.value;
    const usable = availableModels(catalogue.models);
    this.state.discovery = {
      agents: agents.length,
      models: usable.length,
      providers: catalogue.providers.length,
    };
    ctx.detail({
      agentNames: agents.filter((a) => !a.hidden).map((a) => a.name),
      totalModels: catalogue.models.length,
      usableModels: usable.length,
      providers: catalogue.providers.map((p) => `${p.name}${p.authenticated ? "" : " (no credential)"}`),
      authenticatedProviders: catalogue.providers.filter((p) => p.authenticated).length,
    });
    this.log(
      `[discover] ${agents.length} agents, ${usable.length}/${catalogue.models.length} models usable, ${catalogue.providers.length} providers`
    );
    ctx.activity(
      `Found ${agents.length} agents and ${usable.length} usable models`
    );
  }

  private async stageComplete(ctx: StageContext): Promise<void> {
    const { installation, server, connection, auth, discovery } = this.state;
    this.state.summary = {
      installationPath: installation?.path,
      version: installation?.version,
      method: installation?.method,
      serverUrl: server?.baseUrl,
      serverPort: server?.port,
      serverPid: server?.pid,
      serverOwned: server?.owned,
      connected: connection?.connected,
      latencyMs: connection?.latencyMs,
      authenticated: auth?.authenticated,
      authProviders: auth?.providers,
      agents: discovery?.agents,
      models: discovery?.models,
      providers: discovery?.providers,
    };
    ctx.detail({ ...this.state.summary });
    ctx.activity("All stages completed");
  }
}

function STAGE_TITLE(id: InstallStageId): string {
  return STAGE_TITLES[id];
}

const g = globalThis as unknown as { __nexussInstallManager?: InstallManager };

export function getInstallManager(): InstallManager {
  if (!g.__nexussInstallManager) g.__nexussInstallManager = new InstallManager();
  return g.__nexussInstallManager;
}

/** Test hook: replace/reset the process-wide install manager. */
export function setInstallManager(m: InstallManager | undefined): void {
  g.__nexussInstallManager = m;
}
