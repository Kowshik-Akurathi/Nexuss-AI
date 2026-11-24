import { getConnection } from "@/server/opencode/connection";
import { handler, json, client } from "@/server/api";
import { getEventHub } from "@/server/opencode/event-stream";
import { getSelections } from "@/server/lab-state";
import { store } from "@/server/store";
import { listAgents } from "@/server/opencode/agent-manager";
import { availableModels, listModels } from "@/server/opencode/model-manager";
import { SessionManager } from "@/server/opencode/session-manager";

/** Overview page payload - everything here is real, read from OpenCode. */
export const GET = handler("status", async () => {
  const conn = getConnection();
  const state = conn.getState();
  const selections = getSelections();
  const stats = store().stats();

  const base = {
    checkedAt: state.checkedAt,
    installation: state.installation
      ? {
          installed: state.installation.installed,
          version: state.installation.version ?? null,
          path: state.installation.path ?? null,
          method: state.installation.method ?? null,
          guidance: state.installation.guidance ?? null,
        }
      : null,
    server: {
      state: state.server.state,
      baseUrl: state.server.baseUrl ?? null,
      owned: state.server.owned,
      pid: state.server.pid ?? null,
      authRequired: state.server.authRequired ?? false,
      authConfigured: state.server.authConfigured,
      error: state.server.error ?? null,
      message: state.server.message ?? null,
      uptimeMs: state.server.uptimeMs ?? null,
    },
    connected: state.clientAvailable,
    latencyMs: state.latencyMs ?? null,
    events: conn.eventHubStatus(),
    selections,
    lab: stats,
  };

  if (!state.clientAvailable) {
    return json({ ...base, agents: [], models: [], providers: [], sessions: [], activeSession: null });
  }

  const c = client();
  const dir = selections.directory || undefined;

  const [agentsRes, modelsRes, sessionsRes] = await Promise.all([
    listAgents(c, dir).then(
      (v) => ({ ok: true as const, value: v }),
      (e) => ({ ok: false as const, error: (e as Error).message })
    ),
    listModels(c, dir).then(
      (v) => ({ ok: true as const, value: v }),
      (e) => ({ ok: false as const, error: (e as Error).message })
    ),
    new SessionManager(c)
      .list(dir ?? "", { limit: 30 })
      .then(
        (v) => ({ ok: true as const, value: v }),
        () => ({ ok: true as const, value: [] as Awaited<ReturnType<SessionManager["list"]>> })
      ),
  ]);

  const sessions = sessionsRes.value;
  const activeSession = selections.sessionID
    ? sessions.find((s) => s.id === selections.sessionID) ?? null
    : null;

  return json({
    ...base,
    errors: {
      agents: agentsRes.ok ? null : agentsRes.error,
      models: modelsRes.ok ? null : modelsRes.error,
    },
    agents: agentsRes.ok ? agentsRes.value : [],
    providers: modelsRes.ok ? modelsRes.value.providers : [],
    models: modelsRes.ok ? availableModels(modelsRes.value.models) : [],
    sessions,
    activeSession,
  });
});
