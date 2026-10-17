import { create } from "zustand";
import { MOCK_WORKSPACE_NAME } from "@/data/mockData";

/**
 * Minimal mock workspace store: only what the chat shell needs (the terminal
 * panel toggle and the connected folder name shown in the profile menu).
 */
interface Workspace {
  name: string;
  root: string;
  kind: string;
}

interface WorkspaceState {
  workspace: Workspace | null;
  panelOpen: boolean;
  error: string | null;
  openPanel: () => void;
  closePanel: () => void;
  togglePanel: () => void;
  clearError: () => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  workspace: { name: MOCK_WORKSPACE_NAME, root: "/Users/you/Projects/nexuss-app", kind: "folder" },
  panelOpen: false,
  error: null,

  openPanel: () => set({ panelOpen: true }),
  closePanel: () => set({ panelOpen: false }),
  togglePanel: () => set({ panelOpen: !get().panelOpen }),
  clearError: () => set({ error: null })
}));
