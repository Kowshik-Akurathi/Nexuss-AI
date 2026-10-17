import { create } from "zustand";
import type { ProviderType, UsageRecord, UsageSummary, ProviderSummary } from "@/types";
import { MOCK_USAGE_SUMMARY } from "@/data/mockData";

/**
 * Mock usage store: keeps an in-memory list of requests so the Usage tab can
 * be exercised (including the "clear statistics" flow).
 */

interface UsageStore {
  summary: UsageSummary;
  loading: boolean;
  recordUsage: (entry: Omit<UsageRecord, "id" | "timestamp" | "userId">) => Promise<void>;
  loadSummary: () => Promise<void>;
  getRecords: (provider?: ProviderType) => Promise<UsageRecord[]>;
  clearUsage: () => Promise<void>;
  resetUsage: () => void;
  estimateContextTokens: (messages: { role: string; content: string }[]) => number;
}

function emptySummary(): UsageSummary {
  return { providers: [], totalRequests: 0, totalTokens: 0 };
}

function buildSummary(records: UsageRecord[]): UsageSummary {
  const map = new Map<ProviderType, ProviderSummary>();
  for (const r of records) {
    let ps = map.get(r.provider);
    if (!ps) {
      ps = {
        provider: r.provider,
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        avgResponseTime: 0,
        models: {}
      };
      map.set(r.provider, ps);
    }
    ps.requests += 1;
    ps.inputTokens += r.inputTokens;
    ps.outputTokens += r.outputTokens;
    ps.totalTokens += r.totalTokens;
    ps.avgResponseTime =
      (ps.avgResponseTime * (ps.requests - 1) + r.responseTime) / ps.requests;

    const model = (ps.models[r.model] ??= {
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      avgResponseTime: 0
    });
    model.requests += 1;
    model.inputTokens += r.inputTokens;
    model.outputTokens += r.outputTokens;
    model.totalTokens += r.totalTokens;
    model.avgResponseTime =
      (model.avgResponseTime * (model.requests - 1) + r.responseTime) / model.requests;
  }
  const providers = [...map.values()];
  return {
    providers,
    totalRequests: records.length,
    totalTokens: providers.reduce((n, p) => n + p.totalTokens, 0)
  };
}

let records: UsageRecord[] = [];
let seeded = false;

function seedRecords(): UsageRecord[] {
  if (seeded) return records;
  seeded = true;
  // Flatten the fixture summary into pseudo records so clears rebuild cleanly.
  const now = Date.now();
  let i = 0;
  records = MOCK_USAGE_SUMMARY.providers.flatMap((p) =>
    Array.from({ length: Math.min(p.requests, 6) }).map((_, idx) => ({
      id: `ur-${i++}`,
      userId: "mock-uid-001",
      provider: p.provider,
      model: Object.keys(p.models)[idx % Object.keys(p.models).length],
      inputTokens: Math.round(p.inputTokens / Math.min(p.requests, 6)),
      outputTokens: Math.round(p.outputTokens / Math.min(p.requests, 6)),
      totalTokens: Math.round(p.totalTokens / Math.min(p.requests, 6)),
      responseTime: p.avgResponseTime,
      timestamp: now - idx * 3_600_000,
      success: true
    }))
  );
  return records;
}

export const useUsageStore = create<UsageStore>((set, get) => ({
  summary: MOCK_USAGE_SUMMARY,
  loading: false,

  loadSummary: async () => {
    set({ loading: true });
    seedRecords();
    set({ summary: buildSummary(records), loading: false });
  },

  recordUsage: async (entry) => {
    const record: UsageRecord = {
      ...entry,
      id: `ur-${Date.now()}`,
      userId: "mock-uid-001",
      timestamp: Date.now()
    };
    records = [record, ...records];
    set({ summary: buildSummary(records) });
  },

  getRecords: async (provider) => {
    seedRecords();
    return provider ? records.filter((r) => r.provider === provider) : records;
  },

  clearUsage: async () => {
    records = [];
    set({ summary: emptySummary() });
  },

  resetUsage: () => {
    records = [];
    seeded = false;
    set({ summary: MOCK_USAGE_SUMMARY });
  },

  estimateContextTokens: (messages) =>
    messages.reduce((total, m) => total + Math.ceil(m.content.length / 4) + 3, 0)
}));
