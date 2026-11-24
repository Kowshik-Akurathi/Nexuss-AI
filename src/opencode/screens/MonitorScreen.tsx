"use client";

import { useCallback, useEffect, useState } from "react";
import { useOpenCodeStore } from "../store";
import type { ResultsView } from "../types";
import { Markdown } from "../components/Markdown";
import ScreenHeader from "../components/ScreenHeader";

interface LiveExecution {
  id: string;
  sessionID: string;
  directory: string;
  prompt: string;
  agent?: string;
  model?: string;
  phase: string;
  mode: "sync" | "async";
  startedAt: number;
  endedAt?: number;
  events: Array<{ type: string; at: number; summary: string }>;
  toolCalls: Array<{ tool: string; state: string; at: number; input?: unknown }>;
  permissionRequests: string[];
  error?: string;
  finalText?: string;
  interruptedByUser?: boolean;
}

interface StoredExecution {
  id: string;
  session_id?: string;
  sessionID?: string;
  directory?: string;
  prompt?: string;
  status?: string;
  started_at?: number;
  startedAt?: number;
  ended_at?: number;
  endedAt?: number;
  error?: string;
  final_text?: string;
  finalText?: string;
  mode?: string;
  agent?: string;
  model?: string;
}

interface Results extends ResultsView {
  executionId: string;
  sessionID: string;
  directory: string;
  finalText: string;
  filesObserved: string[];
}

const PHASE_COLOR: Record<string, string> = {
  running: "text-primary",
  completed: "text-emerald-600 dark:text-emerald-400",
  failed: "text-destructive",
  interrupted: "text-amber-600 dark:text-amber-300",
  queued: "text-muted-foreground/70",
};

interface MonitorScreenProps {
  sidebarOpen?: boolean;
  onToggleSidebar?: () => void;
}

/**
 * Execution Monitor — migrated from Nexuss Lab `/monitor`.
 * Live + stored executions, verified results (files, VCS diff, tools), the
 * real event timeline and the buffered SSE event stream.
 */
