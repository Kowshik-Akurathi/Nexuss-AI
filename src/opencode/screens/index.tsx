"use client";

import type { MainView } from "@/store/viewStore";
import WorkspaceScreen from "./WorkspaceScreen";
import ProjectsScreen from "./ProjectsScreen";
import MonitorScreen from "./MonitorScreen";
import DiagnosticsScreen from "./DiagnosticsScreen";

interface OpenCodeScreenProps {
  view: Exclude<MainView, "chat">;
  sidebarOpen?: boolean;
  onToggleSidebar?: () => void;
}

/**
 * Dispatcher for the migrated Nexuss Lab surfaces. The Nexuss chat remains the
 * default main view; the sidebar "Agents" section switches between these.
 */
export default function OpenCodeScreen({ view, sidebarOpen, onToggleSidebar }: OpenCodeScreenProps) {
  const props = { sidebarOpen, onToggleSidebar };
  switch (view) {
    case "agent-workspace":
      return <WorkspaceScreen {...props} />;
    case "projects":
      return <ProjectsScreen {...props} />;
    case "monitor":
      return <MonitorScreen {...props} />;
    case "diagnostics":
      return <DiagnosticsScreen {...props} />;
    default:
      return <WorkspaceScreen {...props} />;
  }
}
