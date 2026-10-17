import { create } from "zustand";
import {
  LocalProvider,
  LocalModel,
  LocalProviderType,
  normalizeEndpoint
} from "@/types/localModels";
import {
  discoverOllamaModelsDetailed,
  type DiscoveredOllamaModelDetailed,
  type OllamaPullProgress,
  type LocalEndpointTestResult,
  testLocalEndpoint
} from "@/services/localModels";
import { DISCOVERED_OLLAMA_MODELS } from "@/data/mockData";

/**
 * Mock local-model store. Mirrors the shape of the real Nexuss store so the
 * Models settings screen and the composer's model picker behave identically,
 * but everything lives in memory only.
 */

export interface OllamaPullTask {
  model: string;
  status: "pulling" | "completed" | "failed" | "cancelled";
  error?: string;
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

interface LocalModelState {
  providers: LocalProvider[];
  models: LocalModel[];
  hydrated: boolean;
  discoveredOllamaModels: DiscoveredOllamaModelDetailed[];
  ollamaStatus: "connected" | "not_connected" | "error" | "loading" | "idle";
  ollamaError: string | null;
  ollamaLastRefresh: number | null;
  ollamaPullProgress: OllamaPullProgress | null;
  ollamaPullTask: OllamaPullTask | null;
  activeProviderId: string | null;
  selectedModelId: string | null;

