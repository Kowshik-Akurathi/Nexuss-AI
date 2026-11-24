import { handler, json, client, readJson } from "@/server/api";
import { SessionManager, toChatItems } from "@/server/opencode/session-manager";
import { LabError } from "@/server/errors";
import { store } from "@/server/store";
import { getSelections, setSelections } from "@/server/lab-state";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler("session", async (req, _ctx) => {
  const { id } = await ctxId(_ctx);
  const mgr = new SessionManager(client());
  const session = await mgr.get(id);

  const includeHistory = new URL(req.url).searchParams.get("history") !== "0";
  let messages: unknown[] = [];
  if (includeHistory) {
    const bundles = await mgr.history(id, session.directory);
    messages = toChatItems(bundles);
  }
  store().touchSession(id);
  return json({ session, messages });
});

export const PATCH = handler("session", async (req, _ctx) => {
  const { id } = await ctxId(_ctx);
  const body = await readJson<{ agent?: string; model?: string; title?: string }>(req);
  const mgr = new SessionManager(client());
  if (body.agent) await mgr.setAgent(id, body.agent);
  if (body.model) {
    const idx = body.model.indexOf("/");
    if (idx > 0) await mgr.setModel(id, { providerID: body.model.slice(0, idx), id: body.model.slice(idx + 1) });
  }
  if (body.title) await client().updateSession(id, { title: body.title });
  if (body.agent || body.model) store().touchSession(id, body.agent, body.model);
  const session = await mgr.get(id);
  return json({ session });
});

export const DELETE = handler("session", async (_req, _ctx) => {
  const { id } = await ctxId(_ctx);
  const sel = getSelections();
  await new SessionManager(client()).remove(id);
  store().deleteSession(id);
  if (sel.sessionID === id) setSelections({ sessionID: undefined });
  return json({ ok: true, deleted: id });
});

async function ctxId(ctx: { params: Promise<Record<string, string>> }): Promise<{ id: string }> {
  const params = await ctx.params;
  const id = params?.id;
  if (!id || !id.startsWith("ses")) {
    throw new LabError({
      code: "INVALID_REQUEST",
      status: 400,
      message: `Invalid session id "${id}".`,
      recovery: "Session ids issued by OpenCode start with `ses`.",
    });
  }
  return { id };
}
