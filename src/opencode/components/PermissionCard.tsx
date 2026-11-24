import { useState } from "react";
import type { PermissionRow } from "../types";
import { useOpenCodeStore } from "../store";

const RISK: Record<string, { label: string; cls: string }> = {
  high: { label: "HIGH RISK", cls: "border-destructive/50 bg-destructive/10 text-destructive" },
  medium: { label: "MEDIUM", cls: "border-amber-600/50 bg-amber-500/10 text-amber-600 dark:text-amber-300" },
  low: { label: "LOW", cls: "border-border bg-secondary text-muted-foreground" },
};

/**
 * Permission request card. Mirrors OpenCode's own reply vocabulary:
 *   once   -> allow this one time
 *   always -> allow and persist a project-scoped allow rule
 *   reject -> deny
 * Nothing is ever auto-approved.
 */
export function PermissionCard({ permission }: { permission: PermissionRow }) {
  const decidePermission = useOpenCodeStore((s) => s.decidePermission);
  const [busy, setBusy] = useState<string | null>(null);
  const risk = RISK[permission.risk] ?? RISK.low;

  const act = async (decision: "once" | "always" | "reject") => {
    setBusy(decision);
    try {
      await decidePermission(permission.sessionID, permission.id, decision);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="slide-up rounded-lg border border-amber-600/40 bg-amber-500/10 p-3">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded border px-1.5 py-0.5 font-mono text-[9px] tracking-widest ${risk.cls}`}>
              {risk.label}
            </span>
            <span className="font-mono text-[11px] font-semibold text-foreground">{permission.action}</span>
            <span className="chip">{permission.source}</span>
          </div>
          <p className="mt-1.5 text-[13px] text-foreground">{permission.description}</p>
        </div>
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground/70">{permission.id}</span>
      </div>

      {permission.resources.length > 0 && (
        <div className="mb-2 rounded border border-border bg-background/60 p-2">
          <div className="mb-1 font-mono text-[9px] uppercase tracking-widest text-muted-foreground/70">
            requested
          </div>
          <ul className="space-y-0.5">
            {permission.resources.slice(0, 8).map((r) => (
              <li key={r} className="break-all font-mono text-[11px] text-amber-700 dark:text-amber-200/90">
                {r}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button className="btn btn-primary" disabled={busy !== null} onClick={() => void act("once")}>
          {busy === "once" ? "sending…" : "Allow once"}
        </button>
        <button className="btn" disabled={busy !== null} onClick={() => void act("always")}>
          {busy === "always" ? "sending…" : "Allow always"}
        </button>
        <button className="btn btn-danger" disabled={busy !== null} onClick={() => void act("reject")}>
          {busy === "reject" ? "sending…" : "Reject"}
        </button>
        <span className="ml-auto font-mono text-[10px] text-muted-foreground/70">
          session {permission.sessionID.slice(0, 14)}…
        </span>
      </div>
      <p className="mt-2 text-[10.5px] leading-relaxed text-muted-foreground/80">
        Forwarded to OpenCode&apos;s own permission system. <span className="text-muted-foreground">Reject</span>{" "}
        denies the operation and every other pending request in that session.{" "}
        <span className="text-muted-foreground">Allow always</span> persists a project-scoped allow rule (never
        overriding a configured deny).
      </p>
    </div>
  );
}
