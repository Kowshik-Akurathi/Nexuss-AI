import { LabError } from "../errors";
import type { EventEnvelope } from "./types";

export type EventListener = (event: EventEnvelope) => void;

export interface EventHubStatus {
  connected: boolean;
  url?: string;
  eventsReceived: number;
  eventsDropped: number;
  lastEventAt?: number;
  connectedAt?: number;
  error?: string;
  reconnectAttempts: number;
}

const MAX_BUFFER = 500;

/**
 * Maintains a SINGLE upstream SSE connection to the OpenCode server and fans
 * events out to every Lab subscriber (browser SSE routes, execution monitor,
 * permission watcher). Reconnects with capped exponential backoff and keeps a
 * small replay buffer so a late subscriber does not miss the last few events.
 */
export class OpenCodeEventHub {
  private controller: AbortController | null = null;
  private listeners = new Set<EventListener>();
  private buffer: EventEnvelope[] = [];
  private status: EventHubStatus = { connected: false, eventsReceived: 0, eventsDropped: 0, reconnectAttempts: 0 };
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private baseUrl = "";
  private password?: string;
  private directory?: string;
  private stopped = true;
  /**
   * Bumped on every start/stop. A connect loop captures the generation it was
   * started with and exits as soon as it no longer matches - without this the
   * old loop wakes up from its aborted read, sees `stopped === false` again
   * (start() resets it immediately after stop()) and opens a SECOND upstream
   * connection, doubling every event into the chat.
   */
  private generation = 0;

  getStatus(): EventHubStatus {
    return { ...this.status };
  }

  recentEvents(): EventEnvelope[] {
    return [...this.buffer];
  }

  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Start (or restart) the upstream connection. Safe to call repeatedly.
   * The read loop runs detached - this method only waits for the first
   * connect attempt to settle so callers never block on the stream itself.
   */
  async start(baseUrl: string, opts: { password?: string; directory?: string } = {}): Promise<void> {
    const url = baseUrl.replace(/\/$/, "");
    if (this.status.connected && this.baseUrl === url && this.directory === opts.directory) return;
    await this.stop(); // bumps the generation and aborts the previous loop
    this.baseUrl = url;
    this.password = opts.password;
    this.directory = opts.directory;
    this.stopped = false;
    this.status.reconnectAttempts = 0;
    const generation = this.generation;
    void this.connectLoop(generation).catch(() => {
      /* connectLoop handles its own errors; this only guards the detached promise */
    });
    const deadline = Date.now() + 5_000;
    while (
      !this.stopped &&
      !this.status.connected &&
      this.status.reconnectAttempts === 0 &&
      Date.now() < deadline
    ) {
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  /**
   * Re-subscribe for a different project directory. OpenCode only emits
   * session/message events to streams scoped with `?directory=`, so the hub
   * must follow the active project selection.
   */
  async rescope(directory?: string): Promise<void> {
    if (!this.baseUrl || this.stopped) return;
    if ((this.directory ?? "") === (directory ?? "")) return;
    await this.start(this.baseUrl, { password: this.password, directory });
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.generation++; // any loop still running belongs to a past generation
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.controller?.abort();
    this.controller = null;
    this.status.connected = false;
    this.status.error = undefined;
  }

  private emit(event: EventEnvelope) {
    this.status.eventsReceived++;
    this.status.lastEventAt = Date.now();
    this.buffer.push(event);
    if (this.buffer.length > MAX_BUFFER) {
      this.buffer.splice(0, this.buffer.length - MAX_BUFFER);
      this.status.eventsDropped++;
    }
    for (const l of this.listeners) {
      try {
        l(event);
      } catch {
        /* a broken subscriber must not kill the hub */
      }
    }
  }

  private async connectLoop(generation: number): Promise<void> {
    while (!this.stopped && generation === this.generation) {
      try {
        await this.connectOnce(generation);
        if (this.stopped || generation !== this.generation) return;
        // clean end of stream -> reconnect
        this.status.error = "Upstream event stream ended.";
      } catch (e) {
        if (this.stopped || generation !== this.generation) return;
        this.status.error = (e as Error).message;
      }
      this.status.connected = false;
      const attempt = ++this.status.reconnectAttempts;
      const delay = Math.min(1000 * 2 ** Math.min(attempt, 5), 15_000);
      await new Promise<void>((resolve) => {
        this.reconnectTimer = setTimeout(resolve, delay);
      });
      if (generation !== this.generation) return; // superseded while backing off
    }
  }

  private async connectOnce(generation: number): Promise<void> {
    if (generation !== this.generation) return;
    const ctrl = new AbortController();
    this.controller = ctrl;
    const url = new URL(`${this.baseUrl}/event`);
    if (this.directory) url.searchParams.set("directory", this.directory);

    const headers: Record<string, string> = { accept: "text/event-stream" };
    if (this.password) headers.authorization = `Bearer ${this.password}`;

    const res = await fetch(url, { headers, signal: ctrl.signal, cache: "no-store" });
    if (!res.ok || !res.body) {
      throw new LabError({
        code: res.status === 401 ? "AUTH_FAILED" : "STREAM_INTERRUPTED",
        status: res.status,
        message: `OpenCode event stream refused with HTTP ${res.status}.`,
        recovery:
          res.status === 401
            ? "Set OPENCODE_SERVER_PASSWORD in the Lab backend to match the server."
            : "Reconnect from the Connection page.",
      });
    }
    if (generation !== this.generation) {
      // superseded between the abort and the first byte - do not resurrect status
      ctrl.abort();
      return;
    }

    this.status.connected = true;
    this.status.connectedAt = Date.now();
    this.status.error = undefined;
    this.status.reconnectAttempts = 0;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (generation !== this.generation) break;
        buf += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const raw = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const evt = parseSseChunk(raw);
          // A superseded connection may still have bytes in flight; they must
          // never reach subscribers or the chat would render every event twice.
          if (evt && generation === this.generation) this.emit(evt);
        }
      }
    } finally {
      try {
        // cancel() returns a promise that rejects with the abort reason when the
        // stream was already aborted - it must be awaited or it surfaces as an
        // unhandled rejection in the dev server log.
        await reader.cancel().catch(() => undefined);
      } catch {
        /* ignore */
      }
      if (generation === this.generation) this.status.connected = false;
    }
  }
}

