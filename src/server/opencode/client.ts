import { LabError, fromUpstream } from "../errors";
import type {
  AgentInfo,
  DirectoryQuery,
  FileStatus,
  MessageBundle,
  PermissionDecision,
  PermissionRequest,
  PermissionV2Request,
  ProjectInfo,
  ProviderInfo,
  SessionInfo,
  SessionStatus,
  VcsFileStatus,
  V2ModelInfo,
  PathInfo,
  LocationQuery,
} from "./types";

export interface ClientOptions {
  baseUrl: string;
  /** Sent as `Authorization: Bearer <token>` when the server is protected. */
  password?: string;
  timeoutMs?: number;
}

export interface RequestOptions {
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  timeoutMs?: number;
  /** V1 endpoints scope by `?directory=`; V2 by `?location[directory]=`. */
  directory?: string;
}

function buildQuery(opts: RequestOptions): string {
  const sp = new URLSearchParams();
  if (opts.directory) sp.set("directory", opts.directory);
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v === undefined) continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

/** Encode a V2 `location` query parameter (`location[directory]=...`). */
export function locationQuery(loc: LocationQuery): Record<string, string> {
  return { "location[directory]": loc.directory, ...(loc.workspace ? { "location[workspace]": loc.workspace } : {}) };
}

/**
 * Typed HTTP client for the installed OpenCode instance.
 * Speaks BOTH API surfaces exposed by v1.19.5:
 *   - V1 root routes   (/session, /agent, /event, ...)
 *   - V2 /api routes   (/api/session, /api/model, /api/event, ...)
 * Credentials are attached here and never leave the backend.
 */
export class OpenCodeClient {
  readonly baseUrl: string;
  private readonly password?: string;
  private readonly timeoutMs: number;

  constructor(options: ClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.password = options.password;
    this.timeoutMs = options.timeoutMs ?? 60_000;
  }

  private headers(json: boolean): Record<string, string> {
    const h: Record<string, string> = {};
    if (json) h["content-type"] = "application/json";
    if (this.password) h["authorization"] = `Bearer ${this.password}`;
    return h;
  }

