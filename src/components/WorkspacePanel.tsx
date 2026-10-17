import { useEffect, useState } from "react";
import { useWorkspaceStore } from "@/workspace/store";
import { useTerminalConnectionStore } from "@/workspace/terminalConnection";
import TerminalConnectionScreen from "@/components/TerminalConnectionScreen";
import { ChevronDownIcon, SearchIcon, TerminalIcon, XCircleIcon, XIcon } from "@/components/icons";

/**
 * Terminal / agent workspace panel — prototype version.
 *
 * Reproduces the panel shell, the collapse behaviour, the connection status
 * dot and the Terminal connection screen. The connected state renders the
 * verified-status header and the workspace file search surface; the agent
 * staging / command execution surfaces from the production app are not
 * reproduced (see README "Not reproduced").
 */

const MOCK_FILES = [
  { path: "src/components/ChatComposer.tsx", reasons: ["matches: composer"] },
  { path: "src/store/chatStore.ts", reasons: ["matches: streaming"] },
  { path: "src/app/page.tsx", reasons: ["matches: shell layout"] },
  { path: "tailwind.config.js", reasons: ["matches: theme tokens"] }
];

export default function WorkspacePanel() {
  const closePanel = useWorkspaceStore((s) => s.closePanel);
  const terminalStatus = useTerminalConnectionStore((s) => s.status);
  const justConnected = useTerminalConnectionStore((s) => s.justConnected);
  const connectTerminal = useTerminalConnectionStore((s) => s.connect);
  const disconnectTerminal = useTerminalConnectionStore((s) => s.disconnect);
  const [query, setQuery] = useState("");
  const [isExpanded, setIsExpanded] = useState(terminalStatus !== "connected");
  const panelId = "workspace-details";

  useEffect(() => {
    void useTerminalConnectionStore.getState().checkConnection();
  }, []);

  const results = query.trim()
    ? MOCK_FILES.filter((f) => f.path.toLowerCase().includes(query.trim().toLowerCase()))
    : [];

  return (
    <div className="shrink-0 bg-background px-3 pb-1 sm:px-4">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-2">
        <section
          aria-label="Terminal workspace"
          className="overflow-hidden rounded-2xl border border-border bg-card shadow-lg animate-fade-in-up"
        >
          <div className="flex w-full items-center gap-1 px-4 py-3">
            <button
              type="button"
              onClick={() => setIsExpanded(!isExpanded)}
              aria-expanded={isExpanded}
              aria-controls={panelId}
              className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded-lg px-1 py-1 text-left transition-colors hover:bg-muted/50 cursor-pointer"
            >
              <span className="flex min-w-0 items-center gap-2 text-xs font-mono font-semibold text-foreground">
                <TerminalIcon className="h-4 w-4 shrink-0 text-primary" />
                <span className="truncate">Terminal</span>
              </span>
              <ChevronDownIcon
                className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
                  isExpanded ? "rotate-180" : ""
                }`}
              />
            </button>
            <span
              role="status"
              aria-label={
                terminalStatus === "connected"
                  ? "Terminal connected"
                  : terminalStatus === "connecting"
                    ? "Connecting to terminal"
                    : "Terminal disconnected"
              }
              className="flex shrink-0 items-center gap-1.5 pr-1"
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  terminalStatus === "connected"
                    ? "bg-emerald-500"
                    : terminalStatus === "connecting"
                      ? "animate-pulse bg-primary"
                      : "bg-muted-foreground/50"
                }`}
              />
              {terminalStatus === "connecting" && (
                <span className="text-[10px] font-mono font-normal text-muted-foreground">
                  Connecting…
                </span>
              )}
            </span>
            <button
              type="button"
              onClick={closePanel}
              aria-label="Close workspace panel"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground cursor-pointer"
            >
              <XIcon className="h-4 w-4" />
            </button>
          </div>

          <div
            id={panelId}
            className={
              isExpanded ? "border-t border-border animate-fade-in-up" : "max-h-0 overflow-hidden"
            }
          >
            {terminalStatus !== "connected" ? (
              <TerminalConnectionScreen
                status={terminalStatus}
                onConnect={() => void connectTerminal()}
              />
            ) : (
              <div className="border-t border-border p-4 animate-fade-in-up">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-[11px] font-mono font-medium text-foreground">
                      <span className="h-2 w-2 rounded-full bg-emerald-500" />
                      Terminal Connected
                    </p>
                    <p className="mt-1.5 text-[11px] font-mono text-muted-foreground">
                      {justConnected
                        ? "Nexuss can now execute authorized terminal tasks on this device."
                        : "Nexuss can use the authorized terminal on this device."}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void disconnectTerminal()}
                    className="flex shrink-0 items-center gap-1.5 rounded-lg border border-destructive/30 bg-destructive/10 px-2.5 py-1 text-[10px] font-mono font-medium text-destructive transition-colors hover:bg-destructive/20 cursor-pointer"
                  >
                    <XCircleIcon className="h-3.5 w-3.5" />
                    Disconnect
                  </button>
                </div>

                <p className="mt-3 text-[10px] font-mono text-muted-foreground">
                  42 files indexed
                </p>

                <div className="mt-3 flex items-center gap-2 rounded-lg border border-border bg-muted/50 px-2.5 py-2">
                  <SearchIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search files, symbols, error text…"
                    aria-label="Search workspace"
                    className="w-full bg-transparent text-xs text-foreground placeholder-muted-foreground outline-none"
                  />
                </div>

                {query.trim() ? (
                  <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto">
                    {results.length === 0 && (
                      <li className="py-1 text-[11px] font-mono text-muted-foreground">
                        No matches.
                      </li>
                    )}
                    {results.map((hit) => (
                      <li key={hit.path} className="rounded-lg bg-muted/50 px-2.5 py-1.5">
                        <p className="truncate text-xs font-mono text-foreground">{hit.path}</p>
                        <p className="truncate text-[10px] font-mono text-muted-foreground">
                          {hit.reasons.join(" • ")}
                        </p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-[10px] font-mono text-muted-foreground">
                    Your questions automatically pull in the most relevant files.
                  </p>
                )}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
