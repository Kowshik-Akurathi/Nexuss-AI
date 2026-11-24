import { handler, json, client } from "@/server/api";
import { getExecutionManager } from "@/server/execution-registry";
import { ResultsManager } from "@/server/results-manager";
import { store } from "@/server/store";
import { LabError } from "@/server/errors";

/** Execution history: live records first, then Lab SQLite history. */
export const GET = handler("executions", async (req, _ctx) => {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");

  if (id) {
    let record = null;
    try {
      record = getExecutionManager().get(id);
    } catch {
      record = null;
    }
    if (!record) {
      const row = store().listExecutions(500).find((r) => r.id === id);
      if (!row) {
        throw new LabError({
          code: "SESSION_NOT_FOUND",
          status: 404,
          message: `Execution ${id} not found.`,
          recovery: "Open the Execution Monitor and pick an entry from the list.",
        });
      }
      return json({ execution: null, stored: row, results: null });
    }
    const results = await new ResultsManager(client()).build(record);
    return json({ execution: record, stored: null, results });
  }

  const live = getExecutionManager().list(50);
  const stored = store().listExecutions(50);
  return json({ live, stored, count: live.length + stored.length });
});
