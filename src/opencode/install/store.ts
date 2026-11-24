import { create } from "zustand";
import { apiGet, apiSend } from "../api";
import { useOpenCodeStore } from "../store";
import {
  isActiveStatus,
  type InstallState,
  type InstallStageId,
  type StageState,
  type InstallStatus,
  type StageStatus,
  STAGE_TITLES,
  STAGE_ORDER,
} from "@/server/install/types";

/**
 * Installation workflow state for the tracking UI.
 *
 * Progress arrives over a dedicated SSE stream that is independent of the
 * OpenCode connection (installation must be trackable before any connection
 * exists). The initial snapshot is fetched over HTTP so a page refresh always
 * shows the true state of a still-running installation.
 */

export type DiagnosisAction = "install" | "start-server" | "connect" | "authenticate" | "none";

export interface Diagnosis {
  installation: {
    installed: boolean;
    path?: string;
    version?: string;
    method?: string;
    guidance?: string;
  } | null;
  server: { running: boolean; state: string; baseUrl: string | null; pid: number | null; owned: boolean };
  connected: boolean;
  latencyMs: number | null;
  auth: { checked: boolean; authenticated: boolean; providers: string[] };
  discovery: { agents: number; models: number; providers: number } | null;
  actions: DiagnosisAction[];
  checkedAt: number;
}

interface InstallStore {
  state: InstallState | null;
  check: Diagnosis | null;
  checking: boolean;
  open: boolean;
  streamLive: boolean;

  setOpen: (open: boolean) => void;
  load: () => Promise<void>;
  diagnose: () => Promise<Diagnosis | null>;
  start: (opts?: { elevated?: boolean }) => Promise<void>;
  retry: (opts?: { elevated?: boolean }) => Promise<void>;
  cancel: () => Promise<void>;
  recheckAuth: () => Promise<void>;
  continueWithoutAuth: () => Promise<void>;
  startAuth: () => Promise<{ started: boolean; detail: string }>;
  reset: () => Promise<void>;
}

let eventSource: EventSource | null = null;
let initialized = false;
let lastStatus: InstallStatus | null = null;

function applyState(state: InstallState): void {
  const store = useInstallStore.getState();
  const prev = lastStatus;
  lastStatus = state.status;
  useInstallStore.setState({ state });

  // When setup finishes, pull the freshly discovered agents/models into the
  // shared Nexuss provider state.
  if (state.status === "completed" && prev !== "completed") {
    void useOpenCodeStore.getState().refresh();
    void useOpenCodeStore.getState().reloadPermissions();
    useOpenCodeStore.getState().notify("OpenCode connected — agents and models are ready");
  }
}

function syncEventSource(): void {
  if (eventSource) return;
  try {
    const es = new EventSource("/api/install/events");
    eventSource = es;
    es.onopen = () => useInstallStore.setState({ streamLive: true });
    es.onmessage = (msg) => {
      try {
        const parsed = JSON.parse(msg.data) as { type?: string; state?: InstallState };
        if (parsed?.type === "install.state" && parsed.state) applyState(parsed.state);
      } catch {
        /* ignore malformed frames */
      }
    };
    es.onerror = () => useInstallStore.setState({ streamLive: false });
  } catch {
    /* EventSource unavailable — HTTP polling of GET /api/install still works */
  }
}

export const useInstallStore = create<InstallStore>((set, get) => ({
  state: null,
  check: null,
  checking: false,
  open: false,
  streamLive: false,

  setOpen: (open) => set({ open }),

  load: async () => {
    try {
      const data = await apiGet<{ state: InstallState }>("/api/install");
      if (data?.state) {
        lastStatus = data.state.status;
        set({ state: data.state });
      }
    } catch {
      /* the endpoint is optional — leave state null */
    }
  },

  diagnose: async () => {
    set({ checking: true });
    try {
      const data = await apiSend<{ check: Diagnosis; state: InstallState }>(
        "/api/install",
        "POST",
        { action: "diagnose" }
      );
      if (data?.state) applyState(data.state);
      set({ check: data.check ?? null });
      return data.check ?? null;
    } catch {
      set({ check: null });
      return null;
    } finally {
      set({ checking: false });
    }
  },

  start: async (opts) => {
    const data = await apiSend<{ state: InstallState }>("/api/install", "POST", {
      action: "start",
      elevated: Boolean(opts?.elevated),
    });
    if (data?.state) applyState(data.state);
    set({ open: true });
  },

  retry: async (opts) => {
    const data = await apiSend<{ state: InstallState }>("/api/install", "POST", {
      action: "retry",
      elevated: Boolean(opts?.elevated),
    });
    if (data?.state) applyState(data.state);
  },

  cancel: async () => {
    const data = await apiSend<{ state: InstallState }>("/api/install", "POST", {
      action: "cancel",
    });
    if (data?.state) applyState(data.state);
  },

  recheckAuth: async () => {
    const data = await apiSend<{ state: InstallState }>("/api/install", "POST", {
      action: "recheck-auth",
    });
    if (data?.state) applyState(data.state);
  },

  continueWithoutAuth: async () => {
    const data = await apiSend<{ state: InstallState }>("/api/install", "POST", {
      action: "continue-without-auth",
    });
    if (data?.state) applyState(data.state);
  },

  startAuth: async () => {
    try {
      const data = await apiSend<{ started: boolean; detail: string; state: InstallState }>(
        "/api/install",
        "POST",
        { action: "start-auth" }
      );
      if (data?.state) applyState(data.state);
      return { started: Boolean(data?.started), detail: data?.detail ?? "" };
    } catch (e) {
      return { started: false, detail: (e as Error).message };
    }
  },

  reset: async () => {
    const data = await apiSend<{ state: InstallState }>("/api/install", "POST", {
      action: "reset",
    });
    if (data?.state) applyState(data.state);
  },
}));

export function initInstallTracker(): void {
  if (initialized) return;
  initialized = true;
  void useInstallStore.getState().load();
  syncEventSource();
}

/** True while the workflow is actively doing work (not waiting on the user). */
export function installBusy(state: InstallState | null): boolean {
  if (!state) return false;
  return isActiveStatus(state.status) && state.status !== "awaiting-auth";
}

export function stageById(state: InstallState | null, id: InstallStageId) {
  return state?.stages.find((s) => s.id === id) ?? null;
}

export function getStageTitle(id: InstallStageId): string {
  return STAGE_TITLES[id];
}

export function getStageOrder(): InstallStageId[] {
  return STAGE_ORDER;
}