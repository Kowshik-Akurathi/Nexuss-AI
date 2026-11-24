"use client";

import { useCallback, useEffect, useState } from "react";
import { useOpenCodeStore } from "../store";
import type { SettingsPayload } from "../types";

/**
 * OpenCode runtime panel for the Proxy Settings dialog — migrated from Nexuss
 * Lab `/settings`. Default selections, server connection, storage/roots and
 * environment visibility.
 */
export default function OpenCodeSettingsPanel() {
  const status = useOpenCodeStore((s) => s.status);
  const refresh = useOpenCodeStore((s) => s.refresh);
  const notify = useOpenCodeStore((s) => s.notify);

  const [s, setS] = useState<SettingsPayload | null>(null);
  const [agent, setAgent] = useState("");
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch("/api/settings", { cache: "no-store" });
    if (!r.ok) return;
    const d = (await r.json()) as SettingsPayload;
    setS(d);
    setAgent(d.selections.agent);
    setModel(d.selections.model);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agent, model }),
      });
      const d = await r.json();
      if (!r.ok) return notify(d?.error?.message || "Save failed");
      notify("Defaults saved");
      await load();
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-[11.5px] leading-relaxed text-muted-foreground">
        Runtime configuration is read from the environment (<span className="font-mono">.env.local</span>);
        selections persist in Nexuss&apos;s own SQLite. Nothing here touches production OpenCode
        configuration files.
      </p>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-xl border border-border bg-card p-3.5 shadow-xs">
          <h4 className="mb-3 text-[10px] font-bold font-mono uppercase tracking-wider text-muted-foreground">
            Default selections
          </h4>
          <div className="space-y-3">
            <div>
              <div className="label">Default agent</div>
              <select
                className="field w-full"
                value={agent}
                onChange={(e) => setAgent(e.target.value)}
              >
                {(status?.agents ?? []).map((a) => (
                  <option key={a.name} value={a.name}>
                    {a.name} — {a.description.slice(0, 60)}
                  </option>
                ))}
                {agent && !(status?.agents ?? []).some((a) => a.name === agent) && (
                  <option value={agent}>{agent}</option>
                )}
              </select>
            </div>
            <div>
              <div className="label">Default model</div>
              <select
                className="field w-full"
                value={model}
                onChange={(e) => setModel(e.target.value)}
              >
                <option value="">(let OpenCode decide)</option>
                {(status?.models ?? [])
                  .filter((m) => m.enabled !== false)
                  .map((m) => (
                    <option key={m.ref} value={m.ref}>
                      {m.ref}
                      {m.authenticated ? "" : " — not authenticated"}
                    </option>
                  ))}
                {model && !(status?.models ?? []).some((m) => m.ref === model) && (
                  <option value={model}>{model}</option>
                )}
              </select>
            </div>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() => void save()}
            >
              {busy ? "Saving…" : "Save defaults"}
            </button>
          </div>
          <div className="mt-4">
            <Row k="project" v={s?.selections.directory || "none selected"} />
            <Row k="session" v={s?.selections.sessionID || "—"} />
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card p-3.5 shadow-xs">
          <h4 className="mb-3 text-[10px] font-bold font-mono uppercase tracking-wider text-muted-foreground">
            Server connection
          </h4>
          <Row k="preferredUrl" v={s?.config.preferredUrl ?? "(auto-detect)"} />
          <Row k="startPort" v={String(s?.config.startPort ?? "—")} />
          <Row k="hostname" v={s?.config.hostname ?? "—"} />
          <Row k="startTimeoutMs" v={String(s?.config.startTimeoutMs ?? "—")} />
          <Row
            k="OPENCODE_SERVER_PASSWORD"
            v={s?.config.passwordConfigured ? "configured" : "not set (no auth required)"}
            tone={s?.config.passwordConfigured ? "ok" : "warn"}
          />
          <Row
            k="live baseUrl"
            v={status?.server.baseUrl ?? "—"}
            tone={status?.connected ? "ok" : "warn"}
          />
          <Row
            k="server state"
            v={status?.server.state ?? "—"}
            tone={status?.server.state === "running" ? "ok" : "warn"}
          />
          <Row
            k="owned by Nexuss"
            v={
              status?.server.owned
                ? "yes (safe to stop)"
                : "no (adopted — never stopped)"
            }
          />
        </section>

        <section className="rounded-xl border border-border bg-card p-3.5 shadow-xs">
          <h4 className="mb-3 text-[10px] font-bold font-mono uppercase tracking-wider text-muted-foreground">
            Storage &amp; roots
          </h4>
          <Row k="lab root" v={s?.lab.root ?? "—"} />
          <Row k="data dir" v={s?.lab.dataDir ?? "—"} />
          <Row k="node" v={s?.lab.node ?? "—"} />
          <Row k="sessions" v={String(s?.stats.sessions ?? 0)} />
          <Row k="executions" v={String(s?.stats.executions ?? 0)} />
          <Row
            k="failed"
            v={String(s?.stats.failed ?? 0)}
            tone={s?.stats.failed ? "bad" : "ok"}
          />
          <div className="mt-3">
            <div className="label">Allowed project roots</div>
            <ul className="space-y-1">
              {(s?.lab.roots ?? []).map((r) => (
                <li
                  key={r.path}
                  className="rounded-lg border border-border bg-muted/50 px-2 py-1"
                >
                  <div className="text-[12px]">{r.label ?? r.path}</div>
                  {r.label && (
                    <div className="truncate font-mono text-[10px] text-muted-foreground/70">
                      {r.path}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card p-3.5 shadow-xs">
          <h4 className="mb-3 text-[10px] font-bold font-mono uppercase tracking-wider text-muted-foreground">
            Environment
          </h4>
          <Row
            k="OPENCODE_SERVER_URL"
            v={
              s?.config.preferredUrl
                ? s.config.preferredUrl
                : s?.env.OPENCODE_SERVER_URL_SET
                  ? "set (see backend env)"
                  : "(not set — auto-detect on loopback)"
            }
          />
          <Row
            k="OPENCODE_SERVER_PASSWORD"
            v={s?.env.OPENCODE_SERVER_PASSWORD_SET ? "set" : "not set"}
            tone={s?.env.OPENCODE_SERVER_PASSWORD_SET ? "ok" : "warn"}
          />
          <Row
            k="LAB_EXTRA_PROJECT_ROOTS"
            v={s?.env.LAB_EXTRA_PROJECT_ROOTS_SET ? "set" : "(not set)"}
          />
          <Row k="LAB_DATA_DIR" v={s?.env.LAB_DATA_DIR_SET ? "set" : "(default .lab/)"} />
          <div className="mt-3 rounded-lg border border-border bg-muted/50 px-3 py-2 font-mono text-[10.5px] leading-relaxed text-muted-foreground">
            <div className="mb-1 text-muted-foreground/70"># .env.local (Nexuss)</div>
            <div>OPENCODE_SERVER_URL=http://127.0.0.1:4981</div>
            <div># OPENCODE_SERVER_PASSWORD=…</div>
            <div># LAB_EXTRA_PROJECT_ROOTS=C:\work\other-project</div>
          </div>
        </section>
      </div>

      <p className="text-[11.5px] leading-relaxed text-muted-foreground/80">
        Provider API keys stay inside OpenCode. Nexuss only reads a stripped-down catalogue (id, name,
        whether it is authenticated) and never forwards <span className="font-mono">key</span> or{" "}
        <span className="font-mono">env</span> values to the browser.
      </p>
    </div>
  );
}

function Row({ k, v, tone }: { k: string; v: string; tone?: "ok" | "warn" | "bad" }) {
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
