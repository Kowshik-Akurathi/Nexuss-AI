import { create } from "zustand";

/**
 * Mock terminal connection store. `checkConnection` deliberately resolves to
 * "disconnected" so the Terminal panel's connection screen is what reviewers
 * see first; `connect` simulates the handshake (and can be pointed at an
 * "error" outcome by setting MOCK_CONNECT_OUTCOME).
 */

export type TerminalConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "permission_required"
  | "unavailable"
  | "error";

export const TERMINAL_CONNECT_REQUIRED_MESSAGE = "Terminal access required";

/** Change to "error" to review the failed-connection copy. */
type ConnectOutcome = "connected" | "error";
export const MOCK_CONNECT_OUTCOME = "connected" as ConnectOutcome;

interface TerminalConnectionState {
  status: TerminalConnectionStatus;
  lastVerifiedAt: number | null;
  justConnected: boolean;
  lastError: string | null;
  checkConnection: () => Promise<TerminalConnectionStatus>;
  connect: () => Promise<boolean>;
  disconnect: () => Promise<void>;
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const useTerminalConnectionStore = create<TerminalConnectionState>((set, get) => ({
  status: "disconnected",
  lastVerifiedAt: null,
  justConnected: false,
  lastError: null,

  checkConnection: async () => get().status,

  connect: async () => {
    if (get().status === "connecting") return false;
    set({ status: "connecting" });
    await delay(1100);
    if (MOCK_CONNECT_OUTCOME === "error") {
      set({ status: "error", lastError: "connector unreachable" });
      return false;
    }
    set({ status: "connected", lastVerifiedAt: Date.now(), justConnected: true, lastError: null });
    return true;
  },

  disconnect: async () => {
    set({ status: "disconnected", lastVerifiedAt: null, justConnected: false });
  }
}));
