"use client";

import { useEffect, useMemo, useState } from "react";
import { useUsageStore } from "@/store/usageStore";

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

export default function UsageDashboard() {
  const summary = useUsageStore((state) => state.summary);
  const loadSummary = useUsageStore((state) => state.loadSummary);
  const clearUsage = useUsageStore((state) => state.clearUsage);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => { void loadSummary(); }, [loadSummary]);

  const models = useMemo(() => summary.providers.flatMap((provider) =>
    Object.entries(provider.models).map(([model, stats]) => ({ provider: provider.provider, model, ...stats }))
  ), [summary]);

  const handleClear = async () => {
    if (!confirmClear) { setConfirmClear(true); return; }
    await clearUsage();
    setConfirmClear(false);
  };

  return (
    <div className="space-y-4 font-sans text-xs text-foreground">
      {models.length === 0 ? (
        <section className="rounded-xl border border-border bg-card px-4 py-10 text-center shadow-xs">
          <p className="font-mono text-xs text-muted-foreground">No model usage yet</p>
          <p className="mt-1 text-[10px] text-muted-foreground/70">Usage appears after a provider returns token metadata.</p>
        </section>
      ) : (
        <section className="space-y-2.5">
          {models.map((entry) => {
            const percent = summary.totalTokens > 0 ? (entry.totalTokens / summary.totalTokens) * 100 : 0;
            return (
              <article key={`${entry.provider}:${entry.model}`} className="rounded-xl border border-border bg-card p-3.5 shadow-xs">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0"><h4 className="truncate text-xs font-semibold">{entry.model}</h4><p className="mt-0.5 font-mono text-[10px] text-muted-foreground">{entry.provider}</p></div>
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{percent.toFixed(1)}%</span>
                </div>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} /></div>
                <dl className="mt-3 grid grid-cols-3 gap-2 font-mono text-[10px]">
                  <div><dt className="text-muted-foreground">Input</dt><dd className="mt-0.5 font-semibold">{formatTokens(entry.inputTokens)}</dd></div>
                  <div><dt className="text-muted-foreground">Output</dt><dd className="mt-0.5 font-semibold">{formatTokens(entry.outputTokens)}</dd></div>
                  <div><dt className="text-muted-foreground">Total</dt><dd className="mt-0.5 font-semibold">{formatTokens(entry.totalTokens)}</dd></div>
                </dl>
              </article>
            );
          })}
        </section>
      )}

      <section className="pt-1">
        <button type="button" onClick={() => void handleClear()} className={`w-full rounded-xl border px-3 py-2 text-xs font-mono transition-colors cursor-pointer ${confirmClear ? "border-destructive bg-destructive/10 text-destructive font-semibold" : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground"}`}>
          {confirmClear ? "Click again to confirm clear" : "Clear Usage Statistics"}
        </button>
        {confirmClear && <button type="button" onClick={() => setConfirmClear(false)} className="mt-1.5 w-full rounded-xl border border-border bg-background px-3 py-1.5 text-xs font-mono text-muted-foreground hover:text-foreground cursor-pointer">Cancel</button>}
      </section>
    </div>
  );
}
