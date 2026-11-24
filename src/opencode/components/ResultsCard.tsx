import type { ResultsView } from "../types";

/** Verified execution result card: file checks, commands, errors, diff stats. */
export function ResultsCard({ results }: { results: ResultsView }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3.5">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          execution result
        </span>
        <span
          className={`rounded border px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-widest ${
            results.status === "completed"
              ? "border-emerald-600/50 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"
              : results.status === "interrupted"
                ? "border-amber-600/50 bg-amber-500/10 text-amber-600 dark:text-amber-300"
                : "border-destructive/50 bg-destructive/10 text-destructive"
          }`}
        >
          {results.status}
        </span>
      </div>
      <p className="text-[12.5px] leading-relaxed text-muted-foreground">{results.summary}</p>

      {results.fileChecks.length > 0 && (
        <ul className="mt-2 space-y-1">
          {results.fileChecks.map((f) => (
            <li key={f.path} className="flex items-center gap-2 font-mono text-[11px]">
              <span className={f.exists ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}>
                {f.exists ? "✓" : "✕"}
              </span>
              <span className="truncate text-foreground">{f.path}</span>
              {f.size != null && <span className="text-muted-foreground/70">{f.size} B</span>}
            </li>
          ))}
        </ul>
      )}

      {results.commands.length > 0 && (
        <div className="mt-2">
          <div className="label">commands run</div>
          <ul className="space-y-0.5">
            {results.commands.map((c, i) => (
              <li
                key={i}
                className="truncate rounded border border-border bg-background px-2 py-1 font-mono text-[11px] text-blue-600 dark:text-blue-400"
              >
                $ {c}
              </li>
            ))}
          </ul>
        </div>
      )}

      {results.errors.length > 0 && (
        <div className="mt-2 text-[11.5px] text-destructive">{results.errors.join(" · ")}</div>
      )}

      <div className="mt-2 font-mono text-[10.5px] text-muted-foreground/70">
        +{results.additions} −{results.deletions}
        {results.durationMs != null && ` · ${(results.durationMs / 1000).toFixed(1)}s`}
        {` · verified on disk: ${results.verifiedOnDisk ? "yes" : "no changes observed"}`}
      </div>
    </div>
  );
}

/** Compact A/M/D file list used by the workspace right panel. */
export function FileList({ results }: { results: ResultsView }) {
  const rows = [
    ...results.filesCreated.map((p) => ({ p, s: "A" as const })),
    ...results.filesModified.map((p) => ({ p, s: "M" as const })),
    ...results.filesDeleted.map((p) => ({ p, s: "D" as const })),
  ];
  if (!rows.length) return <p className="text-[11.5px] text-muted-foreground/70">No changes detected.</p>;
  return (
    <ul className="space-y-0.5">
      {rows.slice(0, 30).map((r) => (
        <li key={r.s + r.p} className="flex items-center gap-1.5 font-mono text-[10.5px]">
          <span
            className={
              r.s === "A"
                ? "text-emerald-600 dark:text-emerald-400"
                : r.s === "D"
                  ? "text-destructive"
                  : "text-primary"
            }
          >
            {r.s}
          </span>
          <span className="truncate text-muted-foreground" title={r.p}>
            {r.p}
          </span>
        </li>
      ))}
    </ul>
  );
}
