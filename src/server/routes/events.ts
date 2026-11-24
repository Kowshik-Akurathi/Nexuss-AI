import { getConnection } from "@/server/opencode/connection";
import { getEventHub, eventBelongsToSession } from "@/server/opencode/event-stream";
import { getSelections } from "@/server/lab-state";
import { audit } from "@/server/audit-logger";
import { errorResponse, LabError } from "@/server/errors";

const HEARTBEAT_MS = 15_000;

/**
 * Server-Sent Events bridge: relays REAL OpenCode events to the browser.
 * One upstream connection is shared (see OpenCodeEventHub); each browser tab
 * gets its own fan-out stream. Supports `?sessionID=` filtering.
 */
export async function GET(req: Request) {
  try {
    const conn = getConnection();
    if (!conn.getClientOrNull()) {
      throw new LabError({
        code: "NOT_CONNECTED",
        status: 503,
        message: "Not connected to an OpenCode server.",
        recovery: "Connect from the Connection page before subscribing to events.",
      });
    }

    const url = new URL(req.url);
    const sessionID = url.searchParams.get("sessionID") ?? undefined;
    const hub = getEventHub();

    // Self-heal: make sure the shared upstream stream is running for this project.
    if (!hub.getStatus().connected) {
      const state = conn.getState();
      if (state.baseUrl) {
        await hub.start(state.baseUrl, {
          password: conn.getConfig().password,
          directory: getSelections().directory || undefined,
        });
      }
    }

    const encoder = new TextEncoder();
    let closed = false;
    let heartbeat: ReturnType<typeof setInterval> | null = null;

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (payload: unknown) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
          } catch {
            closed = true;
          }
        };

        send({ type: "lab.connected", properties: { sessionID: sessionID ?? null, at: Date.now() } });

        const unsubscribe = hub.subscribe((event) => {
          if (!eventBelongsToSession(event, sessionID)) return;
          send(event);
        });

        // Replay recent events so a late subscriber is not blind.
        for (const e of hub.recentEvents().slice(-50)) {
          if (eventBelongsToSession(e, sessionID)) send(e);
        }

        heartbeat = setInterval(() => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(`: heartbeat ${Date.now()}\n\n`));
          } catch {
            closed = true;
          }
        }, HEARTBEAT_MS);

        const cleanup = () => {
          if (closed) return;
          closed = true;
          unsubscribe();
          if (heartbeat) clearInterval(heartbeat);
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        };

        req.signal.addEventListener("abort", cleanup);
      },
      cancel() {
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
      },
    });

    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      },
    });
  } catch (e) {
    audit().error("events", `SSE subscribe failed: ${(e as Error).message}`);
    return errorResponse(e);
  }
}
