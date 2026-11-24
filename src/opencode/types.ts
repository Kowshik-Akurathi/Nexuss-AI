/**
 * Shared types for the migrated Nexuss Lab / OpenCode integration.
 * Frontend counterpart of the payloads produced by src/server routes.
 */

export interface AgentRow {
  name: string;
  description: string;
  mode: string;
  hidden: boolean;
  native: boolean;
  color?: string;
  allows: number;
  asks: number;
  denies: number;
  canEdit: boolean;
  canShell: boolean;
}

export interface ModelRow {
  ref: string;
  id: string;
  providerID: string;
  providerName: string;
  name: string;
  context?: number;
  status?: string;
  enabled?: boolean;
  authenticated: boolean;
  toolCall: boolean;
  reasoning: boolean;
}

export interface ProviderRow {
  id: string;
  name: string;
  source: string;
  authenticated: boolean;
  modelCount: number;
}

export interface SessionRow {
  id: string;
  title: string;
  directory: string;
  agent?: string;
  model?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ChatItem {
  kind: "user" | "assistant" | "tool" | "reasoning" | "step" | "error" | "system";
  id: string;
  messageID: string;
  text?: string;
  tool?: string;
  toolState?: string;
  toolInput?: unknown;
  toolOutput?: unknown;
  error?: string;
  at: number;
}

export interface PermissionRow {
  id: string;
  sessionID: string;
  action: string;
  resources: string[];
  savePatterns: string[];
  description: string;
  risk: "high" | "medium" | "low";
  source: "v1" | "v2";
}

export interface LabEvent {
  type: string;
  properties: Record<string, unknown>;
  at: number;
  /** Monotonic per-browser sequence so consumers can process every frame exactly once. */
  seq: number;
}

export interface StatusPayload {
  connected: boolean;
  latencyMs: number | null;
  installation: {
    installed: boolean;
    version: string | null;
    path: string | null;
    method: string | null;
    guidance: string | null;
  } | null;
  server: {
    state: string;
    baseUrl: string | null;
    owned: boolean;
    pid: number | null;
    authRequired: boolean;
    authConfigured: boolean;
    error: string | null;
    message: string | null;
    uptimeMs: number | null;
  };
  events: { connected: boolean; eventsReceived: number; error?: string; reconnectAttempts: number };
  selections: { directory: string; agent: string; model: string; sessionID?: string };
  lab: { sessions: number; executions: number; failed: number };
  agents: AgentRow[];
  models: ModelRow[];
  providers: ProviderRow[];
  sessions: SessionRow[];
  activeSession: SessionRow | null;
  errors?: { agents: string | null; models: string | null };
  checkedAt: number;
}

export interface ExecutionView {
  id: string;
  sessionID: string;
  phase: string;
  events: Array<{ type: string; at: number; summary: string }>;
  toolCalls: Array<{ tool: string; state: string; at: number }>;
  error?: string;
  finalText?: string;
}

export interface ResultsView {
  status: string;
  summary: string;
  filesCreated: string[];
  filesModified: string[];
  filesDeleted: string[];
  filesObserved?: string[];
  additions: number;
  deletions: number;
  commands: string[];
  errors: string[];
  verifiedOnDisk: boolean;
  fileChecks: Array<{ path: string; exists: boolean; size?: number }>;
  durationMs?: number;
  toolsUsed: Array<{ tool: string; state: string }>;
}

export interface StoredExecution {
  id: string;
  session_id: string;
  directory: string;
  prompt: string;
  status: string;
  started_at: number;
  ended_at: number | null;
  tools_used: number;
  files_changed: number;
  error: string | null;
}

export interface VcsFileStatus {
  path: string;
  status: string;
  additions?: number;
  deletions?: number;
}

export interface FileStatusRow {
  path: string;
  status: string;
}

export interface ProjectInfoView {
  path: string;
  label: string;
  exists: boolean;
  isDirectory: boolean;
  fileCount: number;
  git: boolean;
  branch?: string;
  files: Array<{ name: string; type: string; size?: number }>;
  changes: VcsFileStatus[];
  fileChanges: FileStatusRow[];
  warnings: string[];
}

export interface AllowedRoot {
  path: string;
  label?: string;
  source: string;
}

export interface ConnectionPayload {
  installation: StatusPayload["installation"] & { guidance?: string | null };
  server: StatusPayload["server"];
  connected: boolean;
  baseUrl: string | null;
  latencyMs: number | null;
  config: {
    preferredUrl: string | null;
    startPort: number;
    hostname: string;
    passwordConfigured: boolean;
    startTimeoutMs?: number;
  };
  events: StatusPayload["events"];
  checkedAt: number;
}

export interface CapabilityRow {
  id: string;
  label: string;
  supported: boolean;
  endpoint: string;
  note?: string;
}

export interface DiagnosticsPayload {
  node: { version: string; platform: string; arch: string };
  installation: StatusPayload["installation"];
  server: StatusPayload["server"];
  connected: boolean;
  baseUrl: string | null;
  latencyMs: number | null;
  events: StatusPayload["events"];
  capabilities: CapabilityRow[];
  openapi: { paths: number; error: string | null };
  lab: {
    root: string;
    roots: AllowedRoot[];
    stats: { sessions: number; executions: number; failed: number };
    dataDir: string;
  };
  config: ConnectionPayload["config"];
  log: Array<{ at?: number; ts?: number; level?: string; scope?: string; message?: string; [k: string]: unknown }>;
}

export interface SettingsPayload {
  selections: StatusPayload["selections"];
  config: ConnectionPayload["config"] & { startTimeoutMs: number };
  lab: { root: string; roots: AllowedRoot[]; dataDir: string; node: string };
  stats: { sessions: number; executions: number; failed: number };
  env: {
    OPENCODE_SERVER_URL_SET: boolean;
    OPENCODE_SERVER_PASSWORD_SET: boolean;
    LAB_EXTRA_PROJECT_ROOTS_SET: boolean;
    LAB_DATA_DIR_SET: boolean;
  };
}

export interface ApiErrorBody {
  error?: { code?: string; message?: string; detail?: string; recovery?: string };
}
