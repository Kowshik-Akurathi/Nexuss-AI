import { LabError } from "../errors";
import type { OpenCodeClient } from "./client";
import type { AgentInfo, AgentMode } from "./types";

export interface AgentSummary {
  name: string;
  description: string;
  mode: AgentMode;
  hidden: boolean;
  native: boolean;
  color?: string;
  /** Count of permission rules that deny or ask. */
  restrictions: number;
  allows: number;
  asks: number;
  denies: number;
  /** True when the agent may edit files (no blanket edit deny). */
  canEdit: boolean;
  canShell: boolean;
  defaultModel?: { providerID: string; modelID: string };
}

function countRules(agent: AgentInfo) {
  const rules = agent.permission ?? [];
  let allows = 0;
  let asks = 0;
  let denies = 0;
  for (const r of rules) {
    if (r.action === "allow") allows++;
    else if (r.action === "ask") asks++;
    else if (r.action === "deny") denies++;
  }
  return { allows, asks, denies, restrictions: asks + denies };
}

function canDo(agent: AgentInfo, permission: string): boolean {
  const rules = agent.permission ?? [];
  // Last matching rule wins in OpenCode.
  let verdict: "allow" | "deny" | "ask" = "ask";
  for (const r of rules) {
    if (r.permission === permission || r.permission === "*") verdict = r.action;
  }
  return verdict === "allow";
}

/**
 * Discovers agents from the connected OpenCode instance.
 * Nothing is hardcoded - hidden/internal agents are surfaced separately so the
 * UI never offers an agent the server does not actually expose.
 */
export async function listAgents(client: OpenCodeClient, directory?: string): Promise<AgentSummary[]> {
  let raw: AgentInfo[];
  try {
    raw = await client.listAgents({ directory });
  } catch (e) {
    if (e instanceof LabError && e.code === "API_ENDPOINT_MISSING") {
      throw new LabError({
        code: "AGENT_UNAVAILABLE",
        message: "This OpenCode build does not expose the agent catalogue.",
        detail: e.detail,
        recovery: "Update OpenCode or check Diagnostics for supported capabilities.",
      });
    }
    throw e;
  }

  return raw.map((a) => {
    const counts = countRules(a);
    return {
      name: a.name,
      description: a.description?.trim() || "",
      mode: a.mode,
      hidden: Boolean(a.hidden),
      native: Boolean(a.native),
      color: a.color,
      ...counts,
      canEdit: canDo(a, "edit"),
      canShell: canDo(a, "shell"),
      defaultModel: a.model ? { providerID: a.model.providerID, modelID: a.model.modelID } : undefined,
    };
  });
}

export function requireAgent(agents: AgentSummary[], name: string): AgentSummary {
  const found = agents.find((a) => a.name === name);
  if (!found) {
    throw new LabError({
      code: "AGENT_UNAVAILABLE",
      status: 404,
      message: `Agent "${name}" is not available on the connected OpenCode instance.`,
      detail: `Available agents: ${agents.map((a) => a.name).join(", ")}`,
      recovery: "Pick an agent from the selector; the list is loaded live from OpenCode.",
    });
  }
  return found;
}
