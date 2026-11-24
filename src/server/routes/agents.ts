import { handler, json, client } from "@/server/api";
import { listAgents } from "@/server/opencode/agent-manager";
import { getSelections } from "@/server/lab-state";

export const GET = handler("agents", async (req, _ctx) => {
  const dir = new URL(req.url).searchParams.get("directory") ?? getSelections().directory ?? undefined;
  const agents = await listAgents(client(), dir || undefined);
  return json({ agents, selected: getSelections().agent, count: agents.length });
});
