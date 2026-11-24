import { handler, json, client, readJson } from "@/server/api";
import { SessionManager } from "@/server/opencode/session-manager";
import { resolveProjectDirectory } from "@/server/project-manager";
import { getSelections, setSelections } from "@/server/lab-state";
import { store } from "@/server/store";
import { LabError } from "@/server/errors";

export const GET = handler("sessions", async (req, _ctx) => {
  const url = new URL(req.url);
  const dirParam = url.searchParams.get("directory");
  const search = url.searchParams.get("search") ?? undefined;
  const all = url.searchParams.get("all") === "1";
  const mgr = new SessionManager(client());

  if (all) {
    const rows = await mgr.listAll(200);
    return json({ sessions: rows, count: rows.length });
  }
  const dir = dirParam ?? getSelections().directory;
  if (!dir) {
    throw new LabError({
      code: "INVALID_PROJECT_DIRECTORY",
      status: 400,
      message: "No project directory selected.",
      recovery: "Choose a project on the Projects page first.",
    });
  }
  const rows = await mgr.list(dir, { search });
  return json({ sessions: rows, count: rows.length, directory: dir });
});

/** Create a session bound to an explicitly validated project directory. */
export const POST = handler("sessions", async (req) => {
  const body = await readJson<{ directory?: string; title?: string; agent?: string; model?: string }>(req);
  const dir = await resolveProjectDirectory(body.directory || getSelections().directory);
  const mgr = new SessionManager(client());

  const opts: { title?: string; agent?: string; model?: { id: string; providerID: string } } = {
    title: body.title,
    agent: body.agent || getSelections().agent,
  };
  if (body.model) {
    const idx = body.model.indexOf("/");
    if (idx > 0) opts.model = { providerID: body.model.slice(0, idx), id: body.model.slice(idx + 1) };
  }

  const session = await mgr.create(dir, opts);
  store().upsertSession({
    session_id: session.id,
    title: session.title,
    directory: session.directory,
    agent: session.agent ?? opts.agent ?? null,
    model: session.model ?? body.model ?? null,
    created_at: session.createdAt,
    updated_at: session.updatedAt,
  });
  setSelections({ directory: dir, sessionID: session.id, agent: opts.agent ?? getSelections().agent });

  return json({ session }, { status: 201 });
});
