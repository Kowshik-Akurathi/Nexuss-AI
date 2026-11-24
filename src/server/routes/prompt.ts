import { handler, json, client, readJson } from "@/server/api";
import { getExecutionManager } from "@/server/execution-registry";
import { SessionManager, toChatItems } from "@/server/opencode/session-manager";
import { PermissionManager } from "@/server/permission-manager";
import { ResultsManager } from "@/server/results-manager";
import { splitModelRef } from "@/server/opencode/model-manager";
import { store } from "@/server/store";
import { setSelections } from "@/server/lab-state";
import { audit } from "@/server/audit-logger";
import { LabError } from "@/server/errors";

type Ctx = { params: Promise<{ id: string }> };

async function sessionId(ctx: { params: Promise<Record<string, string>> }): Promise<string> {
  const params = await ctx.params;
  const id = params?.id;
  if (!id?.startsWith("ses")) {
    throw new LabError({ code: "INVALID_REQUEST", status: 400, message: "Invalid session id." });
  }
  return id;
}

export const GET = handler("messages", async (_req, ctx) => {
  const id = await sessionId(ctx);
  const mgr = new SessionManager(client());
  const session = await mgr.get(id);
  const bundles = await mgr.history(id, session.directory);
  return json({ messages: toChatItems(bundles), session });
});

/** Submit a prompt to the real OpenCode agent. */
export const POST = handler("prompt", async (req, ctx) => {
  const id = await sessionId(ctx);
  const body = await readJson<{
    text?: string;
    agent?: string;
    model?: string;
    directory?: string;
    async?: boolean;
  }>(req);

  if (!body.text?.trim()) {
    throw new LabError({
      code: "INVALID_REQUEST",
      status: 400,
      message: "Prompt text is empty.",
      recovery: "Type an instruction before sending.",
    });
  }

  const sessionMgr = new SessionManager(client());
  const execMgr = getExecutionManager();

  // Parallelize independent upstream calls: get session + set agent
  const [session] = await Promise.all([
    sessionMgr.get(id),
    body.agent ? sessionMgr.setAgent(id, body.agent) : Promise.resolve(),
  ]);

  const directory = body.directory || session.directory;

  const opts: Parameters<typeof execMgr.submit>[0] = {
    sessionID: id,
    directory,
    text: body.text,
    agent: body.agent,
    async: body.async ?? true,
  };
  if (body.model) opts.model = splitModelRef(body.model);

  audit().info("prompt", `Submitting prompt to ${id}`, {
    agent: body.agent,
    model: body.model,
    chars: body.text.length,
    mode: opts.async ? "async" : "sync",
  });

  const rec = await execMgr.submit(opts);

  store().upsertSession({
    session_id: id,
    title: session.title,
    directory,
    agent: body.agent ?? session.agent ?? null,
    model: body.model ?? session.model ?? null,
    created_at: session.createdAt,
    updated_at: Date.now(),
  });
  setSelections({ sessionID: id, directory });

  let results: unknown = null;
  if (rec.phase === "completed") {
    results = await new ResultsManager(client()).build(rec);
  }

  const persist = (row: typeof rec) =>
    store().insertExecution({
      id: row.id,
      session_id: id,
      directory,
      prompt: row.prompt,
      status: row.phase,
      started_at: row.startedAt,
      ended_at: row.endedAt ?? null,
      tools_used: row.toolCalls.length,
      files_changed: 0,
      error: row.error ?? null,
    });

  if (rec.phase === "running") {
    // Background turn: write the history row once it settles.
    void execMgr.whenSettled(rec.id).then(persist).catch(() => {});
  } else {
    persist(rec);
  }

  // Defer permission checks: return immediately, permissions loaded async by frontend
  const pending: unknown = [];

  return json({ execution: rec, results, pendingPermissions: pending }, { status: 201 });
});

/** Interrupt the running turn. */
export const DELETE = handler("interrupt", async (_req, ctx) => {
  const id = await sessionId(ctx);
  audit().info("interrupt", `Interrupt requested for ${id}`);
  await getExecutionManager().interrupt(id);
  return json({ ok: true, sessionID: id });
});
