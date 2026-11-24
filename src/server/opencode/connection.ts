import { LabError } from "../errors";
import { detectInstallation, type InstallationInfo } from "./detector";
import { OpenCodeServerManager, probeServer, type ServerDiagnostics } from "./server-manager";
import { OpenCodeClient } from "./client";
import { getEventHub, type EventHubStatus } from "./event-stream";
import { getSelections } from "../lab-state";

export interface ConnectionState {
  installation: InstallationInfo | null;
  server: ServerDiagnostics;
  clientAvailable: boolean;
  baseUrl?: string;
  /** Last successful round-trip latency in ms. */
  latencyMs?: number;
  checkedAt: number;
}

export interface LabConfig {
  preferredUrl?: string;
  startPort: number;
  hostname: string;
  password?: string;
  startTimeoutMs: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): LabConfig {
  const startPort = Number(env.OPENCODE_SERVER_START_PORT ?? 4981);
  const hostname = env.OPENCODE_SERVER_HOSTNAME ?? "127.0.0.1";
  if (hostname !== "127.0.0.1" && hostname !== "localhost" && hostname !== "::1") {
    throw new LabError({
      code: "INVALID_SERVER_ADDRESS",
      message: `OPENCODE_SERVER_HOSTNAME must be loopback (got "${hostname}").`,
      recovery: "An unauthenticated OpenCode server must never be exposed beyond localhost.",
    });
  }
  const password = env.OPENCODE_SERVER_PASSWORD || undefined;
  return {
    preferredUrl: env.OPENCODE_SERVER_URL || undefined,
    startPort: Number.isFinite(startPort) ? startPort : 4981,
    hostname,
    password,
    startTimeoutMs: Number(env.OPENCODE_SERVER_START_TIMEOUT_MS ?? 30_000),
  };
}

/**
 * Process-wide Lab connection state. One server manager + one client + one
 * event hub are shared by every API route so we never open duplicate servers
 * or duplicate upstream SSE connections.
 */
export class LabConnection {
  private manager: OpenCodeServerManager;
  private client: OpenCodeClient | null = null;
  private state: ConnectionState;
  private config: LabConfig;
  private connecting: Promise<ConnectionState> | null = null;

  constructor(config: LabConfig = loadConfig()) {
    this.config = config;
    this.manager = new OpenCodeServerManager({
      preferredUrl: config.preferredUrl,
      startPort: config.startPort,
      hostname: config.hostname,
      password: config.password,
      startTimeoutMs: config.startTimeoutMs,
    });
    this.state = {
      installation: null,
      server: {
        state: "stopped",
        owned: false,
        authConfigured: Boolean(config.password),
        logs: [],
      },
      clientAvailable: false,
      checkedAt: Date.now(),
    };
  }

  getState(): ConnectionState {
    return { ...this.state };
  }

  getConfig(): LabConfig {
    return { ...this.config };
  }

  /** The client. Throws a clear error when not connected. */
  requireClient(): OpenCodeClient {
    if (!this.client || !this.state.clientAvailable) {
      throw new LabError({
        code: "NOT_CONNECTED",
        status: 503,
        message: "Not connected to an OpenCode server.",
        recovery: "Open the Connection page and press Connect before using this feature.",
      });
    }
    return this.client;
  }

  getClientOrNull(): OpenCodeClient | null {
    return this.client;
  }

  /** Detect installation + adopt/start server + wire client + start event hub. */
  async connect(opts: { portFallback?: boolean } = {}): Promise<ConnectionState> {
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      if (!this.state.installation) {
        this.state = {
          ...this.state,
          installation: await detectInstallation().catch(() => null),
          checkedAt: Date.now(),
        };
      }
      const server = await this.manager.connect(opts);
      this.state = {
        ...this.state,
        installation: this.state.installation,
        server,
        clientAvailable: server.state === "running" && Boolean(server.baseUrl),
        baseUrl: server.baseUrl,
        checkedAt: Date.now(),
      };

      if (server.state === "running" && server.baseUrl) {
        this.client = new OpenCodeClient({
          baseUrl: server.baseUrl,
          password: this.config.password,
        });
        try {
          const t0 = Date.now();
          await this.client.getPath();
          this.state.latencyMs = Date.now() - t0;
        } catch (e) {
          this.state.latencyMs = undefined;
          this.state.server = {
            ...server,
            state: "unreachable",
            error: (e as Error).message,
          };
          this.state.clientAvailable = false;
          this.client = null;
        }
        if (this.client) {
          await getEventHub().start(server.baseUrl, {
            password: this.config.password,
            directory: getSelections().directory || undefined,
          });
        }
      } else {
        this.client = null;
        await getEventHub().stop();
      }
      return this.getState();
    })().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  /** Refresh installation detection without touching the server. */
  async refreshInstallation(): Promise<InstallationInfo> {
    const installation = await detectInstallation();
    this.state = { ...this.state, installation, checkedAt: Date.now() };
    return installation;
  }

  /** Lightweight liveness re-check used by the dashboard polling endpoint. */
  async health(): Promise<{ reachable: boolean; latencyMs?: number; error?: string }> {
    if (!this.state.baseUrl) return { reachable: false, error: "No server address configured." };
    const r = await probeServer(this.state.baseUrl);
    if (r.ok) {
      this.state = { ...this.state, latencyMs: r.latencyMs, clientAvailable: true, checkedAt: Date.now() };
      return { reachable: true, latencyMs: r.latencyMs };
    }
    this.state = {
      ...this.state,
      clientAvailable: false,
      checkedAt: Date.now(),
      server: { ...this.state.server, state: "unreachable", error: r.error },
    };
    return { reachable: false, error: r.error };
  }

  async disconnect(): Promise<void> {
    await getEventHub().stop();
    await this.manager.disconnect();
    this.client = null;
    this.state = {
      ...this.state,
      clientAvailable: false,
      baseUrl: undefined,
      latencyMs: undefined,
      server: { state: "stopped", owned: false, authConfigured: Boolean(this.config.password), logs: this.manager.logLines },
      checkedAt: Date.now(),
    };
  }

  eventHubStatus(): EventHubStatus {
    return getEventHub().getStatus();
  }
}

const g = globalThis as unknown as { __nexussLabConnection?: LabConnection };

export function getConnection(): LabConnection {
  if (!g.__nexussLabConnection) g.__nexussLabConnection = new LabConnection();
  return g.__nexussLabConnection;
}

/** Test hook: replace/reset the process-wide connection. */
export function setConnection(conn: LabConnection | undefined): void {
  g.__nexussLabConnection = conn;
}