/**
 * Parse one `data:`-style SSE chunk into an OpenCode event envelope.
 * Returns null for heartbeats, comments and unparseable payloads.
 */
export function parseSseChunk(chunk: string): EventEnvelope | null {
  const dataLines: string[] = [];
  for (const line of chunk.split(/\r?\n/)) {
    if (line.startsWith(":")) continue; // comment / heartbeat marker
    if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
  }
  if (dataLines.length === 0) return null;
  const joined = dataLines.join("\n");
  if (!joined.trim()) return null;
  try {
    const parsed = JSON.parse(joined) as EventEnvelope;
    if (!parsed || typeof parsed.type !== "string") return null;
    if (parsed.properties === undefined) parsed.properties = {};
    return parsed;
  } catch {
    return null;
  }
}

/** Filter helper: does this event belong to the given session? */
export function eventBelongsToSession(event: EventEnvelope, sessionID?: string): boolean {
  if (!sessionID) return true;
  const p = (event.properties ?? {}) as Record<string, unknown>;
  if (typeof p.sessionID === "string") return p.sessionID === sessionID;
  if (event.type === "file.edited") return true; // project-scoped, no session id
  return false;
}

/** Process-wide hub so all route handlers share one upstream connection. */
const globalForHub = globalThis as unknown as { __nexussOcEventHub?: OpenCodeEventHub };

export function getEventHub(): OpenCodeEventHub {
  if (!globalForHub.__nexussOcEventHub) globalForHub.__nexussOcEventHub = new OpenCodeEventHub();
  return globalForHub.__nexussOcEventHub;
}
