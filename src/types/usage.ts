export interface UsageRecord {
  /** Stable provider message id, used to avoid recording a response twice. */
  id: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  timestamp: number;
}

export interface ProviderSummary {
  provider: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** Retained for compatibility with older persisted/admin summaries. */
  avgResponseTime?: number;
  models: Record<string, ModelSummary>;
}

export interface ModelSummary {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** Retained for compatibility with older persisted/admin summaries. */
  avgResponseTime?: number;
}

export interface UsageSummary {
  providers: ProviderSummary[];
  totalRequests: number;
  totalTokens: number;
}
