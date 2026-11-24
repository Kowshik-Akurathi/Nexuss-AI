import { create } from "zustand";

/**
 * Main-area view switcher: the Nexuss chat stays the default screen, with the
 * migrated OpenCode surfaces (agent workspace, projects, monitor, diagnostics)
 * reachable from the sidebar.
 */
export type MainView = "chat" | "agent-workspace" | "projects" | "monitor" | "diagnostics";

interface ViewState {
  view: MainView;
  setView: (view: MainView) => void;
}

export const useViewStore = create<ViewState>((set) => ({
  view: "chat",
  setView: (view) => set({ view }),
}));
