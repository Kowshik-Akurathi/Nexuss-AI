"use client";

import { useEffect, useMemo, useState } from "react";
import type { InstallState, InstallStageId, StageState, StageStatus } from "@/server/install/types";
import { STAGE_ORDER, STAGE_TITLES, isActiveStatus } from "@/server/install/types";
import { useInstallStore, installBusy, getStageTitle, getStageOrder } from "./store";
import { useViewStore } from "@/store/viewStore";
import { useOpenCodeStore } from "../store";
import {
  AlertTriangleIcon,
  BotIcon,
  CheckIcon,
  ChevronDownIcon,
  DownloadIcon,
  TerminalIcon,
  XCircleIcon,
  XIcon,
} from "@/components/icons";

/* ------------------------------------------------------------------ icons */

function StageMarker({ status }: { status: StageStatus }) {
  if (status === "completed") {
    return (
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-emerald-600/40 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
        <CheckIcon className="h-3.5 w-3.5" />
      </span>
    );
  }
  if (status === "running") {
    return (
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-primary/50 bg-primary/10">
        <span className="h-3 w-3 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-destructive/50 bg-destructive/10 text-destructive">
        <XCircleIcon className="h-3.5 w-3.5" />
      </span>
    );
  }
  if (status === "awaiting") {
    return (
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-amber-600/50 bg-amber-500/15 text-amber-600 dark:text-amber-300">
        <span className="pulse h-2 w-2 rounded-full bg-amber-500" />
      </span>
    );
  }
  if (status === "skipped") {
    return (
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-muted-foreground/70">
        <CheckIcon className="h-3.5 w-3.5" />
      </span>
    );
  }
  if (status === "cancelled") {
    return (
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-muted-foreground/70">
        <XIcon className="h-3 w-3" />
      </span>
    );
  }
  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border bg-background">
      <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
    </span>
  );
}

function statusLabel(status: StageStatus): string {
  switch (status) {
    case "completed":
      return "Completed";
    case "running":
      return "In progress";
    case "failed":
      return "Failed";
    case "awaiting":
      return "Action needed";
    case "skipped":
      return "Skipped";
    case "cancelled":
      return "Cancelled";
    default:
      return "Waiting";
  }
}

/* --------------------------------------------------------------- timeline */

