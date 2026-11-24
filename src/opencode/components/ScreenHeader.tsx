"use client";

import type { ReactNode } from "react";
import { PanelLeftIcon } from "@/components/icons";
import { useOpenCodeStore } from "../store";

interface ScreenHeaderProps {
  title: string;
  subtitle?: string;
  sidebarOpen?: boolean;
  onToggleSidebar?: () => void;
  actions?: ReactNode;
}

/**
 * Shared header for the migrated OpenCode screens — mirrors ChatHeader so the
 * agent surfaces feel native to the Nexuss shell.
 */
export default function ScreenHeader({
  title,
  subtitle,
  sidebarOpen = false,
  onToggleSidebar,
  actions,
}: ScreenHeaderProps) {
  const connected = useOpenCodeStore((s) => s.status?.connected ?? false);

  return (
    <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        {onToggleSidebar && (
          <button
            type="button"
            onClick={onToggleSidebar}
            className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title={sidebarOpen ? "Close sidebar" : "Open sidebar"}
            aria-label={sidebarOpen ? "Close sidebar" : "Open sidebar"}
          >
            <PanelLeftIcon className="h-4 w-4" />
          </button>
        )}
        <div className="flex min-w-0 flex-col">
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono font-bold uppercase tracking-widest text-muted-foreground">
              {title}
            </span>
            {subtitle && (
              <>
                <span className="text-[11px] font-mono text-muted-foreground">•</span>
                <span className="truncate text-xs font-semibold text-foreground">{subtitle}</span>
              </>
            )}
          </div>
        </div>
        <span
          className={`chip ${connected ? "border-emerald-600/40" : ""}`}
          title={connected ? "Connected to OpenCode" : "OpenCode offline"}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-emerald-500" : "bg-muted-foreground/40"}`}
          />
          {connected ? "connected" : "offline"}
        </span>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}
