import { LabError } from "../errors";
import type { OpenCodeClient } from "./client";
import type { MessageBundle, Part, SessionInfo, ToolPart } from "./types";

export interface SessionSummary {
  id: string;
  title: string;
  directory: string;
  agent?: string;
  model?: string;
  parentID?: string;
  createdAt: number;
  updatedAt: number;
  cost?: number;
  tokens?: { input: number; output: number };
  messageCount?: number;
}

export function summarize(s: SessionInfo): SessionSummary {
  return {
    id: s.id,
    title: s.title || s.slug || s.id,
    directory: s.directory,
    agent: s.agent,
    model: s.model ? `${s.model.providerID}/${s.model.id}` : undefined,
    parentID: s.parentID,
    createdAt: s.time?.created ?? 0,
    updatedAt: s.time?.updated ?? 0,
    cost: s.cost,
    tokens: s.tokens ? { input: s.tokens.input, output: s.tokens.output } : undefined,
  };
}

/**
 * Session operations. Every method is directory-scoped so a session can never
 * be created against (or resolved from) an unrelated project.
 */
export class SessionManager {
  constructor(private client: OpenCodeClient) {}

  async list(directory: string, opts: { search?: string; limit?: number } = {}): Promise<SessionSummary[]> {
    const rows = await this.client.listSessions({ directory, search: opts.search, limit: opts.limit });
    return (rows ?? []).map(summarize);
  }

  async listAll(limit = 200): Promise<SessionSummary[]> {
    const rows = await this.client.listSessions({ limit });
    return (rows ?? []).map(summarize);
  }

  async create(
    directory: string,
    opts: { title?: string; agent?: string; model?: { id: string; providerID: string } }
  ): Promise<SessionSummary> {
    const s = await this.client.createSession(
      { title: opts.title, agent: opts.agent, model: opts.model },
      { directory }
    );
    if (!s?.id) {
      throw new LabError({
        code: "SESSION_FAILURE",
        message: "OpenCode did not return a session id.",
        recovery: "Retry; if it persists, check the OpenCode server logs.",
      });
    }
    if (s.directory && normalize(s.directory) !== normalize(directory)) {
      throw new LabError({
        code: "INVALID_PROJECT_DIRECTORY",
        message: "OpenCode created the session in a different directory than requested.",
        detail: `requested=${directory} actual=${s.directory}`,
        recovery: "Verify the selected project directory exists and is readable.",
      });
    }
    return summarize(s);
  }

  async get(sessionID: string): Promise<SessionSummary> {
    const s = await this.client.getSession(sessionID);
    if (!s?.id) {
      throw new LabError({ code: "SESSION_NOT_FOUND", status: 404, message: `Session ${sessionID} not found.` });
    }
    return summarize(s);
  }

  /** Loads messages and asserts they belong to the requested session. */
  async history(sessionID: string, directory?: string): Promise<MessageBundle[]> {
    const rows = await this.client.listMessages(sessionID, { directory });
    const out = (rows ?? []).filter((r) => r && r.info);
    for (const r of out) {
      if (r.info.sessionID && r.info.sessionID !== sessionID) {
        throw new LabError({
          code: "SESSION_FAILURE",
          message: "OpenCode returned messages from a different session.",
          detail: `expected=${sessionID} got=${r.info.sessionID}`,
          recovery: "Reload the session; this indicates an upstream inconsistency.",
        });
      }
    }
    return out;
  }

  async remove(sessionID: string): Promise<void> {
    await this.client.deleteSession(sessionID);
  }

  async setAgent(sessionID: string, agent: string): Promise<void> {
    await this.client.switchAgent(sessionID, agent);
  }

  async setModel(sessionID: string, model: { id: string; providerID: string }): Promise<void> {
    await this.client.switchModel(sessionID, model);
  }

  /** Interrupt/abort. Tries the V2 interrupt first, falls back to V1 abort. */
  async interrupt(sessionID: string, directory?: string): Promise<void> {
    try {
      await this.client.interruptSession(sessionID);
      return;
    } catch (e) {
      if (e instanceof LabError && (e.code === "API_ENDPOINT_MISSING" || e.status === 404)) {
        await this.client.abortSession(sessionID, { directory });
        return;
      }
      throw e;
    }
  }
}

export function normalize(p: string): string {
  return p.replace(/[\\/]+$/, "").replace(/\//g, "\\").toLowerCase();
}

// ---------------------------------------------------------------------------
// Transcript shaping for the chat UI
// ---------------------------------------------------------------------------

export interface ChatItem {
  kind: "user" | "assistant" | "tool" | "reasoning" | "step" | "error" | "system";
  id: string;
  messageID: string;
  text?: string;
  tool?: string;
  toolState?: string;
  toolInput?: unknown;
  toolOutput?: unknown;
  error?: string;
  at: number;
}

/** Flatten OpenCode message bundles into renderable chat items. */
export function toChatItems(bundles: MessageBundle[]): ChatItem[] {
  const items: ChatItem[] = [];
  for (const b of bundles) {
    const at = b.info.time?.created ?? 0;
    if (b.info.role === "user") {
      const text = b.parts
        .filter((p): p is Extract<Part, { type: "text" }> => p.type === "text")
        .map((p) => p.text)
        .join("\n");
      items.push({ kind: "user", id: b.info.id, messageID: b.info.id, text, at });
      continue;
    }
    if (b.info.role === "assistant") {
      if (b.info.error) {
        items.push({
          kind: "error",
          id: b.info.id,
          messageID: b.info.id,
          error: summarizeError(b.info.error),
          at,
        });
      }
      for (const p of b.parts) {
        if (p.type === "text" && p.text) {
          items.push({ kind: "assistant", id: p.id, messageID: b.info.id, text: p.text, at: p.time?.start ?? at });
        } else if (p.type === "reasoning" && p.text) {
          items.push({ kind: "reasoning", id: p.id, messageID: b.info.id, text: p.text, at: p.time?.start ?? at });
        } else if (p.type === "tool") {
          const tp = p as ToolPart;
          items.push({
            kind: "tool",
            id: tp.id,
            messageID: b.info.id,
            tool: tp.tool,
            toolState: tp.state?.status ?? "unknown",
            toolInput: (tp.state as { input?: unknown })?.input,
            toolOutput: (tp.state as { output?: unknown })?.output,
            at,
          });
        } else if (p.type === "step-start") {
          items.push({ kind: "step", id: p.id, messageID: b.info.id, text: "step", at });
        } else if (p.type === "retry") {
          items.push({
            kind: "error",
            id: p.id,
            messageID: b.info.id,
            error: `Retry ${((p as { attempt?: number }).attempt ?? "?")}`,
            at,
          });
        }
      }
    }
  }
  return items;
}

function summarizeError(err: unknown): string {
  if (!err) return "Unknown error";
  if (typeof err === "string") return err;
  const e = err as { name?: string; data?: { message?: string }; message?: string };
  return e.data?.message || e.message || e.name || JSON.stringify(err);
}

/** Extract the final assistant text - used for results reporting. */
export function finalAssistantText(bundles: MessageBundle[]): string {
  for (let i = bundles.length - 1; i >= 0; i--) {
    const b = bundles[i];
    if (b.info.role !== "assistant") continue;
    const text = b.parts
      .filter((p): p is Extract<Part, { type: "text" }> => p.type === "text")
      .map((p) => p.text)
      .join("\n")
      .trim();
    if (text) return text;
  }
  return "";
}