  hydrate: () => Promise<void>;
  addProvider: (input: {
    name: string;
    providerType: LocalProviderType;
    endpoint: string;
    apiKey?: string;
  }) => Promise<LocalProvider>;
  updateProvider: (
    id: string,
    patch: Partial<Pick<LocalProvider, "name" | "endpoint" | "apiKey" | "enabled" | "providerType">>
  ) => Promise<void>;
  removeProvider: (id: string) => Promise<void>;
  addModel: (providerId: string, modelId: string, displayName?: string) => Promise<LocalModel>;
  removeModel: (id: string) => Promise<void>;
  getProviderForModel: (modelId: string) => LocalProvider | undefined;
  pullOllamaModel: (model: string) => Promise<void>;
  cancelPullOllamaModel: () => void;
  clearPullTask: () => void;
  refreshOllamaModels: (endpoint?: string) => Promise<void>;
  clearDiscoveredOllamaModels: () => void;
  testEndpoint: (endpoint: string, type: LocalProviderType, apiKey?: string) => Promise<LocalEndpointTestResult>;
  setActiveProviderId: (id: string | null) => void;
  setSelectedModel: (modelId: string | null) => void;
}

const OLLAMA_PROVIDER_ID = "lp-ollama";

function seedOllama(): { providers: LocalProvider[]; models: LocalModel[] } {
  const now = Date.now();
  const provider: LocalProvider = {
    id: OLLAMA_PROVIDER_ID,
    userId: "mock-uid-001",
    name: "Ollama",
    providerType: "ollama",
    endpoint: normalizeEndpoint("http://localhost:11434", "ollama"),
    enabled: true,
    createdAt: now - 10 * 86_400_000,
    updatedAt: now - 86_400_000
  };
  const models: LocalModel[] = DISCOVERED_OLLAMA_MODELS.map((m) => ({
    id: `lm-${m.id}`,
    userId: "mock-uid-001",
    providerId: provider.id,
    modelId: m.modelId,
    displayName: m.modelId,
    enabled: true,
    createdAt: now - 10 * 86_400_000,
    updatedAt: now - 86_400_000,
    size: m.size,
    family: m.family,
    parameterSize: m.parameterSize,
    quantization: m.quantization
  }));
  return { providers: [provider], models };
}

let pullTimer: number | null = null;

export const useLocalModelStore = create<LocalModelState>((set, get) => ({
  providers: [],
  models: [],
  hydrated: false,
  discoveredOllamaModels: [],
  ollamaStatus: "idle",
  ollamaError: null,
  ollamaLastRefresh: null,
  ollamaPullProgress: null,
  ollamaPullTask: null,
  activeProviderId: null,
  selectedModelId: null,

  hydrate: async () => {
    if (get().hydrated) return;
    const seeded = seedOllama();
    set({
      providers: seeded.providers,
      models: seeded.models,
      discoveredOllamaModels: DISCOVERED_OLLAMA_MODELS,
      ollamaStatus: "connected",
      ollamaLastRefresh: Date.now(),
      hydrated: true,
      activeProviderId: OLLAMA_PROVIDER_ID,
      selectedModelId: DISCOVERED_OLLAMA_MODELS[0].modelId
    });
  },

  addProvider: async ({ name, providerType, endpoint, apiKey }) => {
    const now = Date.now();
    const provider: LocalProvider = {
      id: newId(),
      userId: "mock-uid-001",
      name,
      providerType,
      endpoint: normalizeEndpoint(endpoint, providerType),
      apiKey,
      enabled: true,
      createdAt: now,
      updatedAt: now
    };
    set((s) => ({ providers: [...s.providers, provider] }));
    return provider;
  },

  updateProvider: async (id, patch) => {
    set((s) => ({
      providers: s.providers.map((p) =>
        p.id === id ? { ...p, ...patch, updatedAt: Date.now() } : p
      )
    }));
  },

  removeProvider: async (id) => {
    set((s) => ({
      providers: s.providers.filter((p) => p.id !== id),
      models: s.models.filter((m) => m.providerId !== id),
      activeProviderId: s.activeProviderId === id ? null : s.activeProviderId
    }));
  },

  addModel: async (providerId, modelId, displayName) => {
    const now = Date.now();
    const existing = get().models.find(
      (m) => m.providerId === providerId && m.modelId === modelId
    );
    if (existing) return existing;
    const model: LocalModel = {
      id: newId(),
      userId: "mock-uid-001",
      providerId,
      modelId,
      displayName: displayName || modelId,
      enabled: true,
      createdAt: now,
      updatedAt: now
    };
    set((s) => ({ models: [...s.models, model] }));
    return model;
  },

  removeModel: async (id) => {
    set((s) => ({ models: s.models.filter((m) => m.id !== id) }));
  },

  getProviderForModel: (modelId) => {
    const state = get();
    const model = state.models.find((m) => m.modelId === modelId);
    if (!model) return undefined;
    return state.providers.find((p) => p.id === model.providerId);
  },

  refreshOllamaModels: async (endpoint) => {
    void endpoint;
    set({ ollamaStatus: "loading" });
    try {
      const models = await discoverOllamaModelsDetailed(endpoint);
      set({
        discoveredOllamaModels: models,
        ollamaStatus: "connected",
        ollamaError: null,
        ollamaLastRefresh: Date.now()
      });
    } catch {
      set({ discoveredOllamaModels: [], ollamaStatus: "error", ollamaError: "unreachable" });
    }
  },

  clearDiscoveredOllamaModels: () => {
    set({ discoveredOllamaModels: [], ollamaStatus: "idle" });
  },

  pullOllamaModel: async (model) => {
    if (pullTimer) window.clearInterval(pullTimer);
    set({
      ollamaPullTask: { model, status: "pulling" },
      ollamaPullProgress: { status: "pulling manifest", completed: 0, total: 100, percent: 0 }
    });

    let percent = 0;
    pullTimer = window.setInterval(() => {
      percent += 7 + Math.random() * 9;
      const done = Math.min(99, Math.round(percent));
      if (percent >= 100) {
        if (pullTimer) window.clearInterval(pullTimer);
        pullTimer = null;
        set({
          ollamaPullTask: { model, status: "completed" },
          ollamaPullProgress: { status: "success", percent: 100, completed: 100, total: 100 }
        });
        const state = get();
        const provider =
          state.providers.find((p) => p.providerType === "ollama") ?? state.providers[0];
        if (provider) void state.addModel(provider.id, model);
        return;
      }
      set({
        ollamaPullProgress: {
          status: done > 60 ? "verifying digest" : "pulling model data",
          completed: done,
          total: 100,
          percent: done,
          bytesPerSecond: 12_400_000
        }
      });
    }, 420);
  },

  cancelPullOllamaModel: () => {
    if (pullTimer) window.clearInterval(pullTimer);
    pullTimer = null;
    const task = get().ollamaPullTask;
    if (task) set({ ollamaPullTask: { ...task, status: "cancelled" } });
  },

  clearPullTask: () => {
    if (pullTimer) window.clearInterval(pullTimer);
    pullTimer = null;
    set({ ollamaPullTask: null, ollamaPullProgress: null });
  },

  testEndpoint: async (endpoint, type, apiKey) => testLocalEndpoint(endpoint, type, apiKey),

  setActiveProviderId: (id) => set({ activeProviderId: id }),
  setSelectedModel: (modelId) => set({ selectedModelId: modelId })
}));
