import { handler, json, client, readJson } from "@/server/api";
import { PermissionManager, describePermission, riskLevel } from "@/server/permission-manager";
import { getSelections } from "@/server/lab-state";
import type { PermissionDecision } from "@/server/opencode/types";
import { audit } from "@/server/audit-logger";
import { LabError } from "@/server/errors";

export const GET = handler("permissions", async (req, _ctx) => {
  const dir = new URL(req.url).searchParams.get("directory") ?? getSelections().directory;
  if (!dir) return json({ permissions: [], count: 0 });
  const mgr = new PermissionManager(client());
  const pending = await mgr.pending(dir);
  return json({
    permissions: pending.map((p) => ({
      ...p,
      description: describePermission(p),
      risk: riskLevel(p.action),
    })),
    count: pending.length,
    recentDecisions: mgr.recentDecisions().slice(-20),
  });
});

/** Approve / reject a real OpenCode permission request. Never auto-approved. */
export const POST = handler("permissions", async (req) => {
  const body = await readJson<{
    sessionID?: string;
    permissionID?: string;
    decision?: PermissionDecision;
    directory?: string;
    message?: string;
  }>(req);

  if (!body.sessionID || !body.permissionID || !body.decision) {
    throw new LabError({
      code: "INVALID_REQUEST",
      status: 400,
      message: "sessionID, permissionID and decision are required.",
      recovery: "decision must be one of: once | always | reject",
    });
  }
  if (!["once", "always", "reject"].includes(body.decision)) {
    throw new LabError({
      code: "INVALID_REQUEST",
      status: 400,
      message: `Invalid decision "${body.decision}".`,
      recovery: "Use `once` (allow once), `always` (persist allow rule) or `reject`.",
    });
  }
  const dir = body.directory || getSelections().directory;
  if (!dir) {
    throw new LabError({
      code: "INVALID_PROJECT_DIRECTORY",
      status: 400,
      message: "No project directory selected.",
      recovery: "Select a project first.",
    });
  }

  const mgr = new PermissionManager(client());
  audit().info("permissions", `${body.decision} for ${body.permissionID}`, {
    sessionID: body.sessionID,
  });
  await mgr.respond(dir, body.sessionID, body.permissionID, body.decision, body.message);
  return json({ ok: true, decision: body.decision, permissionID: body.permissionID });
});
