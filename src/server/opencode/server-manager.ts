import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { LabError } from "../errors";
import { detectInstallation, requireInstallation, type InstallationInfo } from "./detector";

export type ServerState =
  | "stopped"
  | "starting"
  | "running"
  | "unreachable"
  | "error"
  | "not-installed";

export interface ServerDiagnostics {
  state: ServerState;
  /** Base URL of the OpenCode server, when reachable. */
  baseUrl?: string;
  host?: string;
  port?: number;
  /** True when this Lab spawned the process (vs. adopted an existing one). */
  owned: boolean;
  pid?: number;
  version?: string;
  /** True when the server requires OPENCODE_SERVER_PASSWORD. */
  authRequired?: boolean;
  authConfigured: boolean;
  message?: string;
  error?: string;
  startedAt?: number;
  uptimeMs?: number;
  logs: string[];
  portConflict?: boolean;
}

export interface ServerManagerOptions {
  /** Preferred URL of an already-running server (env OPENCODE_SERVER_URL). */
  preferredUrl?: string;
  /** Port to start a private server on (env OPENCODE_SERVER_START_PORT). */
  startPort?: number;
  hostname?: string;
  password?: string;
  startTimeoutMs?: number;
  /** Extra ports to probe when adopting an existing server. */
  probePorts?: number[];
}

const DEFAULT_PROBE_PORTS = [4981, 4096, 6096, 5096, 8080];

function nowLog(line: string): string {
  return `[${new Date().toISOString()}] ${line}`;
}

/** Returns true when something is already listening on the port. */
export async function isPortListening(port: number, host = "127.0.0.1"): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const done = (v: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(v);
    };
    socket.setTimeout(700);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
    socket.connect(port, host);
  });
}

/** Find a free TCP port starting at `preferred` (never kills anything). */
export async function findFreePort(preferred: number, host = "127.0.0.1"): Promise<number> {
  if (preferred > 0 && !(await isPortListening(preferred, host))) return preferred;
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", (e) => reject(e));
    srv.listen(0, host, () => {
      const addr = srv.address();
      const p = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => (p ? resolve(p) : reject(new Error("no free port"))));
    });
  });
}

async function fetchJson(baseUrl: string, pathName: string, timeoutMs = 5000): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}${pathName}`, { signal: ctrl.signal });
    const text = await res.text();
    if (!res.ok) {
      throw new LabError({
        code: res.status === 401 ? "AUTH_FAILED" : "UPSTREAM_ERROR",
        status: res.status,
        message: `OpenCode responded HTTP ${res.status} for ${pathName}.`,
        detail: text.slice(0, 400),
      });
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new LabError({
        code: "API_VERSION_UNSUPPORTED",
        message: `OpenCode returned a non-JSON body for ${pathName}.`,
        detail: text.slice(0, 400),
        recovery: "The address may point at something other than an OpenCode server.",
      });
    }
  } finally {
    clearTimeout(t);
  }
}

/**
 * Probes a base URL and returns a structured verdict instead of throwing,
 * so the dashboard can show diagnostics for every candidate address.
 */
export async function probeServer(baseUrl: string): Promise<{
  ok: boolean;
  version?: string;
  pid?: number;
  authRequired?: boolean;
  error?: string;
  latencyMs: number;
}> {
  const started = Date.now();
  try {
    const info = (await fetchJson(baseUrl, "/path", 4000)) as { home?: string; directory?: string };
    let version: string | undefined;
    let pid: number | undefined;
    try {
      // `/global/health` is present on this build; `/path` proves the API surface.
      const health = (await fetchJson(baseUrl, "/global/health", 4000)) as Record<string, unknown>;
      if (health && typeof health === "object") {
        if (typeof health.version === "string") version = health.version;
        if (typeof health.pid === "number") pid = health.pid;
      }
    } catch {
      /* health endpoint is optional; /path already succeeded */
    }
    return { ok: true, version, pid, latencyMs: Date.now() - started, authRequired: false, error: undefined, ...(info ? {} : {}) };
  } catch (e) {
    const err = e as LabError;
    return {
      ok: false,
      latencyMs: Date.now() - started,
      error: err?.message || (e as Error).message,
      authRequired: err?.code === "AUTH_FAILED",
    };
  }
}

export interface ConnectionAttempt {
  baseUrl: string;
  adopted: boolean;
  version?: string;
  pid?: number;
}

/**
 * Finds a usable OpenCode server without starting a duplicate:
 *  1. preferred URL from config
 *  2. a list of probe ports
 * Never kills or disturbs an existing process.
 */
export async function findRunningServer(
  opts: ServerManagerOptions
): Promise<ConnectionAttempt | null> {
  const host = opts.hostname || "127.0.0.1";
  const urls: string[] = [];
  if (opts.preferredUrl) urls.push(opts.preferredUrl.replace(/\/$/, ""));
  for (const p of opts.probePorts ?? DEFAULT_PROBE_PORTS) {
    urls.push(`http://${host}:${p}`);
  }
  const seen = new Set<string>();
  for (const url of urls) {
    if (seen.has(url)) continue;
    seen.add(url);
    const r = await probeServer(url);
    if (r.ok) return { baseUrl: url, adopted: true, version: r.version, pid: r.pid };
  }
  return null;
}

