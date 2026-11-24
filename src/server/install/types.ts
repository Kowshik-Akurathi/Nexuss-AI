/**
 * Installation workflow state shared by the install manager and the API.
 *
 * The eight stages mirror the order-tracking concept: each stage is a real
 * operation with a real result. Nothing here is simulated — progress is always
 * derived from completed stages, never from timers.
 */

export type InstallStageId =
  | "environment"
  | "install"
  | "verify"
  | "server"
  | "connect"
  | "auth"
  | "discover"
  | "complete";

export type StageStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "awaiting"
  | "skipped"
  | "cancelled";

export type InstallStatus =
  | "idle"
  | "checking"
  | "installing"
  | "verifying"
  | "configuring"
  | "connecting"
  | "awaiting-auth"
  | "discovering"
  | "completed"
  | "failed"
  | "cancelling"
  | "cancelled";

export interface StageError {
  code: string;
  message: string;
  detail?: string;
  recovery?: string;
  /** True when the fix needs an explicit user confirmation (e.g. elevation). */
  confirmationRequired?: boolean;
}

export interface StageState {
  id: InstallStageId;
  title: string;
  status: StageStatus;
  /** Human-readable description of what is happening right now. */
  activity: string;
  startedAt?: number;
  endedAt?: number;
  error?: StageError;
  /** Stage-specific payload shown in the technical details section. */
  detail?: Record<string, unknown>;
}

export interface InstallMethodOption {
  id: string;
  label: string;
  available: boolean;
  detail?: string;
  /** True for the method the installer would actually use. */
  selected?: boolean;
}

export interface EnvironmentReport {
  platform: string;
  platformLabel: string;
  platformRelease: string;
  arch: string;
  cpus: number;
  totalMemMB: number;
  node: string;
  npm: string | null;
  methods: InstallMethodOption[];
  dependencies: Array<{ name: string; ok: boolean; detail: string }>;
  existingInstallations: Array<{ path: string; version?: string; method?: string }>;
  existingServers: Array<{ url: string; pid?: number; version?: string }>;
  configFiles: Array<{ path: string; exists: boolean }>;
  ports: Array<{ port: number; inUse: boolean; role: string }>;
  /** False when no supported install method exists on this device. */
  canInstall: boolean;
  /** True when the selected install target is not writable without elevation. */
  requiresElevation: boolean;
  notes: string[];
  checkedAt: number;
}

export interface InstallSummary {
  installationPath?: string;
  version?: string;
  method?: string;
  serverUrl?: string;
  serverPort?: number;
  serverPid?: number;
  serverOwned?: boolean;
  connected?: boolean;
  latencyMs?: number;
  authenticated?: boolean;
  authProviders?: string[];
  agents?: number;
  models?: number;
  providers?: number;
}

export interface InstallState {
  id: string | null;
  status: InstallStatus;
  stages: StageState[];
  currentStage: InstallStageId | null;
  /** Overall progress 0-100, derived from completed stages only. */
  progress: number;
  startedAt: number | null;
  endedAt: number | null;
  cancelRequested: boolean;
  environment: EnvironmentReport | null;
  installation: { path?: string; version?: string; method?: string } | null;
  server: {
    baseUrl?: string;
    port?: number;
    pid?: number;
    owned?: boolean;
    state?: string;
  } | null;
  connection: { connected: boolean; latencyMs?: number } | null;
  auth: { checked: boolean; authenticated: boolean; providers: string[] } | null;
  discovery: { agents: number; models: number; providers: number } | null;
  summary: InstallSummary | null;
  error: (StageError & { stage: InstallStageId }) | null;
  logs: string[];
  updatedAt: number;
}

export const STAGE_TITLES: Record<InstallStageId, string> = {
  environment: "Checking Environment",
  install: "Installing OpenCode",
  verify: "Verifying Installation",
  server: "Configuring Server",
  connect: "Connecting to Nexuss",
  auth: "Authentication",
  discover: "Discovering Agents & Models",
  complete: "Setup Completed",
};

export const STAGE_ORDER: InstallStageId[] = [
  "environment",
  "install",
  "verify",
  "server",
  "connect",
  "auth",
  "discover",
  "complete",
];

/** Status shown in the header while a stage runs. */
export const STAGE_STATUS: Record<InstallStageId, InstallStatus> = {
  environment: "checking",
  install: "installing",
  verify: "verifying",
  server: "configuring",
  connect: "connecting",
  auth: "connecting",
  discover: "discovering",
  complete: "completed",
};

export function initialStages(): StageState[] {
  return STAGE_ORDER.map((id) => ({
    id,
    title: STAGE_TITLES[id],
    status: "pending" as StageStatus,
    activity: "Waiting",
  }));
}

export function isTerminalStatus(s: InstallStatus): boolean {
  return s === "completed" || s === "failed" || s === "cancelled" || s === "idle";
}

export function isActiveStatus(s: InstallStatus): boolean {
  return (
    s === "checking" ||
    s === "installing" ||
    s === "verifying" ||
    s === "configuring" ||
    s === "connecting" ||
    s === "discovering" ||
    s === "awaiting-auth" ||
    s === "cancelling"
  );
}

/** Progress is completed stages over total stages — never fabricated. */
export function computeProgress(stages: StageState[]): number {
  if (stages.length === 0) return 0;
  const done = stages.filter((s) => s.status === "completed" || s.status === "skipped").length;
  return Math.round((done / stages.length) * 100);
}

export function emptyInstallState(): InstallState {
  const stages = initialStages();
  return {
    id: null,
    status: "idle",
    stages,
    currentStage: null,
    progress: computeProgress(stages),
    startedAt: null,
    endedAt: null,
    cancelRequested: false,
    environment: null,
    installation: null,
    server: null,
    connection: null,
    auth: null,
    discovery: null,
    summary: null,
    error: null,
    logs: [],
    updatedAt: Date.now(),
  };
}