function TimelineStage({
  stage,
  isLast,
  onRetry,
  onAuthAction,
  authNotice,
}: {
  stage: StageState;
  isLast: boolean;
  onRetry: () => void;
  onAuthAction: (kind: "start" | "recheck" | "skip") => void;
  authNotice: string | null;
}) {
  const active = stage.status === "running";
  return (
    <li className="relative flex gap-3 pb-4 last:pb-0">
      {!isLast && (
        <span
          className={`absolute left-[11px] top-6 h-[calc(100%-1.5rem)] w-px ${
            stage.status === "completed" || stage.status === "skipped"
              ? "bg-emerald-600/40"
              : "bg-border"
          }`}
          aria-hidden="true"
        />
      )}
      <StageMarker status={stage.status} />
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span
            className={`text-[13px] font-semibold ${
              active
                ? "text-primary"
                : stage.status === "failed"
                  ? "text-destructive"
                  : stage.status === "completed" || stage.status === "skipped"
                    ? "text-foreground"
                    : "text-muted-foreground"
            }`}
          >
            {stage.title}
          </span>
          <span
            className={`font-mono text-[10px] uppercase tracking-wider ${
              stage.status === "completed"
                ? "text-emerald-600 dark:text-emerald-400"
                : stage.status === "failed"
                  ? "text-destructive"
                  : stage.status === "awaiting"
                    ? "text-amber-600 dark:text-amber-300"
                    : "text-muted-foreground/70"
            }`}
          >
            {statusLabel(stage.status)}
          </span>
        </div>

        {stage.status !== "completed" && stage.status !== "skipped" && (
          <p
            className={`mt-0.5 text-[12px] leading-snug ${
              stage.status === "failed" ? "text-destructive" : "text-muted-foreground"
            }`}
          >
            {stage.activity}
            {active && <span className="thinking-dots ml-1 inline-flex"><i /><i /><i /></span>}
          </p>
        )}
        {stage.status === "completed" && stage.id !== "complete" && (
          <p className="mt-0.5 truncate text-[12px] text-muted-foreground/70">{stage.activity}</p>
        )}

        {stage.status === "failed" && stage.error && (
          <div className="mt-2 rounded-lg border border-destructive/40 bg-destructive/5 p-2.5">
            <p className="text-[12px] leading-snug text-destructive">{stage.error.message}</p>
            {stage.error.recovery && (
              <p className="mt-1 text-[11.5px] leading-snug text-muted-foreground">
                {stage.error.recovery}
              </p>
            )}
            <button type="button" className="btn btn-primary mt-2" onClick={onRetry}>
              Retry this stage
            </button>
          </div>
        )}

        {stage.status === "awaiting" && stage.id === "auth" && (
          <div className="mt-2 rounded-lg border border-amber-600/40 bg-amber-500/10 p-2.5">
            <p className="text-[12px] leading-snug text-amber-700 dark:text-amber-200">
              Installing OpenCode does not provide an AI provider credential. Add one so Nexuss can
              offer models — the login happens in your own terminal and Nexuss never sees the secret.
            </p>
            {authNotice && (
              <p className="mt-1.5 text-[11.5px] leading-snug text-muted-foreground">{authNotice}</p>
            )}
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => onAuthAction("start")}
              >
                <TerminalIcon className="h-3.5 w-3.5" /> Start authentication
              </button>
              <button type="button" className="btn" onClick={() => onAuthAction("recheck")}>
                I&apos;ve finished — recheck
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => onAuthAction("skip")}
              >
                Continue without authentication
              </button>
            </div>
          </div>
        )}
      </div>
    </li>
  );
}

/* --------------------------------------------------------------- modal shell */

