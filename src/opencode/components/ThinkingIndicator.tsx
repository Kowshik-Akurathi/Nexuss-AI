/**
 * ChatGPT-style thinking indicator: shown only while the agent is working and
 * has not produced any visible answer text yet. It never contains the user's
 * prompt, never fabricates reasoning, and disappears as soon as the assistant
 * starts responding.
 */
export function ThinkingIndicator() {
  return (
    <div className="slide-up flex items-center gap-2.5 rounded-lg border border-border bg-muted/40 px-3.5 py-2.5">
      <span className="text-[13px] leading-none text-primary pulse" aria-hidden="true">
        ❯
      </span>
      <span className="text-[13px] text-muted-foreground">Thinking</span>
      <span className="thinking-dots flex items-end gap-1" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
    </div>
  );
}