/**
 * Spawns a PRIVATE OpenCode server bound to loopback only.
 * Refuses to start when the port is already occupied (never hijacks it).
 */
export class OpenCodeServerManager {
  private child: ChildProcess | null = null;
  private opts: Required<Omit<ServerManagerOptions, "preferredUrl" | "probePorts">> &
    Pick<ServerManagerOptions, "preferredUrl" | "probePorts">;
  private logs: string[] = [];
  private installation: InstallationInfo | null = null;
  private baseUrl: string | null = null;
  private owned = false;
  private startedAt = 0;
  private state: ServerState = "stopped";
  private portFallback = false;

  constructor(options: ServerManagerOptions = {}) {
    this.opts = {
      startPort: options.startPort ?? 4981,
      hostname: options.hostname ?? "127.0.0.1",
      password: options.password ?? "",
      startTimeoutMs: options.startTimeoutMs ?? 30_000,
      preferredUrl: options.preferredUrl,
      probePorts: options.probePorts,
    };
  }

  private log(line: string) {
    this.logs.push(nowLog(line));
    if (this.logs.length > 300) this.logs.splice(0, this.logs.length - 300);
  }

  get logLines() {
    return [...this.logs];
  }

  get isOwned() {
    return this.owned;
  }

  get currentBaseUrl() {
    return this.baseUrl;
  }

  /** Detect installation, then adopt or start a server.
   *  `portFallback` (used by the installation workflow) selects a free port
   *  when the preferred one is occupied by a non-OpenCode process instead of
   *  failing. It never terminates or hijacks the occupant. */
  async connect(opts: { portFallback?: boolean } = {}): Promise<ServerDiagnostics> {
    this.state = "starting";
    this.log("connect() requested");
    this.portFallback = Boolean(opts.portFallback);

    try {
      this.installation = requireInstallation(await detectInstallation());
    } catch (e) {
      this.state = "not-installed";
      const err = e as LabError;
      this.log(`installation not found: ${err.message}`);
      return this.snapshot({ error: err.message });
    }
    this.log(`installation: ${this.installation.path} (${this.installation.version})`);

    // 1) adopt an already-running server
    const existing = await findRunningServer(this.opts);
    if (existing) {
      this.baseUrl = existing.baseUrl;
      this.owned = false;
      this.state = "running";
      this.log(`adopted existing server at ${existing.baseUrl}`);
      const auth = await this.detectAuth();
      return this.snapshot({ authRequired: auth });
    }
    this.log("no existing server found on probe list");

    // 2) start our own private server
    try {
      const url = await this.startOwned();
      this.baseUrl = url;
      this.owned = true;
      this.state = "running";
      const auth = await this.detectAuth();
      return this.snapshot({ authRequired: auth });
    } catch (e) {
      // Preferred port busy and fallback allowed -> retry once on a free port.
      const err = e as LabError;
      if (err.code === "SERVER_PORT_IN_USE" && this.portFallback) {
        this.log(`preferred port busy, retrying on an ephemeral free port`);
        try {
          const alt = await findFreePort(0, this.opts.hostname);
          const url = await this.startOwned(alt);
          this.baseUrl = url;
          this.owned = true;
          this.state = "running";
          const auth = await this.detectAuth();
          return this.snapshot({ authRequired: auth });
        } catch (e2) {
          const err2 = e2 as LabError;
          this.state = "error";
          this.log(`start failed after port fallback: ${err2.message}`);
          return this.snapshot({ error: err2.message, portConflict: err2.code === "SERVER_PORT_IN_USE" });
        }
      }
      this.state = "error";
      this.log(`start failed: ${err.message}`);
      return this.snapshot({ error: err.message, portConflict: err.code === "SERVER_PORT_IN_USE" });
    }
  }

  private async detectAuth(): Promise<boolean> {
    if (!this.baseUrl) return false;
    try {
      await fetchJson(this.baseUrl, "/path", 4000);
      return false;
    } catch (e) {
      return (e as LabError)?.code === "AUTH_FAILED";
    }
  }

