import { create } from "zustand";
import { apiGet, apiSend, OpenCodeApiError } from "./api";
import type { LabEvent, PermissionRow, StatusPayload } from "./types";

/**
 * OpenCode integration state — zustand port of the Lab's LabProvider context.
 * Owns status polling, the SSE event hub subscription, pending permissions
 * and the toast channel used across the migrated screens.
 */

const MAX_EVENTS = 1000;
/** OpenCode heartbeats carry no payload - they only eat the frame buffer. */
const NOISE_EVENTS = new Set(["server.heartbeat"]);

export interface OpenCodeState {
  status: StatusPayload | null;
  loading: boolean;
  error: string | null;
  busy: boolean;
  events: LabEvent[];
  permissions: PermissionRow[];
  toast: string | null;

  refresh: () => Promise<void>;
  connect: (action?: "connect" | "disconnect" | "refresh-installation") => Promise<{
    ok?: boolean;
    installation?: any;
    check?: any;
  }>;
  reloadPermissions: () => Promise<void>;
  decidePermission: (
    sessionID: string,
    id: string,
    decision: "once" | "always" | "reject"
  ) => Promise<void>;
  clearEvents: () => void;
  notify: (msg: string) => void;
}

let seq = 0;
let eventSource: EventSource | null = null;
let toastTimer: ReturnType<typeof setTimeout> | null = null;
let lastSseRefresh = 0;

function closeEventSource(): void {
  eventSource?.close();
  eventSource = null;
}

/** Keep exactly one EventSource wired to the shared hub for the lifetime of the connection. */
function syncEventSource(connected: boolean): void {
  if (!connected) {
    closeEventSource();
    return;
  }
  if (eventSource) return;

  try {
    const es = new EventSource("/api/events");
    eventSource = es;
    es.onmessage = (msg) => {
      const store = useOpenCodeStore.getState();
      try {
        const parsed = JSON.parse(msg.data) as Omit<LabEvent, "seq" | "at">;
        if (!parsed?.type) return;
        if (NOISE_EVENTS.has(parsed.type)) return;
        const evt: LabEvent = { ...parsed, at: Date.now(), seq: ++seq };
        const next = [...store.events, evt];
        useOpenCodeStore.setState({
          events: next.length > MAX_EVENTS ? next.slice(next.length - MAX_EVENTS) : next,
        });

        if (
          parsed.type === "permission.asked" ||
          parsed.type === "permission.v2.asked" ||
          parsed.type === "permission.replied" ||
          parsed.type === "permission.v2.replied"
        ) {
          void store.reloadPermissions();
        }
        if (parsed.type === "session.idle") {
          void store.refresh();
        } else if (parsed.type === "session.status") {
          // status fires many times per turn - throttle the expensive refresh
          const now = Date.now();
          if (now - lastSseRefresh > 2000) {
            lastSseRefresh = now;
            void store.refresh();
          }
        }
      } catch {
        /* ignore malformed frames */
      }
    };
    es.onerror = () => {
      /* EventSource auto-reconnects; status polling surfaces real failures */
    };
  } catch {
    /* EventSource unavailable */
  }
}

export const useOpenCodeStore = create<OpenCodeState>((set, get) => ({
  status: null,
  loading: true,
  error: null,
  busy: false,
  events: [],
  permissions: [],
  toast: null,

  refresh: async () => {
    try {
      const data = await apiGet<StatusPayload>("/api/status");
      set({ status: data, error: null });
      syncEventSource(data.connected);
    } catch (e) {
      set({ error: (e as Error).message });
    } finally {
      set({ loading: false });
    }
  },

  connect: async (action = "connect") => {
    set({ busy: true });
    try {
      const data = await apiSend<{
        ok?: boolean;
        error?: { message?: string };
        installation?: any;
        check?: any;
      }>("/api/connection", "POST", { action });
      if (data && data.ok === false) {
        throw new OpenCodeApiError(500, "CONNECT_FAILED", "Connection failed.");
      }
      get().notify(action === "disconnect" ? "Disconnected" : "Connected to OpenCode");
      await get().refresh();
      await get().reloadPermissions();
      return data;
    } catch (e) {
      const msg =
        e instanceof OpenCodeApiError ? e.message : `Connection failed: ${(e as Error).message}`;
      get().notify(msg);
      throw e;
    } finally {
      set({ busy: false });
    }
  },

  reloadPermissions: async () => {
    try {
      const data = await apiGet<{ permissions: PermissionRow[] }>("/api/permissions");
      set({ permissions: data.permissions ?? [] });
    } catch {
      /* permissions are best-effort */
    }
  },

  decidePermission: async (sessionID, id, decision) => {
    try {
      await apiSend("/api/permissions", "POST", { sessionID, permissionID: id, decision });
      get().notify(
        decision === "reject"
          ? "Permission rejected"
          : `Permission ${decision === "always" ? "allowed (saved)" : "allowed"}`
      );
      await get().reloadPermissions();
    } catch (e) {
      get().notify(
        e instanceof OpenCodeApiError ? e.message : "Failed to deliver permission decision"
      );
    }
  },

  clearEvents: () => set({ events: [] }),

  notify: (msg: string) => {
    set({ toast: msg });
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => set({ toast: null }), 4000);
  },
}));

/** Kick off the initial load (idempotent — safe to call from App bootstrap). */
export function initOpenCode(): void {
  void useOpenCodeStore.getState().refresh();
  void useOpenCodeStore.getState().reloadPermissions();
}
