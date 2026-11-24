import { handler, json, readJson } from "@/server/api";
import { getInstallManager } from "@/server/install/manager";
import { diagnose, type Diagnosis } from "@/server/install/diagnose";
import { audit } from "@/server/audit-logger";
import { LabError } from "@/server/errors";
import { isActiveStatus, type InstallState } from "@/server/install/types";

console.log("[install-routes] module loaded");

const HEARTBEAT_MS = 15_000;

/** Current installation state (survives browser refreshes). */
export const GET = handler("install", async () => {
  return json({ state: getInstallManager().getState() });
});

const ACTIONS = new Set([
  "start",
  "cancel",
  "retry",
  "recheck-auth",
  "continue-without-auth",
  "start-auth",
  "reset",
  "diagnose",
]);

/**
 * Drive the installation workflow. The body only ever carries an action name
 * plus an explicit elevation acknowledgement — never a command, path or URL.
 */
export const POST = handler("install", async (req) => {
  const body = await readJson<{ action?: string; elevated?: boolean }>(req).catch(() => ({}) as {
    action?: string;
    elevated?: boolean;
  });
  const action = body.action ?? "start";
  if (!ACTIONS.has(action)) {
    throw new LabError({
      code: "INVALID_REQUEST",
      status: 400,
      message: `Unknown install action "${action}".`,
      recovery: `Use one of: ${[...ACTIONS].join(", ")}.`,
    });
  }

  const mgr = getInstallManager();

  if (action === "diagnose") {
    const check: Diagnosis = await diagnose();
    return json({ ok: true, check, state: mgr.getState() });
  }

  if (action === "reset") {
    mgr.reset();
    audit().info("install", "Installation state reset");
    return json({ ok: true, state: mgr.getState() });
  }

  if (action === "start-auth") {
    const result = await mgr.startAuthentication();
    audit().info("install", `Authentication launch requested (started=${result.started})`);
    return json({ ok: true, ...result, state: mgr.getState() });
  }

  if (action === "cancel") {
    const state = await mgr.cancel();
    return json({ ok: true, state });
  }

  let state: InstallState;
  switch (action) {
    case "start":
      state = mgr.start({ elevated: Boolean(body.elevated) });
      break;
    case "retry":
      state = mgr.retry({ elevated: Boolean(body.elevated) });
      break;
    case "recheck-auth":
      state = mgr.recheckAuthentication();
      break;
    case "continue-without-auth":
      state = mgr.continueWithoutAuthentication();
      break;
    default:
      state = mgr.getState();
  }
  return json({ ok: true, state });
});

/**
 * Server-Sent Events for installation progress. Sends the current state on
 * subscribe, then every subsequent state change. Independent of the OpenCode
 * event hub so installation tracking works before any connection exists.
 */
export async function GET_EVENTS(req: Request) {
  const encoder = new TextEncoder();
  let closed = false;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let unsubscribe: (() => void) | null = null;

  const mgr = getInstallManager();
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

      // Replay the live state so a fresh subscriber is immediately accurate.
      send({ type: "install.state", state: mgr.getState() });

      unsubscribe = mgr.subscribe((state) => send({ type: "install.state", state }));

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
        if (unsubscribe) unsubscribe();
        unsubscribe = null;
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
      if (unsubscribe) unsubscribe();
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
}

/** Convenience used by the UI to know whether a run is in flight. */
export function installInFlight(state: InstallState): boolean {
  return isActiveStatus(state.status) && state.status !== "awaiting-auth";
}
