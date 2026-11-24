import { handler, json, readJson } from "@/server/api";
import { getSelections, setSelections } from "@/server/lab-state";
import { getConnection } from "@/server/opencode/connection";
import { allowedRoots, LAB_ROOT } from "@/server/project-manager";
import { store } from "@/server/store";
import { LabError } from "@/server/errors";


/** Current Lab settings (read-only view of runtime config + persisted selections). */
export const GET = handler("settings", async (_req, _ctx) => {
  const conn = getConnection();
  const config = conn.getConfig();
  return json({
    selections: getSelections(),
    config: {
      preferredUrl: config.preferredUrl ?? null,
      startPort: config.startPort,
      hostname: config.hostname,
      startTimeoutMs: config.startTimeoutMs,
      passwordConfigured: Boolean(config.password),
    },
    lab: {
      root: LAB_ROOT,
      roots: allowedRoots(),
      dataDir: process.env.LAB_DATA_DIR || `${LAB_ROOT}/.lab`,
      node: process.version,
    },
    stats: store().stats(),
    env: {
      // Flags only - never echo raw env values to the browser.
      OPENCODE_SERVER_URL_SET: Boolean(process.env.OPENCODE_SERVER_URL),
      OPENCODE_SERVER_PASSWORD_SET: Boolean(process.env.OPENCODE_SERVER_PASSWORD),
      LAB_EXTRA_PROJECT_ROOTS_SET: Boolean(process.env.LAB_EXTRA_PROJECT_ROOTS),
      LAB_DATA_DIR_SET: Boolean(process.env.LAB_DATA_DIR),
    },
  });
});

/** Persist default agent / model selections. Project changes go through /api/projects. */
export const PATCH = handler("settings", async (req) => {
  const body = await readJson<{ agent?: string; model?: string }>(req);
  const patch: { agent?: string; model?: string } = {};
  if (typeof body.agent === "string") {
    const name = body.agent.trim();
    if (!name || name.length > 64) {
      throw new LabError({
        code: "INVALID_REQUEST",
        status: 400,
        message: "Agent name must be 1-64 characters.",
        recovery: "Pick an agent from the Workspace sidebar.",
      });
    }
    patch.agent = name;
  }
  if (typeof body.model === "string") {
    const ref = body.model.trim();
    if (ref.length > 200) {
      throw new LabError({
        code: "INVALID_REQUEST",
        status: 400,
        message: "Model reference is too long.",
        recovery: "Pick a model from the Workspace sidebar.",
      });
    }
    patch.model = ref;
  }
  if (!patch.agent && !patch.model) {
    throw new LabError({
      code: "INVALID_REQUEST",
      status: 400,
      message: "Nothing to update.",
      recovery: "Send at least one of { agent, model }.",
    });
  }
  const selections = setSelections(patch);
  return json({ ok: true, selections });
});
