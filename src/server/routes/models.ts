import { handler, json, client } from "@/server/api";
import { availableModels, listModels, splitModelRef } from "@/server/opencode/model-manager";
import { getSelections } from "@/server/lab-state";

export const GET = handler("models", async (req, _ctx) => {
  const dir = new URL(req.url).searchParams.get("directory") ?? getSelections().directory ?? undefined;
  const { providers, models } = await listModels(client(), dir || undefined);
  return json({
    providers,
    models: availableModels(models),
    total: models.length,
    selected: getSelections().model,
  });
});

/** Validate a model reference without leaking provider credentials. */
export const POST = handler("models", async (req) => {
  const body = (await req.json()) as { ref?: string };
  if (!body.ref) return json({ ok: false, error: "ref required" }, { status: 400 });
  const split = splitModelRef(body.ref);
  return json({ ok: true, ...split });
});
