/**
 * Re-detect diagnosis — powers the extended Re-detect workflow.
 *
 * Scenario A (installed): reports installation path/version, whether a server
 * is running, connectivity, authentication and live agent/model discovery, and
 * the exact next action (start server / connect / authenticate / none).
 * Scenario B (not installed): reports `install` so the UI can offer the
 * one-click installer.
 *
 * Read-only: never spawns a server, never changes configuration.
 */
import { detectInstallation, type InstallationInfo } from "@/server/opencode/detector";
import { findRunningServer, probeServer, type ServerState } from "@/server/opencode/server-manager";
import { OpenCodeClient } from "@/server/opencode/client";
import { getConnection } from "@/server/opencode/connection";
import { listAgents } from "@/server/opencode/agent-manager";
import { listModels } from "@/server/opencode/model-manager";
import { getSelections } from "@/server/lab-state";
import { checkAuthentication } from "./auth-check";

export type DiagnosisAction = "install" | "start-server" | "connect" | "authenticate" | "none";

export interface Diagnosis {
  installation: InstallationInfo | null;
  server: {
    running: boolean;
    state: ServerState | "unknown";
    baseUrl: string | null;
    pid: number | null;
    owned: boolean;
  };
  connected: boolean;
  latencyMs: number | null;
  auth: { checked: boolean; authenticated: boolean; providers: string[] };
  discovery: { agents: number; models: number; providers: number } | null;
  actions: DiagnosisAction[];
  checkedAt: number;
}

async function discover(client: OpenCodeClient, directory: string | undefined) {
  const [agents, models] = await Promise.all([
    listAgents(client, directory).then(
      (v) => ({ ok: true as const, value: v }),
      (e) => ({ ok: false as const, error: (e as Error).message })
    ),
    listModels(client, directory).then(
      (v) => ({ ok: true as const, value: v }),
      (e) => ({ ok: false as const, error: (e as Error).message })
    ),
  ]);
  if (!agents.ok && !models.ok) {
    throw new Error(`Agent discovery failed: ${agents.error}; model discovery failed: ${models.error}`);
  }
  return {
    agents: agents.ok ? agents.value.length : 0,
    models: models.ok ? models.value.models.length : 0,
    providers: models.ok ? models.value.providers.length : 0,
    agentsError: agents.ok ? null : agents.error,
    modelsError: models.ok ? null : models.error,
  };
}

export async function diagnose(): Promise<Diagnosis> {
  const conn = getConnection();
  const state = conn.getState();
  const directory = getSelections().directory || undefined;
  const checkedAt = Date.now();

  const installation = await detectInstallation().catch(() => null);

  // 1) Already connected through the shared connection -> use it.
  const connectedClient = conn.getClientOrNull();
  if (state.clientAvailable && connectedClient) {
    const auth = await checkAuthentication(connectedClient, directory);
    let discovery: Diagnosis["discovery"] = null;
    try {
      const d = await discover(connectedClient, directory);
      discovery = { agents: d.agents, models: d.models, providers: d.providers };
    } catch {
      discovery = null;
    }
    return {
      installation: installation ?? state.installation,
      server: {
        running: state.server.state === "running",
        state: state.server.state,
        baseUrl: state.server.baseUrl ?? null,
        pid: state.server.pid ?? null,
        owned: state.server.owned,
      },
      connected: true,
      latencyMs: state.latencyMs ?? null,
      auth: { checked: auth.checked, authenticated: auth.authenticated, providers: auth.providers },
      discovery,
      actions: auth.checked && !auth.authenticated ? ["authenticate"] : ["none"],
      checkedAt,
    };
  }

  // 2) Not connected — look for a server we could adopt (read-only probe).
  const cfg = conn.getConfig();
  const existing = await findRunningServer({
    preferredUrl: cfg.preferredUrl,
    startPort: cfg.startPort,
    hostname: cfg.hostname,
  }).catch(() => null);

  if (existing) {
    const probe = await probeServer(existing.baseUrl);
    const client = new OpenCodeClient({ baseUrl: existing.baseUrl, password: cfg.password });
    const auth = probe.ok
      ? await checkAuthentication(client, directory)
      : { checked: false, authenticated: false, providers: [] as string[], sources: [] };
    let discovery: Diagnosis["discovery"] = null;
    if (probe.ok) {
      try {
        const d = await discover(client, directory);
        discovery = { agents: d.agents, models: d.models, providers: d.providers };
      } catch {
        discovery = null;
      }
    }
    return {
      installation: installation ?? state.installation,
      server: {
        running: true,
        state: "running",
        baseUrl: existing.baseUrl,
        pid: existing.pid ?? null,
        owned: false,
      },
      connected: false,
      latencyMs: probe.ok ? probe.latencyMs : null,
      auth: { checked: auth.checked, authenticated: auth.authenticated, providers: auth.providers },
      discovery,
      actions: auth.checked && !auth.authenticated ? ["connect", "authenticate"] : ["connect"],
      checkedAt,
    };
  }

  // 3) Nothing running.
  const installed = Boolean(installation?.installed);
  return {
    installation: installation ?? state.installation,
    server: { running: false, state: installed ? "stopped" : "not-installed", baseUrl: null, pid: null, owned: false },
    connected: false,
    latencyMs: null,
    auth: { checked: false, authenticated: false, providers: [] },
    discovery: null,
    actions: installed ? ["start-server"] : ["install"],
    checkedAt,
  };
}
