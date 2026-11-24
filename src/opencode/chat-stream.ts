/**
 * Role-aware reducer that turns raw OpenCode SSE frames into the live chat view.
 *
 * Why this exists (verified against OpenCode 1.19.5 on the live Lab stack):
 *  - OpenCode broadcasts BOTH the user's and the assistant's
 *    `message.part.updated` frames on the shared event stream. Mapping any
 *    text part into the live bubble is what put the user's own prompt inside
 *    the Thinking panel.
 *  - Reasoning deltas are emitted with `field: "text"`, so the field alone
 *    cannot distinguish hidden chain-of-thought from the visible answer.
 *  - `message.part.updated` snapshots for a brand-new part arrive with
 *    `text: ""`, which wiped previously streamed answer text.
 *
 * The reducer is pure bookkeeping: it never invents content, never fabricates
 * reasoning, and only exposes assistant answer text that OpenCode actually
 * produced.
 */

export interface StreamFrame {
  type: string;
  properties?: Record<string, unknown>;
}

export type PartKind = "text" | "reasoning" | "tool" | "other";

interface PartRecord {
  id: string;
  messageID: string;
  kind: PartKind;
  /** Full snapshot text from `message.part.updated` (authoritative once non-empty). */
  snapshot: string;
  /** Deltas observed for this part (used until a snapshot lands). */
  delta: string;
  order: number;
}

export interface ToolRecord {
  key: string;
  tool: string;
  state: string;
  input?: unknown;
  output?: unknown;
  at: number;
}

export interface TurnStream {
  sessionID?: string;
  /** Prompt text of the in-flight user turn, used to reject the user's own part. */
  pendingUserText: string;
  userMessages: Set<string>;
  assistantMessages: Set<string>;
  userParts: Set<string>;
  parts: Map<string, PartRecord>;
  tools: Map<string, ToolRecord>;
  order: number;
  idle: boolean;
  error?: string;
}

export interface TurnView {
  /** Assistant answer text streamed so far. Never contains user or reasoning text. */
  text: string;
  /** Hidden model reasoning, tracked but NEVER rendered as an answer. */
  reasoning: string;
  tools: ToolRecord[];
  idle: boolean;
  error?: string;
}

export function createTurnStream(opts: { sessionID?: string; pendingUserText?: string } = {}): TurnStream {
  return {
    sessionID: opts.sessionID,
    pendingUserText: opts.pendingUserText ?? "",
    userMessages: new Set(),
    assistantMessages: new Set(),
    userParts: new Set(),
    parts: new Map(),
    tools: new Map(),
    order: 0,
    idle: false,
  };
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function kindOf(type: unknown): PartKind {
  if (type === "text" || type === "reasoning" || type === "tool") return type;
  return "other";
}

/**
 * Apply one OpenCode frame to the turn. Mutates `turn` in place; callers read
 * the derived view with {@link turnView} and push it into React state.
 */
export function applyTurnFrame(turn: TurnStream, frame: StreamFrame): void {
  const p = (frame.properties ?? {}) as Record<string, unknown>;

  // Defense in depth: frames from another session can never touch this turn.
  const frameSession = str(p.sessionID);
  if (turn.sessionID && frameSession && frameSession !== turn.sessionID) return;

  switch (frame.type) {
    case "message.updated": {
      const info = p.info as { id?: string; role?: string } | undefined;
      if (!info?.id) break;
      if (info.role === "assistant") turn.assistantMessages.add(info.id);
      else if (info.role === "user") turn.userMessages.add(info.id);
      break;
    }

    case "message.part.updated": {
      const part = p.part as
        | { id?: string; messageID?: string; type?: string; text?: string; tool?: string; state?: { status?: string; input?: unknown; output?: unknown } }
        | undefined;
      if (!part?.id) break;
      const partID = part.id;
      const messageID = str(part.messageID);

      // Known user message -> this part belongs to the prompt, never to the reply.
      if (messageID && turn.userMessages.has(messageID)) {
        turn.userParts.add(partID);
        break;
      }

      if (part.type === "tool") {
        const key = partID;
        const prev = turn.tools.get(key);
        turn.tools.set(key, {
          key,
          tool: str(part.tool) || prev?.tool || "?",
          state: part.state?.status ?? prev?.state ?? "unknown",
          input: part.state?.input ?? prev?.input,
          output: part.state?.output ?? prev?.output,
          at: Date.now(),
        });
        break;
      }

      const kind = kindOf(part.type);
      if (kind !== "text" && kind !== "reasoning") break;

      const text = str(part.text);
      const knownAssistant = Boolean(messageID && turn.assistantMessages.has(messageID));
      if (!knownAssistant) {
        // The user's own prompt is announced as a plain text part. Reject it by
        // message role, or - if that frame was missed - by exact prompt text.
        if (turn.pendingUserText && text === turn.pendingUserText) {
          turn.userParts.add(partID);
          if (messageID) turn.userMessages.add(messageID);
          break;
        }
        if (!messageID) break; // cannot attribute -> do not render
      }

      let rec = turn.parts.get(partID);
      if (!rec) {
        rec = { id: partID, messageID, kind, snapshot: "", delta: "", order: turn.order++ };
        turn.parts.set(partID, rec);
      }
      rec.messageID = messageID || rec.messageID;
      // Snapshots are authoritative, but an empty snapshot must not wipe text
      // that already streamed in as deltas.
      if (text) rec.snapshot = text;
      break;
    }

    case "message.part.delta": {
      const partID = str(p.partID);
      if (!partID) break;
      const messageID = str(p.messageID);
      if (turn.userParts.has(partID)) break;
      if (messageID && turn.userMessages.has(messageID)) break;

      const field = str(p.field) || "text";
      const delta = str(p.delta);
      if (!delta) break;

      let rec = turn.parts.get(partID);
      if (!rec) {
        // Deltas always follow their part announcement; if that single frame was
        // dropped, infer the kind from the field. User frames never stream deltas.
        if (messageID && turn.userMessages.has(messageID)) break;
        rec = {
          id: partID,
          messageID,
          kind: field === "reasoning" ? "reasoning" : "text",
          snapshot: "",
          delta: "",
          order: turn.order++,
        };
        turn.parts.set(partID, rec);
      }
      rec.delta += delta;
      break;
    }

    case "session.idle": {
      turn.idle = true;
      break;
    }

    case "session.error": {
      const err = p.error;
      turn.error = typeof err === "string" ? err : JSON.stringify(err ?? "unknown error").slice(0, 500);
      break;
    }

    default:
      break;
  }
}

/** Effective text for one part: a non-empty snapshot wins over deltas. */
function partText(rec: PartRecord): string {
  if (rec.snapshot) return rec.snapshot;
  return rec.delta;
}

/** Derive the renderable view for the live chat bubble. */
export function turnView(turn: TurnStream): TurnView {
  const ordered = [...turn.parts.values()].sort((a, b) => a.order - b.order);
  let text = "";
  let reasoning = "";
  for (const rec of ordered) {
    const value = partText(rec);
    if (!value) continue;
    if (rec.kind === "text") text += value;
    else if (rec.kind === "reasoning") reasoning += value;
  }
  return {
    text,
    reasoning,
    tools: [...turn.tools.values()],
    idle: turn.idle,
    error: turn.error,
  };
}
