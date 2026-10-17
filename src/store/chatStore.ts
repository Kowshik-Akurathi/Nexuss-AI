import { create } from "zustand";
import type { Chat, Message, ProviderType, ChatState } from "@/types";
import { generateTitle } from "@/utils/providerLabels";
import { MOCK_REPLIES, initialChats, initialMessages, MOCK_USER } from "@/data/mockData";
import { useUsageStore } from "@/store/usageStore";

/**
 * Mock chat store.
 * Same public API as the Nexuss chat store so the UI can be ported as-is, but
 * assistant replies are simulated locally — no network requests are made.
 */

interface ChatStore extends ChatState {
  theme: string;
  reset: (clearStorage?: boolean) => void;
  sendMessageStream: (content: string, image?: string) => Promise<void>;
  stopGeneration: () => void;
  createNewChat: () => Promise<Chat>;
  renameChat: (id: string, title: string) => Promise<void>;
  deleteChat: (id: string) => Promise<void>;
  loadChat: (id: string) => Promise<void>;
  setProvider: (provider: ProviderType) => void;
  setModel: (model: string) => void;
  setTheme: (theme: string) => Promise<void>;
  clearError: () => void;
  hydrate: () => Promise<void>;
  searchChats: (query: string) => Promise<Chat[]>;
  editMessageAndRegenerate: (
    messageId: string,
    newContent: string,
    image?: string
  ) => Promise<void>;
  regenerateResponse: (messageId: string, image?: string) => Promise<void>;
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function applyTheme(theme: string): void {
  if (typeof window === "undefined") return;
  document.documentElement.classList.toggle("dark", theme === "dark");
  try {
    window.localStorage.setItem("theme", theme);
  } catch {
    /* storage unavailable — theme still applies for this session */
  }
}

/** Message store per conversation (in-memory replacement for IndexedDB). */
const messageCache: Record<string, Message[]> = { ...initialMessages };

let streamTimer: number | null = null;
let streamAbort = false;

function stopTimer(): void {
  if (streamTimer !== null) {
    window.clearInterval(streamTimer);
    streamTimer = null;
  }
}

function pickReply(seed: number): string {
  return MOCK_REPLIES[Math.abs(seed) % MOCK_REPLIES.length];
}

export const useChatStore = create<ChatStore>((set, get) => ({
  currentChat: null,
  chats: [],
  messages: [],
  provider: "groq",
  model: "openai/gpt-oss-120b",
  loading: false,
  isStreaming: false,
  streamingMessageId: null,
  error: null,
  fallbackNotice: null,
  theme: "dark",

  hydrate: async () => {
    if (get().chats.length > 0) return;
    let theme = "dark";
    try {
      theme = window.localStorage.getItem("theme") ?? "dark";
    } catch {
      /* ignore */
    }
    applyTheme(theme);
    const chats = [...initialChats];
    set({ chats, theme, currentChat: chats[0], messages: messageCache[chats[0].id] ?? [] });
  },

  reset: (clearStorage) => {
    stopTimer();
    if (clearStorage) {
      try {
        window.localStorage.removeItem("theme");
      } catch {
        /* ignore */
      }
    }
    set({
      currentChat: null,
      chats: [],
      messages: [],
      loading: false,
      isStreaming: false,
      streamingMessageId: null,
      error: null
    });
  },

  createNewChat: async () => {
    const chat: Chat = {
      id: newId(),
      userId: MOCK_USER.uid,
      title: "New chat",
      provider: get().provider,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    messageCache[chat.id] = [];
    set((state) => ({ chats: [chat, ...state.chats], currentChat: chat, messages: [] }));
    return chat;
  },

  loadChat: async (id) => {
    const chat = get().chats.find((c) => c.id === id);
    if (!chat) return;
    set({ currentChat: chat, messages: messageCache[id] ?? [] });
  },

  renameChat: async (id, title) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    const updatedAt = Date.now();
    set((state) => ({
      chats: state.chats.map((c) => (c.id === id ? { ...c, title: trimmed, updatedAt } : c)),
      currentChat:
        state.currentChat?.id === id
          ? { ...state.currentChat, title: trimmed, updatedAt }
          : state.currentChat
    }));
  },

  deleteChat: async (id) => {
    delete messageCache[id];
    const wasCurrent = get().currentChat?.id === id;
    stopTimer();
    set((state) => ({
      chats: state.chats.filter((c) => c.id !== id),
      currentChat: wasCurrent ? null : state.currentChat,
      messages: wasCurrent ? [] : state.messages,
      isStreaming: wasCurrent ? false : state.isStreaming,
      loading: wasCurrent ? false : state.loading,
      streamingMessageId: wasCurrent ? null : state.streamingMessageId,
      error: null
    }));
  },

  searchChats: async (query) => {
    const q = query.toLowerCase().trim();
    const chats = get().chats;
    if (!q) return chats;
    return chats.filter((c) => c.title.toLowerCase().includes(q));
  },

  setProvider: (provider) => {
    const defaults: Record<string, string> = {
      groq: "openai/gpt-oss-120b",
      gemini: "gemini-3.6-flash",
      openrouter: "openai/gpt-oss-120b:free"
    };
    set({ provider, model: provider === "local" ? get().model : (defaults[provider] ?? "") });
  },

  setModel: (model) => set({ model }),

  setTheme: async (theme) => {
    applyTheme(theme);
    set({ theme });
  },

  clearError: () => set({ error: null }),

  sendMessageStream: async (content) => {
    const text = content.trim();
    if (!text) return;
    const state = get();
    if (state.loading || state.isStreaming) return;

    // Validation error state: chatting locally with no model selected.
    if (state.provider === "local" && !state.model) {
      set({
        error:
          "No local model selected. Open Settings → Models and connect a local provider first."
      });
      return;
    }

    let chat = state.currentChat;
    if (!chat) chat = await get().createNewChat();

    const userMsg: Message = {
      id: newId(),
      chatId: chat.id,
      role: "user",
      content: text,
      timestamp: Date.now()
    };
    const isFirstMessage = get().messages.length === 0;

    messageCache[chat.id] = [...(messageCache[chat.id] ?? []), userMsg];
    set((s) => ({
      messages: [...s.messages, userMsg],
      loading: true,
      error: null,
      fallbackNotice: null
    }));

    if (isFirstMessage) {
      const title = generateTitle(text);
      get().renameChat(chat.id, title);
    }

    streamReply(set, get, chat.id, text);
  },

  stopGeneration: () => {
    streamAbort = true;
    stopTimer();
    set({ loading: false, isStreaming: false, streamingMessageId: null });
  },

  regenerateResponse: async (messageId) => {
    const state = get();
    if (state.loading || state.isStreaming) return;
    const index = state.messages.findIndex((m) => m.id === messageId);
    if (index === -1) return;
    // Truncate to the user message that produced this reply, then re-ask.
    const prior = state.messages.slice(0, index);
    const lastUser = [...prior].reverse().find((m) => m.role === "user");
    const kept = prior;
    const chatId = state.currentChat?.id;
    if (!chatId || !lastUser) return;

    messageCache[chatId] = kept;
    set({ messages: kept, loading: true, error: null });
    streamReply(set, get, chatId, lastUser.content);
  },

  editMessageAndRegenerate: async (messageId, newContent) => {
    const state = get();
    if (state.loading || state.isStreaming) return;
    const index = state.messages.findIndex((m) => m.id === messageId);
    if (index === -1) return;
    const chatId = state.currentChat?.id;
    if (!chatId) return;

    const edited: Message = { ...state.messages[index], content: newContent, timestamp: Date.now() };
    const kept = state.messages.slice(0, index + 1).map((m) => (m.id === messageId ? edited : m));
    messageCache[chatId] = kept;
    set({ messages: kept, loading: true, error: null });
    streamReply(set, get, chatId, newContent);
  }
}));

type SetFn = (partial: Partial<ChatStore>) => void;
type GetFn = () => ChatStore;

/** Simulates a streamed assistant reply with realistic timing. */
function streamReply(set: SetFn, get: GetFn, chatId: string, prompt: string): void {
  streamAbort = false;
  const provider = get().provider;
  const model = get().model;
  const full = pickReply(prompt.length + model.length);
  const assistantId = newId();
  const startedAt = Date.now();

  const pushAssistant = (content: string) => {
    const msg: Message = {
      id: assistantId,
      chatId,
      role: "assistant",
      content,
      timestamp: Date.now()
    };
    const existing = messageCache[chatId] ?? [];
    const without = existing.filter((m) => m.id !== assistantId);
    messageCache[chatId] = [...without, msg];
    set({
      messages: [...get().messages.filter((m) => m.id !== assistantId), msg],
      streamingMessageId: assistantId,
      isStreaming: true,
      loading: false
    });
  };

  let cursor = 0;
  let buffer = "";
  let firstChunk = false;

  streamTimer = window.setInterval(() => {
    if (streamAbort) return;

    if (!firstChunk) {
      firstChunk = true;
      pushAssistant("");
      return;
    }

    // Stream ~2-6 characters per tick for a natural typing feel.
    const step = 2 + Math.floor(Math.random() * 5);
    buffer = full.slice(0, Math.min(full.length, cursor + step));
    cursor += step;
    pushAssistant(buffer);

    if (cursor >= full.length) {
      stopTimer();
      const duration = Date.now() - startedAt;
      set({ isStreaming: false, streamingMessageId: null, loading: false });
      const tokens = Math.round(full.length / 4);
      void useUsageStore.getState().recordUsage({
        provider,
        model,
        inputTokens: Math.round(prompt.length / 4),
        outputTokens: tokens,
        totalTokens: Math.round(prompt.length / 4) + tokens,
        responseTime: duration,
        success: true
      });
    }
  }, 26);
}