function elapsed(from: number | null, to: number | null): string {
  if (!from) return "—";
  const ms = (to ?? Date.now()) - from;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export default function InstallTracker() {
  const open = useInstallStore((s) => s.open);
  const setOpen = useInstallStore((s) => s.setOpen);
  const state = useInstallStore((s) => s.state);
  const checking = useInstallStore((s) => s.checking);
  const streamLive = useInstallStore((s) => s.streamLive);
  const startAuth = useInstallStore((s) => s.startAuth);
  const recheckAuth = useInstallStore((s) => s.recheckAuth);
  const continueWithoutAuth = useInstallStore((s) => s.continueWithoutAuth);
  const cancel = useInstallStore((s) => s.cancel);
  const retry = useInstallStore((s) => s.retry);
  const setView = useViewStore((s) => s.setView);
  const notify = useOpenCodeStore((s) => s.notify);

  const [showLogs, setShowLogs] = useState(false);
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [, tick] = useState(0);

  // Keep the elapsed timer honest while a run is active.
  useEffect(() => {
    if (!open || !state || !isActiveStatus(state.status)) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [open, state]);

  const busy = installBusy(state);
  const currentStage = useMemo(
    () => state?.stages.find((s) => s.id === state.currentStage) ?? null,
    [state]
  );
  const currentIdx = state?.currentStage ? STAGE_ORDER.indexOf(state.currentStage) : -1;

  if (!open) return null;

  const close = () => {
    // Closing never kills a running installation — the pill keeps it visible.
    setOpen(false);
    setConfirmCancel(false);
  };

  const handleAuth = async (kind: "start" | "recheck" | "skip") => {
    if (kind === "start") {
      const r = await startAuth();
      setAuthNotice(r.detail);
      notify(r.started ? "Authentication terminal opened" : r.detail);
      return;
    }
    setAuthNotice(null);
    if (kind === "recheck") await recheckAuth();
    else await continueWithoutAuth();
  };

  const finished = state?.status === "completed";
  const failed = state?.status === "failed";
  const cancelled = state?.status === "cancelled";
  const awaiting = state?.status === "awaiting-auth";

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      aria-label="Installing OpenCode"
    >
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl animate-in zoom-in-95 duration-150">
        {/* ---------------------------------------------------------- header */}
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-primary/40 bg-primary/10 text-primary">
              {finished ? <CheckIcon className="h-4.5 w-4.5" /> : <DownloadIcon className="h-4.5 w-4.5" />}
            </span>
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-foreground">
                {finished ? "OpenCode Successfully Connected!" : "Installing OpenCode"}
              </h2>
              <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">
                {finished
                  ? "Your OpenCode environment is installed, configured and connected to Nexuss."
                  : "Real installation stages run on this device — each step below reports an actual result."}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={close}
            className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Close (installation keeps running)"
            title="Close — the setup keeps running in the background"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        {/* ------------------------------------------------- progress summary */}
        {!finished && state && (
          <div className="border-b border-border px-5 py-3">
            <div className="flex items-center justify-between gap-3 text-[11.5px]">
              <span className="font-mono uppercase tracking-wider text-muted-foreground">
                {currentStage ? currentStage.title : state.status}
                {currentIdx >= 0 && ` · stage ${currentIdx + 1} of ${STAGE_ORDER.length}`}
              </span>
              <span className="flex items-center gap-2 font-mono text-muted-foreground">
                <span className="text-foreground">{state.progress}%</span>
                <span className="text-muted-foreground/70">· {elapsed(state.startedAt, state.endedAt)}</span>
                {!streamLive && <span className="text-amber-600 dark:text-amber-300">reconnecting…</span>}
              </span>
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  failed ? "bg-destructive" : awaiting ? "bg-amber-500" : "bg-primary"
                }`}
                style={{ width: `${state.progress}%` }}
              />
            </div>
            {currentStage && isActiveStatus(state.status) && (
              <p className="mt-2 flex items-center gap-1.5 text-[12.5px] text-foreground">
                {currentStage.activity}
                <span className="thinking-dots inline-flex"><i /><i /><i /></span>
              </p>
            )}
            {state.environment && state.status === "checking" && (
              <p className="mt-1 font-mono text-[11px] text-muted-foreground/80">
                {state.environment.platformLabel} {state.environment.platformRelease} ·{" "}
                {state.environment.arch} · Node {state.environment.node}
                {state.environment.npm ? ` · npm ${state.environment.npm}` : ""}
              </p>
            )}
          </div>
        )}

        {/* -------------------------------------------------------- completed */}
        {finished && state?.summary && (
          <div className="border-b border-border px-5 py-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <SummaryCell k="OpenCode version" v={state.summary.version ?? "—"} />
              <SummaryCell k="Server address" v={state.summary.serverUrl ?? "—"} />
              <SummaryCell k="Connection" v={state.summary.connected ? "Connected" : "Not connected"} ok={state.summary.connected} />
              <SummaryCell
                k="Authentication"
                v={state.summary.authenticated ? "Configured" : "Not configured"}
                ok={state.summary.authenticated}
              />
              <SummaryCell k="Agents" v={String(state.summary.agents ?? 0)} ok={(state.summary.agents ?? 0) > 0} />
              <SummaryCell k="Models" v={String(state.summary.models ?? 0)} ok={(state.summary.models ?? 0) > 0} />
            </div>
            {state.summary.authProviders && state.summary.authProviders.length > 0 && (
              <p className="mt-2 font-mono text-[11px] text-muted-foreground">
                Authenticated providers: {state.summary.authProviders.join(", ")}
              </p>
            )}
            {!state.summary.authenticated && (
              <p className="mt-2 rounded-lg border border-amber-600/40 bg-amber-500/10 px-3 py-2 text-[11.5px] text-amber-700 dark:text-amber-200">
                No provider credential yet — agents work, but models stay unavailable until you
                authenticate from the Authentication stage above.
              </p>
            )}
          </div>
        )}

        {/* ----------------------------------------------------------- failed */}
        {failed && state?.error && (
          <div className="border-b border-border px-5 py-3">
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
              <div className="flex items-start gap-2">
                <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                <div className="min-w-0">
                  <p className="text-[12.5px] font-semibold text-destructive">
                    {STAGE_TITLES[state.error.stage]} failed
                  </p>
                  <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">
                    {state.error.message}
                  </p>
                  {state.error.recovery && (
                    <p className="mt-1 text-[11.5px] leading-snug text-muted-foreground/80">
                      {state.error.recovery}
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => void retry({ elevated: state.error?.code === "ELEVATION_REQUIRED" })}
                    >
                      Retry from this stage
                    </button>
                    {state.error.code === "ELEVATION_REQUIRED" && (
                      <button type="button" className="btn" onClick={() => void retry({ elevated: true })}>
                        Retry with elevated permissions
                      </button>
                    )}
                    <button type="button" className="btn btn-ghost" onClick={() => void retry()}>
                      Retry
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* -------------------------------------------------------- cancelled */}
        {cancelled && (
          <div className="border-b border-border px-5 py-3">
            <p className="text-[12.5px] text-muted-foreground">
              Setup cancelled. Completed stages were preserved — resume any time to continue from
              where it stopped.
            </p>
          </div>
        )}

        {/* --------------------------------------------------------- timeline */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <ul className="space-y-0">
            {state?.stages.map((stage, i) => (
              <TimelineStage
                key={stage.id}
                stage={stage}
                isLast={i === state.stages.length - 1}
                onRetry={() => void retry()}
                onAuthAction={(k) => void handleAuth(k)}
                authNotice={authNotice}
              />
            ))}
            {!state && (
              <li className="py-6 text-center text-[13px] text-muted-foreground">
                {checking ? "Checking the current setup state…" : "No installation has been started yet."}
              </li>
            )}
          </ul>

          {/* environment details after stage 1 completes */}
          {state?.environment && (
            <div className="mt-3 rounded-lg border border-border bg-muted/40 p-3">
              <div className="grid gap-x-4 gap-y-1 font-mono text-[11px] text-muted-foreground sm:grid-cols-2">
                <DetailRow k="OS" v={`${state.environment.platformLabel} ${state.environment.platformRelease}`} />
                <DetailRow k="Architecture" v={state.environment.arch} />
                <DetailRow k="Node" v={state.environment.node} />
                <DetailRow k="npm" v={state.environment.npm ?? "not found"} />
                <DetailRow
                  k="Install method"
                  v={state.environment.methods.find((m) => m.selected)?.label ?? "none available"}
                />
                <DetailRow
                  k="Existing install"
                  v={
                    state.environment.existingInstallations[0]?.path ?? "none found"
                  }
                />
                <DetailRow
                  k="Running server"
                  v={state.environment.existingServers[0]?.url ?? "none found"}
                />
                <DetailRow
                  k="Elevation"
                  v={state.environment.requiresElevation ? "required" : "not required"}
                />
              </div>
              {state.environment.notes.length > 0 && (
                <ul className="mt-2 space-y-0.5 border-t border-border pt-2 text-[11px] text-muted-foreground">
                  {state.environment.notes.map((n) => (
                    <li key={n}>• {n}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* technical details */}
          <details
            className="mt-3 overflow-hidden rounded-lg border border-border"
            open={showLogs}
            onToggle={(e) => setShowLogs((e.currentTarget as HTMLDetailsElement).open)}
          >
            <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-[11.5px] font-medium text-muted-foreground hover:bg-muted">
              <span className="flex items-center gap-1.5">
                <ChevronDownIcon className="h-3.5 w-3.5" /> Technical details & logs
              </span>
              <span className="font-mono text-[10px]">{state?.logs.length ?? 0} lines</span>
            </summary>
            <div className="border-t border-border bg-black/40 p-3">
              {state?.stages.some((s) => s.detail) && (
                <pre className="mb-2 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[10.5px] leading-relaxed text-muted-foreground">
                  {state.stages
                    .filter((s) => s.detail)
                    .map((s) => `## ${s.title}\n${JSON.stringify(s.detail, null, 2)}`)
                    .join("\n\n")}
                </pre>
              )}
              <pre className="max-h-56 overflow-auto whitespace-pre-wrap font-mono text-[10.5px] leading-relaxed text-muted-foreground">
                {state?.logs.length ? state.logs.join("\n") : "No log output yet."}
              </pre>
            </div>
          </details>
        </div>

        {/* ----------------------------------------------------------- footer */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-5 py-3">
          <div className="flex items-center gap-2">
            {busy && !confirmCancel && (
              <button type="button" className="btn btn-danger" onClick={() => setConfirmCancel(true)}>
                Cancel Setup
              </button>
            )}
            {confirmCancel && (
              <>
                <span className="text-[12px] text-muted-foreground">Stop the installation?</span>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => {
                    setConfirmCancel(false);
                    void cancel();
                  }}
                >
                  Yes, cancel
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setConfirmCancel(false)}>
                  Keep running
                </button>
              </>
            )}
            {(failed || cancelled) && !confirmCancel && (
              <button type="button" className="btn" onClick={() => void retry()}>
                {cancelled ? "Resume setup" : "Retry"}
              </button>
            )}
            {(failed || cancelled || awaiting) && !confirmCancel && (
              <button type="button" className="btn btn-ghost" onClick={() => void useInstallStore.getState().reset()}>
                Discard
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {finished ? (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setOpen(false);
                  setView("agent-workspace");
                }}
              >
                Start Using OpenCode
              </button>
            ) : (
              <button type="button" className="btn btn-ghost" onClick={close}>
                {busy ? "Keep running in background" : "Close"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SummaryCell({ k, v, ok }: { k: string; v: string; ok?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-muted/40 px-2.5 py-1.5">
      <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{k}</div>
      <div
        className={`mt-0.5 truncate font-mono text-[12px] ${
          ok === undefined ? "text-foreground" : ok ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-300"
        }`}
        title={v}
      >
        {v}
      </div>
    </div>
  );
}

function DetailRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-muted-foreground/70">{k}</span>
      <span className="truncate text-foreground" title={v}>
        {v}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------ floating pill */

/** Shown while an installation runs so closing the modal never loses it. */
export function InstallPill() {
  const open = useInstallStore((s) => s.open);
  const state = useInstallStore((s) => s.state);
  const setOpen = useInstallStore((s) => s.setOpen);

  if (open || !state || !installBusy(state)) return null;

  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="fixed bottom-5 right-5 z-[65] flex cursor-pointer items-center gap-2.5 rounded-xl border border-primary/50 bg-card px-3.5 py-2.5 text-xs font-medium text-foreground shadow-2xl transition-colors hover:bg-muted animate-fade-in-up"
      title="Open the installation tracker"
    >
      <span className="flex h-5 w-5 items-center justify-center">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </span>
      <span className="flex flex-col items-start">
        <span className="font-semibold">Installing OpenCode…</span>
        <span className="font-mono text-[10px] text-muted-foreground">
          {state.progress}% · {state.currentStage ? STAGE_TITLES[state.currentStage] : state.status}
        </span>
      </span>
    </button>
  );
}

/** Convenience for the Re-detect panel: a compact status line. */
export function InstallStatusChip() {
  const state = useInstallStore((s) => s.state);
  if (!state || state.status === "idle") return null;
  return (
    <span className="chip" title={state.currentStage ? STAGE_TITLES[state.currentStage] : state.status}>
      <BotIcon className="h-3 w-3" />
      {state.status === "completed" ? "setup complete" : `${state.progress}%`}
    </span>
  );
}