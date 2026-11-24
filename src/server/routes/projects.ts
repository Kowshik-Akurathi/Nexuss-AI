import { handler, json, client, readJson } from "@/server/api";
import { ProjectManager, resolveProjectDirectory, allowedRoots } from "@/server/project-manager";
import { getSelections, setSelections } from "@/server/lab-state";
import { LabError } from "@/server/errors";

/**
 * GET /api/projects              -> allowed roots + current selection
 * GET /api/projects?browse=<dir> -> sub-directories of an allowed root
 * GET /api/projects?inspect=<dir> -> full inspection (files, git, changes)
 * POST /api/projects             -> validate + select a project directory
 */
export const GET = handler("projects", async (req, _ctx) => {
  const url = new URL(req.url);
  const browse = url.searchParams.get("browse");
  const inspect = url.searchParams.get("inspect");
  const sub = url.searchParams.get("sub") ?? "";
  const mgr = new ProjectManager(client());

  if (browse) {
    const entries = await mgr.browse(browse);
    return json({ root: browse, entries });
  }

  if (inspect) {
    const view = await mgr.inspect(inspect, sub);
    return json({ project: view });
  }

  return json({
    roots: allowedRoots(),
    current: getSelections().directory || null,
    home: mgr.home(),
  });
});

export const POST = handler("projects", async (req) => {
  const body = await readJson<{ directory?: string; create?: string }>(req);
  const mgr = new ProjectManager(client());

  let dir = body.directory;
  if (body.create) {
    dir = await mgr.createLabProject(body.create);
  }
  if (!dir) {
    throw new LabError({
      code: "INVALID_PROJECT_DIRECTORY",
      status: 400,
      message: "No directory supplied.",
      recovery: "Pick a directory or pass `create` to make a Lab scratch project.",
    });
  }

  const resolved = await resolveProjectDirectory(dir);
  const view = await mgr.inspect(resolved);
  setSelections({ directory: resolved });
  return json({ ok: true, directory: resolved, project: view });
});
