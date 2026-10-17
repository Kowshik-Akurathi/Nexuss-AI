import type { LocalProviderType } from "@/types/localModels";
import { DISCOVERED_OLLAMA_MODELS } from "@/data/mockData";

/**
 * Mocked local-model service layer.
 * In the real app this talks to Ollama / LM Studio / vLLM directly from the
 * browser. Here everything resolves from fixtures after a short delay so the
 * UI states (checking, connected, failed) stay realistic.
 */

export interface DiscoveredOllamaModelDetailed {
  id: string;
  modelId: string;
  name?: string;
  size?: number;
  modifiedAt?: number;
  modified?: string;
  family?: string;
  parameterSize?: string;
  quantization?: string;
}

export interface OllamaPullProgress {
  status: string;
  completed?: number;
  total?: number;
  percent?: number;
  bytesPerSecond?: number;
}

export interface LocalEndpointTestResult {
  ok: boolean;
  endpointReachable?: boolean;
  models?: string[];
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A short, deterministic model list per OpenAI-compatible provider type. */
const FAKE_MODELS: Record<LocalProviderType, string[]> = {
  ollama: DISCOVERED_OLLAMA_MODELS.map((m) => m.modelId),
  lmstudio: ["meta-llama/llama-3.2-3b-instruct", "qwen/qwen2.5-7b-instruct"],
  vllm: ["mistralai/mistral-7b-instruct-v0.3"],
  generic: ["local-model-a", "local-model-b"]
};

/**
 * Pretends to probe the endpoint. Endpoints pointing at localhost always
 * succeed; anything else "fails" so the error states can be reviewed.
 */
export async function testLocalEndpoint(
  endpoint: string,
  providerType: LocalProviderType,
  _apiKey?: string
): Promise<LocalEndpointTestResult> {
  await delay(600);
  const reachable = /localhost|127\.0\.0\.1/i.test(endpoint);
  return {
    ok: reachable,
    endpointReachable: reachable,
    models: reachable ? FAKE_MODELS[providerType] : []
  };
}

export async function discoverOllamaModelsDetailed(
  _endpoint?: string
): Promise<DiscoveredOllamaModelDetailed[]> {
  await delay(500);
  return DISCOVERED_OLLAMA_MODELS;
}

export async function verifyLocalChat(
  _endpoint: string,
  _modelId: string
): Promise<{ ok: boolean; message?: string }> {
  await delay(900);
  return { ok: true };
}
