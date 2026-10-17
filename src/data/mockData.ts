import type { Chat, Message, UsageSummary, ProviderSummary } from "@/types";
import type { DiscoveredOllamaModelDetailed } from "@/services/localModels";

/**
 * Mock data for the Nexuss design prototype.
 * Nothing here talks to a backend — every screen is fed from these fixtures.
 */

const now = Date.now();
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const MOCK_USER = {
  uid: "mock-uid-001",
  email: "arjun@nexuss.in",
  displayName: "Arjun Mehta"
};

export const MOCK_WORKSPACE_NAME = "nexuss-app";

export const initialChats: Chat[] = [
  {
    id: "chat-1",
    userId: MOCK_USER.uid,
    title: "Refactor the streaming chat pipeline",
    provider: "groq",
    createdAt: now - 3 * HOUR,
    updatedAt: now - 12 * MINUTE
  },
  {
    id: "chat-2",
    userId: MOCK_USER.uid,
    title: "Postgres index strategy for message search",
    provider: "gemini",
    createdAt: now - 26 * HOUR,
    updatedAt: now - 5 * HOUR
  },
  {
    id: "chat-3",
    userId: MOCK_USER.uid,
    title: "Design a provider fallback ladder",
    provider: "openrouter",
    createdAt: now - 2 * DAY,
    updatedAt: now - 2 * DAY
  },
  {
    id: "chat-4",
    userId: MOCK_USER.uid,
    title: "Ollama setup on a Windows laptop",
    provider: "local",
    createdAt: now - 4 * DAY,
    updatedAt: now - 3 * DAY
  },
  {
    id: "chat-5",
    userId: MOCK_USER.uid,
    title: "Landing hero copy experiments",
    provider: "groq",
    createdAt: now - 9 * DAY,
    updatedAt: now - 8 * DAY
  }
];

function msg(
  chatId: string,
  id: string,
  role: Message["role"],
  content: string,
  timestamp: number
): Message {
  return { id, chatId, role, content, timestamp };
}

export const initialMessages: Record<string, Message[]> = {
  "chat-1": [
    msg(
      "chat-1",
      "m1",
      "user",
      "I have a chat stream that buffers the whole response before rendering. Can you show me how to stream tokens into React state without re-rendering the entire list?",
      now - 3 * HOUR
    ),
    msg(
      "chat-1",
      "m2",
      "assistant",
      `Yes — the trick is to keep the streamed chunk in a single message row instead of appending a new row per token.

### Approach

1. Append the assistant message **once**, when the first chunk arrives.
2. Update only that message's \`content\` for every following chunk.
3. Memoise the row so untouched messages never re-render.

\`\`\`tsx
const [streamingId, setStreamingId] = useState<string | null>(null);

function onChunk(id: string, delta: string) {
  setMessages((prev) =>
    prev.map((m) => (m.id === id ? { ...m, content: m.content + delta } : m))
  );
}
\`\`\`

| Concern | Solution |
| --- | --- |
| Re-render cost | \`React.memo\` on the message row |
| Ordering | Append once, update in place |
| Scroll | Follow the bottom only while the user is already there |

Also keep an eye on \`requestAnimationFrame\` — batching chunks into one frame keeps typing smooth on slower devices.`,
      now - 3 * HOUR + 40 * 1000
    ),
    msg(
      "chat-1",
      "m3",
      "user",
      "Nice. What about stopping generation mid-stream — I want the partial text kept.",
      now - 2 * HOUR
    ),
    msg(
      "chat-1",
      "m4",
      "assistant",
      `Keep the abort controller outside React state and simply stop writing:

- Call \`controller.abort()\` from the Stop button.
- Leave the assistant message exactly as it is — the partial content is already committed.
- Set \`isStreaming: false\` so the composer re-enables.

Your current Stop button in the composer already follows this pattern: it stays enabled during generation and never clears the message.`,
      now - 2 * HOUR + 15 * 1000
    )
  ],
  "chat-2": [
    msg(
      "chat-2",
      "m5",
      "user",
      "Searching chat titles is slow once we pass ~50k rows. What index would you use?",
      now - 26 * HOUR
    ),
    msg(
      "chat-2",
      "m6",
      "assistant",
      `Start with a trigram index if you need substring search, otherwise a plain B-tree on lower(title) covers prefix lookups.

\`\`\`sql
CREATE INDEX chats_title_trgm_idx
  ON chats USING gin (title gin_trgm_ops);
\`\`\`

For the message body, prefer a \`tsvector\` column kept in sync with a trigger — it scales far better than \`ILIKE '%…%'\`.`,
      now - 26 * HOUR + 30 * 1000
    )
  ],
  "chat-3": [
    msg(
      "chat-3",
      "m7",
      "user",
      "How should Nexuss fall back when Groq is rate limited?",
      now - 2 * DAY
    ),
    msg(
      "chat-3",
      "m8",
      "assistant",
      `A simple ordered ladder works well:

1. Try the selected provider with a short timeout.
2. On \`429\` or \`5xx\`, move to the next provider in the ladder.
3. Surface a small notice in the composer when a fallback was used.
4. Record every attempt in usage so you can see which provider actually served the reply.`,
      now - 2 * DAY + 45 * 1000
    )
  ],
  "chat-4": [
    msg(
      "chat-4",
      "m9",
      "user",
      "Ollama keeps saying connection refused on Windows. Where do I even start?",
      now - 4 * DAY
    ),
    msg(
      "chat-4",
      "m10",
      "assistant",
      `Check these in order:

- Is the Ollama desktop app actually running? Look for the tray icon.
- Does \`http://localhost:11434\` open in your browser?
- Some VPNs block loopback traffic — try disabling it briefly.
- Then hit **Refresh Models** in the model picker so Nexuss re-discovers your installed models.`,
      now - 4 * DAY + 20 * 1000
    )
  ],
  "chat-5": []
};

