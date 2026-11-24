import { LabError } from "../errors";
import type { OpenCodeClient } from "./client";
import type { ProviderInfo, V2ModelInfo } from "./types";

export interface ModelSummary {
  /** `providerID/modelID` - the value OpenCode expects. */
  ref: string;
  id: string;
  providerID: string;
  providerName: string;
  name: string;
  context?: number;
  outputTokens?: number;
  status?: string;
  /** V2 `enabled` flag when the V2 catalogue is reachable. */
  enabled?: boolean;
  /** Whether this Lab could confirm a credential exists for the provider. */
  authenticated: boolean;
  toolCall: boolean;
  reasoning: boolean;
}

export interface ProviderSummary {
  id: string;
  name: string;
  source: string;
  authenticated: boolean;
  modelCount: number;
}

/**
 * Models available on the connected instance.
 *
 * Secrets handling: `ProviderInfo.key` is stripped here and never returned to
 * the browser. `authenticated` is a boolean derived from whether a credential
 * is present - the credential itself stays in the backend only.
 *
 * The catalogue is fetched from OpenCode twice (V1 providers + V2 models) and
 * takes ~1 s, and every page poll asks for it, so results are cached briefly
 * and concurrent callers share one in-flight request.
 */
const CACHE_TTL_MS = 20_000;
type Catalogue = { providers: ProviderSummary[]; models: ModelSummary[] };
const catalogueCache = new Map<string, { at: number; value: Catalogue }>();
const catalogueInflight = new Map<string, Promise<Catalogue>>();

export async function listModels(
  client: OpenCodeClient,
  directory?: string
): Promise<{ providers: ProviderSummary[]; models: ModelSummary[] }> {
  const key = directory ?? "";
  const hit = catalogueCache.get(key);
  if (hit) {
    // Serve immediately and refresh in the background once the entry is stale,
    // so page polls never wait on the ~1 s upstream catalogue fetch.
    if (Date.now() - hit.at > CACHE_TTL_MS && !catalogueInflight.has(key)) {
      void refreshCatalogue(client, directory).catch(() => undefined);
    }
    return hit.value;
  }
  return refreshCatalogue(client, directory);
}

function refreshCatalogue(client: OpenCodeClient, directory?: string): Promise<Catalogue> {
  const key = directory ?? "";
  const pending = catalogueInflight.get(key);
  if (pending) return pending;

  const promise = fetchCatalogue(client, directory).then(
    (value) => {
      catalogueCache.set(key, { at: Date.now(), value });
      catalogueInflight.delete(key);
      return value;
    },
    (e) => {
      catalogueInflight.delete(key);
      throw e;
    }
  );
  catalogueInflight.set(key, promise);
  return promise;
}

async function fetchCatalogue(client: OpenCodeClient, directory?: string): Promise<Catalogue> {
  const [providers, v2res] = await Promise.all([
    client.listProviders({ directory }),
    directory
      ? client.listModelsV2({ directory }).catch(() => null)
      : Promise.resolve(null),
  ]);

  let v2: Map<string, V2ModelInfo> | null = null;
  if (v2res) v2 = new Map((v2res.data ?? []).map((m) => [`${m.providerID}/${m.id}`, m]));

  const providerSummaries: ProviderSummary[] = [];
  const models: ModelSummary[] = [];

  for (const p of providers as ProviderInfo[]) {
    const authenticated = Boolean(p.key) || (p.env ?? []).some((k) => Boolean(process.env[k]));
    const entries = Object.values(p.models ?? {});
    providerSummaries.push({
      id: p.id,
      name: p.name,
      source: p.source,
      authenticated,
      modelCount: entries.length,
    });

    for (const m of entries) {
      const ref = `${p.id}/${m.id}`;
      const v = v2?.get(ref);
      models.push({
        ref,
        id: m.id,
        providerID: p.id,
        providerName: p.name,
        name: m.name || m.id,
        context: m.limit?.context,
        outputTokens: m.limit?.output,
        status: m.status,
        enabled: v?.enabled,
        authenticated,
        toolCall: Boolean(m.capabilities?.toolcall),
        reasoning: Boolean(m.capabilities?.reasoning),
      });
    }
  }

  return { providers: providerSummaries, models };
}

/** Only models whose provider has a usable credential are offered for selection. */
export function availableModels(models: ModelSummary[]): ModelSummary[] {
  return models.filter((m) => m.authenticated && m.enabled !== false);
}

export function requireModel(models: ModelSummary[], ref: string): ModelSummary {
  const found = models.find((m) => m.ref === ref);
  if (!found) {
    throw new LabError({
      code: "MODEL_UNAVAILABLE",
      status: 404,
      message: `Model "${ref}" is not available on the connected OpenCode instance.`,
      detail: `Known models: ${models.length}`,
      recovery: "Choose a model from the selector - the list is loaded live from OpenCode.",
    });
  }
  if (!found.authenticated) {
    throw new LabError({
      code: "MODEL_UNAVAILABLE",
      status: 409,
      message: `Provider "${found.providerID}" has no configured credential.`,
      detail: `Model ${ref} belongs to ${found.providerName}.`,
      recovery:
        "Add a credential for that provider in OpenCode (`opencode providers`) or pick a model from an authenticated provider.",
    });
  }
  return found;
}

/** Split `provider/model` refs, tolerating model ids that contain slashes. */
export function splitModelRef(ref: string): { providerID: string; modelID: string } {
  const idx = ref.indexOf("/");
  if (idx <= 0 || idx === ref.length - 1) {
    throw new LabError({
      code: "INVALID_REQUEST",
      message: `Model reference "${ref}" must look like provider/model.`,
      recovery: "Select a model from the list; refs are generated from the OpenCode catalogue.",
    });
  }
  return { providerID: ref.slice(0, idx), modelID: ref.slice(idx + 1) };
}