  async request<T>(
    method: "GET" | "POST" | "PATCH" | "DELETE" | "PUT",
    pathName: string,
    opts: RequestOptions = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${pathName}${buildQuery(opts)}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? this.timeoutMs);
    const payload = opts.body === undefined ? undefined : JSON.stringify(opts.body);
    try {
      const res = await fetch(url, {
        method,
        headers: this.headers(payload !== undefined),
        body: payload,
        signal: controller.signal,
        cache: "no-store",
      });
      const text = await res.text();
      if (!res.ok) throw fromUpstream(res.status, text, `${method} ${pathName}`);
      if (!text) return undefined as T;
      try {
        return JSON.parse(text) as T;
      } catch {
        return text as unknown as T;
      }
    } catch (e) {
      if (e instanceof LabError) throw e;
      const err = e as Error;
      if (err.name === "AbortError" || /aborted|timeout/i.test(err.message)) {
        throw new LabError({
          code: "CONNECTION_TIMEOUT",
          message: `Timed out calling ${method} ${pathName}.`,
          detail: err.message,
          recovery: "Check the OpenCode server status on the Connection page and retry.",
          cause: e,
        });
      }
      throw new LabError({
        code: "SERVER_UNREACHABLE",
        message: `Could not reach the OpenCode server at ${this.baseUrl}.`,
        detail: err.message,
        recovery: "Open the Connection page, verify the address, and reconnect.",
        cause: e,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  // -------------------------------------------------------------------------
  // Server / capability probing
  // -------------------------------------------------------------------------

  getPath(opts: { directory?: string } = {}) {
    return this.request<PathInfo>("GET", "/path", { directory: opts.directory });
  }

  getHealth() {
    return this.request<{ healthy: boolean }>("GET", "/api/health");
  }

  /** Fetch the OpenAPI document the running instance serves at `/doc`. */
  async getOpenApi(): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("GET", "/doc", { timeoutMs: 20_000 });
  }

  // -------------------------------------------------------------------------
  // Agents / models / providers
  // -------------------------------------------------------------------------

  listAgents(opts: { directory?: string } = {}) {
    return this.request<AgentInfo[]>("GET", "/agent", { directory: opts.directory });
  }

  async listProviders(opts: { directory?: string } = {}): Promise<ProviderInfo[]> {
    const res = await this.request<{ all?: ProviderInfo[] } | ProviderInfo[]>(
      "GET",
      "/provider",
      { directory: opts.directory }
    );
    if (Array.isArray(res)) return res;
    return (res as { all?: ProviderInfo[] }).all ?? [];
  }

  /** V2 model catalogue with `enabled` flags. */
  listModelsV2(loc: LocationQuery) {
    return this.request<{ data: V2ModelInfo[] }>("GET", "/api/model", { query: locationQuery(loc) });
  }

  listCommands(opts: { directory?: string } = {}) {
    return this.request<Array<{ name: string; description?: string; source?: string }>>(
      "GET",
      "/command",
      { directory: opts.directory }
    );
  }

  listSkills(opts: { directory?: string } = {}) {
    return this.request<Array<{ name: string; description?: string }>>("GET", "/skill", {
      directory: opts.directory,
    });
  }

  // -------------------------------------------------------------------------
  // Sessions
  // -------------------------------------------------------------------------

  listSessions(opts: { directory?: string; search?: string; limit?: number } = {}) {
    return this.request<SessionInfo[]>("GET", "/session", {
      directory: opts.directory,
      query: { search: opts.search, limit: opts.limit },
    });
  }

  getSession(sessionID: string) {
    return this.request<SessionInfo>("GET", `/session/${sessionID}`);
  }

  createSession(
    body: { title?: string; agent?: string; model?: { id: string; providerID: string }; parentID?: string },
    opts: { directory?: string } = {}
  ) {
    return this.request<SessionInfo>("POST", "/session", { directory: opts.directory, body });
  }

  updateSession(sessionID: string, body: Record<string, unknown>) {
    return this.request<void>("PATCH", `/session/${sessionID}`, { body });
  }

  deleteSession(sessionID: string) {
    return this.request<void>("DELETE", `/session/${sessionID}`);
  }

  listMessages(sessionID: string, opts: { directory?: string } = {}) {
    return this.request<MessageBundle[]>("GET", `/session/${sessionID}/message`, {
      directory: opts.directory,
    });
  }

  /** V1 synchronous prompt - resolves when the agent turn completes. */
  prompt(
    sessionID: string,
    body: {
      parts: Array<{ type: "text"; text: string }>;
      agent?: string;
      model?: { providerID: string; modelID: string };
      messageID?: string;
    },
    opts: { directory?: string; timeoutMs?: number } = {}
  ) {
    return this.request<{ info: unknown; parts: unknown[] }>(
      "POST",
      `/session/${sessionID}/message`,
      { directory: opts.directory, body, timeoutMs: opts.timeoutMs ?? 300_000 }
    );
  }

  abortSession(sessionID: string, opts: { directory?: string } = {}) {
    return this.request<boolean>("POST", `/session/${sessionID}/abort`, { directory: opts.directory });
  }

  interruptSession(sessionID: string) {
    return this.request<void>("POST", `/api/session/${sessionID}/interrupt`);
  }

  switchAgent(sessionID: string, agent: string) {
    return this.request<void>("POST", `/api/session/${sessionID}/agent`, { body: { agent } });
  }

  switchModel(sessionID: string, model: { id: string; providerID: string }) {
    return this.request<void>("POST", `/api/session/${sessionID}/model`, { body: { model } });
  }

  getSessionStatus(opts: { directory?: string } = {}) {
    return this.request<Record<string, SessionStatus>>("GET", "/session/status", {
      directory: opts.directory,
    });
  }

  getSessionDiff(sessionID: string, opts: { directory?: string } = {}) {
    return this.request<unknown>("GET", `/session/${sessionID}/diff`, { directory: opts.directory });
  }

  // -------------------------------------------------------------------------
  // Permissions
  // -------------------------------------------------------------------------

  listPermissions(opts: { directory?: string } = {}) {
    return this.request<PermissionRequest[]>("GET", "/permission", { directory: opts.directory });
  }

  respondPermission(
    sessionID: string,
    permissionID: string,
    response: PermissionDecision,
    opts: { directory?: string } = {}
  ) {
    return this.request<boolean>("POST", `/session/${sessionID}/permissions/${permissionID}`, {
      directory: opts.directory,
      body: { response },
    });
  }

  listPermissionsV2(loc: LocationQuery) {
    return this.request<{ location: unknown; data: PermissionV2Request[] }>(
      "GET",
      "/api/permission/request",
      { query: locationQuery(loc) }
    );
  }

  replyPermissionV2(
    sessionID: string,
    requestID: string,
    reply: PermissionDecision,
    message?: string
  ) {
    return this.request<void>("POST", `/api/session/${sessionID}/permission/${requestID}/reply`, {
      body: { reply, message },
      timeoutMs: 15_000,
    });
  }

  // -------------------------------------------------------------------------
  // Project / files / VCS
  // -------------------------------------------------------------------------

  fileStatus(opts: { directory?: string } = {}) {
    return this.request<FileStatus[]>("GET", "/file/status", { directory: opts.directory });
  }

  vcsStatus(opts: { directory?: string } = {}) {
    return this.request<VcsFileStatus[]>("GET", "/vcs/status", { directory: opts.directory });
  }

  vcsDiff(opts: { directory?: string } = {}) {
    return this.request<unknown>("GET", "/vcs/diff", { directory: opts.directory });
  }

  listProjects() {
    return this.request<ProjectInfo[]>("GET", "/project");
  }

  currentProject(opts: { directory?: string } = {}) {
    return this.request<ProjectInfo>("GET", "/project/current", { directory: opts.directory });
  }

  listFilesystem(opts: { directory?: string; path?: string }) {
    return this.request<unknown>("GET", "/api/fs/list", {
      query: { ...(opts.path ? { path: opts.path } : {}) },
      ...(opts.directory ? { query: { "location[directory]": opts.directory, ...(opts.path ? { path: opts.path } : {}) } } : {}),
    });
  }

  /** Directory listing used by the project inspector. */
  async listDirectory(dir: string, sub = ""): Promise<Array<{ name: string; type: "file" | "dir"; size?: number }>> {
    const res = await this.request<{ entries?: Array<{ name: string; type: string; size?: number }> } | Array<{ name: string; type: string }>>(
      "GET",
      "/api/fs/list",
      { query: { "location[directory]": dir, ...(sub ? { path: sub } : {}) } }
    );
    const entries = Array.isArray(res) ? res : (res?.entries ?? []);
    return entries.map((e) => ({
      name: e.name,
      type: (e.type === "directory" || e.type === "dir" ? "dir" : "file") as "file" | "dir",
      size: (e as { size?: number }).size,
    }));
  }
}