export default function MonitorScreen({ sidebarOpen, onToggleSidebar }: MonitorScreenProps) {
  const events = useOpenCodeStore((s) => s.events);
  const clearEvents = useOpenCodeStore((s) => s.clearEvents);
  const status = useOpenCodeStore((s) => s.status);
  const notify = useOpenCodeStore((s) => s.notify);

  const [live, setLive] = useState<LiveExecution[]>([]);
  const [stored, setStored] = useState<StoredExecution[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [results, setResults] = useState<Results | null>(null);
  const [detail, setDetail] = useState<LiveExecution | null>(null);
  const [auto, setAuto] = useState(true);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/executions", { cache: "no-store" });
      if (!r.ok) return;
      const d = (await r.json()) as { live: LiveExecution[]; stored: StoredExecution[] };
      setLive(d.live ?? []);
      setStored(d.stored ?? []);
    } catch {
      /* transient */
    }
  }, []);

  useEffect(() => {
    void load();
    if (!auto) return;
    const t = setInterval(() => void load(), 3000);
    return () => clearInterval(t);
  }, [load, auto]);

  useEffect(() => {
    if (!selected) {
      setResults(null);
      setDetail(null);
      return;
    }
    let alive = true;
    void (async () => {
      const r = await fetch(`/api/executions?id=${encodeURIComponent(selected)}`, { cache: "no-store" });
      if (!r.ok || !alive) return;
      const d = (await r.json()) as { execution: LiveExecution | null; results: Results | null };
      if (!alive) return;
      setDetail(d.execution);
      setResults(d.results);
    })();
    return () => {
      alive = false;
    };
  }, [selected]);

  const interrupt = async (sessionID: string) => {
    const r = await fetch(`/api/sessions/${sessionID}/prompt`, { method: "DELETE" });
    const d = await r.json().catch(() => ({}));
    notify(r.ok ? "Interrupt sent" : d?.error?.message || "Interrupt failed");
    await load();
  };

  const duration = (e: { startedAt: number; endedAt?: number }) =>
    e.endedAt ? `${((e.endedAt - e.startedAt) / 1000).toFixed(1)}s` : "running…";

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-background text-foreground dark:bg-[#0f0f0f]">
      <ScreenHeader
        title="Execution monitor"
        subtitle={`${live.length + stored.length} executions`}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={onToggleSidebar}
        actions={
          <>
            <button
              type="button"
              className={`chip cursor-pointer ${auto ? "border-primary/50 text-primary" : ""}`}
              onClick={() => setAuto((v) => !v)}
            >
              {auto ? "● auto-refresh" : "○ paused"}
            </button>
            <button type="button" className="btn" onClick={() => void load()}>
              ⟳ Reload
            </button>
          </>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <div className="mx-auto max-w-[1300px] space-y-4">
          <p className="text-[12.5px] text-muted-foreground">
            Every row is a real OpenCode turn — live records while running, SQLite history afterwards,
            with on-disk verification of files, VCS diff and tool usage in the detail pane.
          </p>

          <div className="grid gap-4 lg:grid-cols-5">
            <section className="rounded-lg border border-border bg-card p-4 lg:col-span-2">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-mono text-[12px] uppercase tracking-widest text-muted-foreground">
                  Executions
                </h2>
                <span className="chip">{live.length + stored.length}</span>
              </div>
              {live.length + stored.length === 0 ? (
                <p className="text-[12.5px] text-muted-foreground/70">
                  No executions yet. Send a prompt from the Agent Workspace and it will appear here in
                  real time.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {live.map((e) => (
                    <li key={e.id}>
                      <button
                        type="button"
                        onClick={() => setSelected(e.id)}
                        className={`w-full cursor-pointer rounded-lg border px-2.5 py-2 text-left transition-colors ${
                          selected === e.id
                            ? "border-primary/50 bg-primary/10"
                            : "border-border hover:bg-accent"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className={`font-mono text-[11px] uppercase ${PHASE_COLOR[e.phase] ?? "text-muted-foreground"}`}
                          >
                            {e.phase} · live
                          </span>
                          <span className="font-mono text-[10px] text-muted-foreground/70">
                            {duration(e)}
                          </span>
                        </div>
                        <div className="mt-1 line-clamp-2 text-[12.5px]">{e.prompt.slice(0, 160)}</div>
                        <div className="mt-1 flex flex-wrap gap-1.5 font-mono text-[10px] text-muted-foreground/70">
                          <span>{e.agent ?? "build"}</span>
                          <span>· {e.toolCalls.length} tools</span>
                          <span>· {e.permissionRequests.length} permissions</span>
                        </div>
                      </button>
                    </li>
                  ))}
                  {stored.map((s) => {
                    const id = s.id;
                    const sid = s.session_id ?? s.sessionID ?? "";
                    const started = s.started_at ?? s.startedAt ?? 0;
                    const ended = s.ended_at ?? s.endedAt;
                    return (
                      <li key={id}>
                        <button
                          type="button"
                          onClick={() => setSelected(id)}
                          className={`w-full cursor-pointer rounded-lg border px-2.5 py-2 text-left transition-colors ${
                            selected === id
                              ? "border-primary/50 bg-primary/10"
                              : "border-border hover:bg-accent"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span
                              className={`font-mono text-[11px] uppercase ${PHASE_COLOR[s.status ?? ""] ?? "text-muted-foreground"}`}
                            >
                              {s.status ?? "stored"} · history
                            </span>
                            <span className="font-mono text-[10px] text-muted-foreground/70">
                              {started && ended ? `${((ended - started) / 1000).toFixed(1)}s` : "—"}
                            </span>
                          </div>
                          <div className="mt-1 line-clamp-2 text-[12.5px]">
                            {(s.prompt ?? "(no prompt)").slice(0, 160)}
                          </div>
                          <div className="mt-1 truncate font-mono text-[10px] text-muted-foreground/70">
                            {sid}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section className="rounded-lg border border-border bg-card p-4 lg:col-span-3">
              {!selected ? (
                <div className="flex h-full min-h-[300px] flex-col items-center justify-center gap-2 text-center">
                  <div className="font-mono text-2xl text-muted-foreground/60">∿</div>
                  <p className="text-[13px] text-muted-foreground">
                    Select an execution to inspect its verified results.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-mono text-[11px] text-muted-foreground/70">{selected}</div>
                    {detail && !detail.endedAt && (
                      <button
                        type="button"
                        className="btn btn-danger"
                        onClick={() => void interrupt(detail.sessionID)}
                      >
                        ■ Interrupt session
                      </button>
                    )}
                  </div>

                  {results && (
                    <div>
                      <div className="mb-2 flex flex-wrap gap-1.5">
                        <span className="chip">{results.status}</span>
                        <span className="chip">
                          {results.filesCreated.length} created · {results.filesModified.length}{" "}
                          modified · {results.filesDeleted.length} deleted
                          {results.filesObserved?.length
                            ? ` · ${results.filesObserved.length} observed`
                            : ""}
                        </span>
                        <span className="chip">
                          +{results.additions} / −{results.deletions}
                        </span>
                        <span
                          className={`chip ${results.verifiedOnDisk ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-300"}`}
                        >
                          {results.verifiedOnDisk ? "verified on disk" : "not verified"}
                        </span>
                        {typeof results.durationMs === "number" && (
                          <span className="chip">{(results.durationMs / 1000).toFixed(1)}s</span>
                        )}
                      </div>
                      <p className="text-[12.5px] text-muted-foreground">{results.summary}</p>
                    </div>
                  )}

                  {(results?.filesCreated.length ?? 0) +
                    (results?.filesModified.length ?? 0) +
                    (results?.filesObserved?.length ?? 0) >
                    0 && (
                    <div>
                      <div className="label">Files (real paths)</div>
                      <ul className="space-y-0.5 font-mono text-[11px]">
                        {(results?.filesCreated ?? []).map((f) => (
                          <li key={`c:${f}`} className="text-emerald-600 dark:text-emerald-400">
                            + {f}
                          </li>
                        ))}
                        {(results?.filesModified ?? []).map((f) => (
                          <li key={`m:${f}`} className="text-primary">
                            ~ {f}
                          </li>
                        ))}
                        {(results?.filesDeleted ?? []).map((f) => (
                          <li key={`d:${f}`} className="text-destructive">
                            − {f}
                          </li>
                        ))}
                        {(results?.filesObserved ?? [])
                          .filter(
                            (f) =>
                              ![...(results?.filesCreated ?? []), ...(results?.filesModified ?? [])].includes(f)
                          )
                          .map((f) => (
                            <li key={`o:${f}`} className="text-blue-600 dark:text-blue-400">
                              · {f}
                            </li>
                          ))}
                      </ul>
                    </div>
                  )}

                  {(results?.toolsUsed.length ?? 0) > 0 && (
                    <div>
                      <div className="label">Tools used</div>
                      <div className="flex flex-wrap gap-1.5">
                        {results?.toolsUsed.map((t, i) => (
                          <span key={`${t.tool}:${i}`} className="chip">
                            {t.tool} <span className="text-muted-foreground/70">{t.state}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {(results?.errors.length ?? 0) > 0 && (
                    <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2">
                      <div className="label text-destructive">Errors</div>
                      <ul className="space-y-1 font-mono text-[11px] text-destructive">
                        {results?.errors.map((e, i) => (
                          <li key={i}>{e}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {(detail?.finalText || results?.finalText) && (
                    <div>
                      <div className="label">Final response</div>
                      <div className="text-[13px]">
                        <Markdown content={detail?.finalText || results?.finalText || ""} />
                      </div>
                    </div>
                  )}

                  {detail && (
                    <div>
                      <div className="label">Real event timeline ({detail.events.length})</div>
                      <ul className="max-h-[200px] space-y-0.5 overflow-y-auto font-mono text-[10.5px] text-muted-foreground">
                        {detail.events.map((e, i) => (
                          <li key={i}>
                            <span className="text-muted-foreground/70">
                              {new Date(e.at).toLocaleTimeString()}
                            </span>{" "}
                            <span className="text-primary">{e.type}</span> {e.summary}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </section>
          </div>

          <section className="rounded-lg border border-border bg-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-mono text-[12px] uppercase tracking-widest text-muted-foreground">
                Live OpenCode event stream{" "}
                {status?.events?.connected ? "· connected" : "· not connected"}
              </h2>
              <div className="flex gap-2">
                <span className="chip">{events.length} buffered</span>
                <button type="button" className="btn btn-ghost py-0.5" onClick={clearEvents}>
                  clear
                </button>
              </div>
            </div>
            {events.length === 0 ? (
              <p className="text-[12.5px] text-muted-foreground/70">No events received yet.</p>
            ) : (
              <ul className="max-h-[280px] space-y-0.5 overflow-y-auto font-mono text-[10.5px]">
                {[...events].reverse().map((e, i) => (
                  <li key={`${e.at}:${i}`} className="flex gap-2 border-b border-border/40 py-0.5">
                    <span className="shrink-0 text-muted-foreground/70">
                      {new Date(e.at).toLocaleTimeString()}
                    </span>
                    <span className="shrink-0 text-primary">{e.type}</span>
                    <span
                      className="min-w-0 truncate text-muted-foreground"
                      title={JSON.stringify(e.properties)}
                    >
                      {Object.entries(e.properties)
                        .filter(([k]) => k !== "directory")
                        .map(([k, v]) =>
                          `${k}=${typeof v === "object" ? JSON.stringify(v).slice(0, 60) : String(v)}`
                        )
                        .join(" ")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
