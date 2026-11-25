import { create } from "zustand";
import type { UsageRecord, UsageSummary, ProviderSummary } from "@/types";

const STORAGE_KEY = "nexuss-usage-records";

interface UsageStore {
  summary: UsageSummary;
  loading: boolean;
  recordUsage: (entry: Omit<UsageRecord, "timestamp"> & { timestamp?: number }) => Promise<void>;
  loadSummary: () => Promise<void>;
  getRecords: (provider?: string) => Promise<UsageRecord[]>;
  clearUsage: () => Promise<void>;
  resetUsage: () => void;
}

function emptySummary(): UsageSummary { return { providers: [], totalRequests: 0, totalTokens: 0 }; }

function buildSummary(records: UsageRecord[]): UsageSummary {
  const map = new Map<string, ProviderSummary>();
  for (const record of records) {
    let provider = map.get(record.provider);
    if (!provider) {
      provider = { provider: record.provider, requests: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, models: {} };
      map.set(record.provider, provider);
    }
    provider.requests += 1;
    provider.inputTokens += record.inputTokens;
    provider.outputTokens += record.outputTokens;
    provider.totalTokens += record.totalTokens;
    const model = (provider.models[record.model] ??= { requests: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 });
    model.requests += 1;
    model.inputTokens += record.inputTokens;
    model.outputTokens += record.outputTokens;
    model.totalTokens += record.totalTokens;
  }
  const providers = [...map.values()];
  return { providers, totalRequests: records.length, totalTokens: providers.reduce((total, p) => total + p.totalTokens, 0) };
}

let records: UsageRecord[] = [];
let loaded = false;

function loadRecords(): UsageRecord[] {
  if (loaded) return records;
  loaded = true;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = stored ? JSON.parse(stored) : [];
    records = Array.isArray(parsed) ? parsed as UsageRecord[] : [];
  } catch { records = []; }
  return records;
}

function persistRecords(): void {
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(records)); } catch { /* best effort */ }
}

export const useUsageStore = create<UsageStore>((set) => ({
  summary: emptySummary(),
  loading: false,
  loadSummary: async () => {
    set({ loading: true });
    loadRecords();
    set({ summary: buildSummary(records), loading: false });
  },
  recordUsage: async (entry) => {
    loadRecords();
    if (records.some((record) => record.id === entry.id)) return;
    records = [{ ...entry, timestamp: entry.timestamp ?? Date.now() }, ...records];
    persistRecords();
    set({ summary: buildSummary(records) });
  },
  getRecords: async (provider) => {
    loadRecords();
    return provider ? records.filter((record) => record.provider === provider) : records;
  },
  clearUsage: async () => {
    loadRecords();
    records = [];
    persistRecords();
    set({ summary: emptySummary() });
  },
  resetUsage: () => {
    records = [];
    loaded = true;
    persistRecords();
    set({ summary: emptySummary() });
  }
}));