  private async startOwned(portOverride?: number): Promise<string> {
    const host = this.opts.hostname;
    if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
      throw new LabError({
        code: "INVALID_SERVER_ADDRESS",
        message: `Refusing to bind OpenCode to non-loopback host "${host}".`,
        recovery: "Set OPENCODE_SERVER_HOSTNAME=127.0.0.1. An unauthenticated OpenCode server must not be exposed.",
      });
    }

    const bin = this.installation!.path!;
    let port = portOverride ?? this.opts.startPort;

    if (!portOverride && port > 0 && (await isPortListening(port, host))) {
      throw new LabError({
        code: "SERVER_PORT_IN_USE",
        status: 409,
        message: `Port ${port} is already in use by another process.`,
        detail: `Refusing to start a second OpenCode server on ${host}:${port}.`,
        recovery: `Choose a different OPENCODE_SERVER_START_PORT, or let the Lab adopt the process already listening on ${port}.`,
      });
    }
    if (port <= 0) port = await findFreePort(0, host);

    const env: NodeJS.ProcessEnv = { ...process.env };
    if (this.opts.password) env.OPENCODE_SERVER_PASSWORD = this.opts.password;
    else delete env.OPENCODE_SERVER_PASSWORD;

    this.log(`spawning: ${bin} serve --port ${port} --hostname ${host}`);
    const args = ["serve", "--port", String(port), "--hostname", host, "--print-logs"];

    const child = spawn(bin, args, {
      env,
      cwd: process.cwd(),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.child = child;
    this.startedAt = Date.now();
    this.owned = true;

    const onData = (buf: Buffer) => {
      for (const line of buf.toString().split(/\r?\n/)) {
        if (line.trim()) this.log(`[server] ${line.trim()}`);
      }
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.on("exit", (code, signal) => {
      this.log(`server exited code=${code} signal=${signal}`);
      if (this.state === "running") this.state = "unreachable";
      this.child = null;
    });
    child.on("error", (e) => this.log(`server process error: ${e.message}`));

    const url = `http://${host}:${port}`;
    const deadline = Date.now() + this.opts.startTimeoutMs;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) {
        throw new LabError({
          code: "SERVER_START_FAILED",
          message: `OpenCode server exited during startup (code ${child.exitCode}).`,
          detail: this.logLines.slice(-20).join("\n"),
          recovery: "Check the technical detail for a port conflict or a config error, then retry.",
        });
      }
      if (await isPortListening(port, host)) {
        // Wait until the HTTP API answers before declaring victory.
        const probe = await probeServer(url);
        if (probe.ok) {
          this.log(`server ready at ${url}`);
          return url;
        }
        this.log(`port open but API not ready yet: ${probe.error}`);
      }
      await new Promise((r) => setTimeout(r, 400));
    }

    throw new LabError({
      code: "SERVER_START_TIMEOUT",
      message: `OpenCode server did not become ready within ${this.opts.startTimeoutMs}ms.`,
      detail: this.logLines.slice(-20).join("\n"),
      recovery: "Increase OPENCODE_SERVER_START_TIMEOUT_MS or inspect the log tail above.",
    });
  }

  /** Stop ONLY a server this Lab spawned. Never touches adopted processes. */
  async disconnect(): Promise<void> {
    if (!this.owned || !this.child) {
      this.log("disconnect: nothing owned to stop (adopted servers are left running)");
      this.baseUrl = null;
      this.state = "stopped";
      return;
    }
    const child = this.child;
    this.log(`stopping owned server pid=${child.pid}`);
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          /* already gone */
        }
        resolve();
      }, 5000);
      child.once("exit", () => {
        clearTimeout(t);
        resolve();
      });
      try {
        child.kill();
      } catch {
        clearTimeout(t);
        resolve();
      }
    });
    this.child = null;
    this.baseUrl = null;
    this.owned = false;
    this.state = "stopped";
  }

  private snapshot(extra: { error?: string; authRequired?: boolean; portConflict?: boolean }): ServerDiagnostics {
    return {
      state: this.state,
      baseUrl: this.baseUrl ?? undefined,
      host: this.opts.hostname,
      port: this.baseUrl ? Number(new URL(this.baseUrl).port) : undefined,
      owned: this.owned,
      pid: this.child?.pid,
      version: this.installation?.version,
      authRequired: extra.authRequired,
      authConfigured: Boolean(this.opts.password),
      error: extra.error,
      portConflict: extra.portConflict,
      startedAt: this.startedAt || undefined,
      uptimeMs: this.startedAt ? Date.now() - this.startedAt : undefined,
      logs: this.logLines,
      message:
        this.state === "running"
          ? this.owned
            ? "Connected to an OpenCode server started by this Lab."
            : "Adopted an OpenCode server that was already running."
          : extra.error,
    };
  }
}
