/**
 * Types derived from the OpenAPI document served by the INSTALLED OpenCode
 * instance (`GET /doc` on the running server, v1.19.5). Nothing here is
 * invented - every field was verified against the live spec / live responses.
 */

// ---------------------------------------------------------------------------
// Location / project scoping
// ---------------------------------------------------------------------------

/** V1 query string scope: `?directory=<abs path>` */
export type DirectoryQuery = string;

/** V2 query string scope: `?location[directory]=<abs path>` */
export interface LocationQuery {
  directory: string;
  workspace?: string;
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

export interface PathInfo {
  home: string;
  state: string;
  config: string;
  worktree: string;
  directory: string;
}

// ---------------------------------------------------------------------------
// Agents  (GET /agent -> Agent[])
// ---------------------------------------------------------------------------

export type AgentMode = "primary" | "subagent" | "all";

export interface PermissionRule {
  permission: string;
  pattern: string;
  action: "allow" | "deny" | "ask";
}

export type PermissionRuleset = PermissionRule[];

export interface AgentInfo {
  name: string;
  description?: string;
  mode: AgentMode;
  native?: boolean;
  hidden?: boolean;
  color?: string;
  temperature?: number;
  topP?: number;
  permission: PermissionRuleset;
  options: Record<string, unknown>;
  model?: { providerID: string; modelID: string };
  variant?: string;
  prompt?: string;
  steps?: number;
}

// ---------------------------------------------------------------------------
// Models & providers  (GET /provider -> { all: Provider[] })
// ---------------------------------------------------------------------------

export interface ModelCapabilities {
  temperature?: boolean;
  reasoning?: boolean;
  attachment?: boolean;
  toolcall?: boolean;
  input?: Record<string, boolean>;
  output?: Record<string, boolean>;
}

export interface ModelInfo {
  id: string;
  providerID: string;
  api: { id: string; url: string; npm: string };
  name: string;
  family?: string;
  capabilities: ModelCapabilities;
  cost: { input: number; output: number; cache: { read: number; write: number } };
  limit: { context: number; input?: number; output: number };
  status: "alpha" | "beta" | "deprecated" | "active";
  options?: Record<string, unknown>;
  headers?: Record<string, string>;
  release_date?: string;
  variants?: Record<string, Record<string, unknown>>;
}

export interface ProviderInfo {
  id: string;
  name: string;
  source: "env" | "config" | "custom" | "api";
  env: string[];
  /** Raw credential. NEVER forwarded to the browser. */
  key?: string;
  options: Record<string, unknown>;
  models: Record<string, ModelInfo>;
}

/** `/api/model` response (V2) - flat list with an `enabled` flag. */
export interface V2ModelInfo {
  id: string;
  providerID: string;
  name: string;
  capabilities: Record<string, unknown>;
  status: string;
  enabled: boolean;
  limit: { context: number; output: number };
  cost: unknown[];
  variants: unknown[];
  time: { released: number };
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export interface TokenUsage {
  input: number;
  output: number;
  reasoning: number;
  cache: { read: number; write: number };
}

export interface SessionInfo {
  id: string;
  slug: string;
  projectID: string;
  workspaceID?: string;
  directory: string;
  path?: string;
  parentID?: string;
  title: string;
  agent?: string;
  model?: { id: string; providerID: string; variant?: string };
  version: string;
  cost?: number;
  tokens?: TokenUsage;
  metadata?: Record<string, unknown>;
  permission?: PermissionRuleset;
  time: { created: number; updated: number; compacting?: number; archived?: number };
}

export type SessionStatus =
  | { type: "idle" }
  | { type: "busy" }
  | { type: "retry"; attempt: number; message?: string; action?: unknown };

// ---------------------------------------------------------------------------
// Messages & parts
// ---------------------------------------------------------------------------

export type PartType =
  | "text"
  | "subtask"
  | "reasoning"
  | "file"
  | "tool"
  | "step-start"
  | "step-finish"
  | "snapshot"
  | "patch"
  | "agent"
  | "retry"
  | "compaction";

export interface BasePart {
  id: string;
  sessionID: string;
  messageID: string;
  type: PartType;
}

export interface TextPart extends BasePart {
  type: "text";
  text: string;
  synthetic?: boolean;
  ignored?: boolean;
  time?: { start?: number; end?: number };
}

export interface ReasoningPart extends BasePart {
  type: "reasoning";
  text: string;
  time?: { start?: number; end?: number };
}

export type ToolState =
  | { status: "pending"; input?: Record<string, unknown> }
  | { status: "running"; input?: Record<string, unknown>; time?: { start: number } }
  | {
      status: "completed";
      input?: Record<string, unknown>;
      output?: unknown;
      title?: string;
      time?: { start: number; end: number };
      metadata?: Record<string, unknown>;
    }
  | {
      status: "error";
      input?: Record<string, unknown>;
      error?: unknown;
      time?: { start: number; end: number };
      metadata?: Record<string, unknown>;
    };

export interface ToolPart extends BasePart {
  type: "tool";
  callID: string;
  tool: string;
  state: ToolState;
}

export interface StepStartPart extends BasePart {
  type: "step-start";
}
export interface StepFinishPart extends BasePart {
  type: "step-finish";
  reason?: string;
  cost?: number;
  tokens?: Record<string, number>;
}
export interface PatchPart extends BasePart {
  type: "patch";
  hash?: string;
  files?: Record<string, unknown>;
}
export interface FilePart extends BasePart {
  type: "file";
  mime?: string;
  filename?: string;
  url?: string;
}
export interface AgentPart extends BasePart {
  type: "agent";
  name: string;
}
export interface RetryPart extends BasePart {
  type: "retry";
  attempt?: number;
  error?: unknown;
}
export interface SubtaskPart extends BasePart {
  type: "subtask";
  prompt?: string;
  description?: string;
  agent?: string;
}
export interface SnapshotPart extends BasePart {
  type: "snapshot";
  snapshot?: string;
}
export interface CompactionPart extends BasePart {
  type: "compaction";
}

export type Part =
  | TextPart
  | ReasoningPart
  | ToolPart
  | StepStartPart
  | StepFinishPart
  | PatchPart
  | FilePart
  | AgentPart
  | RetryPart
  | SubtaskPart
  | SnapshotPart
  | CompactionPart;

export type MessageRole = "user" | "assistant" | "system" | "synthetic" | "shell";

export interface MessageInfo {
  id: string;
  sessionID: string;
  role: MessageRole;
  time: { created: number; completed?: number };
  agent?: string;
  model?: { providerID: string; modelID: string; variant?: string };
  modelID?: string;
  providerID?: string;
  mode?: string;
  error?: unknown;
  cost?: number;
  tokens?: Record<string, number>;
  summary?: { title?: string; body?: string; diffs?: unknown[] };
  path?: { cwd?: string; root?: string };
  finish?: string;
}

/** `GET /session/{id}/message` item */
export interface MessageBundle {
  info: MessageInfo;
  parts: Part[];
}

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

/** `GET /permission` (V1) item */
export interface PermissionRequest {
  id: string;
  sessionID: string;
  permission: string;
  patterns: string[];
  metadata: Record<string, unknown>;
  always: string[];
  tool?: { messageID: string; callID: string };
}

/** `GET /api/permission/request` (V2) item */
export interface PermissionV2Request {
  id: string;
  sessionID: string;
  action: string;
  resources: string[];
  save?: string[];
  metadata?: Record<string, unknown>;
  source?: string;
}

export type PermissionDecision = "once" | "always" | "reject";

// ---------------------------------------------------------------------------
// Events (SSE on GET /event) - envelope is { id, type, properties }
// ---------------------------------------------------------------------------

export interface EventEnvelope<P = Record<string, unknown>> {
  id?: string;
  type: string;
  properties: P;
}

export interface EvtSessionStatus {
  sessionID: string;
  status: SessionStatus;
}
export interface EvtSessionIdle {
  sessionID: string;
}
export interface EvtMessagePartDelta {
  sessionID: string;
  messageID: string;
  partID: string;
  field: string;
  delta: string;
}
export interface EvtMessageUpdated {
  sessionID: string;
  info: MessageInfo;
}
export interface EvtMessagePartUpdated {
  sessionID: string;
  part: Part;
  time?: number;
}
export interface EvtSessionUpdated {
  sessionID: string;
  info: SessionInfo;
}
export interface EvtPermissionAsked {
  id: string;
  sessionID: string;
  permission: string;
  patterns: string[];
  metadata: Record<string, unknown>;
  always: string[];
  tool?: { messageID: string; callID: string };
}
export interface EvtPermissionReplied {
  id: string;
  sessionID: string;
  response?: PermissionDecision;
  [k: string]: unknown;
}
export interface EvtSessionError {
  sessionID: string;
  error: unknown;
}
export interface EvtSessionDiff {
  sessionID: string;
  diff: unknown[];
}
export interface EvtFileEdited {
  file: string;
}

/** Event types the Lab surfaces in the execution monitor. */
export const MONITOR_EVENT_TYPES = [
  "session.created",
  "session.updated",
  "session.deleted",
  "session.status",
  "session.idle",
  "session.error",
  "session.diff",
  "message.updated",
  "message.part.updated",
  "message.part.delta",
  "message.removed",
  "message.part.removed",
  "permission.asked",
  "permission.replied",
  "permission.v2.asked",
  "permission.v2.replied",
  "file.edited",
  "server.connected",
] as const;

export type MonitorEventType = (typeof MONITOR_EVENT_TYPES)[number];

// ---------------------------------------------------------------------------
// Results / VCS
// ---------------------------------------------------------------------------

export interface VcsFileStatus {
  file: string;
  additions: number;
  deletions: number;
  status: "added" | "deleted" | "modified";
}

export interface FileStatus {
  path: string;
  added: number;
  removed: number;
  status: "added" | "deleted" | "modified";
}

export interface ProjectInfo {
  id: string;
  worktree: string;
  vcs?: string;
  name?: string;
  time: { created: number; updated: number };
  sandboxes: string[];
}

// ---------------------------------------------------------------------------
// Capability matrix (what this Lab can / cannot do on the installed version)
// ---------------------------------------------------------------------------

export interface ApiCapability {
  id: string;
  label: string;
  supported: boolean;
  endpoint: string;
  note?: string;
}
