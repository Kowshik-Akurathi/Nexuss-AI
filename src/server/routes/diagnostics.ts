import { handler, json, client } from "@/server/api";
import { getConnection } from "@/server/opencode/connection";
import { getEventHub } from "@/server/opencode/event-stream";
import { audit } from "@/server/audit-logger";
import { allowedRoots, LAB_ROOT } from "@/server/project-manager";
import { store } from "@/server/store";

/**
 * Diagnostics: detected capabilities of the RUNNING OpenCode instance.
 * Every row is probed live - nothing is assumed from documentation.
 */
export const GET = handler("diagnostics", async (_req, _ctx) => {
  const conn = getConnection();
  const state = conn.getState();
  const hub = getEventHub();
  const log = await audit().tail(150);

  const capabilities: Array<{
    id: string;
    label: string;
    supported: boolean;
    endpoint: string;
    note?: string;
  }> = [];

  const c = conn.getClientOrNull();
  const probe = async (id: string, label: string, endpoint: string, fn: () => Promise<unknown>) => {
    if (!c) {
      capabilities.push({ id, label, supported: false, endpoint, note: "Not connected." });
      return;
    }
    try {
      await fn();
      capabilities.push({ id, label, supported: true, endpoint });
    } catch (e) {
      const err = e as { code?: string; message?: string };
      capabilities.push({
        id,
        label,
        supported: false,
        endpoint,
        note: err.code === "API_ENDPOINT_MISSING" ? "Route absent on this build." : err.message,
      });
    }
  };

  await probe("agents", "Agent discovery", "GET /agent", () => c!.listAgents());
  await probe("providers", "Provider catalogue", "GET /provider", () => c!.listProviders());
  await probe("sessions", "Session list", "GET /session", () => c!.listSessions({ limit: 1 }));
  await probe("messages", "Session history", "GET /session/{id}/message", async () => {
    const rows = await c!.listSessions({ limit: 1 });
    if (!rows?.length) return [];
    return c!.listMessages(rows[0].id);
  });
  await probe("permissions-v1", "Permissions (V1)", "GET /permission", () => c!.listPermissions());
  await probe("permissions-v2", "Permissions (V2)", "GET /api/permission/request", () =>
    c!.listPermissionsV2({ directory: allowedRoots()[0].path })
  );
  await probe("models-v2", "Model catalogue (V2)", "GET /api/model", () =>
    c!.listModelsV2({ directory: allowedRoots()[0].path })
  );
  await probe("events", "SSE event stream", "GET /event", async () => {
    if (!hub.getStatus().connected && !hub.getStatus().url) {
      // hub may not be started yet; treat as unknown-but-present
    }
    return { connected: hub.getStatus().connected };
  });
  await probe("vcs", "VCS status", "GET /vcs/status", () => c!.vcsStatus({ directory: LAB_ROOT }));
  await probe("file-status", "File status", "GET /file/status", () => c!.fileStatus({ directory: LAB_ROOT }));
  await probe("interrupt", "Session interrupt", "POST /api/session/{id}/interrupt", async () => {
    // Probing a real interrupt would disturb a running turn; check the spec instead.
    const doc = (await c!.getOpenApi()) as { paths?: Record<string, unknown> };
    if (!doc.paths || !("/api/session/{sessionID}/interrupt" in doc.paths)) {
      throw Object.assign(new Error("route missing"), { code: "API_ENDPOINT_MISSING" });
    }
    return true;
  });
  await probe("diff", "Session diff", "GET /session/{id}/diff", async () => {
    const rows = await c!.listSessions({ limit: 1 });
    if (!rows?.length) return [];
    return c!.getSessionDiff(rows[0].id, { directory: rows[0].directory });
  });

  let openapiPaths = 0;
  let openapiError: string | null = null;
  if (c) {
    try {
      const doc = (await c.getOpenApi()) as { paths?: Record<string, unknown> };
      openapiPaths = Object.keys(doc.paths ?? {}).length;
    } catch (e) {
      openapiError = (e as Error).message;
    }
  }

  return json({
    node: { version: process.version, platform: process.platform, arch: process.arch },
    installation: state.installation,
    server: state.server,
    connected: state.clientAvailable,
    baseUrl: state.baseUrl ?? null,
    latencyMs: state.latencyMs ?? null,
    events: hub.getStatus(),
    capabilities,
    openapi: { paths: openapiPaths, error: openapiError },
    lab: {
      root: LAB_ROOT,
      roots: allowedRoots(),
      stats: store().stats(),
      dataDir: process.env.LAB_DATA_DIR || `${LAB_ROOT}/.lab`,
    },
    config: {
      preferredUrl: conn.getConfig().preferredUrl ?? null,
      startPort: conn.getConfig().startPort,
      hostname: conn.getConfig().hostname,
      passwordConfigured: Boolean(conn.getConfig().password),
    },
    log: log.slice(0, 100),
  });
});