export const DISCOVERED_OLLAMA_MODELS: DiscoveredOllamaModelDetailed[] = [
  {
    id: "ollama-1",
    modelId: "qwen2.5-coder:3b",
    name: "qwen2.5-coder:3b",
    size: 1_900_000_000,
    parameterSize: "3.6B",
    quantization: "Q4_K_M",
    family: "qwen2.5",
    modifiedAt: now - 6 * DAY
  },
  {
    id: "ollama-2",
    modelId: "llama3.1:8b",
    name: "llama3.1:8b",
    size: 4_900_000_000,
    parameterSize: "8.0B",
    quantization: "Q4_K_M",
    family: "llama",
    modifiedAt: now - 11 * DAY
  },
  {
    id: "ollama-3",
    modelId: "gemma2:2b",
    name: "gemma2:2b",
    size: 1_600_000_000,
    parameterSize: "2.6B",
    quantization: "Q4_K_M",
    family: "gemma2",
    modifiedAt: now - 20 * DAY
  }
];

const usageProviders: ProviderSummary[] = [
  {
    provider: "groq",
    requests: 412,
    inputTokens: 186_400,
    outputTokens: 94_120,
    totalTokens: 280_520,
    avgResponseTime: 820,
    models: {
      "openai/gpt-oss-120b": {
        requests: 301,
        inputTokens: 131_000,
        outputTokens: 66_400,
        totalTokens: 197_400,
        avgResponseTime: 760
      },
      "openai/gpt-oss-20b": {
        requests: 111,
        inputTokens: 55_400,
        outputTokens: 27_720,
        totalTokens: 83_120,
        avgResponseTime: 980
      }
    }
  },
  {
    provider: "gemini",
    requests: 168,
    inputTokens: 71_900,
    outputTokens: 39_240,
    totalTokens: 111_140,
    avgResponseTime: 1_140,
    models: {
      "gemini-3.6-flash": {
        requests: 168,
        inputTokens: 71_900,
        outputTokens: 39_240,
        totalTokens: 111_140,
        avgResponseTime: 1_140
      }
    }
  },
  {
    provider: "local",
    requests: 37,
    inputTokens: 18_300,
    outputTokens: 9_860,
    totalTokens: 28_160,
    avgResponseTime: 2_410,
    models: {
      "qwen2.5-coder:3b": {
        requests: 37,
        inputTokens: 18_300,
        outputTokens: 9_860,
        totalTokens: 28_160,
        avgResponseTime: 2_410
      }
    }
  }
];

export const MOCK_USAGE_SUMMARY: UsageSummary = {
  providers: usageProviders,
  totalRequests: usageProviders.reduce((n, p) => n + p.requests, 0),
  totalTokens: usageProviders.reduce((n, p) => n + p.totalTokens, 0)
};

export const MOCK_ACCOUNT_INFO = {
  email: MOCK_USER.email,
  name: MOCK_USER.displayName,
  created_at: now - 118 * DAY
};

/**
 * Canned assistant replies used to simulate streaming in the prototype.
 */
export const MOCK_REPLIES: string[] = [
  `Here's a clean way to think about it.

### Steps

1. Keep the provider and model selection in one place.
2. Validate the combination before sending the request.
3. Fall back only on \`429\` or \`5xx\`, never on a user cancellation.

\`\`\`ts
const ladder = ["groq", "gemini", "openrouter"] as const;

for (const provider of ladder) {
  const res = await send(provider, payload);
  if (res.ok) return res;
  if (res.status !== 429 && res.status < 500) throw new Error(res.statusText);
}
\`\`\`

That keeps the happy path fast and makes failures predictable.`,
  `Short answer: yes, but keep the state shallow.

| Option | Cost | Notes |
| --- | --- | --- |
| One store slice | Low | Best for most chat UIs |
| Context per message | High | Re-renders every row |
| External cache | Medium | Good for cross-tab sync |

**Recommendation:** one slice for the thread, memoised rows, and a streaming id to isolate the row that is still writing.`,
  `I'd structure it like this:

\`\`\`tsx
export function ModelSelector({ provider, model }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button onClick={() => setOpen((v) => !v)}>{label}</button>
      {open && <Listbox onPick={setModel} />}
    </div>
  );
}
\`\`\`

- Close on outside click and on \`Escape\`.
- Keep the trigger label truncated to one line.
- Mark the selected row with a check icon so state is obvious at a glance.`
];
