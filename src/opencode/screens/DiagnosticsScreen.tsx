"use client";

import { useCallback, useEffect, useState } from "react";
import { useOpenCodeStore } from "../store";
import { useInstallStore } from "../install/store";
import type { ConnectionPayload, DiagnosticsPayload } from "../types";
import ScreenHeader from "../components/ScreenHeader";
import InstallTracker from "../install/InstallTracker";
import { InstallStatusChip } from "../install/InstallTracker";
import {
  DownloadIcon,
  TerminalIcon,
} from "@/components/icons";

interface DiagnosticsScreenProps {
  sidebarOpen?: boolean;
  onToggleSidebar?: () => void;
}

/**
 * Diagnostics — merged from Nexuss Lab `/diagnostics` + `/connection`.
 * Live capability probes, runtime/server/bridges summary, audit log, allowed
 * roots, plus the full connection lifecycle (detect, adopt vs start, log tail).
 */
export default function DiagnosticsScreen({ sidebarOpen, onToggleSidebar }: DiagnosticsScreenProps) {
  const status = useOpenCodeStore((s) => s.status);
  const connect = useOpenCodeStore((s) => s.connect);
  const refresh = useOpenCodeStore((s) => s.refresh);
  const busy = useOpenCodeStore((s) => s.busy);
  const notify = useOpenCodeStore((s) => s.notify);

  const [d, setD] = useState<DiagnosticsPayload | null>(null);
  const [conn, setConn] = useState<ConnectionPayload | null>(null);
  const [check, setCheck] = useState<{
    installation: { installed: boolean; path?: string; version?: string; method?: string; guidance?: string } | null;
    server: { running: boolean; state: string; baseUrl: string | null; pid: number | null; owned: boolean };
    connected: boolean;
    latencyMs: number | null;
    auth: { checked: boolean; authenticated: boolean; providers: string[] };
    discovery: { agents: number; models: number; providers: number } | null;
    actions: string[];
    checkedAt: number;
  } | null>(null);
  const [probing, setProbing] = useState(false);
  const [filter, setFilter] = useState("");
  const [action, setAction] = useState<string | null>(null);

  const setOpenInstaller = useInstallStore((s) => s.setOpen);

  const loadDiag = useCallback(async () => {
    setProbing(true);
    try {
      const r = await fetch("/api/diagnostics", { cache: "no-store" });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        notify(body?.error?.message || `Diagnostics failed (HTTP ${r.status})`);
        return;
      }
      setD((await r.json()) as DiagnosticsPayload);
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setProbing(false);
    }
  }, [notify]);

  const loadConn = useCallback(async () => {
    try {
      const r = await fetch("/api/connection", { cache: "no-store" });
      if (r.ok) setConn((await r.json()) as ConnectionPayload);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void loadDiag();
    void loadConn();
  }, [loadDiag, loadConn]);

  const run = async (a: "connect" | "disconnect" | "refresh-installation") => {
    setAction(a);
    try {
      const res = await connect(a);
      if (a === "refresh-installation" && res?.check) {
        setCheck(res.check);
      }
      await loadDiag();
      await loadConn();
    } finally {
      setAction(null);
    }
  };

  const supported = d?.capabilities.filter((c) => c.supported).length ?? 0;
  const total = d?.capabilities.length ?? 0;
  const inst = status?.installation;
  const s = status?.server;

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-background text-foreground dark:bg-[#0f0f0f]">
      <ScreenHeader
        title="Diagnostics"
        subtitle={status?.connected ? "connected" : "disconnected"}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={onToggleSidebar}
        actions={
          <button type="button" className="btn btn-primary" disabled={probing} onClick={() => void loadDiag()}>
            {probing ? "Probing…" : "⟳ Re-probe capabilities"}
          </button>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <div className="mx-auto max-w-[1200px] space-y-4">
          <p className="text-[12.5px] text-muted-foreground">
            Each capability below is probed live against the running OpenCode instance — nothing is
            assumed from documentation.
          </p>

          {/* ── Connection lifecycle ── */}
          <div className="grid gap-4 md:grid-cols-2">
            <section className="rounded-lg border border-border bg-card p-4">
              <h2 className="mb-3 font-mono text-[12px] uppercase tracking-widest text-muted-foreground">
                1 · Installation
              </h2>
              <dl className="space-y-2 text-[12.5px]">
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground/70">Detected</dt>
                  <dd
                    className={`font-mono ${inst?.installed ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}
                  >
                    {inst == null ? "not checked" : inst.installed ? "yes" : "no"}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground/70">Version</dt>
                  <dd className="font-mono">{inst?.version ?? "—"}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground/70">Method</dt>
                  <dd className="font-mono">{inst?.method ?? "—"}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground/70">Binary</dt>
                  <dd className="max-w-[65%] break-all text-right font-mono text-[11px]">
                    {inst?.path ?? "—"}
                  </dd>
                </div>
              </dl>
              <button
                type="button"
                className="btn mt-3"
                disabled={busy}
                onClick={() => void run("refresh-installation")}
              >
                {action === "refresh-installation" ? "Scanning…" : "Re-detect"}
              </button>
              {inst && !inst.installed && inst.guidance && (
                <pre className="mt-3 whitespace-pre-wrap rounded-lg border border-amber-600/40 bg-amber-500/10 p-3 font-mono text-[11px] leading-relaxed text-amber-700 dark:text-amber-200">
                  {inst.guidance}
                </pre>
              )}

              {/* Re-detect result panel */}
              {check && (
                <div className="mt-4 space-y-3">
                  <div className="rounded-lg border border-border bg-muted/40 p-3">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                        Detection result
                      </span>
                      <span
                        className={`chip ${
                          check.installation?.installed
                            ? "border-emerald-600/40"
                            : "border-amber-600/40"
                        }`}
                      >
                        {check.installation?.installed ? "Installed" : "Not installed"}
                      </span>
                    </div>
                    <div className="grid gap-1 font-mono text-[11px] sm:grid-cols-2">
                      <DetailRow k="Version" v={check.installation?.version ?? "—"} />
                      <DetailRow k="Path" v={check.installation?.path ?? "—"} />
                      <DetailRow k="Method" v={check.installation?.method ?? "—"} />
                      <DetailRow k="Server" v={check.server.running ? `running at ${check.server.baseUrl}` : "stopped"} />
                      <DetailRow
                        k="Connected"
                        v={check.connected ? `yes (${check.latencyMs}ms)` : "no"}
                        ok={check.connected === true}
                      />
                      <DetailRow
                        k="Auth"
                        v={check.auth.checked ? (check.auth.authenticated ? `yes (${check.auth.providers.join(", ")})` : "missing") : "not checked"}
                        ok={check.auth.authenticated === true}
                      />
                      <DetailRow
                        k="Agents"
                        v={check.discovery ? `${check.discovery.agents} agents, ${check.discovery.models} models` : "—"}
                        ok={check.discovery !== null && check.discovery.agents > 0}
                      />
                    </div>
                    {check.installation?.guidance && (
                      <pre className="mt-2 whitespace-pre-wrap text-[10.5px] text-muted-foreground">
                        {check.installation.guidance}
                      </pre>
                    )}
                    {!check.installation?.installed && (
                      <button
                        type="button"
                        className="btn btn-primary mt-2"
                        onClick={() => setOpenInstaller(true)}
                      >
                        <DownloadIcon className="h-3.5 w-3.5" /> Install OpenCode
                      </button>
                    )}
                    {check.installation?.installed && !check.server.running && (
                      <button
                        type="button"
                        className="btn btn-primary mt-2"
                        onClick={() => void run("connect")}
                      >
                        Start server
                      </button>
                    )}
                    {check.installation?.installed && check.server.running && !check.connected && (
                      <button
                        type="button"
                        className="btn btn-primary mt-2"
                        onClick={() => void run("connect")}
                      >
                        Connect
                      </button>
                    )}
                    {check.auth.checked && !check.auth.authenticated && (
                      <button
                        type="button"
                        className="btn mt-2"
                        onClick={() => setOpenInstaller(true)}
                      >
                        <TerminalIcon className="h-3.5 w-3.5" /> Set up authentication
                      </button>
                    )}
                    {check.auth.checked && check.auth.authenticated && check.connected && (
                      <span className="chip border-emerald-600/40 text-emerald-600 dark:text-emerald-400">
                        All systems ready
                      </span>
                    )}
                  </div>
                </div>
              )}
            </section>

            <section className="rounded-lg border border-border bg-card p-4">
              <h2 className="mb-3 font-mono text-[12px] uppercase tracking-widest text-muted-foreground">
                2 · Server
              </h2>
              <dl className="space-y-2 text-[12.5px]">
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground/70">State</dt>
                  <dd
                    className={`font-mono ${
                      s?.state === "running"
                        ? "text-emerald-600 dark:text-emerald-400"
                        : s?.state === "error"
                          ? "text-destructive"
                          : "text-primary"
                    }`}
                  >
                    {s?.state ?? "stopped"}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground/70">Address</dt>
                  <dd className="font-mono">{s?.baseUrl ?? "—"}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground/70">Ownership</dt>
                  <dd className="font-mono">{s ? (s.owned ? "started by Nexuss" : "adopted") : "—"}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground/70">PID</dt>
                  <dd className="font-mono">{s?.pid ?? "—"}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground/70">Auth required</dt>
                  <dd className={`font-mono ${s?.authRequired ? "text-primary" : ""}`}>
                    {s?.authRequired ? "yes" : "no"}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground/70">Latency</dt>
                  <dd className="font-mono">{status?.latencyMs != null ? `${status.latencyMs}ms` : "—"}</dd>
                </div>
              </dl>
              <div className="mt-3 flex gap-2">
                {status?.connected ? (
                  <button
                    type="button"
                    className="btn btn-danger"
                    disabled={busy || action !== null}
                    onClick={() => void run("disconnect")}
                  >
                    {action === "disconnect" ? "Stopping…" : "Disconnect"}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy || action !== null}
                    onClick={() => void run("connect")}
                  >
                    {action === "connect" ? "Connecting…" : "Connect"}
                  </button>
                )}
                <button type="button" className="btn" onClick={() => void refresh()}>
                  Refresh status
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => void loadConn()}>
                  Load log
                </button>
              </div>
              {s?.error && (
                <div className="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 p-2.5 font-mono text-[11px] text-destructive">
                  {s.error}
                </div>
              )}
            </section>
          </div>

          {/* ── Behaviour explanation ── */}
          <section className="rounded-lg border border-border bg-card p-4">
            <h2 className="mb-2 font-mono text-[12px] uppercase tracking-widest text-muted-foreground">
              Lifecycle guarantees
            </h2>
            <div className="grid gap-4 text-[12px] md:grid-cols-3">
              <div>
                <div className="mb-1 text-[11px] uppercase tracking-wider text-muted-foreground/70">
                  Adopt vs start
                </div>
                <p className="text-muted-foreground">
                  On <span className="font-mono text-foreground">Connect</span> Nexuss first probes{" "}
                  <span className="font-mono text-foreground">
                    {conn?.config?.preferredUrl ?? status?.server?.baseUrl ?? "the configured URL"}
                  </span>{" "}
                  and a short list of local ports. If a server answers, it is{" "}
                  <em>adopted</em> — never restarted. Only when nothing answers does Nexuss spawn a
                  private server on port{" "}
                  <span className="font-mono text-foreground">{conn?.config?.startPort ?? 4981}</span>.
                </p>
              </div>
              <div>
                <div className="mb-1 text-[11px] uppercase tracking-wider text-muted-foreground/70">
                  Port safety
                </div>
                <p className="text-muted-foreground">
                  If the preferred port is occupied Nexuss refuses to start a duplicate and reports{" "}
                  <span className="font-mono text-foreground">SERVER_PORT_IN_USE</span> with recovery
                  guidance. It never terminates another process to free a port.
                </p>
              </div>
              <div>
                <div className="mb-1 text-[11px] uppercase tracking-wider text-muted-foreground/70">
                  Exposure
                </div>
                <p className="text-muted-foreground">
                  Nexuss only ever binds <span className="font-mono text-foreground">127.0.0.1</span>.
                  Binding a non-loopback host is rejected outright. When a password is configured it
                  is attached in the backend as{" "}
                  <span className="font-mono text-foreground">Authorization: Bearer …</span> and never
                  reaches the browser.
                </p>
              </div>
            </div>
          </section>

          {/* ── Server log tail ── */}
          <section className="rounded-lg border border-border bg-card p-4">
            <h2 className="mb-2 font-mono text-[12px] uppercase tracking-widest text-muted-foreground">
              Server log (tail)
            </h2>
            {conn?.server && "logs" in conn.server && Array.isArray((conn.server as { logs?: string[] }).logs) &&
            (conn.server as { logs: string[] }).logs.length ? (
              <pre className="max-h-[320px] overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-black/50 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
                {(conn.server as { logs: string[] }).logs.slice(-80).join("\n")}
              </pre>
            ) : (
              <p className="text-[12px] text-muted-foreground/70">
                Press “Load log” to read the server log tail.
              </p>
            )}
            {conn?.events && (
              <p className="mt-2 font-mono text-[11px] text-muted-foreground/70">
                event stream: {conn.events.connected ? "connected" : "disconnected"} · reconnect
                attempts {conn.events.reconnectAttempts}
                {conn.events.error ? ` · ${conn.events.error}` : ""}
              </p>
            )}
          </section>

          {/* ── Probe summary ── */}
          {!d ? (
            <div className="rounded-lg border border-border bg-card p-6 text-center text-[13px] text-muted-foreground">
              {probing ? "Running live probes…" : "No diagnostics yet — press re-probe."}
            </div>
          ) : (
            <>
              <div className="grid gap-4 md:grid-cols-3">
                <section className="rounded-lg border border-border bg-card p-4">
                  <h2 className="mb-2 font-mono text-[12px] uppercase tracking-widest text-muted-foreground">
                    Runtime
                  </h2>
                  <Line k="node" v={d.node.version} />
                  <Line k="platform" v={`${d.node.platform}/${d.node.arch}`} />
                  <Line k="opencode" v={d.installation?.version ?? "unknown"} />
                  <Line k="path" v={d.installation?.path ?? "—"} />
                  <Line k="method" v={d.installation?.method ?? "—"} />
                </section>
                <section className="rounded-lg border border-border bg-card p-4">
                  <h2 className="mb-2 font-mono text-[12px] uppercase tracking-widest text-muted-foreground">
                    Server
                  </h2>
                  <Line k="state" v={d.server.state} tone={d.server.state === "running" ? "ok" : "warn"} />
                  <Line k="baseUrl" v={d.baseUrl ?? "—"} tone={d.connected ? "ok" : "warn"} />
                  <Line k="owned" v={d.server.owned ? "yes" : "no (adopted)"} />
                  <Line k="pid" v={d.server.pid ? String(d.server.pid) : "—"} />
                  <Line k="latency" v={d.latencyMs != null ? `${d.latencyMs}ms` : "—"} />
                  <Line
                    k="auth"
                    v={d.config.passwordConfigured ? "password set" : "no password (loopback only)"}
                    tone={d.config.passwordConfigured ? "ok" : "warn"}
                  />
                </section>
                <section className="rounded-lg border border-border bg-card p-4">
                  <h2 className="mb-2 font-mono text-[12px] uppercase tracking-widest text-muted-foreground">
                    Bridges
                  </h2>
                  <Line
                    k="SSE events"
                    v={d.events.connected ? "connected" : "idle"}
                    tone={d.events.connected ? "ok" : "warn"}
                  />
                  <Line k="events received" v={String(d.events.eventsReceived)} />
                  <Line k="reconnects" v={String(d.events.reconnectAttempts)} />
                  <Line
                    k="openapi paths"
                    v={d.openapi.paths ? String(d.openapi.paths) : "—"}
                    tone={d.openapi.paths ? "ok" : "bad"}
                  />
                  {d.openapi.error && <Line k="openapi error" v={d.openapi.error} tone="bad" />}
                  <Line k="lab data" v={d.lab.dataDir} />
                </section>
              </div>

              <section className="rounded-lg border border-border bg-card p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="font-mono text-[12px] uppercase tracking-widest text-muted-foreground">
                    Capability matrix · {supported}/{total} supported
                  </h2>
                  <input
                    className="field w-56 py-1.5 text-[12px]"
                    placeholder="filter endpoints…"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                  />
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  {d.capabilities
                    .filter(
                      (c) =>
                        !filter ||
                        c.label.toLowerCase().includes(filter.toLowerCase()) ||
                        c.endpoint.toLowerCase().includes(filter.toLowerCase())
                    )
                    .map((c) => (
                      <div
                        key={c.id}
                        className={`rounded-lg border px-3 py-2 ${
                          c.supported
                            ? "border-emerald-600/40 bg-emerald-500/5"
                            : "border-destructive/40 bg-destructive/5"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[12.5px]">{c.label}</span>
                          <span
                            className={`font-mono text-[10px] uppercase ${c.supported ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}
                          >
                            {c.supported ? "supported" : "absent"}
                          </span>
                        </div>
                        <div className="mt-0.5 font-mono text-[10.5px] text-muted-foreground/70">
                          {c.endpoint}
                        </div>
                        {c.note && (
                          <div className="mt-0.5 text-[11px] text-amber-600 dark:text-amber-300">
                            {c.note}
                          </div>
                        )}
                      </div>
                    ))}
                </div>
              </section>

              <section className="rounded-lg border border-border bg-card p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="font-mono text-[12px] uppercase tracking-widest text-muted-foreground">
                    Audit log (tail)
                  </h2>
                  <span className="chip">{d.log.length}</span>
                </div>
                {d.log.length === 0 ? (
                  <p className="text-[12.5px] text-muted-foreground/70">No audit entries yet.</p>
                ) : (
                  <ul className="max-h-[320px] space-y-0.5 overflow-y-auto font-mono text-[10.5px]">
                    {[...d.log].reverse().map((e, i) => (
                      <li
                        key={`${e.ts ?? e.at ?? i}:${i}`}
                        className="flex gap-2 border-b border-border/40 py-0.5"
                      >
                        <span className="shrink-0 text-muted-foreground/70">
                          {new Date(e.ts ?? e.at ?? 0).toLocaleTimeString()}
                        </span>
                        <span
                          className={`shrink-0 uppercase ${
                            e.level === "error"
                              ? "text-destructive"
                              : e.level === "warn"
                                ? "text-amber-600 dark:text-amber-300"
                                : "text-primary"
                          }`}
                        >
                          {e.level}
                        </span>
                        <span className="shrink-0 text-blue-600 dark:text-blue-400">{e.scope}</span>
                        <span
                          className="min-w-0 truncate text-muted-foreground"
                          title={JSON.stringify(e.data ?? {})}
                        >
                          {e.message}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="rounded-lg border border-border bg-card p-4">
                <h2 className="mb-3 font-mono text-[12px] uppercase tracking-widest text-muted-foreground">
                  Allowed roots
                </h2>
                <ul className="space-y-1">
                  {d.lab.roots.map((r) => (
                    <li key={r.path} className="flex items-baseline justify-between gap-3 text-[12px]">
                      <span className="min-w-0 truncate font-mono text-muted-foreground">
                        {r.label ? `${r.label} · ${r.path}` : r.path}
                      </span>
                      <span className="chip shrink-0">{r.source}</span>
                    </li>
                  ))}
                </ul>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Line({ k, v, tone }: { k: string; v: string; tone?: "ok" | "warn" | "bad" }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/50 py-1.5 last:border-0">
      <span className="shrink-0 font-mono text-[11px] text-muted-foreground/70">{k}</span>
      <span
        className={`min-w-0 truncate text-right font-mono text-[11.5px] ${
          tone === "ok"
            ? "text-emerald-600 dark:text-emerald-400"
            : tone === "warn"
              ? "text-amber-600 dark:text-amber-300"
              : tone === "bad"
                ? "text-destructive"
                : "text-muted-foreground"
        }`}
        title={v}
      >
        {v}
      </span>
    </div>
  );
}

function DetailRow({ k, v, ok }: { k: string; v: string; ok?: boolean }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-muted-foreground/70">{k}</span>
      <span
        className={`truncate font-mono text-[11px] ${
          ok === undefined ? "text-foreground" : ok ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-300"
        }`}
        title={v}
      >
        {v}
      </span>
    </div>
  );
}
