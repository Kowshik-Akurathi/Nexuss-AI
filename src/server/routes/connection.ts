import { handler, json, readJson } from "@/server/api";
import { getConnection } from "@/server/opencode/connection";
import { diagnose } from "@/server/install/diagnose";
import { audit } from "@/server/audit-logger";

export const GET = handler("connection", async (_req, _ctx) => {
  const conn = getConnection();
  const state = conn.getState();
  const hub = conn.eventHubStatus();
  return json({
    installation: state.installation,
    server: state.server,
    connected: state.clientAvailable,
    baseUrl: state.baseUrl ?? null,
    latencyMs: state.latencyMs ?? null,
    config: {
      preferredUrl: conn.getConfig().preferredUrl ?? null,
      startPort: conn.getConfig().startPort,
      hostname: conn.getConfig().hostname,
      passwordConfigured: Boolean(conn.getConfig().password),
      startTimeoutMs: conn.getConfig().startTimeoutMs,
    },
    events: hub,
    checkedAt: state.checkedAt,
  });
});

/** Detect installation + adopt-or-start the OpenCode server. */
export const POST = handler("connection", async (req) => {
  const body = await readJson<{ action?: string }>(req).catch(() => ({ action: "connect" }));
  const conn = getConnection();
  const action = body.action ?? "connect";

  if (action === "disconnect") {
    await conn.disconnect();
    audit().info("connection", "Disconnected from OpenCode server");
    return json({ ok: true, state: conn.getState() });
  }

  if (action === "refresh-installation") {
    // Extended Re-detect: installation detection plus a read-only diagnosis of
    // server / connectivity / authentication / discovery so the UI can offer
    // the right next action (install, start server, connect, authenticate).
    const installation = await conn.refreshInstallation();
    const check = await diagnose();
    return json({ ok: true, installation, check });
  }

  audit().info("connection", "Connect requested");
  const state = await conn.connect();
  return json({
    ok: state.clientAvailable,
    installation: state.installation,
    server: state.server,
    connected: state.clientAvailable,
    baseUrl: state.baseUrl ?? null,
    latencyMs: state.latencyMs ?? null,
    events: conn.eventHubStatus(),
  });
});
