import { ExecutionManager } from "./execution-manager";
import { SessionManager } from "./opencode/session-manager";
import { getConnection } from "./opencode/connection";
import { LabError } from "./errors";

/**
 * Process-wide ExecutionManager so interrupt/monitor calls issued from a
 * different request see the SAME records as the request that submitted the
 * prompt. Rebuilt automatically when the OpenCode client is reconnected.
 */
const g = globalThis as unknown as {
  __nexussExec?: { manager: ExecutionManager; baseUrl: string | null };
};

export function getExecutionManager(): ExecutionManager {
  const conn = getConnection();
  const client = conn.getClientOrNull();
  const baseUrl = client?.baseUrl ?? null;

  if (!g.__nexussExec || g.__nexussExec.baseUrl !== baseUrl) {
    if (!client) {
      throw new LabError({
        code: "NOT_CONNECTED",
        status: 503,
        message: "Not connected to an OpenCode server.",
        recovery: "Connect from the Diagnostics screen before listing executions.",
      });
    }
    const manager = new ExecutionManager(client, new SessionManager(client));
    manager.attach();
    g.__nexussExec = { manager, baseUrl };
  }
  return g.__nexussExec.manager;
}

/** Test hook. */
export function resetExecutionManager(): void {
  g.__nexussExec?.manager.detach();
  g.__nexussExec = undefined;
}
