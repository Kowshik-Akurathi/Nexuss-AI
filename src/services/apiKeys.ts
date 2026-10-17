/**
 * Mock API-key service.
 * Keys are never persisted anywhere — the prototype only tracks "connected"
 * status in memory so the API Keys screen shows realistic states.
 */

export interface ApiKeyStatus {
  provider: string;
  has_key: boolean;
  updatedAt: number;
}

export interface ApiKeyTestResult {
  valid: boolean;
  message: string;
}

const connected: Record<string, ApiKeyStatus> = {
  groq: { provider: "groq", has_key: true, updatedAt: Date.now() - 6 * 86_400_000 },
  gemini: { provider: "gemini", has_key: false, updatedAt: 0 },
  openrouter: { provider: "openrouter", has_key: true, updatedAt: Date.now() - 2 * 86_400_000 }
};

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const apiKeyService = {
  list: async (): Promise<ApiKeyStatus[]> => {
    await delay(350);
    return Object.values(connected);
  },

  test: async (provider: string, api_key: string): Promise<ApiKeyTestResult> => {
    await delay(700);
    const valid = api_key.trim().length >= 8 && !api_key.toLowerCase().includes("invalid");
    return {
      valid,
      message: valid
        ? `Key looks good — ${provider} responded to the test request.`
        : "That key was rejected by the provider. Double-check and try again."
    };
  },

  save: async (provider: string, _api_key: string): Promise<ApiKeyStatus> => {
    await delay(600);
    const status: ApiKeyStatus = { provider, has_key: true, updatedAt: Date.now() };
    connected[provider] = status;
    return status;
  },

  remove: async (provider: string): Promise<void> => {
    await delay(400);
    connected[provider] = { provider, has_key: false, updatedAt: 0 };
  }
};
