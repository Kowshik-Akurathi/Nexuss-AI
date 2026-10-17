/**
 * NexussUIReplica.tsx
 * ---------------------------------------------------------------------------
 * A SINGLE, self-contained source file holding the complete Nexuss internal
 * (authenticated) UI/UX replica: every component, type, hook, store, mock,
 * icon, and stylesheet that previously lived across the replica's source tree.
 *
 * Contents (in source order):
 *   1.  External imports (react, zustand, markdown + syntax highlighting)
 *   2.  Types            (chat, providers, usage, local models, admin)
 *   3.  Utilities        (labels, formatting, escape guard, perf, reasoning)
 *   4.  Mock data        (chats, messages, usage, account, canned replies)
 *   5.  Mock services    (account, api keys, local models, ollama setup)
 *   6.  Hooks            (useChat, keyboard inset, screen share)
 *   7.  Zustand stores   (chat, usage, local models, auth, workspace, terminal)
 *   8.  UI components    (icons, sidebar, composer, messages, settings, modals)
 *   9.  App shell        (sidebar + chat workspace + signed-out card)
 *   10. Embedded design-token stylesheet (<style>) + root export
 *
 * Everything is powered by local mock data: no network calls, no real API keys.
 * Styling uses the replica's Tailwind utility classes (compiled by the host
 * project) plus the embedded base/theme CSS below.
 * ---------------------------------------------------------------------------
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { create } from "zustand";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

/* ──────────────────────────────────────────────────────────── src/types/chats.ts */
interface Chat {
  id: string;
  userId: string;
  title: string;
  provider: ProviderType;
  createdAt: number;
  updatedAt: number;
}

type Role = "user" | "assistant" | "system";

interface Message {
  id: string;
  chatId: string;
  role: Exclude<Role, "system">;
  content: string;
  timestamp: number;
}

interface AIMessage {
  role: Role;
  content: string;
}

interface AppSettings {
  selectedProvider: ProviderType;
}

interface ChatState {
  currentChat: Chat | null;
  chats: Chat[];
  messages: Message[];
  provider: ProviderType;
  model: string;
  loading: boolean;
  error: string | null;
  isStreaming: boolean;
  // Id of the assistant message currently being streamed (added to `messages`
  // as soon as the first chunk arrives and updated in place until completion).
  streamingMessageId: string | null;
  fallbackNotice: string | null;
}

/* ──────────────────────────────────────────────────────────── src/types/providers.ts */
const PROVIDERS = {
  groq: {
    name: "Groq",
    model: "openai/gpt-oss-120b",
    icon: "groq"
  },
  gemini: {
    name: "Gemini",
    model: "gemini-3.6-flash",
    icon: "gemini"
  },
  openrouter: {
    name: "OpenRouter",
    model: "openai/gpt-oss-120b:free",
    icon: "openrouter"
  },
  local: {
    name: "Local",
    model: "",
    icon: "local"
  }
} as const;

type ProviderType = keyof typeof PROVIDERS;

const PROVIDER_LIST: ProviderType[] = ["groq", "gemini", "openrouter", "local"];

interface ProviderModelOption {
  id: string;
  label: string;
  badge?: "FREE" | "FREE*";
}

// Models exposed in the settings UI per provider, with human-readable labels
// and free-tier badges. Must stay in sync with the ALLOWED_MODELS map in
// backend/app/schemas/settings.py.
const PROVIDER_MODEL_OPTIONS: Record<ProviderType, readonly ProviderModelOption[]> = {
  groq: [
    { id: "openai/gpt-oss-20b", label: "GPT-OSS 20B", badge: "FREE" },
    { id: "openai/gpt-oss-120b", label: "GPT-OSS 120B", badge: "FREE" },
    { id: "qwen/qwen3.6-27b", label: "Qwen 3.6 27B", badge: "FREE" },
    { id: "groq/compound", label: "Groq Compound", badge: "FREE" },
    { id: "groq/compound-mini", label: "Groq Compound Mini", badge: "FREE" }
  ],
  gemini: [
    { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash", badge: "FREE*" },
    { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash", badge: "FREE*" },
    { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite", badge: "FREE*" },
    { id: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash-Lite", badge: "FREE*" },
    { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", badge: "FREE*" },
    { id: "gemma-4", label: "Gemma 4", badge: "FREE*" }
  ],
  openrouter: [
    { id: "openai/gpt-oss-120b:free", label: "GPT-OSS 120B", badge: "FREE" },
    { id: "openai/gpt-oss-20b:free", label: "GPT-OSS 20B", badge: "FREE" },
    { id: "nvidia/nemotron-3-ultra:free", label: "Nemotron 3 Ultra", badge: "FREE" },
    { id: "nvidia/nemotron-3-super:free", label: "Nemotron 3 Super", badge: "FREE" },
    { id: "nex-agi/nex-n2-pro:free", label: "Nex-N2-Pro", badge: "FREE" },
    { id: "liquid/lfm2.5-1.2b-instruct:free", label: "LFM2.5 1.2B Instruct", badge: "FREE" },
    { id: "openrouter/free", label: "OpenRouter Free Router", badge: "FREE" }
  ],
  local: []
};

const DEFAULT_PROVIDER_MODELS: Record<ProviderType, string> = {
  groq: "openai/gpt-oss-120b",
  gemini: "gemini-3.6-flash",
  openrouter: "openai/gpt-oss-120b:free",
  local: ""
};

// A provider and model must always be a valid combination: a model from one
// provider is never valid for another, so invalid combos are rejected up front
// instead of being silently rewritten downstream.
// Local models are dynamic and user-specific; validation for "local" is handled
// via the local model store at selection time, but any non-empty model is
// considered syntactically valid here to avoid coupling providers.ts to Zustand
// and to keep the module pure and lint-clean.
function isValidModelForProvider(
  provider: ProviderType,
  model: string
): boolean {
  if (provider === "local") {
    return !!model && model.trim().length > 0;
  }
  return PROVIDER_MODEL_OPTIONS[provider].some((m) => m.id === model);
}

function getModelLabel(
  provider: ProviderType,
  model: string
): string {
  const option = PROVIDER_MODEL_OPTIONS[provider].find((m) => m.id === model);
  if (option) return option.badge ? `${option.label} (${option.badge})` : option.label;
  // For local, return modelId as label
  if (model) return model;
  return model;
}

/* ──────────────────────────────────────────────────────────── src/types/chat.ts */
interface UsageInfo {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
}

interface FallbackAttempt {
  provider: string;
  model: string;
  attempt: number;
  status: "success" | "failed";
  http_status?: number | null;
  reason?: string | null;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  response_time_ms: number;
  timestamp: number;
}

interface ChatResponse {
  reply: string;
  provider: string;
  model: string;
  usage?: UsageInfo;
  fallback_used?: string | null;
  attempts?: FallbackAttempt[];
}

/* ──────────────────────────────────────────────────────────── src/types/usage.ts */
interface UsageRecord {
  id: string;
  userId: string;
  provider: ProviderType;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  responseTime: number;
  timestamp: number;
  success: boolean;
}

interface ProviderSummary {
  provider: ProviderType;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  avgResponseTime: number;
  models: Record<string, ModelSummary>;
}

interface ModelSummary {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  avgResponseTime: number;
}

interface UsageSummary {
  providers: ProviderSummary[];
  totalRequests: number;
  totalTokens: number;
}

/* ──────────────────────────────────────────────────────────── src/types/localModels.ts */
type LocalProviderType = "ollama" | "lmstudio" | "vllm" | "generic";

const LOCAL_PROVIDER_LABELS: Record<LocalProviderType, string> = {
  ollama: "Ollama",
  lmstudio: "LM Studio",
  vllm: "vLLM",
  generic: "Generic OpenAI-compatible",
};

const LOCAL_PROVIDER_DEFAULT_ENDPOINTS: Record<LocalProviderType, string> = {
  ollama: "http://localhost:11434/v1",
  lmstudio: "http://localhost:1234/v1",
  vllm: "http://localhost:8000/v1",
  generic: "http://localhost:8000/v1",
};

interface LocalProvider {
  id: string;
  userId: string;
  name: string;
  providerType: LocalProviderType;
  endpoint: string; // normalized, always ends with /v1
  apiKey?: string; // optional, for authenticated local servers
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

interface LocalModel {
  id: string;
  userId: string;
  providerId: string;
  modelId: string; // as reported by /models, e.g. "llama3.2:3b"
  displayName: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  // Optional metadata from Ollama /api/tags or /v1/models
  size?: number;
  modifiedAt?: number;
  family?: string;
  parameterSize?: string;
  quantization?: string;
}

interface DiscoveredOllamaModel {
  id: string;
  modelId: string;
  size?: number;
  modified?: string;
  modifiedAt?: number;
  family?: string;
  parameterSize?: string;
  quantization?: string;
  created?: number;
}

type LocalHealthStatus = "connected" | "not_connected" | "error" | "disabled";

/** Normalize endpoint: handle Ollama bare host, trailing slash, etc. */
function normalizeEndpoint(input: string, providerType: LocalProviderType = "generic"): string {
  let raw = input.trim();
  if (!raw) return raw;
  // Add scheme if missing
  if (!/^https?:\/\//i.test(raw)) raw = `http://${raw}`;
  try {
    const url = new URL(raw);
    let pathname = url.pathname.replace(/\/+$/, "");
    // Ollama special: bare http://localhost:11434 -> /v1
    if (providerType === "ollama" && (pathname === "" || pathname === "/")) {
      pathname = "/v1";
    } else if (pathname === "") {
      pathname = "/v1";
    } else if (pathname === "/v1") {
      // already correct
    } else if (!pathname.endsWith("/v1")) {
      // If user typed .../v1/models or .../v1/chat/completions, strip to /v1
      if (pathname.includes("/v1")) {
        pathname = pathname.slice(0, pathname.indexOf("/v1") + 3);
      } else if (!pathname.endsWith("/v1")) {
        // keep as is, but ensure /v1 suffix for most cases
        // For generic, if they typed /api or root, leave? We normalize to /v1 only for known local types
        // Do nothing – user knows what they're doing
      }
    }
    // Remove trailing slash except after host
    url.pathname = pathname;
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return raw.replace(/\/+$/, "");
  }
}

function validateEndpoint(input: string): string | null {
  if (!input.trim()) return "Endpoint is required.";
  try {
    const normalized = normalizeEndpoint(input);
    const url = new URL(normalized);
    if (!["http:", "https:"].includes(url.protocol)) return "Endpoint must be http:// or https://";
    if (!url.hostname) return "Invalid endpoint URL.";
    // Block cloud metadata endpoints (SSRF defense, even though we do browser-direct)
    const host = url.hostname.toLowerCase();
    if (host === "169.254.169.254" || host === "metadata.google.internal" || host.endsWith(".internal")) {
      return "Endpoint host is not allowed.";
    }
    return null;
  } catch {
    return "Invalid endpoint URL.";
  }
}

// --- Environment helpers for Ollama local vs production ---

/** True when running inside Nexuss Desktop (Electron) where window.nexussDesktop is exposed. */
function isDesktop(): boolean {
  if (typeof window === "undefined") return false;
  return !!(window as unknown as { nexussDesktop?: unknown }).nexussDesktop;
}

/** True when running on http://localhost:3000 or http://127.0.0.1:3000 (local dev). */
function isLocalDev(): boolean {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

/** True when running on production web (https://www.nexuss.in, https://nexuss.in, https://*.vercel.app). */
function isProductionWeb(): boolean {
  if (typeof window === "undefined") return false;
  if (isDesktop()) return false;
  if (isLocalDev()) return false;
  const protocol = window.location.protocol;
  const host = window.location.hostname;
  // Any https host that is not localhost is considered production web
  if (protocol === "https:") return true;
  // Also treat vercel preview and nexuss.in as production even if http (should not happen)
  if (host.includes("nexuss.in") || host.includes("vercel.app")) return true;
  return false;
}

/** Whether the browser can directly fetch http://localhost:11434 (local dev or desktop). */
function canUseLocalModelsDirect(): boolean {
  if (typeof window === "undefined") return true; // for tests/SSR, allow
  return isDesktop() || isLocalDev();
}

function getLocalModelProductionMessage(): string {
  return "Ollama runs locally on your own machine. Local models are only available when using Nexuss Desktop or running Nexuss locally at http://localhost:3000. Production https://www.nexuss.in cannot directly access your localhost Ollama. Please use Nexuss Desktop or run npm run dev locally to chat with Ollama at http://localhost:11434.";
}

/* ──────────────────────────────────────────────────────────── src/types/admin.ts */
/**
 * TypeScript types mirroring the backend Pydantic schemas in
 * `backend/app/schemas/admin.py`. Field names match the API responses exactly
 * (snake_case), including nullability, so the UI never has to guess.
 */

// ────────────────────────────────────────────── users

type UserRole = "user" | "admin";
type UserStatus = "active" | "blocked";

interface AdminUser {
  id: string;
  email: string;
  name: string;
  photo_url: string | null;
  provider: string;
  role: UserRole;
  status: UserStatus;
  created_at: number;
  updated_at: number;
}

interface AdminUserList {
  items: AdminUser[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
}

interface RoleUpdate {
  role: UserRole;
}

interface DeleteResult {
  status: string;
  id: string;
}

// ────────────────────────────────────────────── analytics

interface AnalyticsPeriod {
  from_ms: number | null;
  to_ms: number | null;
}

interface AnalyticsTotals {
  total_users: number;
  active_users: number;
  total_requests: number;
  successful_requests: number;
  failed_requests: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  requests_today: number;
}

interface AnalyticsSummary {
  period: AnalyticsPeriod;
  totals: AnalyticsTotals;
}

interface AiUsageDaily {
  date: string;
  requests: number;
  successful: number;
  failed: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
}

interface AiUsageBucket {
  key: string;
  requests: number;
  successful: number;
  failed: number;
  total_tokens: number;
}

interface AiUsageResponse {
  period: AnalyticsPeriod;
  filters: Record<string, unknown>;
  totals: AnalyticsTotals;
  series: AiUsageDaily[];
  by_provider: AiUsageBucket[];
  by_model: AiUsageBucket[];
  by_status: AiUsageBucket[];
  by_request_type: AiUsageBucket[];
}

// ────────────────────────────────────────────── feedback

type FeedbackStatus = "new" | "reviewed" | "closed";

interface FeedbackUser {
  id: string;
  email: string;
  name: string;
}

interface AdminFeedback {
  id: string;
  user: FeedbackUser;
  rating: number | null;
  message: string;
  status: FeedbackStatus;
  created_at: number;
}

interface AdminFeedbackList {
  items: AdminFeedback[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
}

interface FeedbackStatusUpdate {
  status: FeedbackStatus;
}

// ────────────────────────────────────────────── settings

type SettingValueType = "string" | "boolean" | "number" | "json";

interface AdminSetting {
  id: string;
  key: string;
  value: string;
  value_type: SettingValueType;
  description: string | null;
  updated_by_email: string | null;
  created_at: number;
  updated_at: number;
}

interface AdminSettingsResponse {
  items: AdminSetting[];
}

interface AdminSettingUpsert {
  key: string;
  value: string;
  value_type: SettingValueType;
  description?: string | null;
}

// ────────────────────────────────────────────── security / audit

interface AuditLogEntry {
  id: string;
  admin_user_id: string | null;
  admin_email: string | null;
  admin_name: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  details: Record<string, unknown> | null;
  ip_address: string | null;
  created_at: number;
}

interface AuditLogList {
  items: AuditLogEntry[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
}

// ────────────────────────────────────────────── misc

interface AdminHealthResponse {
  status: string;
  admin: { email: string; role: string };
  timestamp: number;
}

/* ──────────────────────────────────────────────────────────── src/utils/providerLabels.ts */
const PROVIDER_LABELS: Record<ProviderType, string> = {
  groq: "Groq",
  gemini: "Gemini",
  openrouter: "OpenRouter",
  local: "Local"
};

const PROVIDER_MODELS: Record<ProviderType, string> = {
  groq: "openai/gpt-oss-120b",
  gemini: "gemini-3.6-flash",
  openrouter: "openai/gpt-oss-120b",
  local: ""
};

function generateTitle(firstMessage: string): string {
  const cleaned = firstMessage.trim();
  if (!cleaned) return "New chat";

  const sentences = cleaned.split(/[.!?]/).filter(s => s.trim().length > 0);
  const firstSentence = sentences[0]?.trim() || cleaned;

  const words = firstSentence.split(/\s+/);
  const maxWords = 8;
  const titleWords = words.slice(0, maxWords);
  let title = titleWords.join(" ");

  if (words.length > maxWords || sentences.length > 1 || firstSentence.length > 60) {
    title += "...";
  }

  return title.charAt(0).toUpperCase() + title.slice(1) || "New chat";
}

/* ──────────────────────────────────────────────────────────── src/utils/errorHandler.ts */
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "Something went wrong";
}

/* ──────────────────────────────────────────────────────────── src/utils/escapeGuard.ts */
/**
 * Escape-key arbitration between nested surfaces.
 *
 * The app has several stacked overlays (sidebar drawer, settings modal,
 * profile popover, confirmation dialogs) that each listen for Escape on
 * `window`. Because a parent registers its listener before a child, the
 * parent always sees the key first — so a parent must yield while a nested
 * surface is on screen.
 *
 * Nested surfaces mark their root element with `data-escape-guard` while
 * they are open; parents call this helper before acting on Escape.
 */
const ESCAPE_GUARD_ATTR = "data-escape-guard";

function hasNestedEscapeOverlay(): boolean {
  if (typeof document === "undefined") return false;
  return document.querySelector(`[${ESCAPE_GUARD_ATTR}]`) !== null;
}

/* ──────────────────────────────────────────────────────────── src/utils/format.ts */
/** Shared formatting helpers for the Admin UI. Kept pure for easy testing. */

function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "0";
  return value.toLocaleString("en-US");
}

function formatCompact(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "0";
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

/** Format epoch-milliseconds as a readable date-time (e.g. Aug 12, 2026 • 3:41 PM). */
function formatDateTime(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return "—";
  const d = new Date(ms);
  return (
    d.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    }) +
    " • " +
    d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
  );
}

/** Short date-only form (e.g. Aug 12, 2026). */
function formatDate(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return "—";
  return new Date(ms).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Render a boolean-ish setting value as a friendly label. */
function formatSettingValue(setting: {
  value: string;
  value_type: string;
}): string {
  if (setting.value_type === "boolean") {
    return setting.value === "true" ? "Enabled" : "Disabled";
  }
  return setting.value;
}

/* ──────────────────────────────────────────────────────────── src/utils/localPerf.ts */
// Lightweight performance instrumentation for local model path.
// Only logs in development or when NEXT_PUBLIC_PERF_DEBUG=1.
// All timestamps are performance.now() relative to user submit.

const PERF_ENABLED = typeof process !== "undefined" ? process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_PERF_DEBUG === "1" : false;

interface PerfMark {
  label: string;
  ts: number;
  delta?: number;
}

class PerfTracker {
  private marks: PerfMark[] = [];
  private start: number;
  private enabled: boolean;

  constructor(enabled = PERF_ENABLED) {
    this.enabled = enabled;
    this.start = performance.now();
    this.mark("user_submit");
  }

  mark(label: string) {
    if (!this.enabled) return;
    const ts = performance.now();
    const delta = ts - this.start;
    this.marks.push({ label, ts, delta });
    // Lightweight console log for dev
    console.debug(`[Perf] ${label} +${delta.toFixed(1)}ms`);
  }

  // For TTFT, call when first chunk received
  firstToken(label = "ttft") {
    this.mark(label);
  }

  done(label = "done") {
    this.mark(label);
  }

  getMarks() {
    return this.marks;
  }

  summary() {
    if (!this.enabled || this.marks.length < 2) return null;
    const first = this.marks[0];
    const last = this.marks[this.marks.length - 1];
    const total = last.delta ?? 0;
    const ttftMark = this.marks.find((m) => m.label.includes("ttft") || m.label.includes("first_token"));
    const ttft = ttftMark?.delta ?? null;
    return { total, ttft, marks: this.marks };
  }

  logSummary() {
    if (!this.enabled) return;
    const s = this.summary();
    if (!s) return;
    console.debug(`[Perf] SUMMARY total=${s.total.toFixed(1)}ms ttft=${s.ttft?.toFixed(1) ?? "n/a"}ms marks=${s.marks.map((m) => `${m.label}:${m.delta?.toFixed(0)}`).join(" | ")}`);
  }
}

function perfNow() {
  return performance.now();
}

/* ──────────────────────────────────────────────────────────── src/utils/reasoning.ts */
/**
 * Reasoning-tag filter for model responses.
 *
 * The configured models (notably the Qwen3 vision model `qwen/qwen3.6-27b`
 * and other thinking-capable providers) return their internal chain of thought
 * inline in the reply, delimited by reasoning markers:
 *
 *   thinking
 *   <internal reasoning>
 *   response
 *   <final answer>
 *
 * The markers also appear as angle-bracket tags (`<thinking>`, `</thinking>`,
 * `<response>`, `</response>`) and in case/whitespace variants depending on how
 * the provider serves them.
 *
 * `ReasoningFilter` is a stateful, streaming-safe parser: feed it response
 * chunks with `push()` and it emits only the final-answer portion, maintaining
 * state across chunk boundaries (including markers split across chunks). It
 * never removes the actual answer: only recognized reasoning markup and the
 * text inside a reasoning block are discarded. `filterReasoning` is the
 * convenience wrapper for already-complete responses.
 */

type ReasoningState = "normal" | "thinking";

// Longest possible marker we will hold back while a marker might be arriving
// across chunks (`</thinking>` with extra whitespace). Anything longer cannot
// be a recognized reasoning marker.
const MAX_MARKER = 24;

const ANGLE_MARKER_RE = /<\s*\/?\s*(thinking|think|response)\s*>/i;
// `\r` is included so CRLF line endings (rare but possible in provider output)
// are recognized the same as LF: otherwise a "thinking"/"response" marker on a
// `\r\n` line would not match and the internal reasoning would leak.
const BARE_LINE_MARKER_RE = /^[ \t\r]*(thinking|response)[ \t\r]*$/m;

interface Marker {
  index: number;
  end: number;
  type: "open" | "close";
}

function classifyAngleTag(tag: string): "open" | "close" {
  const closing = /^<\s*\//.test(tag);
  const name = tag.replace(/^<\s*\/?\s*/, "").replace(/\s*>$/, "").toLowerCase();
  if ((name === "thinking" || name === "think") && !closing) return "open";
  return "close";
}

function findCompleteMarker(text: string): Marker | null {
  let best: Marker | null = null;

  const angle = text.match(ANGLE_MARKER_RE);
  if (angle && angle.index !== undefined) {
    best = {
      index: angle.index,
      end: angle.index + angle[0].length,
      type: classifyAngleTag(angle[0])
    };
  }

  const bare = text.match(BARE_LINE_MARKER_RE);
  if (bare && bare.index !== undefined) {
    const type: "open" | "close" =
      bare[1].toLowerCase() === "thinking" ? "open" : "close";
    let end = bare.index + bare[0].length;
    if (text[end] === "\n") end += 1;
    const candidate: Marker = { index: bare.index, end, type };
    if (best === null || candidate.index < best.index) best = candidate;
  }

  return best;
}

function isTagPrefix(candidate: string): boolean {
  // `candidate` starts with `<` and has no closing `>` yet; check that the
  // characters so far could still form a recognized reasoning tag.
  const body = candidate.slice(1);
  const m = /^(\s*)(\/?)(\s*)([a-z]*)(\s*)$/i.exec(body);
  if (!m) return false;
  const letters = m[4].toLowerCase();
  return ["thinking", "think", "response"].some(
    (word) => word.startsWith(letters) && letters.length <= word.length
  );
}

function isBareLinePrefix(line: string): boolean {
  const t = line.trim().toLowerCase();
  if (t === "") return true;
  return (
    (t.length <= "thinking".length && "thinking".startsWith(t)) ||
    (t.length <= "response".length && "response".startsWith(t))
  );
}

/**
 * Return the index in `text` from which the text could still become a marker,
 * or null when nothing is pending.
 */
function partialMarkerAt(text: string): number | null {
  let hold: number | null = null;

  const lt = text.lastIndexOf("<");
  if (lt !== -1) {
    const suffix = text.slice(lt);
    if (!suffix.includes(">") && suffix.length <= MAX_MARKER && isTagPrefix(suffix)) {
      hold = lt;
    }
  }

  const nl = text.lastIndexOf("\n");
  const line = text.slice(nl + 1);
  if (line.length <= MAX_MARKER && isBareLinePrefix(line)) {
    const lineHold = nl + 1;
    hold = hold === null ? lineHold : Math.min(hold, lineHold);
  }

  return hold;
}

const TRAILING_WHITESPACE = /[\t \r\n]+$/;
const LEADING_WHITESPACE = /^[\t \r\n]+/;

// Planning / CoT headings that must never be shown. Matches lines like
// "Strategy: ...", "Draft: ...", "Refine: ..." etc (case-insensitive,
// optional markdown wrapping). They are stripped as reasoning.
const PLANNING_HEADING_RE =
  /^\s*(?:\d+\.\s*)?(?:\*\*|#{1,6}\s*)?\(?\s*(Final Output Generation|Output Generation|Final Polish|Internal instructions?|Prompt text|Planning text|Follow Constraints?|Constraints|Checks?|Thought Process|Final choice|Final answer|Chain[-\s]?of[-\s]?thought|Self[-\s]?Correction|Strategy|Mental|Draft|Refine|Verification|Analysis|Reasoning|Thought|Plan|Decision|Choice|Conclusion|Summary|Result|Ready|Proceeds)\b[^:\n]*?\)?\s*(?::|->)\s*.*$|^\s*\[.*(?:Done|Proceeds).*?\]\s*$|^\s*[-*]?\s*(?:Ready|Proceeds)\.?\s*[✅]*\s*$/im;

function stripPlanningHeadings(text: string): string {
  if (!text || !PLANNING_HEADING_RE.test(text)) return text;
  const rawLines: string[] = [];
  let pos = 0;
  while (pos < text.length) {
    const nl = text.indexOf("\n", pos);
    if (nl === -1) {
      rawLines.push(text.slice(pos));
      break;
    }
    rawLines.push(text.slice(pos, nl + 1));
    pos = nl + 1;
  }
  let lastIdx = -1;
  let lastAfter = "";
  let lastName = "";
  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i].replace(/\r?\n$/, "");
    const m = line.match(PLANNING_HEADING_RE);
    if (m) {
      lastIdx = i;
      if (m[1]) {
        lastName = m[1].trim().toLowerCase();
      } else {
        const low = line.trim().toLowerCase();
        if (low.includes("done")) lastName = "done";
        else if (low.includes("proceeds")) lastName = "proceeds";
        else lastName = "proceeds";
      }
      const arrow = line.indexOf("->");
      const colon = line.indexOf(":");
      if (arrow !== -1 && colon !== -1) {
        if (arrow < colon) lastAfter = line.slice(arrow + 2).replace(/^[ *#\t\r\n"'✅]+/, "").trim();
        else lastAfter = line.slice(colon + 1).replace(/^[ *#\t\r\n"'✅]+/, "").trim();
      } else if (arrow !== -1) {
        lastAfter = line.slice(arrow + 2).replace(/^[ *#\t\r\n"'✅]+/, "").trim();
      } else if (colon !== -1) {
        lastAfter = line.slice(colon + 1).replace(/^[ *#\t\r\n"'✅]+/, "").trim();
      } else {
        lastAfter = "";
      }
    }
  }
  if (lastIdx === -1) return text;
  const remaining = rawLines.slice(lastIdx + 1).join("");
  if (remaining.trim()) {
    let cleaned = remaining.replace(/^\r?\n/, "").trim();
    cleaned = cleaned.replace(/^\s*\d+\.\s*/, "");
    return cleaned;
  }
  const answerHeadings = new Set([
    "output generation",
    "final output generation",
    "final polish",
    "decision",
    "final choice",
    "choice",
    "conclusion",
    "summary",
    "result",
    "final answer",
  ]);
  if (answerHeadings.has(lastName) && lastAfter.trim()) return lastAfter.trim();
  // Keep preamble before first heading if present
  let firstIdx = -1;
  for (let i = 0; i < rawLines.length; i++) {
    if (PLANNING_HEADING_RE.test(rawLines[i].replace(/\r?\n$/, ""))) {
      firstIdx = i;
      break;
    }
  }
  const prefix = firstIdx > 0 ? rawLines.slice(0, firstIdx).join("").trim() : "";
  if (prefix) return prefix;
  if (rawLines.length === 1) return "";
  return answerHeadings.has(lastName) ? lastAfter.trim() : "";
}

function stripFreeformDeliberation(text: string): string {
  if (!text) return text;
  let t = text.replace(/^\s*(?:NEXUSS\s*:?\s*)?:\*\*\s*/i, "").trim();
  t = t.replace(/^\s*:\*\*\s*/, "").trim();
  if (/Let's try|Let's stick|Actually, the user|Final decision|Refined plan|I will say|I will just|Let's go|Wait,|I should respond|I should acknowledge|should respond with|Follow Constraints|Final Output Generation|Respond only with|Never reveal internal|Be helpful and concise|Acknowledge the friendly/i.test(t)) {
    const parts = t.split(/\n\s*\n/);
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      if (!p.trim() || /Let's try|Let's stick|Actually,|Final decision|Refined plan|I will |Wait,|Okay,|I should|Follow Constraints|Final Output Generation|Respond only with|Never reveal|Acknowledge the friendly/i.test(p)) continue;
      const m_q = p.match(/"([^"]*How can I help[^"]*)"/i);
      if (m_q) return m_q[1].trim().replace(/^["']|["']$/g, "").trim();
      const m_q2 = p.match(/"([^"]+)"/);
      if (m_q2 && /Hello|Hi/i.test(m_q2[1]) && !/Let's|Actually|I will|Final decision|Refined plan/i.test(m_q2[1])) return m_q2[1].trim();
      if (/Hello|Hi.*How can I help/i.test(p) && p.trim().length < 120) return p.trim().replace(/^["']|["']$/g, "").trim();
    }
    const quotes = [...t.matchAll(/"([^"]*How can I help[^"]*)"/gi)].map((m) => m[1].trim());
    if (quotes.length) {
      // Prefer last that is not inside deliberation paragraph
      for (let i = quotes.length - 1; i >= 0; i--) {
        const q = quotes[i];
        const idx = t.indexOf(q);
        const paraStart = t.lastIndexOf("\n\n", idx);
        const para = t.slice(paraStart, idx + q.length + 50);
        if (!/Let's try|Actually,|Final decision|Wait,|I should|Follow Constraints|Final Output Generation/i.test(para)) return q.trim().replace(/^["']|["']$/g, "").trim();
      }
      return quotes[quotes.length - 1].trim().replace(/^["']|["']$/g, "").trim();
    }
    const mEx = t.match(/Example:\s*"([^"]+)"/i);
    if (mEx && /As an AI|don't drink coffee|How can I help|Hello! How can I help/i.test(mEx[1])) {
      const after = t.slice((mEx.index ?? 0) + mEx[0].length).trim().replace(/^[\s\d.:\-✅]*/, "");
      if (after && after.length > 20 && !/Acknowledge the friendly|I should respond/i.test(after.slice(0, 80))) {
        if (/As an AI|don't drink coffee|How can I help|Hello!/i.test(after)) {
          const afterClean = after.replace(/^\s*\d+\.\s*/, "").trim().replace(/^["']|["']$/g, "").trim();
          if (afterClean) return afterClean;
        }
      }
      return mEx[1].trim();
    }
    let mLove: RegExpMatchArray | null = null;
    for (const mm of t.matchAll(/I'd love to, but as an AI.*/gi)) mLove = mm as unknown as RegExpMatchArray;
    if (mLove && mLove.index !== undefined) {
      const cand = t.slice(mLove.index).trim().replace(/^["']|["']$/g, "").trim();
      if (cand.length > 20) return cand;
    }
    let last: RegExpMatchArray | null = null;
    for (const mm of t.matchAll(/I(?:'m| am) an AI assistant/gi)) last = mm;
    if (last && last.index !== undefined) return t.slice(last.index).trim().replace(/^:\*\*\s*/, "").trim();
    for (let i = parts.length - 1; i >= 0; i--)
      if (parts[i].trim() && !/Let's try|Let's stick|Actually,|Final decision|Refined plan|I will |Wait,|Okay,|I should|Follow Constraints|Final Output Generation|Respond only with|Never reveal/i.test(parts[i])) {
        const cleaned = parts[i].trim().replace(/^\s*\d+\.\s*/, "");
        if (cleaned) return cleaned;
      }
    if (/Acknowledge the friendly|I should acknowledge/i.test(t)) {
      const mFinal = t.match(/(I'd love to, but as an AI.*|Hello! How can I help.*)/i);
      if (mFinal) return mFinal[1].trim().replace(/^["']|["']$/g, "").trim();
    }
  }
  if (/I need to keep it tight/i.test(t)) {
    let last: RegExpMatchArray | null = null;
    for (const mm of t.matchAll(/I(?:'m| am) an AI assistant designed to be helpful/gi)) last = mm;
    if (last && last.index !== undefined) return t.slice(last.index).trim().replace(/^:\*\*\s*/, "").trim();
    const m3 = t.match(/I(?:'m| am) an AI assistant/i);
    if (m3 && m3.index !== undefined) return t.slice(m3.index).trim();
  }
  if (t.startsWith(":**")) t = t.slice(3).trim();
  return t;
}

class ReasoningFilter {
  private state: ReasoningState = "normal";
  private pending = "";
  private emitted = false;
  private planBuf = "";
  private sawPlanning = false;

  private isPlanPrefix(line: string): boolean {
    if (/:\*\*|I should|Acknowledge the friendly|Follow Constraints|Final Output Generation/i.test(line)) return true;
    let t = line.trim().replace(/^[*#\s\-]+/, "");
    t = t.replace(/^\d+\.\s*/, "").trim();
    t = t.replace(/^[-*]\s*/, "").trim();
    t = t.replace(/^\[|\]$/g, "").trim();
    t = t.toLowerCase();
    if (t === "") return true;
    let first = t.split(":")[0].trim();
    first = first.replace(/\(.*?\)/g, "").trim();
    const candidates = [
      "strategy",
      "mental",
      "draft",
      "refine",
      "self-correction",
      "self correction",
      "verification",
      "analysis",
      "reasoning",
      "chain-of-thought",
      "chain of thought",
      "internal instructions",
      "internal instruction",
      "prompt text",
      "planning text",
      "check against guidelines",
      "checks against guidelines",
      "follow constraints",
      "constraints",
      "final output generation",
      "final polish",
      "output generation",
      "thought process",
      "thought",
      "plan",
      "steps",
      "step",
      "decision",
      "final choice",
      "choice",
      "conclusion",
      "summary",
      "result",
      "final answer",
      "proceeds",
      "done",
    ];
    return candidates.some(
      (c) => c.startsWith(first) && first.length <= c.length || first.startsWith(c)
    ) || candidates.some((c) => first.startsWith(c.split(" ")[0]));
  }

  private planPush(text: string): string {
    if (!text) return "";
    this.planBuf += text;
    if (PLANNING_HEADING_RE.test(this.planBuf)) this.sawPlanning = true;
    if (this.sawPlanning) {
      if (!this.planBuf.includes("\n")) return "";
      return "";
    }
    let out = "";
    while (this.planBuf.includes("\n")) {
      const idx = this.planBuf.indexOf("\n");
      const line = this.planBuf.slice(0, idx + 1);
      this.planBuf = this.planBuf.slice(idx + 1);
      if (PLANNING_HEADING_RE.test(line.replace(/\r?\n$/, ""))) continue;
      if (/:\*\*|I should respond|I should acknowledge|Acknowledge the friendly/i.test(line)) {
        this.sawPlanning = true;
        continue;
      }
      out += line;
    }
    if (this.sawPlanning) {
      if (out) this.planBuf = out + this.planBuf;
      return "";
    }
    if (this.planBuf && this.isPlanPrefix(this.planBuf)) return out;
    if (this.planBuf) {
      const tail = this.planBuf;
      this.planBuf = "";
      return out + tail;
    }
    return out;
  }

  private planFlush(): string {
    if (!this.planBuf) return "";
    const line = this.planBuf;
    this.planBuf = "";
    if (!line.includes("\n")) {
      const m = line.trim().match(PLANNING_HEADING_RE);
      if (m) {
        let name = "";
        if (m[1]) name = m[1].trim().toLowerCase();
        else {
          const low = line.trim().toLowerCase();
          if (low.includes("done")) name = "done";
          else if (low.includes("proceeds")) name = "proceeds";
          else name = "done";
        }
        const answerHeadings = new Set([
          "output generation",
          "final output generation",
          "final polish",
          "decision",
          "final choice",
          "choice",
          "conclusion",
          "summary",
          "result",
          "final answer",
        ]);
        if (!answerHeadings.has(name)) return "";
        const arrow = line.indexOf("->");
        const colon = line.indexOf(":");
        let after = "";
        if (arrow !== -1 && colon !== -1) {
          if (arrow < colon) after = line.slice(arrow + 2).replace(/^[ *#\t\r\n"'✅]+/, "").trim();
          else after = line.slice(colon + 1).replace(/^[ *#\t\r\n"'✅]+/, "").trim();
        } else if (arrow !== -1) {
          after = line.slice(arrow + 2).replace(/^[ *#\t\r\n"'✅]+/, "").trim();
        } else if (colon !== -1) {
          after = line.slice(colon + 1).replace(/^[ *#\t\r\n"'✅]+/, "").trim();
        }
        if (after) return after;
        return "";
      }
    }
    return line;
  }

  /** Feed one response chunk; returns the visible (non-reasoning) portion. */
  push(chunk: string): string {
    this.pending += chunk;
    let out = "";
    let guard = 0;
    while (this.pending.length > 0 && guard++ < 10_000) {
      const result = this.step();
      if (result === "wait") break;
      if (result.length > 0) this.emitted = true;
      out += result;
    }
    return this.planPush(out);
  }

  /** Flush any remaining input (end of stream). Reasoning is never exposed. */
  flush(): string {
    if (this.state === "thinking") {
      this.pending = "";
      let tail = this.planFlush();
      if (this.sawPlanning && /^\s*\d+\.\s*/.test(tail)) tail = tail.replace(/^\s*\d+\.\s*/, "");
      return stripFreeformDeliberation(tail).trim();
    }

    let out = this.pending;
    this.pending = "";

    // The stream ended mid-marker: drop a trailing incomplete reasoning tag
    // and the line break that preceded it.
    const incomplete = /<\s*\/?\s*(thinking|think|response)\s*$/i.exec(out);
    if (incomplete && incomplete.index !== undefined) {
      out = out.slice(0, incomplete.index);
      out = out.replace(TRAILING_WHITESPACE, "");
    }

    // Drop a trailing bare marker line that was never completed (no newline).
    const nl = out.lastIndexOf("\n");
    const lastLine = out.slice(nl + 1).trim().toLowerCase();
    if (lastLine === "thinking" || lastLine === "response") {
      out = nl >= 0 ? out.slice(0, nl) : "";
    }

    if (out.length > 0) this.emitted = true;
    const planTail = this.planFlush();
    const combined = out + planTail;
    let stripped = stripPlanningHeadings(combined);
    if (this.sawPlanning && /^\s*\d+\.\s*/.test(stripped)) stripped = stripped.replace(/^\s*\d+\.\s*/, "");
    const strippedFree = stripFreeformDeliberation(stripped).trim();
    const combinedFree = stripFreeformDeliberation(combined).trim();
    if (strippedFree !== combinedFree && this.emitted) {
      if (strippedFree.length < combinedFree.length) return strippedFree;
    }
    if (strippedFree !== combinedFree) return strippedFree;
    return combinedFree;
  }

  private step(): string | "wait" {
    if (this.pending.length === 0) return "wait";

    if (this.state === "normal") {
      const marker = findCompleteMarker(this.pending);
      if (marker) {
        const markerAtEnd = marker.end === this.pending.length;
        let prefix = this.pending.slice(0, marker.index);
        this.pending = this.pending.slice(marker.end);
        if (marker.type === "open") {
          // Strip the separator before a reasoning block only when it is pure
          // whitespace and nothing has been shown yet (e.g. leading blank lines
          // rendered before the first `thinking` marker).
          if (!this.emitted && prefix.trim() === "") prefix = "";
          // If the stream currently ends right after the open marker, the
          // reasoning never produced content: drop the preceding line break.
          if (markerAtEnd) prefix = prefix.replace(TRAILING_WHITESPACE, "");
          this.state = "thinking";
        } else {
          // A stray reasoning-close boundary: consume the marker and any
          // separator whitespace, but never the answer that follows it.
          this.pending = this.pending.replace(LEADING_WHITESPACE, "");
        }
        return prefix;
      }

      const hold = partialMarkerAt(this.pending);
      if (hold === null) {
        const all = this.pending;
        this.pending = "";
        return all;
      }
      if (hold > 0) {
        let prefix = this.pending.slice(0, hold);
        const ws = TRAILING_WHITESPACE.exec(prefix);
        if (ws && ws.index !== undefined) {
          // Hold back trailing whitespace so a line break preceding an
          // incomplete reasoning tag can still be dropped at flush time.
          prefix = prefix.slice(0, ws.index);
          this.pending = this.pending.slice(ws.index);
        } else {
          this.pending = this.pending.slice(hold);
        }
        if (prefix.length === 0) return "wait";
        return prefix;
      }
      // Everything pending could still become a marker.
      if (this.pending.length > MAX_MARKER) {
        const all = this.pending;
        this.pending = "";
        return all;
      }
      return "wait";
    }

    // THINKING state: discard everything until a close marker completes.
    const close = findCloseMarker(this.pending);
    if (close) {
      this.pending = this.pending.slice(close.end);
      // Skip separator whitespace before the answer.
      this.pending = this.pending.replace(LEADING_WHITESPACE, "");
      this.state = "normal";
      return "";
    }

    const hold = partialMarkerAt(this.pending);
    if (hold === null) {
      this.pending = "";
      return "";
    }
    this.pending = this.pending.slice(hold);
    if (this.pending.length > MAX_MARKER) {
      this.pending = "";
    }
    return "";
  }
}

/** Find the next reasoning CLOSE marker (open markers are ignored while thinking). */
function findCloseMarker(text: string): Marker | null {
  let best: Marker | null = null;

  const angle = text.match(ANGLE_MARKER_RE);
  if (angle && angle.index !== undefined) {
    const type = classifyAngleTag(angle[0]);
    if (type === "close") {
      best = {
        index: angle.index,
        end: angle.index + angle[0].length,
        type
      };
    }
  }

  const bare = text.match(BARE_LINE_MARKER_RE);
  if (bare && bare.index !== undefined) {
    const type: "open" | "close" =
      bare[1].toLowerCase() === "thinking" ? "open" : "close";
    if (type === "close") {
      let end = bare.index + bare[0].length;
      if (text[end] === "\n") end += 1;
      const candidate: Marker = { index: bare.index, end, type };
      if (best === null || candidate.index < best.index) best = candidate;
    }
  }

  return best;
}

/** Strip internal reasoning from a complete model response. */
function filterReasoning(text: string): string {
  const filter = new ReasoningFilter();
  const primary = (filter.push(text) + filter.flush()).trim();
  const afterHeadings = stripPlanningHeadings(primary).trim();
  return stripFreeformDeliberation(afterHeadings).trim();
}

/* ──────────────────────────────────────────────────────────── src/data/mockData.ts */
/**
 * Mock data for the Nexuss design prototype.
 * Nothing here talks to a backend — every screen is fed from these fixtures.
 */

const now = Date.now();
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const MOCK_USER = {
  uid: "mock-uid-001",
  email: "arjun@nexuss.in",
  displayName: "Arjun Mehta"
};

const MOCK_WORKSPACE_NAME = "nexuss-app";

const initialChats: Chat[] = [
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

const initialMessages: Record<string, Message[]> = {
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

const DISCOVERED_OLLAMA_MODELS: DiscoveredOllamaModelDetailed[] = [
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

const MOCK_USAGE_SUMMARY: UsageSummary = {
  providers: usageProviders,
  totalRequests: usageProviders.reduce((n, p) => n + p.requests, 0),
  totalTokens: usageProviders.reduce((n, p) => n + p.totalTokens, 0)
};

const MOCK_ACCOUNT_INFO = {
  email: MOCK_USER.email,
  name: MOCK_USER.displayName,
  created_at: now - 118 * DAY
};

/**
 * Canned assistant replies used to simulate streaming in the prototype.
 */
const MOCK_REPLIES: string[] = [
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

/* ──────────────────────────────────────────────────────────── src/services/account.ts */
/** Mock account service — profile, export and deletion flows (no backend). */

interface AccountInfo {
  email: string;
  name: string;
  created_at: number | null;
}

interface ServerAccountExport {
  account: AccountInfo;
  settings: Record<string, unknown>;
}

type DeletionState = "none" | "queued" | "running" | "retry_wait" | "failed" | "completed";
type DeletionStage = "queued" | "deleting_data" | "removing_auth" | "verifying";

const DELETION_STAGE_LABELS: Record<DeletionStage, string> = {
  queued: "Deletion queued",
  deleting_data: "Removing your data from Nexuss servers",
  removing_auth: "Removing your Firebase sign-in account",
  verifying: "Verifying that nothing was left behind"
};

interface DeletionStatus {
  state: DeletionState;
  stage: DeletionStage | null;
  attempt: number;
  next_attempt_at: number | null;
  last_error: string | null;
  detail: string | null;
}

const NO_DELETION: DeletionStatus = {
  state: "none",
  stage: null,
  attempt: 1,
  next_attempt_at: null,
  last_error: null,
  detail: null
};

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function getAccountInfo(): Promise<AccountInfo> {
  return delay(300).then(() => MOCK_ACCOUNT_INFO);
}

function fetchServerExport(): Promise<ServerAccountExport> {
  return delay(500).then(() => ({
    account: MOCK_ACCOUNT_INFO,
    settings: { theme: "dark", provider: "groq", model: "openai/gpt-oss-120b" }
  }));
}

function getDeletionStatus(): Promise<DeletionStatus> {
  return delay(200).then(() => NO_DELETION);
}

type FirebaseUserLike = {
  providerData?: Array<{ providerId: string }> | null;
} | null;

function getReauthMethod(user: FirebaseUserLike): "password" | "popup" {
  const providers = user?.providerData?.map((entry) => entry.providerId) ?? [];
  return providers.includes("password") ? "password" : "popup";
}

async function reauthenticateWithPassword(password: string): Promise<void> {
  await delay(500);
  if (password.length < 4) throw new Error("The password you entered is incorrect.");
}

async function reauthenticateWithGoogle(): Promise<void> {
  await delay(500);
}

async function startAccountDeletion(): Promise<DeletionStatus> {
  await delay(600);
  return { ...NO_DELETION, state: "queued" };
}

function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ──────────────────────────────────────────────────────────── src/services/accountData.ts */
/** Mock local account-data helpers used by the Account screen. */

async function gatherLocalAccountExport(_uid: string): Promise<Record<string, unknown>> {
  return { chats: [], messages: [], note: "Prototype export — no local database is attached." };
}

async function purgeLocalAccountData(_uid: string): Promise<void> {
  return Promise.resolve();
}

/* ──────────────────────────────────────────────────────────── src/services/api.ts */
/** No-op stand-ins for the prototype's HTTP layer. */

function clearAuthCache(): void {
  /* intentionally empty */
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  void path;
  void init;
  throw new Error("The prototype does not talk to a backend.");
}

/* ──────────────────────────────────────────────────────────── src/services/apiKeys.ts */
/**
 * Mock API-key service.
 * Keys are never persisted anywhere — the prototype only tracks "connected"
 * status in memory so the API Keys screen shows realistic states.
 */

interface ApiKeyStatus {
  provider: string;
  has_key: boolean;
  updatedAt: number;
}

interface ApiKeyTestResult {
  valid: boolean;
  message: string;
}

const connected: Record<string, ApiKeyStatus> = {
  groq: { provider: "groq", has_key: true, updatedAt: Date.now() - 6 * 86_400_000 },
  gemini: { provider: "gemini", has_key: false, updatedAt: 0 },
  openrouter: { provider: "openrouter", has_key: true, updatedAt: Date.now() - 2 * 86_400_000 }
};


const apiKeyService = {
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

/* ──────────────────────────────────────────────────────────── src/services/localModels.ts */
/**
 * Mocked local-model service layer.
 * In the real app this talks to Ollama / LM Studio / vLLM directly from the
 * browser. Here everything resolves from fixtures after a short delay so the
 * UI states (checking, connected, failed) stay realistic.
 */

interface DiscoveredOllamaModelDetailed {
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

interface OllamaPullProgress {
  status: string;
  completed?: number;
  total?: number;
  percent?: number;
  bytesPerSecond?: number;
}

interface LocalEndpointTestResult {
  ok: boolean;
  endpointReachable?: boolean;
  models?: string[];
}


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
async function testLocalEndpoint(
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

async function discoverOllamaModelsDetailed(
  _endpoint?: string
): Promise<DiscoveredOllamaModelDetailed[]> {
  await delay(500);
  return DISCOVERED_OLLAMA_MODELS;
}

async function verifyLocalChat(
  _endpoint: string,
  _modelId: string
): Promise<{ ok: boolean; message?: string }> {
  await delay(900);
  return { ok: true };
}

/* ──────────────────────────────────────────────────────────── src/services/localModelSelection.ts */
/**
 * Selects a local model through the same path Settings → Models uses:
 * persists it (best effort) and updates the chat provider/model state.
 */
async function selectLocalModel(modelId: string): Promise<void> {
  const local = useLocalModelStore.getState();
  const owner = local.providers.find((p) =>
    local.models.some((m) => m.providerId === p.id && m.modelId === modelId)
  );

  const chat = useChatStore.getState();
  if (chat.provider !== "local") chat.setProvider("local");
  chat.setModel(modelId);
  local.setSelectedModel(modelId);

  if (owner) local.setActiveProviderId(owner.id);
}

/* ──────────────────────────────────────────────────────────── src/services/modelCatalogue.ts */
// Configurable catalogue of Ollama models Nexuss can set up automatically,
// plus the device-aware recommendation rules used by the local AI setup flow.
//
// Nothing here is hardcoded to a single model: the catalogue is a plain data
// list (easy to extend) and every recommendation is derived from the device
// information we could actually read. When hardware information is not
// available in the browser we never invent it — recommendations are returned
// with `estimated: true` so the UI can label them as estimates.

const GB = 1024 ** 3;

type ModelTier = "lightweight" | "balanced" | "capable";

interface CatalogueModel {
  /** Ollama model id used with the pull API. */
  id: string;
  label: string;
  tier: ModelTier;
  /** Parameter count as displayed, e.g. "3B". */
  params: string;
  /** Numeric parameter count for memory maths. */
  paramCount: number;
  /** Quantization used for the approximate download size. */
  quant: string;
  /** Approximate download size in bytes (registry metadata may differ slightly). */
  downloadBytes: number;
  /** Conservative minimum recommended RAM in bytes. */
  ramBytes: number;
  /** Intended workload. */
  use: string;
}

/**
 * Default recommendation catalogue. Approximate sizes are registry
 * approximations and are always shown to the user before a download starts.
 */
const OLLAMA_MODEL_CATALOGUE: CatalogueModel[] = [
  {
    id: "qwen2.5:0.5b",
    label: "Qwen 2.5 0.5B",
    tier: "lightweight",
    params: "0.5B",
    paramCount: 0.5e9,
    quant: "Q4_K_M",
    downloadBytes: Math.round(0.4 * GB),
    ramBytes: 2 * GB,
    use: "Lightweight assistance on any device",
  },
  {
    id: "qwen2.5:3b",
    label: "Qwen 2.5 3B",
    tier: "balanced",
    params: "3B",
    paramCount: 3e9,
    quant: "Q4_K_M",
    downloadBytes: Math.round(1.9 * GB),
    ramBytes: 6 * GB,
    use: "General chat and everyday tasks",
  },
  {
    id: "qwen2.5-coder:3b",
    label: "Qwen 2.5 Coder 3B",
    tier: "balanced",
    params: "3B",
    paramCount: 3e9,
    quant: "Q4_K_M",
    downloadBytes: Math.round(1.9 * GB),
    ramBytes: 6 * GB,
    use: "Coding, refactors and code review",
  },
  {
    id: "llama3.1:8b",
    label: "Llama 3.1 8B",
    tier: "capable",
    params: "8B",
    paramCount: 8e9,
    quant: "Q4_K_M",
    downloadBytes: Math.round(4.9 * GB),
    ramBytes: 12 * GB,
    use: "Higher-quality reasoning and writing",
  },
];

interface DeviceProfile {
  /** Physical RAM in GB when the browser exposes it, otherwise null. */
  ramGB: number | null;
  /** Approximate free disk space in bytes when it can be estimated. */
  freeDiskBytes: number | null;
  /** Coarse OS label derived from the user agent. */
  os: string | null;
}

/** Fraction of RAM a model may need to be recommended without caveats. */
const RAM_BUDGET_FACTOR = 0.75;
/** Fraction of free disk a download may occupy. */
const DISK_BUDGET_FACTOR = 0.9;

/**
 * Read whatever device information the browser actually exposes.
 * `navigator.deviceMemory` is coarse (and capped) and the storage estimate is
 * origin-scoped — both are used conservatively and reported as estimates.
 */
async function getDeviceProfile(): Promise<DeviceProfile> {
  const nav: Navigator | undefined = typeof navigator === "undefined" ? undefined : navigator;
  let ramGB: number | null = null;
  const deviceMemory = nav ? (nav as Navigator & { deviceMemory?: number }).deviceMemory : undefined;
  if (typeof deviceMemory === "number" && Number.isFinite(deviceMemory) && deviceMemory > 0) {
    ramGB = deviceMemory;
  }

  let freeDiskBytes: number | null = null;
  try {
    const estimate = await nav?.storage?.estimate?.();
    if (estimate && typeof estimate.quota === "number" && typeof estimate.usage === "number") {
      const free = estimate.quota - estimate.usage;
      if (free > 0) freeDiskBytes = free;
    }
  } catch {
    // Storage estimate unavailable — stay conservative with null.
  }

  const ua = nav?.userAgent ?? "";
  let os: string | null = null;
  if (/Windows/i.test(ua)) os = "Windows";
  else if (/Android/i.test(ua)) os = "Android";
  else if (/iPhone|iPad|iPod/i.test(ua)) os = "iOS";
  else if (/Mac OS X|Macintosh/i.test(ua)) os = "macOS";
  else if (/Linux/i.test(ua)) os = "Linux";

  return { ramGB, freeDiskBytes, os };
}

/** Parse Ollama parameter sizes like "7.6B", "13B", "0.5B" into a number. */
function parseParamCount(raw?: string): number | null {
  if (!raw) return null;
  const m = /^\s*(\d+(?:\.\d+)?)\s*([KMB])?\s*$/i.exec(raw);
  if (!m) return null;
  const value = Number(m[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  const unit = (m[2] ?? "B").toUpperCase();
  const factor = unit === "B" ? 1e9 : unit === "M" ? 1e6 : 1e3;
  return value * factor;
}

/**
 * Conservative in-memory footprint for a quantized (Q4-class) model:
 * roughly one byte per parameter plus a gigabyte of runtime overhead.
 */
function estimateRamBytes(opts: {
  paramCount?: number | null;
  sizeBytes?: number | null;
}): number | null {
  if (opts.paramCount && opts.paramCount > 0) {
    return Math.round(opts.paramCount + 0.5 * GB);
  }
  if (opts.sizeBytes && opts.sizeBytes > 0) {
    // Q4 disk size ≈ memory size; add headroom for the runtime.
    return Math.round(opts.sizeBytes * 1.15 + 0.5 * GB);
  }
  return null;
}

function ramBudgetBytes(device: DeviceProfile): number | null {
  if (device.ramGB == null || device.ramGB <= 0) return null;
  return device.ramGB * GB * RAM_BUDGET_FACTOR;
}

/** Catalogue models that comfortably fit the device, best tiers included. */
function compatibleCatalogueModels(device: DeviceProfile): CatalogueModel[] {
  const budget = ramBudgetBytes(device);
  const diskBudget =
    device.freeDiskBytes != null ? device.freeDiskBytes * DISK_BUDGET_FACTOR : null;
  const filtered = OLLAMA_MODEL_CATALOGUE.filter((m) => {
    if (budget != null && m.ramBytes > budget) return false;
    if (diskBudget != null && m.downloadBytes > diskBudget) return false;
    return true;
  });
  // Everything was filtered out (very small device): fall back to the
  // lightest options rather than showing an empty list.
  if (filtered.length === 0) {
    return [...OLLAMA_MODEL_CATALOGUE].sort((a, b) => a.ramBytes - b.ramBytes).slice(0, 2);
  }
  return filtered;
}

interface Recommendation {
  model: CatalogueModel;
  /** True when hardware info was missing or tight — label it as an estimate. */
  estimated: boolean;
  reason: string;
}

const TIER_RANK: Record<ModelTier, number> = { lightweight: 0, balanced: 1, capable: 2 };

/**
 * Pick the most capable catalogue model that fits the device.
 * With unknown hardware the conservative default (small balanced model) is
 * chosen and flagged as an estimate.
 */
function recommendCatalogueModel(device: DeviceProfile): Recommendation {
  const pool = compatibleCatalogueModels(device);

  if (device.ramGB == null) {
    const balanced = pool
      .filter((m) => m.tier === "balanced")
      .sort((a, b) => a.ramBytes - b.ramBytes);
    const model = balanced[0] ?? [...pool].sort((a, b) => a.ramBytes - b.ramBytes)[0];
    return {
      model,
      estimated: true,
      reason: "We couldn't read this device's exact specs — this is a conservative estimate.",
    };
  }

  if (device.ramGB > 0 && pool.every((m) => m.ramBytes > device.ramGB! * GB * RAM_BUDGET_FACTOR)) {
    // Should be rare thanks to the fallback in compatibleCatalogueModels.
    const lightest = [...pool].sort((a, b) => a.ramBytes - b.ramBytes)[0];
    return {
      model: lightest,
      estimated: true,
      reason: `Your device has about ${device.ramGB} GB of memory — this is the lightest option.`,
    };
  }

  const best = [...pool].sort((a, b) => {
    const tier = TIER_RANK[b.tier] - TIER_RANK[a.tier];
    if (tier !== 0) return tier;
    return b.ramBytes - a.ramBytes;
  })[0];

  return {
    model: best,
    estimated: false,
    reason: `Fits your device's ~${device.ramGB} GB of memory.`,
  };
}

interface InstalledModelMeta {
  modelId: string;
  size?: number;
  parameterSize?: string;
}

/**
 * Recommend one of the *already installed* models using its real metadata
 * (parameter count or size) against the device profile. Never downloads
 * anything — if a suitable model exists, the user should just use it.
 */
function recommendInstalledModel(
  models: InstalledModelMeta[],
  device: DeviceProfile
): { modelId: string; estimated: boolean } | null {
  if (models.length === 0) return null;

  const budget = ramBudgetBytes(device);
  const withNeed = models.map((m) => {
    const paramCount = parseParamCount(m.parameterSize);
    return { ...m, need: estimateRamBytes({ paramCount, sizeBytes: m.size ?? null }) };
  });

  if (budget == null) {
    // Unknown hardware: conservative pick is the lightest model.
    const sorted = [...withNeed].sort((a, b) => (a.need ?? Infinity) - (b.need ?? Infinity));
    return { modelId: sorted[0].modelId, estimated: true };
  }

  const fitting = withNeed
    .filter((m) => m.need != null && m.need <= budget)
    .sort((a, b) => (b.need ?? 0) - (a.need ?? 0));
  if (fitting.length > 0) {
    return { modelId: fitting[0].modelId, estimated: false };
  }

  // Nothing fits comfortably: offer the lightest and flag it.
  const sorted = [...withNeed].sort((a, b) => (a.need ?? Infinity) - (b.need ?? Infinity));
  return { modelId: sorted[0].modelId, estimated: true };
}

/** Human-readable byte size for setup cards and progress. */
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes >= GB) {
    const gb = bytes / GB;
    return `${gb >= 10 ? gb.toFixed(0) : gb.toFixed(1)} GB`;
  }
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

/* ──────────────────────────────────────────────────────────── src/services/ollamaSetup.ts */
/**
 * Mocked local-AI setup detection.
 * The real implementation probes Ollama through the local connector; the
 * prototype always reports "Ollama running with models installed" so the
 * primary setup path is reviewable. Toggle `MOCK_DETECTION_STATE` to walk the
 * other screens (not installed / stopped / no models / unknown).
 */

type SetupDetectionState =
  | "models"
  | "no_models"
  | "stopped"
  | "not_installed"
  | "unknown";

type SetupDetectionReason = "connector_unreachable" | "timeout" | "blocked";
type SetupDetectionVia = "connector" | "direct" | "desktop";

interface SetupDetection {
  state: SetupDetectionState;
  models?: DiscoveredOllamaModelDetailed[];
  installed?: boolean;
  reason?: SetupDetectionReason;
  via: SetupDetectionVia;
}

/** Change this to preview a different setup state. */
const MOCK_DETECTION_STATE: SetupDetectionState = "models";


async function detectOllamaSetup(
  _opts?: { endpoint?: string }
): Promise<SetupDetection> {
  await delay(750);
  if (MOCK_DETECTION_STATE === "models") {
    return { state: "models", models: DISCOVERED_OLLAMA_MODELS, installed: true, via: "connector" };
  }
  if (MOCK_DETECTION_STATE === "no_models") {
    return { state: "no_models", models: [], installed: true, via: "connector" };
  }
  if (MOCK_DETECTION_STATE === "stopped") {
    return { state: "stopped", installed: true, via: "connector" };
  }
  if (MOCK_DETECTION_STATE === "not_installed") {
    return { state: "not_installed", installed: false, via: "connector" };
  }
  return { state: "unknown", reason: "connector_unreachable", via: "connector" };
}

function unknownReasonCopy(reason?: SetupDetectionReason): string {
  switch (reason) {
    case "timeout":
      return "Checking your device timed out.";
    case "connector_unreachable":
      return "Nexuss couldn't reach Ollama on this device.";
    default:
      return "We couldn't check your device.";
  }
}

function friendlySetupError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  if (/fetch|network|Failed to fetch|ECONNREFUSED/i.test(raw)) {
    return "Couldn't reach Ollama. Make sure it's running and try again.";
  }
  if (/abort|timed? ?out/i.test(raw)) {
    return "The request timed out. Check that Ollama is running and try again.";
  }
  if (raw.length > 160) return "Something went wrong during setup. Please try again.";
  return raw;
}

/* ──────────────────────────────────────────────────────────── src/hooks/useChat.ts */
function useChat() {
  const currentChat = useChatStore((s) => s.currentChat);
  const messages = useChatStore((s) => s.messages);
  const loading = useChatStore((s) => s.loading);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const streamingMessageId = useChatStore((s) => s.streamingMessageId);
  const error = useChatStore((s) => s.error);
  const sendMessageStream = useChatStore((s) => s.sendMessageStream);
  const stopGeneration = useChatStore((s) => s.stopGeneration);
  const editMessageAndRegenerate = useChatStore((s) => s.editMessageAndRegenerate);
  const regenerateResponse = useChatStore((s) => s.regenerateResponse);
  const createNewChat = useChatStore((s) => s.createNewChat);
  const clearError = useChatStore((s) => s.clearError);
  const theme = useChatStore((s) => s.theme);
  const setTheme = useChatStore((s) => s.setTheme);
  const provider = useChatStore((s) => s.provider);
  const model = useChatStore((s) => s.model);
  const setProvider = useChatStore((s) => s.setProvider);
  const setModel = useChatStore((s) => s.setModel);

  return {
    currentChat,
    messages,
    loading,
    isStreaming,
    streamingMessageId,
    error,
    theme,
    setTheme,
    provider,
    model,
    setProvider,
    setModel,
    sendMessageStream,
    stopGeneration,
    editMessageAndRegenerate,
    regenerateResponse,
    createNewChat,
    clearError
  };
}

/* ──────────────────────────────────────────────────────────── src/hooks/useKeyboardInset.ts */
"use client";


/**
 * Tracks how much of the layout viewport is currently covered by the on-screen
 * keyboard, in pixels.
 *
 * The software keyboard shrinks the *visual* viewport but not the layout
 * viewport on iOS Safari, so a fixed-height chat layout would otherwise hide
 * the composer behind the keyboard. On Chrome for Android the layout viewport
 * already resizes (`interactive-widget=resizes-content`), so the gap is ~0 and
 * no extra offset is applied. Returns 0 on desktop and when visualViewport is
 * unavailable.
 */
function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined" || !window.visualViewport) return;
    const vv = window.visualViewport;

    const update = () => {
      const gap = window.innerHeight - vv.height;
      setInset(gap > 0 ? gap : 0);
    };

    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    update();

    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  return inset;
}

/* ──────────────────────────────────────────────────────────── src/hooks/useScreenShare.ts */
interface UseScreenShare {
  /** Whether a live screen share is currently active. */
  isActive: boolean;
  /** True while the native screen/window selector is open. */
  isStarting: boolean;
  /**
   * Whether the current browser/device can actually capture the screen (the
   * native getDisplayMedia API exists, which browsers only expose in secure
   * contexts). On browsers/devices without it (e.g. iOS Safari) we never fake
   * support — the UI surfaces a clear explanation instead.
   */
  supported: boolean;
  /** User-friendly error message (cancelled, denied, unsupported, ...). */
  error: string | null;
  clearError: () => void;
  /** Label of the currently selected source (from the stream track). */
  selectedSourceName: string | null;
  /** Whether the details section is expanded. */
  isExpanded: boolean;
  setExpanded: (value: boolean) => void;
  /**
   * Callback ref attached to the <video> element rendering the live preview.
   * Fires whenever the element mounts/unmounts so the still-live MediaStream is
   * reattached after the preview is hidden and shown again.
   */
  videoRef: (node: HTMLVideoElement | null) => void;
  startSharing: () => Promise<boolean>;
  stopSharing: () => void;
  changeScreen: () => Promise<void>;
  /** Capture exactly one current frame from the live preview. */
  captureFrame: () => string | null;
}

const MAX_FRAME_DIMENSION = 1280;

/**
 * Live screen sharing for the chatboard.
 *
 * The MediaStream stays in the browser and only feeds a local <video> preview.
 * No frames are sent anywhere automatically: `captureFrame` is invoked exactly
 * once per user question by the chat send path. Every track is stopped on
 * cleanup, on external termination (browser/OS controls), and on unmount.
 */
function useScreenShare(): UseScreenShare {
  const videoElementRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [isActive, setIsActive] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedSourceName, setSelectedSourceName] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  // Computed once. `getDisplayMedia` is only ever exposed in secure contexts,
  // so its mere presence is the honest capability signal: browsers/devices
  // without it (e.g. iOS Safari) cannot capture the screen, and we never fake
  // support.
  const [supported] = useState(
    () =>
      typeof window !== "undefined" &&
      typeof navigator !== "undefined" &&
      !!navigator.mediaDevices?.getDisplayMedia
  );

  const clearError = useCallback(() => setError(null), []);

  // Attach the persistent MediaStream to whatever <video> element is current.
  // The stream is the source of truth; the element is only a visual consumer.
  // Idempotent, so it is safe to run on every mount/re-render path.
  const attachStream = useCallback((video: HTMLVideoElement | null) => {
    if (!video) return;
    const stream = streamRef.current;
    if (!stream) return;
    video.srcObject = stream;
    video.muted = true;
    video.autoplay = true;
    video.playsInline = true;
    void video.play().catch(() => {});
  }, []);

  // Callback ref: connect the stream whenever the preview element mounts, and
  // clear the internal pointer when it unmounts (e.g. details collapsed). The
  // stream itself is never touched here, so collapse/expand is a pure UI action.
  const videoRef = useCallback(
    (video: HTMLVideoElement | null) => {
      videoElementRef.current = video;
      attachStream(video);
    },
    [attachStream]
  );

  const cleanupStream = useCallback(() => {
    const stream = streamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }
    streamRef.current = null;
    const video = videoElementRef.current;
    if (video) {
      video.srcObject = null;
    }
    setIsActive(false);
    setSelectedSourceName(null);
  }, []);

  // Connect the active stream to the preview <video> element. Runs when the
  // stream is adopted/replaced while the element is already mounted (the
  // callback ref above already covers the element-mount case).
  useEffect(() => {
    attachStream(videoElementRef.current);
  }, [isActive, attachStream]);

  // Detect external termination (browser/OS "Stop sharing" controls). When the
  // video track ends, release the stream and reset state without touching the
  // chat session, so the user can start sharing again.
  useEffect(() => {
    const stream = streamRef.current;
    if (!stream) return;
    const tracks = stream.getVideoTracks();
    const handleEnded = () => cleanupStream();
    tracks.forEach((track) => track.addEventListener("ended", handleEnded));
    return () => {
      tracks.forEach((track) => track.removeEventListener("ended", handleEnded));
    };
  }, [isActive, cleanupStream]);

  const stopSharing = useCallback(() => {
    cleanupStream();
  }, [cleanupStream]);

  // Restore Nexuss as the active UI after the native picker resolves. The
  // browser/OS may briefly activate the selected source (tab/window/screen).
  // This is a browser/platform behavior outside JS control; we can only make
  // a best-effort request to re-focus our window. The stream itself is never
  // affected — capture continues in the background regardless of focus.
  const restoreNexussFocus = useCallback(() => {
    // Best-effort synchronous focus restore. Browsers may have moved
    // activation to the picked tab/window during the native picker — this
    // is platform behavior, not Nexuss code. window.focus() is the only
    // spec-compliant way to request focus back; it never navigates and never
    // touches the MediaStream. If the platform denies it (no transient
    // activation), the stream still continues in the background.
    if (typeof window !== "undefined" && typeof window.focus === "function") {
      try {
        window.focus();
      } catch {
        // Ignore — focus may be denied without transient activation.
      }
    }
    // Ensure the document regains hasFocus where possible; jsdom returns
    // false until focused, real browsers return true after window.focus().
    if (typeof document !== "undefined" && document.hasFocus?.() === false) {
      try {
        // No navigation: just nudge focus to body if nothing else is focused
        const active = document.activeElement as HTMLElement | null;
        if (!active || active === document.body) {
          (document.body as HTMLElement).focus?.();
        }
      } catch {}
    }
  }, []);

  // Open the browser's native screen/window/tab selector. We never build our
  // own fake list of windows: the OS/browser controls source selection.
  const openPicker = useCallback(async (): Promise<MediaStream | null> => {
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getDisplayMedia
    ) {
      setError(
        "Screen sharing is not supported by this browser/device. Please use a supported desktop browser for screen sharing."
      );
      return null;
    }
    try {
      // Use the smallest safe modern option set. `video:true` is the only
      // required constraint; the remaining hints are optional best-effort
      // flags supported by Chrome/Edge (ignored by Firefox/Safari):
      // - preferCurrentTab:false keeps the chooser unbiased (user may pick any
      //   tab/window/screen, including the current tab).
      // - selfBrowserSurface:"include" allows capturing the current tab if the
      //   user wants it, without forcing it.
      // - surfaceSwitching:"include" lets the user switch sources via the
      //   browser's "Share this tab instead" button without a new prompt.
      // - systemAudio:"exclude" and monitorTypeSurfaces:"include" preserve the
      //   existing audio/screen defaults.
      // None of these trigger navigation — the track label is surfaced only as
      // UI text and is never used as a navigation target.
      return await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
        // Modern Chrome options (cast to any for cross-browser TS compat)
        ...({
          preferCurrentTab: false,
          selfBrowserSurface: "include",
          systemAudio: "exclude",
          surfaceSwitching: "include",
          monitorTypeSurfaces: "include"
        } as unknown as MediaStreamConstraints)
      } as MediaStreamConstraints);
    } catch {
      // The user cancelled the picker or the browser/OS denied permission.
      // This is an expected outcome, not an app error: stay quiet so no
      // scary message appears and sharing simply remains off.
      return null;
    }
  }, []);

  const adoptStream = useCallback(
    (stream: MediaStream) => {
      cleanupStream();
      streamRef.current = stream;
      const track = stream.getVideoTracks()[0];
      setSelectedSourceName(track?.label ?? null);
      setIsActive(true);
      setIsExpanded(true);
      clearError();
      // Best-effort: bring Nexuss back to foreground after selection.
      // Capture continues in background; this never touches the stream.
      restoreNexussFocus();
    },
    [cleanupStream, clearError, restoreNexussFocus]
  );

  const startSharing = useCallback(async (): Promise<boolean> => {
    setIsStarting(true);
    setError(null);
    try {
      const stream = await openPicker();
      if (!stream) return false;
      adoptStream(stream);
      return true;
    } finally {
      setIsStarting(false);
      // If picker was cancelled or denied we still ensure Nexuss retains focus
      // (adoptStream already restores on success; this covers the no-stream
      // path and any browser that moved focus during the picker).
      restoreNexussFocus();
    }
  }, [openPicker, adoptStream, restoreNexussFocus]);

  const changeScreen = useCallback(async () => {
    cleanupStream();
    await startSharing();
    restoreNexussFocus();
  }, [cleanupStream, startSharing, restoreNexussFocus]);

  // Capture ONE current frame from the live preview. Downscaled JPEG keeps the
  // payload small; the frame is transient and never stored. Each call reads the
  // live video at that moment and builds a fresh temporary canvas, so it is a
  // fully reusable operation that never consumes the stream, video, or ref.
  const captureFrame = useCallback((): string | null => {
    const video = videoElementRef.current;
    if (!video || !streamRef.current) return null;
    if (
      video.videoWidth === 0 ||
      video.videoHeight === 0 ||
      video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
    ) {
      return null;
    }

    const scale = Math.min(
      1,
      MAX_FRAME_DIMENSION / Math.max(video.videoWidth, video.videoHeight)
    );
    const width = Math.max(1, Math.round(video.videoWidth * scale));
    const height = Math.max(1, Math.round(video.videoHeight * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.drawImage(video, 0, 0, width, height);
    try {
      return canvas.toDataURL("image/jpeg", 0.72);
    } catch {
      return null;
    }
  }, []);

  // Unmount cleanup: never leave the screen stream running in the background.
  useEffect(() => {
    return () => {
      const stream = streamRef.current;
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
      streamRef.current = null;
    };
  }, []);

  return {
    isActive,
    isStarting,
    supported,
    error,
    selectedSourceName,
    isExpanded,
    setExpanded: setIsExpanded,
    videoRef,
    startSharing,
    stopSharing,
    changeScreen,
    captureFrame,
    clearError
  };
}

/* ──────────────────────────────────────────────────────────── src/store/usageStore.ts */
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

const useUsageStore = create<UsageStore>((set, get) => ({
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

/* ──────────────────────────────────────────────────────────── src/store/chatStore.ts */
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

function newChatId(): string {
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

const useChatStore = create<ChatStore>((set, get) => ({
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
      id: newChatId(),
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
      id: newChatId(),
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
  const assistantId = newChatId();
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

/* ──────────────────────────────────────────────────────────── src/store/localModelStore.ts */
/**
 * Mock local-model store. Mirrors the shape of the real Nexuss store so the
 * Models settings screen and the composer's model picker behave identically,
 * but everything lives in memory only.
 */

interface OllamaPullTask {
  model: string;
  status: "pulling" | "completed" | "failed" | "cancelled";
  error?: string;
}

function newLocalId(): string {
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

const useLocalModelStore = create<LocalModelState>((set, get) => ({
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
      id: newLocalId(),
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
      id: newLocalId(),
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

/* ──────────────────────────────────────────────────────────── src/store/useAuthStore.ts */
/**
 * Mock auth store. The prototype always starts inside the authenticated app;
 * "Log out" only flips this flag so the signed-out transition can be reviewed
 * (there is no sign-in screen in this prototype — see README).
 */

interface MockUser {
  uid: string;
  email: string;
  displayName: string;
  providerData?: Array<{ providerId: string }>;
}

interface AuthState {
  user: MockUser | null;
  idToken: string | null;
  loading: boolean;
  initialized: boolean;
  setUser: (user: MockUser | null) => void;
  signOut: () => Promise<void>;
}

const useAuthStore = create<AuthState>((set) => ({
  user: { ...MOCK_USER, providerData: [{ providerId: "password" }] },
  idToken: "mock-token",
  loading: false,
  initialized: true,
  setUser: (user) => set({ user, loading: false }),
  signOut: async () => set({ user: null, idToken: null })
}));

/* ──────────────────────────────────────────────────────────── src/workspace/store.ts */
/**
 * Minimal mock workspace store: only what the chat shell needs (the terminal
 * panel toggle and the connected folder name shown in the profile menu).
 */
interface Workspace {
  name: string;
  root: string;
  kind: string;
}

interface WorkspaceState {
  workspace: Workspace | null;
  panelOpen: boolean;
  error: string | null;
  openPanel: () => void;
  closePanel: () => void;
  togglePanel: () => void;
  clearError: () => void;
}

const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  workspace: { name: MOCK_WORKSPACE_NAME, root: "/Users/you/Projects/nexuss-app", kind: "folder" },
  panelOpen: false,
  error: null,

  openPanel: () => set({ panelOpen: true }),
  closePanel: () => set({ panelOpen: false }),
  togglePanel: () => set({ panelOpen: !get().panelOpen }),
  clearError: () => set({ error: null })
}));

/* ──────────────────────────────────────────────────────────── src/workspace/terminalConnection.ts */
/**
 * Mock terminal connection store. `checkConnection` deliberately resolves to
 * "disconnected" so the Terminal panel's connection screen is what reviewers
 * see first; `connect` simulates the handshake (and can be pointed at an
 * "error" outcome by setting MOCK_CONNECT_OUTCOME).
 */

type TerminalConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "permission_required"
  | "unavailable"
  | "error";

const TERMINAL_CONNECT_REQUIRED_MESSAGE = "Terminal access required";

/** Change to "error" to review the failed-connection copy. */
type ConnectOutcome = "connected" | "error";
const MOCK_CONNECT_OUTCOME = "connected" as ConnectOutcome;

interface TerminalConnectionState {
  status: TerminalConnectionStatus;
  lastVerifiedAt: number | null;
  justConnected: boolean;
  lastError: string | null;
  checkConnection: () => Promise<TerminalConnectionStatus>;
  connect: () => Promise<boolean>;
  disconnect: () => Promise<void>;
}


const useTerminalConnectionStore = create<TerminalConnectionState>((set, get) => ({
  status: "disconnected",
  lastVerifiedAt: null,
  justConnected: false,
  lastError: null,

  checkConnection: async () => get().status,

  connect: async () => {
    if (get().status === "connecting") return false;
    set({ status: "connecting" });
    await delay(1100);
    if (MOCK_CONNECT_OUTCOME === "error") {
      set({ status: "error", lastError: "connector unreachable" });
      return false;
    }
    set({ status: "connected", lastVerifiedAt: Date.now(), justConnected: true, lastError: null });
    return true;
  },

  disconnect: async () => {
    set({ status: "disconnected", lastVerifiedAt: null, justConnected: false });
  }
}));

/* ──────────────────────────────────────────────────────────── src/components/icons.tsx */
"use client";

interface IconProps {
  className?: string;
}

function Icon({
  className,
  children
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <svg
      className={className ?? "h-4 w-4"}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

function SearchIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.35-4.35" />
    </Icon>
  );
}

function PlusIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </Icon>
  );
}

function XIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </Icon>
  );
}

function PanelLeftIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
    </Icon>
  );
}

function ChatIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M21 12a8 8 0 0 1-11.56 7.17l-3.94.83.83-3.94A8 8 0 1 1 21 12Z" />
      <path d="M8 12h.01" />
      <path d="M12 12h.01" />
      <path d="M16 12h.01" />
    </Icon>
  );
}

function FolderIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
    </Icon>
  );
}

function SettingsIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </Icon>
  );
}

function LogOutIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5" />
      <path d="M21 12H9" />
    </Icon>
  );
}

function SendIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="m22 2-7 20-4-9-9-4Z" />
      <path d="M22 2 11 13" />
    </Icon>
  );
}

function SquareIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <rect x="7" y="7" width="10" height="10" rx="1" />
    </Icon>
  );
}

function ChevronDownIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="m6 9 6 6 6-6" />
    </Icon>
  );
}

function CheckIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M20 6 9 17l-5-5" />
    </Icon>
  );
}

function MonitorIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8" />
      <path d="M12 17v4" />
    </Icon>
  );
}

function XCircleIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="m15 9-6 6" />
      <path d="m9 9 6 6" />
    </Icon>
  );
}

function ArrowRightLeftIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="m16 3 4 4-4 4" />
      <path d="M20 7H4" />
      <path d="m8 21-4-4 4-4" />
      <path d="M4 17h16" />
    </Icon>
  );
}

function TerminalIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" x2="20" y1="19" y2="19" />
    </Icon>
  );
}

function UserIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </Icon>
  );
}

function DownloadIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" x2="12" y1="15" y2="3" />
    </Icon>
  );
}

function TrashIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </Icon>
  );
}

function AlertTriangleIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
      <line x1="12" x2="12" y1="9" y2="13" />
      <line x1="12" x2="12.01" y1="17" y2="17" />
    </Icon>
  );
}

/* ──────────────────────────────────────────────────────────── src/components/admin/NexussLogo.tsx */
interface NexussLogoProps {
  size?: number;
  color?: string;
  className?: string;
}

function NexussLogo({ size = 28, color = "#ffffff", className = "" }: NexussLogoProps) {
  return (
    <svg
      width={size}
      height={size * (70 / 100)}
      viewBox="0 0 140 98"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={{ display: "inline-block", verticalAlign: "middle", flexShrink: 0 }}
      aria-hidden="true"
    >
      <g fill={color}>
        <path d="M52.5 7L7 52.5L52.5 98L73.5 77L52.5 56L31.5 52.5L52.5 31.5L66.5 45.5L80.5 31.5L52.5 7Z" />
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M52.5 0L0 52.5L52.5 105L70 87.5L52.5 70L35 52.5L52.5 35L70 52.5L87.5 35L52.5 0ZM52.5 17.5L17.5 52.5L52.5 87.5L61.25 78.75L52.5 70L52.5 52.5L52.5 35L61.25 26.25L52.5 17.5Z"
        />
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M87.5 0L70 17.5L87.5 35L105 52.5L87.5 70L70 52.5L52.5 70L87.5 105L140 52.5L87.5 0ZM87.5 17.5L122.5 52.5L87.5 87.5L78.75 78.75L87.5 70L87.5 35L78.75 26.25L87.5 17.5Z"
        />
      </g>
    </svg>
  );
}

/* ──────────────────────────────────────────────────────────── src/components/Modal.tsx */
"use client";


interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

function Modal({ isOpen, onClose, title, children }: ModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    const handleClickOutside = (e: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("mousedown", handleClickOutside);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div
        ref={modalRef}
        className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl transition-all duration-150 animate-in zoom-in-95 text-foreground font-sans"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <div className="flex items-center justify-between border-b border-border pb-3 mb-4">
          <h3 id="modal-title" className="text-sm font-bold tracking-wide font-sans text-foreground">
            {title}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
            aria-label="Close modal"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────── src/components/SidebarNavigation.tsx */
"use client";


interface SidebarNavigationProps {
  onNewChat: () => void;
}

function SidebarNavigation({ onNewChat }: SidebarNavigationProps) {
  return (
    <nav className="shrink-0 px-3 pt-3" aria-label="Main navigation">
<button
  type="button"
  onClick={onNewChat}
  className="flex w-full items-center gap-2 rounded-xl text-foreground transition-all hover:bg-accent active:scale-[0.99] cursor-pointer"
>
  <PlusIcon className="h-3.5 w-3.5" />
  <span>New chat</span>
</button>
    </nav>
  );
}

/* ──────────────────────────────────────────────────────────── src/components/RecentChats.tsx */
"use client";


interface RecentChatsProps {
  chats: Chat[];
  currentChatId: string | null;
  searching: boolean;
  onSelect: (id: string) => void;
  onRename: (chat: Chat) => void;
  onDelete: (chat: Chat) => void;
  onNewChat: () => void;
}

function RecentChats({
  chats,
  currentChatId,
  searching,
  onSelect,
  onRename,
  onDelete,
  onNewChat
}: RecentChatsProps) {
  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-between px-2 pb-1.5 pt-3 shrink-0">
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          Recents ({chats.length})
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto space-y-0.5 px-1">
        {chats.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-3 py-8 text-center">
            <ChatIcon className="h-5 w-5 text-muted-foreground/50" />
            <p className="text-xs text-muted-foreground">
              {searching ? "No matching conversations" : "No conversations yet"}
            </p>
            {!searching && (
              <button
                type="button"
                onClick={onNewChat}
                className="rounded-lg border border-border bg-muted/60 px-3 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground cursor-pointer"
              >
                Start a new conversation
              </button>
            )}
          </div>
        ) : (
          chats.map((chat) => (
            <ChatItem
              key={chat.id}
              chat={chat}
              isActive={currentChatId === chat.id}
              onSelect={() => onSelect(chat.id)}
              onRename={() => onRename(chat)}
              onDelete={() => onDelete(chat)}
            />
          ))
        )}
      </div>
    </section>
  );
}

/* ──────────────────────────────────────────────────────────── src/components/ChatItem.tsx */
"use client";


interface ChatItemProps {
  chat: Chat;
  isActive: boolean;
  onSelect: () => void;
  onRename: () => void;
  onDelete: () => void;
}

function ChatItem({
  chat,
  isActive,
  onSelect,
  onRename,
  onDelete,
}: ChatItemProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", handleClickOutside);
    return () => window.removeEventListener("mousedown", handleClickOutside);
  }, [menuOpen]);

  const dateLabel = new Date(chat.updatedAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });

  return (
    <div
      className={`group relative flex cursor-pointer items-center justify-between gap-2 rounded-xl px-3 py-2.5 transition-all duration-150 border ${
        isActive
          ? "bg-accent border-border font-medium text-foreground shadow-xs"
          : "border-transparent text-muted-foreground hover:bg-muted/70 hover:text-foreground"
      }`}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      aria-current={isActive ? "true" : undefined}
    >
      <div className="min-w-0 flex-1 flex flex-col gap-0.5">
        <p className="truncate text-xs font-semibold tracking-tight">
          {chat.title || "Untitled conversation"}
        </p>
        <p className="text-[10px] font-mono opacity-70">{dateLabel}</p>
      </div>

      {/* 3-Dots Action Menu */}
      <div className="relative shrink-0" ref={menuRef} onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={() => setMenuOpen(!menuOpen)}
          className={`flex h-7 w-7 items-center justify-center rounded-lg text-xs transition-opacity cursor-pointer ${
            menuOpen
              ? "opacity-100 bg-muted text-foreground"
              : "opacity-0 group-hover:opacity-100 text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
          aria-label="Conversation actions"
          aria-expanded={menuOpen}
        >
          •••
        </button>

        {menuOpen && (
          <div className="absolute right-0 top-8 z-40 w-36 rounded-xl border border-border bg-popover p-1 shadow-xl animate-in fade-in zoom-in-95 text-popover-foreground font-sans">
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                onRename();
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-foreground hover:bg-muted transition-colors cursor-pointer"
            >
              
              <span>Rename</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                onDelete();
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-destructive hover:bg-destructive/10 transition-colors cursor-pointer"
            >
             
              <span>Delete</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────── src/components/UserProfile.tsx */
"use client";


interface UserProfileProps {
  email: string;
  avatarChar: string;
  /** Display name when the auth provider supplies one. */
  name?: string;
  /** Name of the connected local workspace/folder, when any. */
  workspaceName?: string | null;
  onOpenAccount?: () => void;
  onOpenSettings?: () => void;
  onSignOut?: () => void;
}

const menuItemClass =
  "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-foreground hover:bg-muted transition-colors cursor-pointer text-left";

function UserProfile({
  email,
  avatarChar,
  name,
  workspaceName,
  onOpenAccount,
  onOpenSettings,
  onSignOut
}: UserProfileProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click / Escape while the menu is open.
  useEffect(() => {
    if (!open) return;

    const handleMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    };

    window.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  // Move focus into the menu when it opens so keyboard users land on it.
  useEffect(() => {
    if (!open) return;
    const firstItem = menuRef.current?.querySelector<HTMLElement>("[role='menuitem']");
    firstItem?.focus();
  }, [open]);

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const displayName = name?.trim() || email;

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Open account menu"
        className="flex w-full items-center gap-2.5 rounded-xl p-2 bg-card border border-border text-left transition-colors hover:bg-muted/50 cursor-pointer"
      >
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground shadow-xs">
          {avatarChar}
        </div>
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-xs font-medium text-foreground">{email}</span>
          <span className="text-[10px] text-emerald-500 font-semibold">Active Workspace</span>
        </div>
        <ChevronDownIcon
          className={`ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Account menu"
          {...{ [ESCAPE_GUARD_ATTR]: "" }}
          className="absolute bottom-full left-0 z-50 mb-2 w-full overflow-hidden rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-2xl font-sans animate-in fade-in zoom-in-95 duration-150"
        >
          <div className="flex items-center gap-2.5 px-2 py-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground shadow-xs">
              {avatarChar}
            </div>
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-xs font-semibold text-foreground">{displayName}</span>
              <span className="truncate text-[11px] text-muted-foreground">{email}</span>
            </div>
          </div>

          <div className="mx-2 my-1 h-px bg-border" />

          <div className="px-2 pb-1.5">
            <p className="text-[10px] font-mono font-bold uppercase tracking-wider text-emerald-500">
              Active Workspace
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {workspaceName?.trim() || "No folder connected"}
            </p>
          </div>

          <div className="mx-2 my-1 h-px bg-border" />

          <div className="space-y-0.5">
            {onOpenAccount && (
              <button
                type="button"
                role="menuitem"
                className={menuItemClass}
                onClick={() => {
                  close();
                  onOpenAccount();
                }}
              >
                <UserIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span>Account</span>
              </button>
            )}
            {onOpenSettings && (
              <button
                type="button"
                role="menuitem"
                className={menuItemClass}
                onClick={() => {
                  close();
                  onOpenSettings();
                }}
              >
                <SettingsIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span>Settings</span>
              </button>
            )}
            {onSignOut && (
              <button
                type="button"
                role="menuitem"
                className={`${menuItemClass} text-destructive hover:bg-destructive/10`}
                onClick={() => {
                  close();
                  onSignOut();
                }}
              >
                <LogOutIcon className="h-3.5 w-3.5 shrink-0" />
                <span>Sign out</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────── src/components/RenameModal.tsx */
"use client";


interface RenameModalProps {
  isOpen: boolean;
  onClose: () => void;
  chatId: string;
  currentTitle: string;
}

function RenameModal({
  isOpen,
  onClose,
  chatId,
  currentTitle,
}: RenameModalProps) {
  const [title, setTitle] = useState(currentTitle);
  const renameChat = useChatStore((s) => s.renameChat);

  useEffect(() => {
    setTitle(currentTitle);
  }, [currentTitle, isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = title.trim();
    if (trimmed && trimmed !== currentTitle) {
      await renameChat(chatId, trimmed);
    }
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Rename conversation">
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-muted-foreground font-mono">
            Conversation name
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-xl border border-input bg-background px-3.5 py-2 text-sm text-foreground placeholder-muted-foreground outline-none focus:ring-2 focus:ring-ring font-sans"
            autoFocus
            required
          />
        </div>
        <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-border">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-input bg-background px-4 py-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!title.trim() || title.trim() === currentTitle}
            className="rounded-xl bg-primary text-primary-foreground px-4 py-2 text-xs font-semibold hover:opacity-90 disabled:opacity-40 transition-opacity cursor-pointer"
          >
            Save Changes
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ──────────────────────────────────────────────────────────── src/components/DeleteModal.tsx */
"use client";


interface DeleteModalProps {
  isOpen: boolean;
  onClose: () => void;
  chatId: string;
  chatTitle: string;
}

function DeleteModal({
  isOpen,
  onClose,
  chatId,
  chatTitle,
}: DeleteModalProps) {
  const deleteChat = useChatStore((s) => s.deleteChat);

  const handleDelete = async () => {
    await deleteChat(chatId);
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Delete conversation?">
      <div className="space-y-4">
        <p className="text-xs text-muted-foreground leading-relaxed">
          Are you sure you want to delete this conversation? This action cannot be undone.
        </p>

        <div className="rounded-xl border border-border bg-muted/50 p-3">
          <p className="text-xs font-semibold text-foreground truncate font-sans">
            {chatTitle || "Untitled conversation"}
          </p>
        </div>

        <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-border">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-input bg-background px-4 py-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleDelete()}
            className="rounded-xl bg-destructive text-destructive-foreground px-4 py-2 text-xs font-semibold hover:bg-destructive/90 transition-colors cursor-pointer"
          >
            Delete
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ──────────────────────────────────────────────────────────── src/components/UsageDashboard.tsx */
"use client";


function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatTime(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
}

function UsageDashboard() {
  const summary = useUsageStore((s) => s.summary);
  const loading = useUsageStore((s) => s.loading);
  const loadSummary = useUsageStore((s) => s.loadSummary);
  const clearUsage = useUsageStore((s) => s.clearUsage);
  const estimateContextTokens = useUsageStore((s) => s.estimateContextTokens);

  const provider = useChatStore((s) => s.provider);
  const model = useChatStore((s) => s.model);
  const messages = useChatStore((s) => s.messages);

  const [confirmClear, setConfirmClear] = useState(false);
  const [expandedProvider, setExpandedProvider] = useState<ProviderType | null>(null);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  const contextTokens = estimateContextTokens(
    messages.map((m) => ({ role: m.role, content: m.content }))
  );

  const handleClear = async () => {
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }
    await clearUsage();
    setConfirmClear(false);
  };

  return (
    <div className="space-y-4 font-sans text-xs text-foreground">
      {/* Current Session Context */}
      <section className="rounded-xl border border-border bg-card p-3.5 space-y-2 shadow-xs">
        <h4 className="text-[10px] font-mono font-bold uppercase tracking-wider text-muted-foreground">
          Active Conversation Context
        </h4>
        <div className="flex items-center justify-between rounded-xl bg-background p-2.5 border border-border">
          <div>
            <span className="text-xs font-semibold text-foreground block">Context Tokens</span>
            <span className="text-[10px] font-mono text-muted-foreground">
              {messages.length} messages in current thread
            </span>
          </div>
          <span className="rounded-lg bg-muted border border-border px-2.5 py-1 text-xs font-mono font-bold text-emerald-600 dark:text-emerald-400">
            ~{formatTokens(contextTokens)} tok
          </span>
        </div>
        <p className="text-[10px] font-mono text-muted-foreground">
          Active Model: <span className="text-foreground font-medium">{PROVIDER_LABELS[provider]}</span> • {getModelLabel(provider, model)}
        </p>
      </section>

      {/* API Usage Statistics */}
      <section className="rounded-xl border border-border bg-card p-3.5 space-y-3 shadow-xs">
        <h4 className="text-[10px] font-mono font-bold uppercase tracking-wider text-muted-foreground">
          API Usage Metrics
        </h4>

        {loading ? (
          <p className="text-xs font-mono text-muted-foreground">Loading usage statistics...</p>
        ) : summary.totalRequests === 0 ? (
          <p className="text-xs text-muted-foreground">No usage recorded yet.</p>
        ) : (
          <div className="space-y-3">
            {/* Stat Cards */}
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl bg-background border border-border p-2.5 text-center shadow-2xs">
                <p className="text-base font-mono font-bold text-foreground">{summary.totalRequests}</p>
                <p className="text-[10px] font-mono text-muted-foreground uppercase">Requests</p>
              </div>
              <div className="rounded-xl bg-background border border-border p-2.5 text-center shadow-2xs">
                <p className="text-base font-mono font-bold text-foreground">{formatTokens(summary.totalTokens)}</p>
                <p className="text-[10px] font-mono text-muted-foreground uppercase">Tokens</p>
              </div>
            </div>

            {/* Per-Provider Breakdown */}
            <div className="space-y-2">
              {summary.providers.map((ps: ProviderSummary) => (
                <div key={ps.provider} className="rounded-xl border border-border bg-background p-2.5">
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedProvider(expandedProvider === ps.provider ? null : ps.provider)
                    }
                    className="flex w-full items-center justify-between text-left cursor-pointer"
                  >
                    <div>
                      <span className="text-xs font-bold text-foreground font-mono">
                        {PROVIDER_LABELS[ps.provider]}
                      </span>
                      <span className="ml-2 text-[10px] font-mono text-muted-foreground">
                        {ps.requests} reqs
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-[11px] font-mono text-muted-foreground">
                      <span>{formatTokens(ps.totalTokens)} tok</span>
                      <span>{formatTime(ps.avgResponseTime)}</span>
                      <span className="text-[9px]">{expandedProvider === ps.provider ? "▲" : "▼"}</span>
                    </div>
                  </button>

                  {expandedProvider === ps.provider && (
                    <div className="mt-2 space-y-1.5 border-t border-border pt-2 font-mono text-[11px]">
                      <div className="grid grid-cols-3 gap-1 text-[10px] text-muted-foreground">
                        <span>Input: {formatTokens(ps.inputTokens)}</span>
                        <span>Output: {formatTokens(ps.outputTokens)}</span>
                        <span>Total: {formatTokens(ps.totalTokens)}</span>
                      </div>
                      {Object.entries(ps.models).map(([modelName, ms]) => (
                        <div
                          key={modelName}
                          className="flex items-center justify-between rounded-lg bg-muted border border-border px-2 py-1 text-[10px]"
                        >
                          <span className="text-foreground font-medium truncate max-w-[120px]">{modelName}</span>
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <span>{ms.requests} req</span>
                            <span>{formatTokens(ms.totalTokens)} tok</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Clear Usage Data */}
      <section className="pt-1">
        <button
          type="button"
          onClick={() => void handleClear()}
          className={`w-full rounded-xl border px-3 py-2 text-xs font-mono transition-colors cursor-pointer ${
            confirmClear
              ? "border-destructive bg-destructive/10 text-destructive font-semibold"
              : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
        >
          {confirmClear ? "Click again to confirm clear" : "Clear Usage Statistics"}
        </button>
        {confirmClear && (
          <button
            type="button"
            onClick={() => setConfirmClear(false)}
            className="mt-1.5 w-full rounded-xl border border-border bg-background px-3 py-1.5 text-xs font-mono text-muted-foreground hover:text-foreground cursor-pointer"
          >
            Cancel
          </button>
        )}
      </section>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────── src/components/AccountPanel.tsx */
"use client";


function formatAccountDate(value: number | null | undefined): string {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric"
  });
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <span className="shrink-0 text-xs font-medium text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right text-xs text-foreground">{value}</span>
    </div>
  );
}

function AccountPanel() {
  const user = useAuthStore((s) => s.user);
  const workspace = useWorkspaceStore((s) => s.workspace);

  const [info, setInfo] = useState<AccountInfo | null>(null);
  const [infoError, setInfoError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletion, setDeletion] = useState<DeletionStatus | null>(null);

  const email = info?.email || user?.email || "Unknown";
  const name = info?.name || user?.displayName || "";
  const avatarSource = (name || email).trim();
  const avatarChar = avatarSource[0]?.toUpperCase() || "U";
  const workspaceName = workspace?.name?.trim() || "No folder connected";

  // Ask the backend first: while a deletion is in flight the account is
  // locked, so profile rows (and the profile endpoint) may already be gone
  // and a 423 there must not be reported as a loading problem.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const next = await getDeletionStatus();
        if (cancelled) return;
        if (next.state !== "none") {
          setDeletion(next);
          return;
        }
      } catch {
        // A status hiccup must not stop the profile from loading.
      }
      try {
        const account = await getAccountInfo();
        if (!cancelled) {
          setInfo(account);
          setInfoError(null);
        }
      } catch (err) {
        if (!cancelled) setInfoError(getErrorMessage(err));
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  // Keep the banner honest: refresh the job state while one exists.
  const deletionState = deletion?.state ?? null;
  useEffect(() => {
    if (!deletionState) return;
    const timer = window.setInterval(() => {
      getDeletionStatus()
        .then((next) => setDeletion(next.state === "none" ? null : next))
        .catch(() => {
          // Transient polling error: keep showing the last known state.
        });
    }, 3000);
    return () => window.clearInterval(timer);
  }, [deletionState]);

  const handleExport = async () => {
    if (!user?.uid) {
      setExportMessage({ type: "error", text: "You must be signed in to export data." });
      return;
    }
    setExporting(true);
    setExportMessage(null);
    try {
      const [server, local] = await Promise.all([
        fetchServerExport(),
        gatherLocalAccountExport(user.uid)
      ]);
      downloadJson(`nexuss-export-${new Date().toISOString().slice(0, 10)}.json`, {
        exportedAt: new Date().toISOString(),
        server,
        local
      });
      setExportMessage({
        type: "success",
        text: "Your Nexuss data was downloaded as a JSON file."
      });
    } catch (err) {
      setExportMessage({ type: "error", text: getErrorMessage(err) });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* PROFILE */}
      <section className="rounded-xl border border-border bg-card p-3.5 space-y-3 shadow-xs">
        <h4 className="text-[10px] font-mono font-bold uppercase tracking-wider text-muted-foreground">
          Profile
        </h4>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground shadow-xs">
            {avatarChar}
          </div>
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-xs font-semibold text-foreground">
              {name?.trim() || "Nexuss user"}
            </span>
            <span className="truncate text-[11px] text-muted-foreground">{email}</span>
          </div>
        </div>
        <div className="space-y-1 border-t border-border pt-2.5">
          <Row label="Workspace" value={workspaceName} />
        </div>
      </section>

      {/* ACCOUNT INFORMATION */}
      <section className="rounded-xl border border-border bg-card p-3.5 shadow-xs">
        <h4 className="text-[10px] font-mono font-bold uppercase tracking-wider text-muted-foreground">
          Account Information
        </h4>
        <div className="mt-1 divide-y divide-border">
          <Row label="Email" value={email} />
          <Row label="Member since" value={formatAccountDate(info?.created_at)} />
          <Row label="Current workspace" value={workspaceName} />
        </div>
        {infoError && (
          <p className="mt-2 text-[11px] text-amber-600">
            Live account details could not be loaded: {infoError}
          </p>
        )}
      </section>

      {/* DATA & PRIVACY */}
      <section className="rounded-xl border border-border bg-card p-3.5 space-y-3 shadow-xs">
        <h4 className="text-[10px] font-mono font-bold uppercase tracking-wider text-muted-foreground">
          Data &amp; Privacy
        </h4>
        <div className="space-y-2 text-[11px] leading-relaxed text-muted-foreground">
          <p>Nexuss stores the following for your account:</p>
          <ul className="list-disc space-y-1 pl-4">
            <li>
              <span className="font-medium text-foreground">Account details</span> — your email,
              display name, and sign-in provider from Firebase Authentication.
            </li>
            <li>
              <span className="font-medium text-foreground">Settings</span> — theme, language, and
              your selected provider and model, saved on Nexuss servers.
            </li>
            <li>
              <span className="font-medium text-foreground">Provider API keys</span> — stored
              encrypted on Nexuss servers. They are never shown here or included in an export.
            </li>
            <li>
              <span className="font-medium text-foreground">Usage records</span> — provider, model,
              token counts and response times for analytics. No chat content is recorded.
            </li>
            <li>
              <span className="font-medium text-foreground">This device only</span> — chat history,
              messages, usage history, and local model endpoints live in your browser&apos;s
              IndexedDB and are not synced to Nexuss servers.
            </li>
          </ul>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <button
            type="button"
            onClick={() => void handleExport()}
            disabled={exporting || !!deletion}
            className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-background px-3 py-1 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-30 transition-colors cursor-pointer"
          >
            <DownloadIcon className="h-3.5 w-3.5" />
            {exporting ? "Preparing…" : "Export my data"}
          </button>
          {exportMessage && (
            <span
              className={`text-[11px] ${
                exportMessage.type === "success" ? "text-emerald-500" : "text-destructive"
              }`}
              role="status"
            >
              {exportMessage.text}
            </span>
          )}
        </div>
      </section>

      {/* DANGER ZONE */}
      <section className="rounded-xl border border-destructive/40 bg-destructive/5 p-3.5 space-y-3 shadow-xs">
        <h4 className="flex items-center gap-1.5 text-[10px] font-mono font-bold uppercase tracking-wider text-destructive">
          <AlertTriangleIcon className="h-3.5 w-3.5" />
          Danger Zone
        </h4>
        <div className="space-y-1">
          <p className="text-xs font-semibold text-foreground">Delete your Nexuss account</p>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Deleting your account permanently removes your Nexuss account and associated data:
            your profile, settings, encrypted provider API keys, usage records, and this
            account&apos;s chats and messages stored in this browser. This action cannot be undone.
          </p>
        </div>
        {deletion ? (
          <div
            role="status"
            className={`space-y-1.5 rounded-xl border px-3 py-2 text-[11px] leading-relaxed ${
              deletion.state === "failed"
                ? "border-destructive/40 bg-destructive/10 text-destructive"
                : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
            }`}
          >
            <p className="text-xs font-semibold">
              {deletion.state === "failed"
                ? "Account deletion did not finish."
                : "Your account is being permanently deleted."}
            </p>
            <p>
              {deletion.stage && deletion.stage in DELETION_STAGE_LABELS
                ? DELETION_STAGE_LABELS[deletion.stage]
                : deletion.detail}
            </p>
            <p className="text-[10px] opacity-80">
              {deletion.state === "failed"
                ? "Your account stays locked until the deletion finishes."
                : "It keeps running on our servers even if you close settings."}
            </p>
            <button
              type="button"
              onClick={() => setDeleteOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-1 text-xs font-medium text-destructive hover:bg-destructive/20 transition-colors cursor-pointer"
            >
              {deletion.state === "failed" ? "Retry deletion" : "View deletion progress"}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setDeleteOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-1 text-xs font-medium text-destructive hover:bg-destructive/20 transition-colors cursor-pointer"
          >
            <TrashIcon className="h-3.5 w-3.5" />
            Delete Account
          </button>
        )}
      </section>

      <DeleteAccountModal isOpen={deleteOpen} onClose={() => setDeleteOpen(false)} />
    </div>
  );
}

/* ──────────────────────────────────────────────────────────── src/components/DeleteAccountModal.tsx */
"use client";


const CONFIRMATION_TEXT = "DELETE";
const SUCCESS_REDIRECT_DELAY_MS = 1500;
const POLL_INTERVAL_MS = 1500;

const ACTIVE_STATES = ["queued", "running", "retry_wait"];

interface DeleteAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called after a successful deletion, just before the user is signed out. */
  onSuccess?: () => void;
}

/**
 * `checking`  — asking the backend whether a deletion is already underway
 * `confirm`   — type DELETE (and re-authenticate) to start it
 * `progress`  — backend job running; polled until it completes
 * `failed`    — bounded retries exhausted; the user may retry explicitly
 * `done`      — verified deletion, local purge + sign out follow
 */
type Phase = "checking" | "confirm" | "progress" | "failed" | "done";

function phaseForState(state: DeletionStatus["state"]): Phase {
  if (ACTIVE_STATES.includes(state)) return "progress";
  if (state === "failed") return "failed";
  if (state === "completed") return "done";
  return "confirm";
}

function DeleteAccountModal({
  isOpen,
  onClose,
  onSuccess
}: DeleteAccountModalProps) {
  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);

  const [phase, setPhase] = useState<Phase>("confirm");
  const [confirmation, setConfirmation] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<DeletionStatus | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // True once this browser started (or resumed) the backend job: from then on
  // a status of "none" means the job finished and its row was removed.
  const startedRef = useRef(false);
  const uid = user?.uid ?? null;
  const reauthMethod = getReauthMethod(user);

  const finishDeletion = (message?: string | null) => {
    setPhase("done");
    if (message) setError(null);

    window.setTimeout(() => {
      const cleanup = async () => {
        try {
          if (uid) await purgeLocalAccountData(uid);
          clearAuthCache();
          onSuccess?.();
          await signOut();
        } catch (err) {
          // The account is already deleted server-side; a local cleanup hiccup
          // must never be reported as a failed deletion.
          console.error("Post-deletion cleanup failed:", err);
        }
      };
      void cleanup();
    }, SUCCESS_REDIRECT_DELAY_MS);
  };

  // On open: resume a deletion that is already underway instead of asking for
  // confirmation again, so a reload or a second tab never re-triggers work.
  useEffect(() => {
    if (!isOpen) {
      setPhase("confirm");
      setConfirmation("");
      setPassword("");
      setError(null);
      setStatus(null);
      setBusy(false);
      startedRef.current = false;
      return;
    }

    let cancelled = false;
    setPhase("checking");
    getDeletionStatus()
      .then((next) => {
        if (cancelled) return;
        setStatus(next);
        if (next.state !== "none") startedRef.current = true;
        setPhase(phaseForState(next.state));
      })
      .catch(() => {
        if (!cancelled) setPhase("confirm");
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  // Poll the backend while the job is in flight. The browser can be closed at
  // any point: the job keeps running server-side and this resumes it.
  useEffect(() => {
    if (!isOpen || phase !== "progress") return;
    let cancelled = false;

    const tick = async () => {
      try {
        const next = await getDeletionStatus();
        if (cancelled) return;
        setStatus(next);
        if (next.state === "completed" || (next.state === "none" && startedRef.current)) {
          finishDeletion();
        } else if (next.state === "failed") {
          setPhase("failed");
        }
      } catch {
        // Transient polling errors are not user-facing failures: keep polling.
      }
    };

    const timer = window.setInterval(() => void tick(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, phase, uid]);

  // Put the caret in the confirmation field as soon as the dialog opens.
  useEffect(() => {
    if (!isOpen || phase !== "confirm") return;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [isOpen, phase]);

  // Never let Escape/outside-click dismiss the dialog mid-deletion: the
  // post-deletion cleanup (local purge + sign out) must still run.
  const requestClose = () => {
    if (busy || phase === "checking" || phase === "progress" || phase === "done") return;
    onClose();
  };

  const canConfirm = confirmation === CONFIRMATION_TEXT;
  const canSubmit = canConfirm && (reauthMethod !== "password" || password.length > 0);

  const handleDelete = async () => {
    if (!canSubmit || busy || phase !== "confirm") return;
    setBusy(true);
    setError(null);

    // Real re-authentication first: the backend only accepts a token issued
    // in the last few minutes, and this proves the person at the keyboard
    // still owns the credential.
    try {
      if (reauthMethod === "password") {
        await reauthenticateWithPassword(password);
      } else {
        await reauthenticateWithGoogle();
      }
    } catch (err) {
      setBusy(false);
      setError(getErrorMessage(err));
      return;
    }

    let started: DeletionStatus;
    try {
      started = await startAccountDeletion();
    } catch (err) {
      setBusy(false);
      setError(getErrorMessage(err));
      return;
    }

    startedRef.current = true;
    setStatus(started);
    setBusy(false);

    if (started.state === "completed") {
      finishDeletion();
      return;
    }
    setPhase(phaseForState(started.state));
  };

  const handleRetry = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      // Resuming an already-authorized job: no new confirmation or password
      // prompt, just a fresh token and the backend's bounded retry.
      const next = await startAccountDeletion();
      setStatus(next);
      setBusy(false);
      if (next.state === "completed") {
        finishDeletion();
        return;
      }
      setPhase(phaseForState(next.state));
    } catch (err) {
      setBusy(false);
      setError(getErrorMessage(err));
    }
  };

  const stageLabel =
    status?.stage && status.stage in DELETION_STAGE_LABELS
      ? DELETION_STAGE_LABELS[status.stage]
      : null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={requestClose}
      title="Delete your Nexuss account?"
    >
      <div {...{ [ESCAPE_GUARD_ATTR]: "" }} className="space-y-4 font-sans text-xs text-foreground">
        {phase === "checking" ? (
          <p role="status" className="py-3 text-center text-xs text-muted-foreground">
            Checking whether a deletion is already in progress…
          </p>
        ) : phase === "done" ? (
          <div role="status" className="flex flex-col items-center gap-2 py-3 text-center">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-500">
              <CheckIcon className="h-5 w-5" />
            </span>
            <p className="text-xs font-semibold text-foreground">
              Your Nexuss account has been permanently deleted.
            </p>
            <p className="text-[11px] text-muted-foreground">
              You are being signed out and returned to the landing page.
            </p>
          </div>
        ) : phase === "progress" ? (
          <div role="status" className="space-y-3 py-2 text-center">
            <span className="mx-auto block h-8 w-8 animate-spin rounded-full border-2 border-border border-t-primary" />
            <p className="text-xs font-semibold text-foreground">
              Your account is being permanently deleted.
            </p>
            <p className="text-[11px] text-foreground">{stageLabel ?? "Working…"}</p>
            {status?.detail && (
              <p className="text-[11px] leading-relaxed text-muted-foreground">{status.detail}</p>
            )}
            {status && status.attempt > 1 && (
              <p className="text-[11px] text-muted-foreground">
                Attempt {status.attempt} — deletion continues on our servers even if you close
                this window.
              </p>
            )}
          </div>
        ) : phase === "failed" ? (
          <div className="space-y-4">
            <div
              role="alert"
              className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-[11px] leading-relaxed text-destructive"
            >
              <span className="font-semibold">Deletion did not finish.</span>{" "}
              {status?.detail || "Automatic retries were exhausted."}
            </div>
            <p className="leading-relaxed text-muted-foreground">
              Your account is locked while the deletion is retried. You can try again now, or
              contact support if the problem persists.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={requestClose}
                disabled={busy}
                className="rounded-xl border border-border bg-background px-3 py-1 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-30 transition-colors cursor-pointer"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => void handleRetry()}
                disabled={busy}
                className="rounded-xl bg-destructive px-4 py-2 text-xs font-semibold text-destructive-foreground hover:bg-destructive/90 disabled:opacity-30 transition-colors cursor-pointer"
              >
                {busy ? "Retrying…" : "Retry deletion"}
              </button>
            </div>
          </div>
        ) : (
          <>
            <p className="leading-relaxed text-muted-foreground">
              Deleting your account permanently removes your Nexuss account and
              associated data. This action cannot be undone.
            </p>

            <ul className="list-disc space-y-1 pl-4 text-[11px] leading-relaxed text-muted-foreground">
              <li>Your profile, settings, and encrypted provider API keys on Nexuss servers.</li>
              <li>Your AI usage records and any feedback you submitted.</li>
              <li>Your chats, messages, and local model setup stored in this browser.</li>
              <li>Your Firebase sign-in account, so you cannot sign in again.</li>
            </ul>

            {error && (
              <div
                role="alert"
                className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-[11px] leading-relaxed text-destructive"
              >
                <span className="font-semibold">Your account was not deleted.</span> {error} You
                can try again.
              </div>
            )}

            <div className="space-y-1.5">
              <label
                htmlFor="delete-account-confirmation"
                className="block text-xs font-medium text-foreground"
              >
                Type {CONFIRMATION_TEXT} to confirm
              </label>
              <input
                id="delete-account-confirmation"
                ref={inputRef}
                type="text"
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void handleDelete();
                  }
                }}
                autoComplete="off"
                spellCheck={false}
                placeholder={CONFIRMATION_TEXT}
                aria-describedby="delete-account-confirmation-hint"
                className="w-full rounded-xl border border-input bg-background px-3 py-2 font-mono text-xs text-foreground outline-none focus:ring-1 focus:ring-ring"
              />
              <p
                id="delete-account-confirmation-hint"
                className="text-[10px] text-muted-foreground"
              >
                The permanent deletion button stays disabled until you type{" "}
                {CONFIRMATION_TEXT} exactly.
              </p>
            </div>

            {reauthMethod === "password" && (
              <div className="space-y-1.5">
                <label
                  htmlFor="delete-account-password"
                  className="block text-xs font-medium text-foreground"
                >
                  Confirm your password
                </label>
                <input
                  id="delete-account-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void handleDelete();
                    }
                  }}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  aria-describedby="delete-account-password-hint"
                  className="w-full rounded-xl border border-input bg-background px-3 py-2 font-mono text-xs text-foreground outline-none focus:ring-1 focus:ring-ring"
                />
                <p id="delete-account-password-hint" className="text-[10px] text-muted-foreground">
                  For your security we re-check your password before deleting anything.
                </p>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={requestClose}
                disabled={busy}
                className="rounded-xl border border-border bg-background px-3 py-1 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-30 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleDelete()}
                disabled={!canSubmit || busy}
                className="rounded-xl bg-destructive px-4 py-2 text-xs font-semibold text-destructive-foreground hover:bg-destructive/90 disabled:opacity-30 transition-colors cursor-pointer"
              >
                {busy
                  ? reauthMethod === "password"
                    ? "Verifying password…"
                    : "Confirming with Google…"
                  : "Delete Account Permanently"}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

/* ──────────────────────────────────────────────────────────── src/components/ModelsSettings.tsx */
"use client";


const CLOUD_PROVIDERS: ProviderType[] = ["groq", "gemini", "openrouter"];

const LOCAL_PROVIDER_TYPES: LocalProviderType[] = [
  "ollama",
  "lmstudio",
  "vllm",
  "generic"
];

/** Product-facing one-liners shown when picking a provider to connect. */
const PROVIDER_BLURB: Record<LocalProviderType, string> = {
  ollama: "Run AI models locally with Ollama",
  lmstudio: "Connect models running through LM Studio",
  vllm: "Connect a vLLM server",
  generic: "Use a custom OpenAI-compatible local endpoint"
};

/** Provider-aware primary action, e.g. "Connect Ollama". */
const CONNECT_LABEL: Record<LocalProviderType, string> = {
  ollama: "Connect Ollama",
  lmstudio: "Connect LM Studio",
  vllm: "Connect vLLM",
  generic: "Connect"
};

type ConnectionStatus = "connected" | "checking" | "disconnected";

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connected: "Connected",
  checking: "Checking…",
  disconnected: "Disconnected"
};

/** Per-card UI state for the Local Providers connection experience. */
type CardState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "failed"
  | "checking";

interface LocalProviderEntry {
  /** Stable id for the card: persisted row id, "ollama", or "pending:<type>". */
  key: string;
  /** Persisted LocalProvider id, or null when only known through discovery. */
  id: string | null;
  name: string;
  providerType: LocalProviderType;
  endpoint: string;
  enabled: boolean;
  status: ConnectionStatus;
  statusLabel: string;
}

interface ModelOption {
  id: string;
  label: string;
  meta?: string;
}

interface EndpointCheck {
  ok: boolean;
  message: string;
  models: string[];
}

/**
 * Human-readable connection failures. Raw errors (CORS, stack traces, HTTP
 * details) never reach the normal setup flow.
 */
function connectionFailureMessage(type: LocalProviderType): string {
  const name = LOCAL_PROVIDER_LABELS[type];
  if (isProductionWeb()) {
    return `Local AI runs on your own computer, so ${name} can't be reached from the hosted app. Open Nexuss on your computer to connect.`;
  }
  if (type === "generic") {
    return "Couldn't connect to that server. Make sure it's running and try again.";
  }
  return `Couldn't connect to ${name}. Make sure ${name} is running and try again.`;
}

function rejectionMessage(type: LocalProviderType): string {
  return `${LOCAL_PROVIDER_LABELS[type]} responded, but the connection was rejected. Check the address under Advanced connection settings.`;
}

function formatMeta(
  m: { family?: string; parameterSize?: string; size?: number }
): string | undefined {
  const disk = m.size ? `${(m.size / 1e9).toFixed(1)} GB disk` : null;
  const parts = [m.family, m.parameterSize, disk].filter(Boolean);
  return parts.length > 0 ? parts.join(" • ") : undefined;
}

const SELECT_CLASSES =
  "w-full cursor-pointer rounded-xl border border-input bg-background px-3 py-2 text-xs text-foreground outline-none focus:ring-1 focus:ring-ring";

const INPUT_CLASSES =
  "w-full rounded-xl border border-input bg-background px-3 py-2 font-mono text-xs text-foreground placeholder-muted-foreground outline-none focus:ring-1 focus:ring-ring";

const MODELS_SECONDARY_BUTTON_CLASSES =
  "rounded-xl border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed";

const MODELS_PRIMARY_BUTTON_CLASSES =
  "rounded-xl bg-primary text-primary-foreground px-3 py-1.5 text-xs font-semibold hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed";

const CARD_STATUS: Record<
  CardState,
  { label: string; text: string; dot: string }
> = {
  connected: {
    label: "Connected",
    text: "text-emerald-600 dark:text-emerald-400",
    dot: "bg-emerald-500"
  },
  connecting: {
    label: "Connecting…",
    text: "text-muted-foreground",
    dot: "bg-muted-foreground animate-pulse"
  },
  checking: {
    label: "Checking…",
    text: "text-muted-foreground",
    dot: "bg-muted-foreground animate-pulse"
  },
  failed: {
    label: "Connection failed",
    text: "text-destructive",
    dot: "bg-destructive"
  },
  disconnected: {
    label: "Not connected",
    text: "text-muted-foreground",
    dot: "border border-muted-foreground bg-transparent"
  }
};

function StatusPill({ state }: { state: CardState }) {
  const s = CARD_STATUS[state];
  return (
    <span
      className={`flex shrink-0 items-center gap-1.5 text-[10px] font-medium ${s.text}`}
      data-testid={`local-status-${state}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} aria-hidden="true" />
      {s.label}
    </span>
  );
}

interface ProviderChooserProps {
  types: LocalProviderType[];
  onPick: (type: LocalProviderType) => void;
  onCancel: () => void;
}

function ProviderChooser({ types, onPick, onCancel }: ProviderChooserProps) {
  return (
    <div className="space-y-2.5 rounded-xl border border-dashed border-border bg-muted/20 p-3">
      <div>
        <p className="text-xs font-semibold text-foreground">
          Connect a local AI
        </p>
        <p className="text-[11px] text-muted-foreground">
          Choose your local provider:
        </p>
      </div>
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {types.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => onPick(t)}
            className="rounded-xl border border-border bg-card px-3 py-2.5 text-left transition-colors hover:border-primary/50 hover:bg-muted/40 cursor-pointer"
          >
            <span className="block text-xs font-semibold text-foreground">
              {LOCAL_PROVIDER_LABELS[t]}
            </span>
            <span className="mt-0.5 block text-[10px] leading-snug text-muted-foreground">
              {PROVIDER_BLURB[t]}
            </span>
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={onCancel}
        className="text-[11px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
      >
        Cancel
      </button>
    </div>
  );
}

function ModelsSettings() {
  const provider = useChatStore((s) => s.provider);
  const model = useChatStore((s) => s.model);
  const setProvider = useChatStore((s) => s.setProvider);
  const setModel = useChatStore((s) => s.setModel);

  // ---- Local providers / models (existing store, unchanged) ----
  const localProviders = useLocalModelStore((s) => s.providers);
  const localModels = useLocalModelStore((s) => s.models);
  const localHydrated = useLocalModelStore((s) => s.hydrated);
  const hydrateLocal = useLocalModelStore((s) => s.hydrate);
  const addLocalProvider = useLocalModelStore((s) => s.addProvider);
  const removeLocalProvider = useLocalModelStore((s) => s.removeProvider);
  const updateLocalProvider = useLocalModelStore((s) => s.updateProvider);
  const addLocalModel = useLocalModelStore((s) => s.addModel);
  const getProviderForModel = useLocalModelStore((s) => s.getProviderForModel);
  const discoveredOllamaModels = useLocalModelStore((s) => s.discoveredOllamaModels);
  const ollamaStatus = useLocalModelStore((s) => s.ollamaStatus);
  const refreshOllamaModels = useLocalModelStore((s) => s.refreshOllamaModels);
  const clearDiscoveredOllamaModels = useLocalModelStore(
    (s) => s.clearDiscoveredOllamaModels
  );

  // ---- Connection flow state (one card per provider) ----
  const [connectingKey, setConnectingKey] = useState<string | null>(null);
  const [connectError, setConnectError] = useState<Record<string, string>>({});
  const [endpointDrafts, setEndpointDrafts] = useState<Record<string, string>>({});
  const [advancedOpen, setAdvancedOpen] = useState<Record<string, boolean>>({});
  const [pendingTypes, setPendingTypes] = useState<LocalProviderType[]>([]);
  const [chooserOpen, setChooserOpen] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [endpointChecks, setEndpointChecks] = useState<Record<string, EndpointCheck>>({});
  const [checkingIds, setCheckingIds] = useState<string[]>([]);
  const [activeLocalKey, setActiveLocalKey] = useState<string | null>(null);

  useEffect(() => {
    if (!localHydrated) void hydrateLocal();
  }, [localHydrated, hydrateLocal]);

  // Refresh an already-connected Ollama as soon as the panel opens. A user who
  // has never connected stays on the chooser — discovery only runs on Connect.
  useEffect(() => {
    if (!localHydrated) return;
    const persisted = useLocalModelStore
      .getState()
      .providers.some((p) => p.providerType === "ollama" && p.enabled);
    if (persisted) void refreshOllamaModels();
  }, [localHydrated, refreshOllamaModels]);

  // Quiet validation of persisted non-Ollama providers so their cards show an
  // accurate Connected / Not connected state after a reload.
  const runCheck = useCallback(
    async (id: string, endpoint: string, type: LocalProviderType, apiKey?: string) => {
      setCheckingIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
      try {
        const res = await testLocalEndpoint(endpoint, type, apiKey);
        setEndpointChecks((prev) => ({
          ...prev,
          [id]: { ok: res.ok, message: "", models: res.models ?? [] }
        }));
      } catch {
        setEndpointChecks((prev) => ({
          ...prev,
          [id]: { ok: false, message: "", models: [] }
        }));
      } finally {
        setCheckingIds((prev) => prev.filter((x) => x !== id));
      }
    },
    []
  );

  useEffect(() => {
    if (!localHydrated) return;
    for (const p of localProviders) {
      if (p.providerType === "ollama" || !p.enabled) continue;
      if (endpointChecks[p.id] || checkingIds.includes(p.id)) continue;
      void runCheck(p.id, p.endpoint, p.providerType, p.apiKey);
    }
  }, [localHydrated, localProviders, endpointChecks, checkingIds, runCheck]);

  // Keep the selection valid: if the selected Ollama model was deleted, clear it
  // instead of silently switching to another one.
  useEffect(() => {
    if (provider !== "local") return;
    if (ollamaStatus !== "connected" || discoveredOllamaModels.length === 0) return;
    const stillExists =
      discoveredOllamaModels.some((m) => m.modelId === model) ||
      localModels.some((m) => m.modelId === model && m.enabled);
    if (!stillExists && model) setModel("");
  }, [discoveredOllamaModels, localModels, provider, model, ollamaStatus, setModel]);

  const localEntries = useMemo<LocalProviderEntry[]>(() => {
    const entries: LocalProviderEntry[] = [];

    const persistedOllama = localProviders.find((p) => p.providerType === "ollama");
    let ollamaConnection: ConnectionStatus;
    if (persistedOllama && !persistedOllama.enabled) {
      ollamaConnection = "disconnected";
    } else if (ollamaStatus === "connected") {
      ollamaConnection = "connected";
    } else if (ollamaStatus === "not_connected" || ollamaStatus === "error") {
      ollamaConnection = "disconnected";
    } else {
      // "idle" / "loading": only a row we already persisted is worth probing —
      // a fresh provider waits for the user to press Connect.
      ollamaConnection = persistedOllama ? "checking" : "disconnected";
    }
    entries.push({
      key: persistedOllama ? persistedOllama.id : "ollama",
      id: persistedOllama?.id ?? null,
      name: persistedOllama?.name || "Ollama",
      providerType: "ollama",
      endpoint: persistedOllama?.endpoint || LOCAL_PROVIDER_DEFAULT_ENDPOINTS.ollama,
      enabled: persistedOllama?.enabled ?? true,
      status: ollamaConnection,
      statusLabel:
        persistedOllama && !persistedOllama.enabled
          ? "Disabled"
          : STATUS_LABEL[ollamaConnection]
    });

    for (const p of localProviders) {
      if (p.providerType === "ollama") continue;
      const check = endpointChecks[p.id];
      const status: ConnectionStatus = !p.enabled
        ? "disconnected"
        : checkingIds.includes(p.id)
          ? "checking"
          : check
            ? check.ok
              ? "connected"
              : "disconnected"
            : "checking";
      entries.push({
        key: p.id,
        id: p.id,
        name: p.name || LOCAL_PROVIDER_LABELS[p.providerType],
        providerType: p.providerType,
        endpoint: p.endpoint,
        enabled: p.enabled,
        status,
        statusLabel: !p.enabled ? "Disabled" : STATUS_LABEL[status]
      });
    }

    return entries;
  }, [localProviders, ollamaStatus, endpointChecks, checkingIds]);

  // A stale failure message is meaningless once the provider reports connected.
  useEffect(() => {
    if (Object.keys(connectError).length === 0) return;
    setConnectError((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const entry of localEntries) {
        if (entry.status === "connected" && next[entry.key]) {
          delete next[entry.key];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [localEntries, connectError]);

  /**
   * First run: nothing persisted yet — open the guided local AI setup
   * automatically. The manual provider chooser stays available through
   * "Advanced configuration".
   */
  const firstRun =
    localHydrated && localProviders.length === 0 && pendingTypes.length === 0;

  useEffect(() => {
    if (firstRun) setSetupOpen(true);
  }, [firstRun]);

  const cardEntries = useMemo<LocalProviderEntry[]>(() => {
    const list: LocalProviderEntry[] = [];
    for (const entry of localEntries) {
      if (firstRun && entry.id === null) continue;
      list.push(entry);
    }
    for (const type of pendingTypes) {
      if (list.some((e) => e.providerType === type)) continue;
      list.push({
        key: `pending:${type}`,
        id: null,
        name: LOCAL_PROVIDER_LABELS[type],
        providerType: type,
        endpoint: LOCAL_PROVIDER_DEFAULT_ENDPOINTS[type],
        enabled: true,
        status: "disconnected",
        statusLabel: "Disconnected"
      });
    }
    return list;
  }, [localEntries, firstRun, pendingTypes]);

  const missingTypes = useMemo(
    () =>
      LOCAL_PROVIDER_TYPES.filter(
        (t) => !cardEntries.some((e) => e.providerType === t)
      ),
    [cardEntries]
  );

  // The manual chooser is the advanced path — the guided setup panel owns
  // first-run and the "+ Add Local Provider" entry.
  const chooserVisible = chooserOpen && !setupOpen;

  const activeLocal = useMemo<LocalProviderEntry | null>(() => {
    if (activeLocalKey) {
      const chosen = localEntries.find((e) => e.key === activeLocalKey);
      if (chosen) return chosen;
    }
    if (provider === "local") {
      const owner = getProviderForModel(model);
      const byModel = owner ? localEntries.find((e) => e.id === owner.id) : undefined;
      if (byModel) return byModel;
    }
    return localEntries[0] ?? null;
  }, [activeLocalKey, localEntries, provider, model, getProviderForModel]);

  const isLocalProvider = provider === "local";

  const optionsFor = useCallback(
    (entry: LocalProviderEntry | null): ModelOption[] => {
      if (!entry) return [];
      if (entry.providerType === "ollama") {
        // Live discovery is the source of truth for Ollama; persisted rows are
        // never shown as installed models once the endpoint is unreachable.
        // A refresh (status "checking") keeps the last known list visible.
        if (entry.status === "disconnected") return [];
        return discoveredOllamaModels.map((m) => ({
          id: m.modelId,
          label: m.modelId,
          meta: formatMeta(m)
        }));
      }
      const persisted = localModels
        .filter((m) => m.providerId === entry.id && m.enabled)
        .map((m) => ({ id: m.modelId, label: m.displayName || m.modelId, meta: formatMeta(m) }));
      const options: ModelOption[] = [...persisted];
      const checked = entry.id ? endpointChecks[entry.id] : undefined;
      for (const id of checked?.models ?? []) {
        if (!options.some((o) => o.id === id)) options.push({ id, label: id, meta: undefined });
      }
      return options;
    },
    [discoveredOllamaModels, localModels, endpointChecks]
  );

  const modelOptions = useMemo<ModelOption[]>(() => {
    if (!isLocalProvider) {
      const cloud = provider as Exclude<ProviderType, "local">;
      return (PROVIDER_MODEL_OPTIONS[cloud] ?? []).map((m) => ({
        id: m.id,
        label: m.badge ? `${m.label} (${m.badge})` : m.label
      }));
    }
    return optionsFor(activeLocal);
  }, [isLocalProvider, provider, activeLocal, optionsFor]);

  const cloudProvider = !isLocalProvider
    ? (provider as Exclude<ProviderType, "local">)
    : null;

  const modelValue =
    modelOptions.some((m) => m.id === model)
      ? model
      : cloudProvider
        ? DEFAULT_PROVIDER_MODELS[cloudProvider]
        : "";

  // Nothing selected yet for this local provider (fresh panel, or the previous
  // selection was removed) — default to its first model, mirroring how
  // setProvider("local") picks the first enabled local model.
  useEffect(() => {
    if (!isLocalProvider || !activeLocal || model) return;
    if (modelOptions.length === 0) return;
    void selectLocalModel(modelOptions[0].id);
  }, [isLocalProvider, activeLocal, model, modelOptions]);

  const providerValue =
    isLocalProvider && activeLocal ? `local:${activeLocal.key}` : provider;

  const handleProviderChange = (value: string) => {
    if (value.startsWith("local:")) {
      const key = value.slice("local:".length);
      const entry = localEntries.find((e) => e.key === key);
      setActiveLocalKey(key);
      if (provider !== "local") setProvider("local");
      // Keep the chat model consistent with the local provider the user picked.
      if (entry) {
        const opts = optionsFor(entry).map((o) => o.id);
        const current = useChatStore.getState().model;
        if (opts.length > 0 && !opts.includes(current)) void selectLocalModel(opts[0]);
      }
      return;
    }
    setProvider(value as ProviderType);
  };

  const endpointFor = (entry: LocalProviderEntry) =>
    endpointDrafts[entry.key] ?? entry.endpoint;

  const setEndpointDraft = (key: string, value: string) =>
    setEndpointDrafts((prev) => ({ ...prev, [key]: value }));

  const clearConnectError = (key: string) =>
    setConnectError((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });

  const cardState = (entry: LocalProviderEntry): CardState => {
    if (connectingKey === entry.key) return "connecting";
    if (connectError[entry.key]) return "failed";
    if (entry.status === "connected") return "connected";
    if (entry.status === "checking") return "checking";
    return "disconnected";
  };

  /** Reuses the existing discovery / validation mechanism for one provider. */
  const refreshEntry = async (entry: LocalProviderEntry) => {
    if (entry.providerType === "ollama") {
      await refreshOllamaModels(endpointFor(entry));
      return;
    }
    if (!entry.id) return;
    const persisted = useLocalModelStore
      .getState()
      .providers.find((p) => p.id === entry.id);
    await runCheck(entry.id, endpointFor(entry), entry.providerType, persisted?.apiKey);
  };

  const handleConnect = async (entry: LocalProviderEntry) => {
    const endpoint = endpointFor(entry);
    if (validateEndpoint(endpoint)) {
      setConnectError((prev) => ({
        ...prev,
        [entry.key]: "That address doesn't look right. Check it under Advanced connection settings."
      }));
      setAdvancedOpen((prev) => ({ ...prev, [entry.key]: true }));
      return;
    }

    setConnectingKey(entry.key);
    clearConnectError(entry.key);

    try {
      if (entry.providerType === "ollama") {
        await refreshOllamaModels(endpoint);
        const st = useLocalModelStore.getState();
        if (st.ollamaStatus !== "connected") {
          if (entry.id) {
            setEndpointChecks((prev) => ({
              ...prev,
              [entry.id!]: { ok: false, message: "", models: [] }
            }));
          }
          setConnectError((prev) => ({
            ...prev,
            [entry.key]: connectionFailureMessage("ollama")
          }));
          return;
        }
        const normalized = normalizeEndpoint(endpoint, "ollama");
        let row = st.providers.find((p) => p.providerType === "ollama");
        if (!row) {
          row = await addLocalProvider({
            name: "Ollama",
            providerType: "ollama",
            endpoint: normalized
          });
        } else if (row.endpoint !== normalized || !row.enabled) {
          await updateLocalProvider(row.id, { endpoint: normalized, enabled: true });
        }
        setActiveLocalKey(row.id);
        const first = st.discoveredOllamaModels[0]?.modelId;
        if (first) await selectLocalModel(first);
        return;
      }

      // OpenAI-compatible providers (LM Studio, vLLM, custom endpoints) reuse
      // the same test/discovery helper the app already uses everywhere.
      const type = entry.providerType;
      const current = useLocalModelStore.getState();
      const existing = current.providers.find((p) => p.providerType === type);
      const res = await testLocalEndpoint(endpoint, type, existing?.apiKey);
      const models = res.models ?? [];
      if (entry.id) {
        setEndpointChecks((prev) => ({
          ...prev,
          [entry.id!]: { ok: res.ok, message: "", models }
        }));
      }
      if (!res.ok) {
        setConnectError((prev) => ({
          ...prev,
          [entry.key]: res.endpointReachable
            ? rejectionMessage(type)
            : connectionFailureMessage(type)
        }));
        return;
      }

      const normalized = normalizeEndpoint(endpoint, type);
      let row = existing;
      if (!row) {
        row = await addLocalProvider({
          name: LOCAL_PROVIDER_LABELS[type],
          providerType: type,
          endpoint: normalized
        });
      } else if (row.endpoint !== normalized || !row.enabled) {
        await updateLocalProvider(row.id, { endpoint: normalized, enabled: true });
      }
      setActiveLocalKey(row.id);
      for (const m of models) {        try {
          await addLocalModel(row.id, m);
        } catch {
          // Best-effort persistence — discovery already succeeded.
        }
      }
      setEndpointChecks((prev) => ({ ...prev, [row!.id]: { ok: true, message: "", models } }));
      if (models.length > 0) await selectLocalModel(models[0]);
    } catch {
      setConnectError((prev) => ({
        ...prev,
        [entry.key]: connectionFailureMessage(entry.providerType)
      }));
    } finally {
      setConnectingKey(null);
    }
  };

  const handleDisconnect = async (entry: LocalProviderEntry) => {
    try {
      const st = useLocalModelStore.getState();
      const row =
        (entry.id ? st.providers.find((p) => p.id === entry.id) : undefined) ??
        st.providers.find((p) => p.providerType === entry.providerType);
      const target =
        row ??
        (await addLocalProvider({
          name: entry.name,
          providerType: entry.providerType,
          endpoint: normalizeEndpoint(endpointFor(entry), entry.providerType)
        }));
      await updateLocalProvider(target.id, { enabled: false });
      if (entry.providerType === "ollama") clearDiscoveredOllamaModels();
      clearConnectError(entry.key);
      setActiveLocalKey((prev) => (prev === entry.key ? null : prev));

      // The chat must not stay on a provider that is no longer reachable.
      const chat = useChatStore.getState();
      if (chat.provider === "local") {
        const after = useLocalModelStore.getState();
        const alive = after.models.filter(
          (m) => m.enabled && after.providers.some((p) => p.id === m.providerId && p.enabled)
        );
        if (alive.length > 0) await selectLocalModel(alive[0].modelId);
        else chat.setProvider("groq");
      }
    } catch {
      // Best-effort: the card always reflects the store state.
    }
  };

  const pickProviderType = (type: LocalProviderType) => {
    setPendingTypes((prev) => (prev.includes(type) ? prev : [...prev, type]));
    setChooserOpen(false);
    if (type === "generic") {
      setAdvancedOpen((prev) => ({ ...prev, [`pending:${type}`]: true }));
    }
  };

  const renderAdvancedSettings = (entry: LocalProviderEntry) => {
    const open = !!advancedOpen[entry.key];
    return (
      <div className="space-y-1.5">
        <button
          type="button"
          onClick={() =>
            setAdvancedOpen((prev) => ({ ...prev, [entry.key]: !prev[entry.key] }))
          }
          aria-expanded={open}
          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        >
          <ChevronDownIcon
            className={`h-3 w-3 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          />
          Advanced connection settings
        </button>
        {open && (
          <div className="space-y-1">
            <label
              htmlFor={`local-endpoint-${entry.key}`}
              className="block text-[11px] font-medium text-muted-foreground"
            >
              Endpoint
            </label>
            <input
              id={`local-endpoint-${entry.key}`}
              value={endpointFor(entry)}
              onChange={(e) => setEndpointDraft(entry.key, e.target.value)}
              placeholder={LOCAL_PROVIDER_DEFAULT_ENDPOINTS[entry.providerType]}
              className={INPUT_CLASSES}
            />
          </div>
        )}
      </div>
    );
  };

  const renderCard = (entry: LocalProviderEntry) => {
    const state = cardState(entry);
    const options = optionsFor(entry);
    // Exactly one "Model" picker exists at a time: the active local provider's
    // card owns it while a local provider is selected, the Models section owns
    // it for cloud providers.
    const showPicker =
      isLocalProvider && activeLocal?.key === entry.key && options.length > 0;
    const value = options.some((o) => o.id === model) ? model : "";
    const selectedMeta = options.find((o) => o.id === value)?.meta;
    // A persisted, enabled provider that is still being probed (first check
    // after a reload, or a refresh) stays in the connected layout — only an
    // unreachable endpoint drops the card back to "Not connected".
    const isUp =
      state === "connected" || (state === "checking" && !!entry.id && entry.enabled);
    const busy = state === "connecting" || state === "checking";
    const showConnect =
      state === "disconnected" || state === "failed" || (state === "checking" && !isUp);
    const showAdvanced = state === "disconnected" || state === "failed";

    return (
      <li
        key={entry.key}
        data-testid={`local-provider-card-${entry.providerType}`}
        className="space-y-3 rounded-xl border border-border bg-muted/20 p-3"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-0.5">
            <p className="truncate text-xs font-bold text-foreground">{entry.name}</p>
            {(state === "connecting" || (state === "checking" && !isUp)) && (
              <p className="text-[11px] text-muted-foreground">
                Connecting to {entry.name}…
              </p>
            )}
            {isUp && (
              <p className="text-[11px] text-muted-foreground">
                {state === "checking"
                  ? "Checking models…"
                  : `${options.length} ${options.length === 1 ? "model" : "models"} available`}
              </p>
            )}
            {state === "disconnected" && (
              <p className="text-[11px] text-muted-foreground">
                {PROVIDER_BLURB[entry.providerType]}
              </p>
            )}
          </div>
          <StatusPill state={state} />
        </div>

        {state === "failed" && (
          <p role="alert" className="text-[11px] leading-relaxed text-destructive">
            {connectError[entry.key]}
          </p>
        )}

        {state === "connected" && options.length === 0 && (
          <div className="space-y-0.5">
            <p className="text-xs font-medium text-foreground">No models found</p>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Your provider is connected, but no models are available yet.
            </p>
          </div>
        )}

        {showPicker && (
          <div className="space-y-1.5">
            <label
              htmlFor={`local-model-${entry.key}`}
              className="block text-[11px] font-medium text-muted-foreground"
            >
              Model
            </label>
            <select
              id={`local-model-${entry.key}`}
              value={value}
              onChange={(e) => void selectLocalModel(e.target.value)}
              className={SELECT_CLASSES}
            >
              {value === "" && <option value="">Select a model…</option>}
              {options.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
            {value && (
              <p
                className="truncate text-[11px] font-mono text-muted-foreground"
                data-testid="selected-model-meta"
              >
                {value}
                {selectedMeta ? ` — ${selectedMeta}` : ""}
              </p>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {state === "connecting" && (
            <button type="button" disabled className={MODELS_PRIMARY_BUTTON_CLASSES}>
              Connecting…
            </button>
          )}

          {showConnect && (
            <button
              type="button"
              onClick={() => void handleConnect(entry)}
              disabled={busy}
              className={MODELS_PRIMARY_BUTTON_CLASSES}
            >
              {state === "failed" ? "Retry" : CONNECT_LABEL[entry.providerType]}
            </button>
          )}

          {isUp && (
            <>
              <button
                type="button"
                onClick={() => void refreshEntry(entry)}
                disabled={busy}
                className={MODELS_SECONDARY_BUTTON_CLASSES}
              >
                Refresh Models
              </button>
              <button
                type="button"
                onClick={() => void handleDisconnect(entry)}
                className={MODELS_SECONDARY_BUTTON_CLASSES}
              >
                Disconnect
              </button>
            </>
          )}

          {entry.id && (state === "disconnected" || state === "failed") && (
            <button
              type="button"
              onClick={() => void removeLocalProvider(entry.id as string)}
              className="ml-auto text-[11px] text-muted-foreground hover:text-destructive transition-colors cursor-pointer"
            >
              Remove
            </button>
          )}
        </div>

        {showAdvanced && renderAdvancedSettings(entry)}
      </li>
    );
  };

  return (
    <div className="space-y-4">
      <section className="space-y-3 rounded-xl border border-border bg-card p-3.5 shadow-xs">
        <h4 className="text-[10px] font-mono font-bold uppercase tracking-wider text-muted-foreground">
          Models
        </h4>

        <div className="space-y-1.5">
          <label htmlFor="settings-models-provider" className="block text-xs font-medium text-foreground">
            Provider
          </label>
          <select
            id="settings-models-provider"
            value={providerValue}
            onChange={(e) => handleProviderChange(e.target.value)}
            className={SELECT_CLASSES}
          >
            <optgroup label="Cloud">
              {CLOUD_PROVIDERS.map((p) => (
                <option key={p} value={p}>
                  {PROVIDER_LABELS[p]}
                </option>
              ))}
            </optgroup>
            <optgroup label="Local">
              {localEntries.map((entry) => (
                <option key={entry.key} value={`local:${entry.key}`}>
                  {entry.name} • {entry.statusLabel}
                </option>
              ))}
            </optgroup>
          </select>
        </div>

        {/* Cloud models are picked here; local models are picked on the
            provider card below, right after connecting. */}
        {!isLocalProvider && (
          <div className="space-y-1.5">
            <label
              htmlFor="settings-models-model"
              className="block text-xs font-medium text-foreground"
            >
              Model
            </label>
            <select
              id="settings-models-model"
              value={modelValue}
              onChange={(e) => setModel(e.target.value)}
              className={SELECT_CLASSES}
            >
              {modelOptions.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
            <p className="text-[10px] font-mono text-muted-foreground">
              {modelOptions.length} {modelOptions.length === 1 ? "model" : "models"}
            </p>
          </div>
        )}

        {isLocalProvider && (
          <p className="text-[11px] text-muted-foreground">
            Local models are picked on the provider card below.
          </p>
        )}
      </section>

      <section className="space-y-3 rounded-xl border border-border bg-card p-3.5 shadow-xs">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-[10px] font-mono font-bold uppercase tracking-wider text-muted-foreground">
            Local Providers
          </h4>
          {!setupOpen && !chooserVisible && missingTypes.length > 0 && (
            <button
              type="button"
              onClick={() => setSetupOpen(true)}
              className="rounded-xl bg-primary text-primary-foreground px-3 py-1 text-xs font-semibold hover:opacity-90 cursor-pointer"
            >
              + Add Local Provider
            </button>
          )}
        </div>

        {!localHydrated ? (
          <p className="text-[11px] font-mono text-muted-foreground">Loading local providers…</p>
        ) : (
          <div className="space-y-2">
            {setupOpen && localHydrated && (
              <LocalSetupPanel
                onClose={() => setSetupOpen(false)}
                onAdvanced={() => {
                  setSetupOpen(false);
                  setChooserOpen(true);
                }}
              />
            )}

            {chooserVisible && (
              <ProviderChooser
                types={missingTypes.length > 0 ? missingTypes : LOCAL_PROVIDER_TYPES}
                onPick={pickProviderType}
                onCancel={() => setChooserOpen(false)}
              />
            )}

            {cardEntries.map((entry) => renderCard(entry))}

            {!chooserVisible && !setupOpen && cardEntries.length === 0 && (
              <p className="text-[11px] text-muted-foreground">No local providers yet.</p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────── src/components/LocalSetupPanel.tsx */
"use client";


const ENDPOINT = LOCAL_PROVIDER_DEFAULT_ENDPOINTS.ollama;
const INSTALL_URL = "https://ollama.com/download";

type SetupPhase = "detect" | "download" | "connecting" | "ready" | "failed";

interface LocalSetupPanelProps {
  /** Close the panel (downloads keep running in the store). */
  onClose: () => void;
  /** Hand over to the manual/advanced provider configuration. */
  onAdvanced: () => void;
}

const SECONDARY_BUTTON_CLASSES =
  "rounded-xl border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed";

const PRIMARY_BUTTON_CLASSES =
  "rounded-xl bg-primary text-primary-foreground px-3 py-1.5 text-xs font-semibold hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed";

const DOWNLOAD_STEPS = [
  "Checking Ollama",
  "Preparing model download",
  "Downloading model data",
  "Verifying installation"
];

function downloadStepIndex(progress: OllamaPullProgress | null): number {
  if (!progress) return 1;
  if (progress.status === "success") return 3;
  if (progress.completed != null) return 2;
  if (/verifying|writing|digest/i.test(progress.status)) return 2;
  if (/manifest|waiting|starting/i.test(progress.status)) return 1;
  return 1;
}

/** Map raw Ollama pull statuses to plain user-facing text. */
function downloadStatusLabel(status: string | undefined): string {
  if (!status) return "Downloading model data…";
  if (/^success$/i.test(status)) return "Download complete";
  if (/verifying|digest/i.test(status)) return "Verifying download…";
  if (/writing manifest/i.test(status)) return "Finalizing…";
  if (/pulling manifest/i.test(status)) return "Preparing model download…";
  if (/waiting|starting/i.test(status)) return "Preparing model download…";
  return "Downloading model data…";
}

function installedModelLabel(modelId: string): string {
  return OLLAMA_MODEL_CATALOGUE.find((m) => m.id === modelId)?.label ?? modelId;
}

function installedMeta(m: DiscoveredOllamaModelDetailed): string {
  const parts = [
    m.parameterSize,
    m.quantization,
    m.family,
    m.size ? formatBytes(m.size) : undefined
  ].filter(Boolean);
  return parts.join(" • ");
}

function StepList({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="space-y-1" data-testid="setup-steps">
      {steps.map((label, i) => (
        <li key={label} className="flex items-center gap-2 text-[11px]">
          {i < current ? (
            <CheckIcon className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
          ) : i === current ? (
            <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-primary" aria-hidden="true" />
          ) : (
            <span className="h-1.5 w-1.5 shrink-0 rounded-full border border-muted-foreground/50" aria-hidden="true" />
          )}
          <span className={i <= current ? "text-foreground" : "text-muted-foreground"}>{label}</span>
        </li>
      ))}
    </ol>
  );
}

function LocalSetupPanel({ onClose, onAdvanced }: LocalSetupPanelProps) {
  const [device, setDevice] = useState<DeviceProfile | null>(null);
  const [checking, setChecking] = useState(true);
  const [detection, setDetection] = useState<SetupDetection | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [phase, setPhase] = useState<SetupPhase>("detect");
  const [failure, setFailure] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const pullTask = useLocalModelStore((s) => s.ollamaPullTask);
  const pullProgress = useLocalModelStore((s) => s.ollamaPullProgress);
  const refreshOllamaModels = useLocalModelStore((s) => s.refreshOllamaModels);

  const continuedRef = useRef(false);

  const runDetection = useCallback(async () => {
    setChecking(true);
    setFailure(null);
    try {
      const d = await detectOllamaSetup({ endpoint: ENDPOINT });
      setDetection(d);
    } catch {
      setDetection({ state: "unknown", reason: "blocked", via: "direct" });
    } finally {
      setChecking(false);
    }
  }, []);

  /**
   * Persist the discovered model, select it, then verify with a real test
   * message. "Ready" is only reachable through this verification.
   */
  const connectFlow = useCallback(
    async (modelId: string) => {
      setPhase("connecting");
      setFailure(null);
      setSelected(modelId);
      try {
        await refreshOllamaModels(ENDPOINT);
        const st = useLocalModelStore.getState();
        if (st.ollamaStatus !== "connected") {
          throw new Error("Couldn't reach Ollama. Make sure it's running, then try again.");
        }
        // Verify with a real reply before touching the chat selection — a
        // failed setup must never look like a working model.
        const verification = await verifyLocalChat(ENDPOINT, modelId);
        if (!verification.ok) {
          throw new Error(verification.message || "The connection test failed.");
        }
        await selectLocalModel(modelId);
        useLocalModelStore.getState().clearPullTask();
        setPhase("ready");
      } catch (e) {
        setPhase("failed");
        setFailure(friendlySetupError(e));
      }
    },
    [refreshOllamaModels]
  );

  const startDownload = useCallback(async (modelId: string) => {
    setFailure(null);
    setPhase("download");
    try {
      await useLocalModelStore.getState().pullOllamaModel(modelId);
    } catch {
      // Failure and cancellation are surfaced through pullTask in the panel.
    }
  }, []);

  const backToDetection = useCallback(() => {
    useLocalModelStore.getState().clearPullTask();
    setPhase("detect");
    void runDetection();
  }, [runDetection]);

  useEffect(() => {
    let alive = true;
    void getDeviceProfile().then((d) => {
      if (alive) setDevice(d);
    });
    return () => {
      alive = false;
    };
  }, []);

  // First open: resume an in-flight download, drop stale task states, or detect.
  useEffect(() => {
    const task = useLocalModelStore.getState().ollamaPullTask;
    if (task?.status === "pulling") {
      setPhase("download");
      setChecking(false);
      return;
    }
    if (task) useLocalModelStore.getState().clearPullTask();
    void runDetection();
  }, [runDetection]);

  // A finished download continues automatically: detect, then connect + verify.
  useEffect(() => {
    if (pullTask?.status !== "completed") return;
    if (phase !== "download" || continuedRef.current) return;
    continuedRef.current = true;
    const model = pullTask.model;
    void (async () => {
      const d = await detectOllamaSetup({ endpoint: ENDPOINT });
      setDetection(d);
      setChecking(false);
      if (d.state === "models") await connectFlow(model);
    })();
  }, [pullTask, phase, connectFlow]);

  const installedRec = useMemo(() => {
    if (detection?.state !== "models" || !detection.models) return null;
    const profile = device ?? { ramGB: null, freeDiskBytes: null, os: null };
    return recommendInstalledModel(detection.models, profile);
  }, [detection, device]);

  // Default selection follows the hardware-aware recommendation.
  useEffect(() => {
    if (device === null || selected) return;
    if (detection?.state !== "models" || !detection.models?.length) return;
    setSelected(installedRec?.modelId ?? detection.models[0].modelId);
  }, [device, detection, installedRec, selected]);

  const catalogueRec = useMemo(() => (device ? recommendCatalogueModel(device) : null), [device]);
  const otherModels = useMemo(() => {
    if (!device || !catalogueRec) return [];
    return compatibleCatalogueModels(device).filter((m) => m.id !== catalogueRec.model.id);
  }, [device, catalogueRec]);

  const phaseLabel = (() => {
    if (phase === "download") return "Installing model";
    if (phase === "connecting" || phase === "failed") return "Connecting";
    if (phase === "ready") return "Ready";
    if (checking || !detection) return "Checking device";
    if (detection.state === "models") return "Models available";
    return "Ollama detected";
  })();

  const downloadStep = pullTask ? downloadStepIndex(pullProgress) : 0;
  const hasBytes = pullProgress?.total != null && pullProgress?.completed != null;
  const percent =
    pullProgress?.percent != null && Number.isFinite(pullProgress.percent)
      ? Math.max(0, Math.min(100, pullProgress.percent))
      : null;
  const downloadError = pullTask?.error
    ? friendlySetupError(new Error(pullTask.error))
    : "The download failed. Please try again.";

  const showDetect = phase === "detect";

  return (
    <div
      className="space-y-3 rounded-xl border border-dashed border-border bg-muted/20 p-3"
      data-testid="local-setup-panel"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="text-xs font-semibold text-foreground">Set up local AI</p>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Nexuss will detect Ollama, install a model if you need one, and connect it to chat.
          </p>
          <p className="text-[10px] font-mono text-muted-foreground" data-testid="setup-endpoint">
            {ENDPOINT}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span
            className="rounded-full border border-border bg-card px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
            data-testid="setup-phase"
          >
            {phaseLabel}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close setup"
            className="rounded-lg p-1 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          >
            <XIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* ---------- Checking ---------- */}
      {showDetect && checking && (
        <div className="space-y-2" data-testid="setup-detecting">
          <p className="text-xs font-medium text-foreground">Checking your device…</p>
          <p className="text-[11px] text-muted-foreground">
            Looking for Ollama and any models you already have installed.
          </p>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full w-1/3 animate-pulse rounded-full bg-primary/60" />
          </div>
        </div>
      )}

      {/* ---------- Models available ---------- */}
      {showDetect && !checking && detection?.state === "models" && (
        <div className="space-y-2.5" data-testid="setup-models">
          <div>
            <p className="text-xs font-semibold text-foreground">Ollama detected</p>
            <p className="text-[11px] text-muted-foreground">Models available on this device:</p>
          </div>
          <fieldset className="space-y-1.5" data-testid="setup-models-list">
            <legend className="sr-only">Choose a model</legend>
            {(detection.models ?? []).map((m) => {
              const recommended = installedRec?.modelId === m.modelId;
              return (
                <label
                  key={m.modelId}
                  className={`flex cursor-pointer items-start gap-2 rounded-xl border p-2.5 transition-colors ${
                    selected === m.modelId
                      ? "border-primary/60 bg-primary/5"
                      : "border-border bg-card hover:bg-muted/40"
                  }`}
                >
                  <input
                    type="radio"
                    name="nexuss-setup-model"
                    value={m.modelId}
                    checked={selected === m.modelId}
                    onChange={() => setSelected(m.modelId)}
                    className="mt-0.5 cursor-pointer"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-xs font-medium text-foreground">{m.modelId}</span>
                      {recommended && (
                        <span
                          className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-primary"
                          data-testid="setup-recommended-badge"
                        >
                          Recommended
                        </span>
                      )}
                    </span>
                    {installedMeta(m) && (
                      <span className="mt-0.5 block text-[10px] text-muted-foreground">
                        {installedMeta(m)}
                      </span>
                    )}
                  </span>
                </label>
              );
            })}
          </fieldset>
          {installedRec?.estimated && (
            <p className="text-[10px] text-muted-foreground" data-testid="setup-recommendation-note">
              The recommendation is an estimate — we couldn&apos;t read this device&apos;s exact specs.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!selected}
              onClick={() => selected && void connectFlow(selected)}
              className={PRIMARY_BUTTON_CLASSES}
              data-testid="setup-connect"
            >
              Connect to Nexuss
            </button>
            <button
              type="button"
              onClick={onAdvanced}
              className={SECONDARY_BUTTON_CLASSES}
              data-testid="setup-advanced"
            >
              Advanced configuration
            </button>
          </div>
        </div>
      )}

      {/* ---------- Ollama running, no models ---------- */}
      {showDetect && !checking && detection?.state === "no_models" && (
        <div className="space-y-2.5" data-testid="setup-no-models">
          <div>
            <p className="text-xs font-semibold text-foreground">No models installed yet</p>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Ollama is running but doesn&apos;t have any models. Download one below — Nexuss will
              install it and connect it automatically.
            </p>
          </div>

          {catalogueRec && (
            <div
              className="space-y-1.5 rounded-xl border border-primary/40 bg-primary/5 p-3"
              data-testid="setup-recommended"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-foreground">{catalogueRec.model.label}</p>
                <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-primary">
                  Recommended
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground">
                {catalogueRec.model.params} • ~{formatBytes(catalogueRec.model.downloadBytes)}{" "}
                download • {catalogueRec.model.use}
              </p>
              <p className="text-[10px] text-muted-foreground">{catalogueRec.reason}</p>
              <button
                type="button"
                onClick={() => void startDownload(catalogueRec.model.id)}
                className={PRIMARY_BUTTON_CLASSES}
                data-testid="setup-download-start"
              >
                <DownloadIcon className="mr-1 inline h-3 w-3 align-[-2px]" />
                Download &amp; Set Up
              </button>
            </div>
          )}

          {otherModels.length > 0 && (
            <div className="space-y-1.5">
              <button
                type="button"
                onClick={() => setShowAll((v) => !v)}
                aria-expanded={showAll}
                className="text-[11px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                data-testid="setup-show-others"
              >
                {showAll ? "Hide other compatible models" : "See other compatible models"}
              </button>
              {showAll && (
                <ul className="space-y-1.5" data-testid="setup-other-models">
                  {otherModels.map((m) => (
                    <li
                      key={m.id}
                      className="flex items-center justify-between gap-2 rounded-xl border border-border bg-card p-2.5"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-medium text-foreground">
                          {m.label}
                        </span>
                        <span className="block text-[10px] text-muted-foreground">
                          {m.params} • ~{formatBytes(m.downloadBytes)} • {m.use}
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={() => void startDownload(m.id)}
                        className={SECONDARY_BUTTON_CLASSES}
                        aria-label={`Download ${m.label}`}
                      >
                        Download
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={onAdvanced}
            className={SECONDARY_BUTTON_CLASSES}
            data-testid="setup-advanced"
          >
            Advanced configuration
          </button>
        </div>
      )}

      {/* ---------- Ollama not installed ---------- */}
      {showDetect && !checking && detection?.state === "not_installed" && (
        <div className="space-y-2.5" data-testid="setup-not-installed">
          <div>
            <p className="text-xs font-semibold text-foreground">Ollama isn&apos;t installed yet</p>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Install Ollama to run AI models locally on your device. Nexuss will help you finish
              the setup.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={INSTALL_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={`${PRIMARY_BUTTON_CLASSES} inline-block`}
              data-testid="setup-install-link"
            >
              Install Ollama
            </a>
            <button
              type="button"
              onClick={() => void runDetection()}
              className={SECONDARY_BUTTON_CLASSES}
              data-testid="setup-check-again"
            >
              Check Again
            </button>
            <button
              type="button"
              onClick={onAdvanced}
              className={SECONDARY_BUTTON_CLASSES}
              data-testid="setup-advanced"
            >
              Advanced configuration
            </button>
          </div>
        </div>
      )}

      {/* ---------- Ollama installed but stopped ---------- */}
      {showDetect && !checking && detection?.state === "stopped" && (
        <div className="space-y-2.5" data-testid="setup-stopped">
          <div>
            <p className="text-xs font-semibold text-foreground">Ollama is installed but not running</p>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Open the Ollama app on your computer, then check again.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void runDetection()}
              className={PRIMARY_BUTTON_CLASSES}
              data-testid="setup-check-again"
            >
              Check Again
            </button>
            <button
              type="button"
              onClick={onAdvanced}
              className={SECONDARY_BUTTON_CLASSES}
              data-testid="setup-advanced"
            >
              Advanced configuration
            </button>
          </div>
        </div>
      )}

      {/* ---------- Could not determine (never "not installed") ---------- */}
      {showDetect && !checking && detection?.state === "unknown" && (
        <div className="space-y-2.5" data-testid="setup-unknown">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <AlertTriangleIcon className="h-4 w-4 shrink-0 text-destructive" />
              <p className="text-xs font-semibold text-foreground">
                {unknownReasonCopy(detection.reason)}
              </p>
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              We couldn&apos;t tell whether Ollama is available on this computer. It may not be
              installed, not running, or your browser may be blocking local network access.
            </p>
          </div>
          <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-muted-foreground">
            <li>Install or open Ollama and make sure it is running.</li>
            <li>Start the Nexuss local connector on this computer.</li>
            <li>Allow local network access when your browser asks.</li>
          </ul>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void runDetection()}
              className={PRIMARY_BUTTON_CLASSES}
              data-testid="setup-check-again"
            >
              Check Again
            </button>
            <a
              href={INSTALL_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={`${SECONDARY_BUTTON_CLASSES} inline-block`}
              data-testid="setup-install-link"
            >
              Install Ollama
            </a>
            <button
              type="button"
              onClick={onAdvanced}
              className={SECONDARY_BUTTON_CLASSES}
              data-testid="setup-advanced"
            >
              Advanced configuration
            </button>
          </div>
        </div>
      )}

      {/* ---------- Downloading ---------- */}
      {phase === "download" && pullTask && (
        <div className="space-y-3" data-testid="setup-download">
          <div>
            <p className="text-xs font-semibold text-foreground">
              Installing {installedModelLabel(pullTask.model)}
            </p>
            <p className="text-[11px] text-muted-foreground">
              You can close this panel — the download keeps running.
            </p>
          </div>

          {pullTask.status === "pulling" && (
            <>
              <StepList steps={DOWNLOAD_STEPS} current={downloadStep} />
              <div className="space-y-1.5" data-testid="setup-download-progress">
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full rounded-full bg-primary transition-all ${
                      percent == null ? "w-1/3 animate-pulse" : ""
                    }`}
                    style={percent != null ? { width: `${percent}%` } : undefined}
                  />
                </div>
                <div className="flex items-center justify-between text-[10px] font-mono text-muted-foreground">
                  <span>{downloadStatusLabel(pullProgress?.status)}</span>
                  <span>{percent != null ? `${Math.round(percent)}%` : "…"}</span>
                </div>
                {hasBytes && (
                  <p className="text-[10px] font-mono text-muted-foreground" data-testid="setup-download-bytes">
                    {formatBytes(pullProgress!.completed!)} / {formatBytes(pullProgress!.total!)}
                    {typeof pullProgress?.bytesPerSecond === "number" && pullProgress.bytesPerSecond > 0
                      ? ` • ${formatBytes(pullProgress.bytesPerSecond)}/s`
                      : ""}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => useLocalModelStore.getState().cancelPullOllamaModel()}
                className={SECONDARY_BUTTON_CLASSES}
                data-testid="setup-cancel-download"
              >
                Cancel Download
              </button>
            </>
          )}

          {pullTask.status === "completed" && (
            <p className="text-[11px] text-muted-foreground" data-testid="setup-download-complete">
              Download complete — connecting to Nexuss…
            </p>
          )}

          {pullTask.status === "cancelled" && (
            <div className="space-y-2" data-testid="setup-download-cancelled">
              <p className="text-[11px] text-muted-foreground">Download cancelled.</p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void startDownload(pullTask.model)}
                  className={PRIMARY_BUTTON_CLASSES}
                >
                  Try Again
                </button>
                <button type="button" onClick={backToDetection} className={SECONDARY_BUTTON_CLASSES}>
                  Back
                </button>
              </div>
            </div>
          )}

          {pullTask.status === "failed" && (
            <div className="space-y-2" data-testid="setup-download-failed">
              <p role="alert" className="text-[11px] leading-relaxed text-destructive">
                {downloadError}
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void startDownload(pullTask.model)}
                  className={PRIMARY_BUTTON_CLASSES}
                >
                  Try Again
                </button>
                <button type="button" onClick={backToDetection} className={SECONDARY_BUTTON_CLASSES}>
                  Back
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ---------- Connecting / verifying ---------- */}
      {phase === "connecting" && (
        <div className="space-y-2.5" data-testid="setup-connecting">
          <div>
            <p className="text-xs font-semibold text-foreground">Connecting model to Nexuss</p>
            <p className="text-[11px] text-muted-foreground">
              Sending a tiny test message to confirm the model really replies before setup is
              marked complete.
            </p>
          </div>
          <ol className="space-y-1" data-testid="setup-connecting-steps">
            <li className="flex items-center gap-2 text-[11px]">
              <CheckIcon className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
              <span className="text-foreground">Connecting model to Nexuss</span>
            </li>
            <li className="flex items-center gap-2 text-[11px]">
              <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-primary" aria-hidden="true" />
              <span className="text-foreground">Testing chat</span>
            </li>
          </ol>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
          </div>
        </div>
      )}

      {/* ---------- Ready (only after a verified reply) ---------- */}
      {phase === "ready" && (
        <div className="space-y-2.5" data-testid="setup-ready">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/15">
              <CheckIcon className="h-4 w-4 text-emerald-600" />
            </span>
            <p className="text-sm font-semibold text-foreground">Your local AI is ready</p>
          </div>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {selected ? `${selected} is` : "The model is"} installed, connected, and verified with a
            test message. It&apos;s now selected for chat.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onClose}
              className={PRIMARY_BUTTON_CLASSES}
              data-testid="setup-start-chatting"
            >
              Start Chatting
            </button>
            <button
              type="button"
              onClick={onClose}
              className={SECONDARY_BUTTON_CLASSES}
              data-testid="setup-manage-models"
            >
              Manage Models
            </button>
          </div>
        </div>
      )}

      {/* ---------- Failed ---------- */}
      {phase === "failed" && (
        <div className="space-y-2.5" data-testid="setup-failure">
          <div className="flex items-center gap-2">
            <AlertTriangleIcon className="h-4 w-4 shrink-0 text-destructive" />
            <p className="text-xs font-semibold text-foreground">Setup didn&apos;t finish</p>
          </div>
          <p role="alert" className="text-[11px] leading-relaxed text-destructive">
            {failure}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setPhase("detect");
                setFailure(null);
                void runDetection();
              }}
              className={PRIMARY_BUTTON_CLASSES}
              data-testid="setup-retry"
            >
              Try Again
            </button>
            <button
              type="button"
              onClick={onAdvanced}
              className={SECONDARY_BUTTON_CLASSES}
              data-testid="setup-advanced"
            >
              Advanced configuration
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────── src/components/SettingsContent.tsx */
"use client";


type ApiKeyProvider = "groq" | "gemini" | "openrouter";

type SettingsTab = "general" | "account" | "keys" | "models" | "usage";

const KEY_FIELDS: ApiKeyProvider[] = ["groq", "gemini", "openrouter"];

const EMPTY_STATUS: Record<ApiKeyProvider, ApiKeyStatus> = {
  groq: { provider: "groq", has_key: false, updatedAt: 0 },
  gemini: { provider: "gemini", has_key: false, updatedAt: 0 },
  openrouter: { provider: "openrouter", has_key: false, updatedAt: 0 }
};

interface SettingsContentProps {
  initialTab?: SettingsTab;
}

function SettingsContent({ initialTab = "general" }: SettingsContentProps) {
  const theme = useChatStore((s) => s.theme);
  const provider = useChatStore((s) => s.provider);
  const model = useChatStore((s) => s.model);
  const setTheme = useChatStore((s) => s.setTheme);
  const setProvider = useChatStore((s) => s.setProvider);
  const setModel = useChatStore((s) => s.setModel);
  const providers: ProviderType[] = ["groq", "gemini", "openrouter", "local"];

  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);

  // ---- API key management ----
  const [keyStatus, setKeyStatus] = useState<Record<ApiKeyProvider, ApiKeyStatus>>(
    EMPTY_STATUS
  );
  const [inputs, setInputs] = useState<Record<ApiKeyProvider, string>>({
    groq: "",
    gemini: "",
    openrouter: ""
  });
  const [visible, setVisible] = useState<Record<ApiKeyProvider, boolean>>({
    groq: false,
    gemini: false,
    openrouter: false
  });
  const [saving, setSaving] = useState<ApiKeyProvider | null>(null);
  const [testing, setTesting] = useState<ApiKeyProvider | null>(null);
  const [apiMessage, setApiMessage] = useState<{
    type: "success" | "error";
    text: string;
    provider?: ApiKeyProvider;
  } | null>(null);

  // ---- Local models (read-only here; the Models tab owns local management) ----
  const localModels = useLocalModelStore((s) => s.models);

  useEffect(() => {
    apiKeyService
      .list()
      .then((statuses) => {
        const next = { ...EMPTY_STATUS };
        for (const s of statuses) {
          if (s.provider in next) next[s.provider as ApiKeyProvider] = s;
        }
        setKeyStatus(next);
      })
      .catch(() => {
        setApiMessage({
          type: "error",
          text: "Could not load API key status. Check your connection."
        });
      });
  }, []);

  const handleTestKey = async (field: ApiKeyProvider) => {
    const value = inputs[field].trim();
    if (!value) {
      setApiMessage({
        type: "error",
        text: "Enter an API key to test.",
        provider: field
      });
      return;
    }
    setTesting(field);
    setApiMessage(null);
    try {
      const result = await apiKeyService.test(field, value);
      setApiMessage({
        type: result.valid ? "success" : "error",
        text: result.message,
        provider: field
      });
    } catch (e: unknown) {
      setApiMessage({
        type: "error",
        text: getErrorMessage(e),
        provider: field
      });
    } finally {
      setTesting(null);
    }
  };

  const handleSaveKey = async (field: ApiKeyProvider) => {
    const value = inputs[field].trim();
    if (!value) {
      setApiMessage({
        type: "error",
        text: "Enter an API key to save.",
        provider: field
      });
      return;
    }
    setSaving(field);
    setApiMessage(null);
    try {
      const status = await apiKeyService.save(field, value);
      setKeyStatus((prev) => ({ ...prev, [field]: status }));
      setInputs((prev) => ({ ...prev, [field]: "" }));
      setApiMessage({
        type: "success",
        text: `${PROVIDER_LABELS[field]} API key connected successfully.`,
        provider: field
      });
    } catch (e: unknown) {
      setApiMessage({
        type: "error",
        text: getErrorMessage(e),
        provider: field
      });
    } finally {
      setSaving(null);
    }
  };

  const handleRemoveKey = async (field: ApiKeyProvider) => {
    setSaving(field);
    setApiMessage(null);
    try {
      await apiKeyService.remove(field);
      setKeyStatus((prev) => ({
        ...prev,
        [field]: { provider: field, has_key: false, updatedAt: 0 }
      }));
      setInputs((prev) => ({ ...prev, [field]: "" }));
      setApiMessage({
        type: "success",
        text: `${PROVIDER_LABELS[field]} API key removed.`,
        provider: field
      });
    } catch (e: unknown) {
      setApiMessage({
        type: "error",
        text: getErrorMessage(e),
        provider: field
      });
    } finally {
      setSaving(null);
    }
  };

  const modelOptions = provider === "local" ? localModels.filter((m) => m.enabled).map((m) => ({ id: m.modelId, label: m.displayName })) : PROVIDER_MODEL_OPTIONS[provider as Exclude<ProviderType, "local">] as readonly { id: string; label: string; badge?: string }[];

  return (
    <div className="space-y-4 font-sans text-xs text-foreground">
      {/* Segmented Tab Navigation */}
      <div className="flex rounded-xl bg-muted p-1 border border-border">
        <button
          type="button"
          onClick={() => setActiveTab("general")}
          className={`flex-1 rounded-lg py-1.5 font-mono text-[11px] font-medium transition-all ${
            activeTab === "general"
              ? "bg-card text-foreground border border-border shadow-xs"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Preferences
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("account")}
          className={`flex-1 rounded-lg py-1.5 font-mono text-[11px] font-medium transition-all ${
            activeTab === "account"
              ? "bg-card text-foreground border border-border shadow-xs"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Account
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("keys")}
          className={`flex-1 rounded-lg py-1.5 font-mono text-[11px] font-medium transition-all ${
            activeTab === "keys"
              ? "bg-card text-foreground border border-border shadow-xs"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          API Keys
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("models")}
          className={`flex-1 rounded-lg py-1.5 font-mono text-[11px] font-medium transition-all ${
            activeTab === "models"
              ? "bg-card text-foreground border border-border shadow-xs"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Models
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("usage")}
          className={`flex-1 rounded-lg py-1.5 font-mono text-[11px] font-medium transition-all ${
            activeTab === "usage"
              ? "bg-card text-foreground border border-border shadow-xs"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Usage
        </button>
      </div>

      {/* TAB 1: PREFERENCES */}
      {activeTab === "general" && (
        <div className="space-y-4">
          <section className="rounded-xl border border-border bg-card p-3.5 space-y-3 shadow-xs">
            <h4 className="text-[10px] font-mono font-bold uppercase tracking-wider text-muted-foreground">
              Provider &amp; Model Selection
            </h4>
            
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-foreground">Provider</label>
              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value as ProviderType)}
                className="w-full rounded-xl border border-input bg-background px-3 py-2 text-xs text-foreground outline-none focus:ring-1 focus:ring-ring"
              >
                {providers.map((p) => (
                  <option key={p} value={p}>
                    {PROVIDER_LABELS[p]}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-foreground">Model</label>
              {provider === "local" && localModels.filter((m) => m.enabled).length === 0 ? (
                <div className="rounded-xl border border-dashed border-border bg-muted/50 px-3 py-3 text-xs text-muted-foreground">
                  No local models configured. Add one in the Models tab.
                </div>
              ) : (
                <select
                  value={modelOptions.some((m) => m.id === model) ? model : (provider === "local" ? (modelOptions[0]?.id ?? "") : DEFAULT_PROVIDER_MODELS[provider as Exclude<ProviderType, "local">])}
                  onChange={(e) => setModel(e.target.value)}
                  className="w-full rounded-xl border border-input bg-background px-3 py-2 text-xs text-foreground outline-none focus:ring-1 focus:ring-ring"
                >
                  {modelOptions.map((m) => (
                    <option key={m.id} value={m.id}>
                      {(m as { badge?: string; label: string }).badge ? `${m.label} (${(m as { badge?: string }).badge})` : m.label}
                    </option>
                  ))}
                </select>
              )}
              {provider === "local" && localModels.filter((m) => m.enabled).length === 0 && (
                <p className="text-[11px] font-mono text-amber-500">Local models are required to chat locally without cloud API keys.</p>
              )}
            </div>
          </section>

          <section className="rounded-xl border border-border bg-card p-3.5 space-y-2.5 shadow-xs">
            <h4 className="text-[10px] font-mono font-bold uppercase tracking-wider text-muted-foreground">
              Appearance
            </h4>
            <div className="flex rounded-xl bg-muted p-1 border border-border">
              {(["light", "dark"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => void setTheme(t)}
                  className={`flex-1 rounded-lg py-1.5 text-xs font-semibold capitalize transition-colors ${
                    theme === t
                      ? "bg-card text-foreground border border-border shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </section>
        </div>
      )}

      {/* TAB 1.5: ACCOUNT */}
      {activeTab === "account" && <AccountPanel />}

      {/* TAB 2: API KEYS */}
      {activeTab === "keys" && (
        <div className="space-y-3">
          {KEY_FIELDS.map((field) => {
            const status = keyStatus[field];
            const label = PROVIDER_LABELS[field];
            const busy = saving === field || testing === field;
            const isConnected = status.has_key;
            const fieldMessage = apiMessage?.provider === field ? apiMessage : null;

            return (
              <div key={field} className="rounded-xl border border-border bg-card p-3.5 space-y-2.5 shadow-xs">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-foreground font-mono">{label}</span>
                  <span
                    className={`flex items-center gap-1.5 text-[10px] font-mono font-medium ${
                      isConnected ? "text-emerald-500 font-semibold" : "text-muted-foreground"
                    }`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${isConnected ? "bg-emerald-500 animate-pulse" : "bg-muted-foreground"}`} />
                    {isConnected ? "Connected" : "Not connected"}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type={visible[field] ? "text" : "password"}
                    value={inputs[field]}
                    onChange={(e) =>
                      setInputs((prev) => ({ ...prev, [field]: e.target.value }))
                    }
                    placeholder={isConnected ? "•••••••••••••••• (Replace)" : "Enter API key"}
                    autoComplete="off"
                    spellCheck={false}
                    className="w-full rounded-xl border border-input bg-background px-3 py-1.5 text-xs text-foreground placeholder-muted-foreground outline-none focus:ring-1 focus:ring-ring font-mono"
                    disabled={busy}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setVisible((prev) => ({ ...prev, [field]: !prev[field] }))
                    }
                    className="shrink-0 rounded-xl border border-border bg-muted px-2.5 py-1.5 text-[10px] font-mono text-muted-foreground hover:text-foreground"
                  >
                    {visible[field] ? "Hide" : "Show"}
                  </button>
                </div>

                {isConnected && status.updatedAt > 0 && (
                  <p className="text-[10px] font-mono text-muted-foreground">
                    Updated: {new Date(status.updatedAt).toLocaleDateString()}
                  </p>
                )}

                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => void handleSaveKey(field)}
                    disabled={busy || !inputs[field].trim()}
                    className="rounded-xl bg-primary text-primary-foreground px-3 py-1 text-xs font-semibold hover:opacity-90 disabled:opacity-30 transition-opacity cursor-pointer"
                  >
                    {saving === field ? "Saving..." : "Save"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleTestKey(field)}
                    disabled={busy || !inputs[field].trim()}
                    className="rounded-xl border border-border bg-background px-3 py-1 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-30 transition-colors cursor-pointer"
                  >
                    {testing === field ? "Testing..." : "Test"}
                  </button>
                  {isConnected && (
                    <button
                      type="button"
                      onClick={() => void handleRemoveKey(field)}
                      disabled={busy}
                      className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-1 text-xs font-medium text-destructive hover:bg-destructive/20 transition-colors cursor-pointer"
                    >
                      Remove
                    </button>
                  )}
                </div>

                {fieldMessage && (
                  <p
                    role="status"
                    className={`text-[11px] font-mono ${
                      fieldMessage.type === "success" ? "text-emerald-500 font-medium" : "text-destructive"
                    }`}
                  >
                    {fieldMessage.text}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* TAB 2.5: MODELS — local providers participate in the same Provider > Model picker as cloud providers */}
      {activeTab === "models" && <ModelsSettings />}

      {/* TAB 3: USAGE */}
      {activeTab === "usage" && (
        <section>
          <UsageDashboard />
        </section>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────── src/components/Settings.tsx */
"use client";



interface SettingsProps {
  isOpen: boolean;
  onClose: () => void;
  /** Tab to show when the modal opens (defaults to Preferences). */
  initialTab?: SettingsTab;
}

function Settings({ isOpen, onClose, initialTab = "general" }: SettingsProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // A nested dialog (e.g. the delete-account confirmation) owns Escape
      // while it is open; closing both at once would be disorienting.
      if (hasNestedEscapeOverlay()) return;
      onClose();
    };
    const handleClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKey);
    window.addEventListener("mousedown", handleClick);
    return () => {
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener("mousedown", handleClick);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs font-sans animate-in fade-in duration-150">
      <div
        ref={panelRef}
        className="w-full max-w-[440px] flex max-h-[85vh] flex-col overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-2xl backdrop-blur-xl animate-in zoom-in-95"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3 bg-muted/50">
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono font-bold tracking-wider text-foreground uppercase">
              SETTINGS
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
            aria-label="Close settings"
          >
            ✕
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <SettingsContent initialTab={initialTab} />
        </div>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────── src/components/TerminalConnectCard.tsx */
"use client";


/**
 * Inline chat action shown when a task needs terminal access but the terminal
 * is not connected. Opens the Terminal panel (its connection screen), so the
 * user can connect without entering any technical details.
 */
function TerminalConnectCard() {
  return (
    <div className="my-1 max-w-sm rounded-xl border border-border bg-card p-3 shadow-sm">
      <p className="flex items-center gap-2 text-xs font-mono font-semibold text-foreground">
        <TerminalIcon className="h-4 w-4 shrink-0 text-primary" />
        Terminal access required
      </p>
      <p className="mt-1.5 text-[11px] font-mono text-muted-foreground">
        This task requires access to your computer&apos;s terminal.
      </p>
      <button
        type="button"
        onClick={() => useWorkspaceStore.getState().openPanel()}
        className="mt-3 flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[11px] font-mono font-medium text-primary-foreground transition-colors hover:opacity-90 cursor-pointer"
      >
        <TerminalIcon className="h-3.5 w-3.5" />
        Connect Terminal
      </button>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────── src/components/TerminalConnectionScreen.tsx */
"use client";


/** The exact command the user runs to start the local connector. */
const CONNECTOR_START_COMMAND = "node local-connector/server.js";

/**
 * The Terminal connection screen shown inside the Terminal panel whenever the
 * local connector is not verified as connected. It never asks the user for
 * ports, URLs or any technical configuration — connecting is a single action
 * handled internally by the connection store. Each non-connected state gets
 * truthful, actionable copy: permission guidance when the browser blocked the
 * local-network request, the startup command when the connector is not
 * running, and a plain retry otherwise.
 */
function TerminalConnectionScreen({
  status,
  onConnect
}: {
  status: TerminalConnectionStatus;
  onConnect: () => void;
}) {
  if (status === "connecting") {
    return (
      <div className="border-t border-border p-4 animate-fade-in-up">
        <p
          role="status"
          className="flex items-center gap-2 text-[11px] font-mono font-medium text-muted-foreground"
        >
          <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
          Connecting to your terminal...
        </p>
        <p className="mt-1.5 text-[11px] font-mono text-muted-foreground">
          Verifying the local connector before enabling commands.
        </p>
      </div>
    );
  }

  if (status === "permission_required") {
    return (
      <div className="border-t border-border p-4 animate-fade-in-up">
        <p className="text-xs font-mono font-semibold text-foreground">
          Local network permission required
        </p>
        <p className="mt-1.5 text-[11px] font-mono text-muted-foreground">
          Nexuss needs your browser&apos;s permission to reach the terminal on this
          computer. When your browser asks{" "}
          <span className="text-foreground">
            &quot;Allow access to the local network&quot;
          </span>
          , click <span className="text-foreground">Allow</span>, then try again.
        </p>
        <p className="mt-1.5 text-[11px] font-mono text-muted-foreground">
          If you previously blocked it: open Chrome{" "}
          <span className="text-foreground">
            Settings → Privacy and security → Site settings → Local network access
          </span>{" "}
          and allow this site.
        </p>
        <button
          type="button"
          onClick={onConnect}
          className="mt-3 flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-[11px] font-mono font-medium text-primary-foreground transition-colors hover:opacity-90 cursor-pointer"
        >
          <TerminalIcon className="h-3.5 w-3.5" />
          Try Again
        </button>
      </div>
    );
  }

  if (status === "unavailable") {
    return (
      <div className="border-t border-border p-4 animate-fade-in-up">
        <p className="text-xs font-mono font-semibold text-foreground">
          Local connector not running
        </p>
        <p className="mt-1.5 text-[11px] font-mono text-muted-foreground">
          The Nexuss local connector was not found on this computer. Start it by
          running this command in your project folder:
        </p>
        <code className="mt-1.5 block rounded-lg border border-border bg-muted/60 px-2.5 py-1.5 text-[11px] font-mono text-foreground">
          {CONNECTOR_START_COMMAND}
        </code>
        <button
          type="button"
          onClick={onConnect}
          className="mt-3 flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-[11px] font-mono font-medium text-primary-foreground transition-colors hover:opacity-90 cursor-pointer"
        >
          <TerminalIcon className="h-3.5 w-3.5" />
          Try Again
        </button>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="border-t border-border p-4 animate-fade-in-up">
        <p className="text-xs font-mono font-semibold text-foreground">
          Terminal connection failed
        </p>
        <p className="mt-1.5 text-[11px] font-mono text-muted-foreground">
          Something went wrong while connecting to your terminal. If the
          connector is not running yet, start it with{" "}
          <code className="rounded bg-muted/60 px-1 py-0.5 text-[11px] font-mono text-foreground">
            {CONNECTOR_START_COMMAND}
          </code>{" "}
          and try again.
        </p>
        <button
          type="button"
          onClick={onConnect}
          className="mt-3 flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-[11px] font-mono font-medium text-primary-foreground transition-colors hover:opacity-90 cursor-pointer"
        >
          <TerminalIcon className="h-3.5 w-3.5" />
          Try Again
        </button>
      </div>
    );
  }

  return (
    <div className="border-t border-border p-4 animate-fade-in-up">
      <p className="text-xs font-mono font-semibold text-foreground">Terminal</p>
      <p className="mt-1.5 text-[11px] font-mono text-muted-foreground">
        Connect Nexuss to your computer&apos;s terminal.
      </p>
      <button
        type="button"
        onClick={onConnect}
        className="mt-3 flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-[11px] font-mono font-medium text-primary-foreground transition-colors hover:opacity-90 cursor-pointer"
      >
        <TerminalIcon className="h-3.5 w-3.5" />
        Connect Terminal
      </button>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────── src/components/WorkspacePanel.tsx */
/**
 * Terminal / agent workspace panel — prototype version.
 *
 * Reproduces the panel shell, the collapse behaviour, the connection status
 * dot and the Terminal connection screen. The connected state renders the
 * verified-status header and the workspace file search surface; the agent
 * staging / command execution surfaces from the production app are not
 * reproduced (see README "Not reproduced").
 */

const MOCK_FILES = [
  { path: "src/components/ChatComposer.tsx", reasons: ["matches: composer"] },
  { path: "src/store/chatStore.ts", reasons: ["matches: streaming"] },
  { path: "src/app/page.tsx", reasons: ["matches: shell layout"] },
  { path: "tailwind.config.js", reasons: ["matches: theme tokens"] }
];

function WorkspacePanel() {
  const closePanel = useWorkspaceStore((s) => s.closePanel);
  const terminalStatus = useTerminalConnectionStore((s) => s.status);
  const justConnected = useTerminalConnectionStore((s) => s.justConnected);
  const connectTerminal = useTerminalConnectionStore((s) => s.connect);
  const disconnectTerminal = useTerminalConnectionStore((s) => s.disconnect);
  const [query, setQuery] = useState("");
  const [isExpanded, setIsExpanded] = useState(terminalStatus !== "connected");
  const panelId = "workspace-details";

  useEffect(() => {
    void useTerminalConnectionStore.getState().checkConnection();
  }, []);

  const results = query.trim()
    ? MOCK_FILES.filter((f) => f.path.toLowerCase().includes(query.trim().toLowerCase()))
    : [];

  return (
    <div className="shrink-0 bg-background px-3 pb-1 sm:px-4">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-2">
        <section
          aria-label="Terminal workspace"
          className="overflow-hidden rounded-2xl border border-border bg-card shadow-lg animate-fade-in-up"
        >
          <div className="flex w-full items-center gap-1 px-4 py-3">
            <button
              type="button"
              onClick={() => setIsExpanded(!isExpanded)}
              aria-expanded={isExpanded}
              aria-controls={panelId}
              className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded-lg px-1 py-1 text-left transition-colors hover:bg-muted/50 cursor-pointer"
            >
              <span className="flex min-w-0 items-center gap-2 text-xs font-mono font-semibold text-foreground">
                <TerminalIcon className="h-4 w-4 shrink-0 text-primary" />
                <span className="truncate">Terminal</span>
              </span>
              <ChevronDownIcon
                className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
                  isExpanded ? "rotate-180" : ""
                }`}
              />
            </button>
            <span
              role="status"
              aria-label={
                terminalStatus === "connected"
                  ? "Terminal connected"
                  : terminalStatus === "connecting"
                    ? "Connecting to terminal"
                    : "Terminal disconnected"
              }
              className="flex shrink-0 items-center gap-1.5 pr-1"
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  terminalStatus === "connected"
                    ? "bg-emerald-500"
                    : terminalStatus === "connecting"
                      ? "animate-pulse bg-primary"
                      : "bg-muted-foreground/50"
                }`}
              />
              {terminalStatus === "connecting" && (
                <span className="text-[10px] font-mono font-normal text-muted-foreground">
                  Connecting…
                </span>
              )}
            </span>
            <button
              type="button"
              onClick={closePanel}
              aria-label="Close workspace panel"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground cursor-pointer"
            >
              <XIcon className="h-4 w-4" />
            </button>
          </div>

          <div
            id={panelId}
            className={
              isExpanded ? "border-t border-border animate-fade-in-up" : "max-h-0 overflow-hidden"
            }
          >
            {terminalStatus !== "connected" ? (
              <TerminalConnectionScreen
                status={terminalStatus}
                onConnect={() => void connectTerminal()}
              />
            ) : (
              <div className="border-t border-border p-4 animate-fade-in-up">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-[11px] font-mono font-medium text-foreground">
                      <span className="h-2 w-2 rounded-full bg-emerald-500" />
                      Terminal Connected
                    </p>
                    <p className="mt-1.5 text-[11px] font-mono text-muted-foreground">
                      {justConnected
                        ? "Nexuss can now execute authorized terminal tasks on this device."
                        : "Nexuss can use the authorized terminal on this device."}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void disconnectTerminal()}
                    className="flex shrink-0 items-center gap-1.5 rounded-lg border border-destructive/30 bg-destructive/10 px-2.5 py-1 text-[10px] font-mono font-medium text-destructive transition-colors hover:bg-destructive/20 cursor-pointer"
                  >
                    <XCircleIcon className="h-3.5 w-3.5" />
                    Disconnect
                  </button>
                </div>

                <p className="mt-3 text-[10px] font-mono text-muted-foreground">
                  42 files indexed
                </p>

                <div className="mt-3 flex items-center gap-2 rounded-lg border border-border bg-muted/50 px-2.5 py-2">
                  <SearchIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search files, symbols, error text…"
                    aria-label="Search workspace"
                    className="w-full bg-transparent text-xs text-foreground placeholder-muted-foreground outline-none"
                  />
                </div>

                {query.trim() ? (
                  <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto">
                    {results.length === 0 && (
                      <li className="py-1 text-[11px] font-mono text-muted-foreground">
                        No matches.
                      </li>
                    )}
                    {results.map((hit) => (
                      <li key={hit.path} className="rounded-lg bg-muted/50 px-2.5 py-1.5">
                        <p className="truncate text-xs font-mono text-foreground">{hit.path}</p>
                        <p className="truncate text-[10px] font-mono text-muted-foreground">
                          {hit.reasons.join(" • ")}
                        </p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-[10px] font-mono text-muted-foreground">
                    Your questions automatically pull in the most relevant files.
                  </p>
                )}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────── src/components/ScreenSharePanel.tsx */
"use client";


interface ScreenSharePanelProps {
  screenShare: UseScreenShare;
}

/**
 * Compact premium details section for the live screen share. Collapsed it is a
 * single header row inside the chatboard; expanded it shows the live preview,
 * the active source (only the currently selected one is ever shown — the
 * browser never exposes the full source list to the page), and the
 * change/stop controls. Never a full-screen modal.
 */
function ScreenSharePanel({ screenShare }: ScreenSharePanelProps) {
  const {
    isActive,
    isStarting,
    error,
    clearError,
    selectedSourceName,
    isExpanded,
    setExpanded,
    videoRef,
    changeScreen,
    stopSharing
  } = screenShare;

  const panelId = "screen-share-details";

  return (
    <div className="shrink-0 bg-background px-3 pb-1 sm:px-4">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-2">
        <section
          aria-label="Screen share"
          className="overflow-hidden rounded-2xl border border-border bg-card shadow-lg animate-fade-in-up"
        >
          <button
            type="button"
            onClick={() => setExpanded(!isExpanded)}
            aria-expanded={isExpanded}
            aria-controls={panelId}
            className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left transition-colors hover:bg-muted/50 cursor-pointer"
          >
            <span className="flex min-w-0 items-center gap-2 text-xs font-mono font-semibold text-foreground">
              <MonitorIcon className="h-4 w-4 shrink-0 text-primary" />
              <span className="truncate">Screen Share</span>
              {isActive && selectedSourceName && !isExpanded && (
                <span className="truncate text-[10px] font-normal text-muted-foreground">
                  • {selectedSourceName}
                </span>
              )}
            </span>
            <ChevronDownIcon
              className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
                isExpanded ? "rotate-180" : ""
              }`}
            />
          </button>

          {/* The details body collapses via CSS only. The <video> preview stays
              mounted in both states so the MediaStream is never detached:
              collapsing hides it (max-h-0 + overflow-hidden), and expanding
              shows the current live frame again instantly — no re-request, no
              re-call to getDisplayMedia, no black screen. */}
          <div
            id={panelId}
            className={
              isExpanded
                ? "border-t border-border p-4 animate-fade-in-up"
                : "max-h-0 overflow-hidden"
            }
          >
            {/* Live preview fed by the MediaStream */}
            <div className="overflow-hidden rounded-xl border border-border bg-black">
              <video
                ref={videoRef}
                muted
                autoPlay
                playsInline
                aria-label="Live screen share preview"
                className="aspect-video w-full max-h-[40vh] object-contain lg:max-h-none"
              />
              {isStarting && (
                <div className="flex items-center justify-center gap-2 bg-card py-3 text-[11px] font-mono text-muted-foreground">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
                  Waiting for selection…
                </div>
              )}
            </div>

            {isExpanded && (
              <>
                {/* Active source (only the selected one is ever shown: the
                    browser does not expose the full list to the page) */}
                <p className="mb-2 mt-4 text-[10px] font-mono font-semibold uppercase tracking-wider text-muted-foreground">
                  Sharing
                </p>
                <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/50 px-3 py-2">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full bg-emerald-500"
                    aria-hidden="true"
                  />
                  <span className="truncate text-xs text-foreground">
                    {selectedSourceName || (isStarting ? "Selecting…" : "Live screen")}
                  </span>
                </div>

                <p className="mt-2 text-[10px] font-mono text-muted-foreground">
                  The screen is being shared. Return to this chat to ask your question.
                </p>

                {/* Controls */}
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void changeScreen()}
                    disabled={isStarting}
                    className="flex items-center gap-1.5 rounded-lg border border-border bg-muted px-3 py-1.5 text-[11px] font-mono font-medium text-foreground transition-colors hover:bg-muted/70 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
                  >
                    <ArrowRightLeftIcon className="h-3.5 w-3.5" />
                    Change screen
                  </button>
                  <button
                    type="button"
                    onClick={stopSharing}
                    className="flex items-center gap-1.5 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-1.5 text-[11px] font-mono font-medium text-destructive transition-colors hover:bg-destructive/20 cursor-pointer"
                  >
                    <XCircleIcon className="h-3.5 w-3.5" />
                    Stop sharing
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Concise, user-friendly errors (cancelled, denied, unsupported) */}
          {error && (
            <div
              role="alert"
              className="flex items-center gap-2 border-t border-border bg-destructive/10 px-4 py-2.5 text-[11px] font-mono text-destructive"
            >
              <span className="flex-1">{error}</span>
              <button
                type="button"
                onClick={clearError}
                className="shrink-0 rounded bg-destructive/20 px-2 py-0.5 text-[10px] font-medium hover:bg-destructive/30 cursor-pointer"
                aria-label="Dismiss error"
              >
                Dismiss
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────── src/components/MessageList.tsx */
"use client";


interface MessageListProps {
  messages: Message[];
  loading: boolean;
  isStreaming: boolean;
  streamingMessageId: string | null;
  onSendSuggestion?: (content: string) => Promise<void>;
  screenShareActive?: boolean;
  captureScreenFrame?: () => string | null;
}

interface MessageActionProps {
  message: Message;
  streaming: boolean;
  isEditing: boolean;
  draft: string;
  copied: boolean;
  busy: boolean;
  disabled: boolean;
  onDraftChange: (value: string) => void;
  onStartEdit: (message: Message) => void;
  onCancelEdit: () => void;
  onSaveEdit: (message: Message) => void;
  onCopy: (message: Message) => void;
  onRegenerate: (message: Message) => void;
}

function MessageList({
  messages,
  loading,
  isStreaming,
  streamingMessageId,
  onSendSuggestion,
  screenShareActive,
  captureScreenFrame
}: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const editMessageAndRegenerate = useChatStore((s) => s.editMessageAndRegenerate);
  const regenerateResponse = useChatStore((s) => s.regenerateResponse);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Tracks whether the user is at/near the bottom of the conversation. Manual
  // scrolling always wins: once the user scrolls beyond the threshold, auto-
  // following stops and only resumes when they come back to the bottom.
  const [isNearBottom, setIsNearBottom] = useState(true);
  const isGenerating = loading || isStreaming;
  const prevFirstIdRef = useRef<string | undefined>(undefined);
  const prevLengthRef = useRef(0);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const near = distanceFromBottom < 120;
    setIsNearBottom((prev) => (prev === near ? prev : near));
  }, []);

  // Scroll policy:
  // - A different conversation loading in always lands on the newest message.
  // - A new message appended while the user is still near the bottom scrolls
  //   down so the reply is visible.
  // - While generating, streamed content only keeps the view pinned to the
  //   bottom when the user is already there. If the user scrolls away, their
  //   position is never overridden until they return to the bottom.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const firstId = messages[0]?.id;
    const length = messages.length;
    const chatSwitched = firstId !== undefined && firstId !== prevFirstIdRef.current;
    const messageAdded = length > prevLengthRef.current;
    prevFirstIdRef.current = firstId;
    prevLengthRef.current = length;

    if (chatSwitched) {
      el.scrollTop = el.scrollHeight;
    } else if (messageAdded && isNearBottom) {
      el.scrollTop = el.scrollHeight;
    } else if (isGenerating && isNearBottom) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, isGenerating, isNearBottom]);

  const copyTimer = useRef<number | null>(null);

  // The edit draft is read through a ref so `saveEdit` keeps a stable identity
  // while the user types, which lets memoized message rows stay memoized.
  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  const handleCopy = useCallback(async (msg: Message) => {
    try {
      await navigator.clipboard.writeText(msg.content);
    } catch {
      // Fallback for browsers/non-secure contexts without the async clipboard.
      try {
        const ta = document.createElement("textarea");
        ta.value = msg.content;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      } catch {
        return; // clipboard unavailable; do not corrupt state
      }
    }
    setCopiedId(msg.id);
    if (copyTimer.current) window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => {
      setCopiedId((id) => (id === msg.id ? null : id));
    }, 2000);
  }, []);

  const startEdit = useCallback((msg: Message) => {
    setEditingId(msg.id);
    setDraft(msg.content);
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setDraft("");
  }, []);

  const saveEdit = useCallback(
    async (msg: Message) => {
      const content = draftRef.current.trim();
      if (!content) return;
      setBusyId(msg.id);
      try {
        // While screen sharing is active, attach exactly one fresh frame taken
        // at send time so the edited question is answered with the current screen.
        const image =
          screenShareActive && captureScreenFrame
            ? (captureScreenFrame() ?? undefined)
            : undefined;
        await editMessageAndRegenerate(msg.id, content, image);
      } finally {
        setBusyId(null);
      }
      setEditingId(null);
      setDraft("");
    },
    [screenShareActive, captureScreenFrame, editMessageAndRegenerate]
  );

  const handleRegenerate = useCallback(
    async (msg: Message) => {
      setBusyId(msg.id);
      try {
        // Same rule as edit/send: one fresh frame per regenerate while sharing.
        const image =
          screenShareActive && captureScreenFrame
            ? (captureScreenFrame() ?? undefined)
            : undefined;
        await regenerateResponse(msg.id, image);
      } finally {
        setBusyId(null);
      }
    },
    [screenShareActive, captureScreenFrame, regenerateResponse]
  );

  const blocked = loading || isStreaming;

if (messages.length === 0 && !loading && !isStreaming) {
    return (
      <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col items-center justify-center px-6 py-12 text-center">
        <NexussLogo size={64} className="mb-4" />
        <h2 className="text-xl font-bold tracking-tight text-foreground font-sans">
          What&apos;s on your mind today?
        </h2>
        <p className="mt-2 max-w-md text-xs text-muted-foreground font-sans leading-relaxed">
          Ask technical questions, generate clean code, analyze complex architectures, or debug your code with NEXUSS AI.
        </p>
      </div>
    );
  }
  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className="flex min-h-0 flex-1 flex-col overflow-y-auto"
    >
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-6">
        {messages.map((msg) => (
          <MessageItem
            key={msg.id}
            message={msg}
            streaming={isStreaming && msg.id === streamingMessageId}
            isEditing={editingId === msg.id}
            draft={editingId === msg.id ? draft : msg.content}
            copied={copiedId === msg.id}
            busy={busyId === msg.id}
            disabled={blocked}
            onDraftChange={setDraft}
            onStartEdit={startEdit}
            onCancelEdit={cancelEdit}
            onSaveEdit={saveEdit}
            onCopy={handleCopy}
            onRegenerate={handleRegenerate}
          />
        ))}

        {/* Thinking indicator — shown while the request is starting, before
            streaming begins. */}
        {loading && !isStreaming && (
          <div className="flex items-center gap-3 self-start max-w-[90%]">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-card border border-border">
              <img src="/nexuss-logo.png" alt="NEXUSS" className="w-4 h-4 object-contain" />
            </div>
            <div className="flex items-center gap-2 rounded-2xl rounded-tl-sm border border-border bg-card px-4 py-3">
              <ThinkingIndicator />
            </div>
          </div>
        )}

        <div className="h-px" />
      </div>
    </div>
  );
}

const MessageItem = memo(function MessageItem(props: MessageActionProps) {
  const {
    message,
    streaming,
    isEditing,
    draft,
    copied,
    busy,
    disabled,
    onDraftChange,
    onStartEdit,
    onCancelEdit,
    onSaveEdit,
    onCopy,
    onRegenerate
  } = props;
  const isAssistant = message.role === "assistant";
  const actionsDisabled = disabled || busy;

  return (
    <div
      className={`flex w-full items-start gap-3 animate-message-in ${
        isAssistant ? "justify-start" : "justify-end"
      }`}
    >
      {isAssistant && (
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-card border border-border mt-1">
          <img src="/nexuss-logo.png" alt="NEXUSS" className="w-4 h-4 object-contain" />
        </div>
      )}

      <div className="flex min-w-0 max-w-[85%] flex-col">
        {isEditing && !isAssistant ? (
          <div className="rounded-2xl rounded-tr-sm border border-border bg-card p-3">
            <textarea
              value={draft}
              onChange={(e) => onDraftChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  onSaveEdit(message);
                }
                if (e.key === "Escape") {
                  onCancelEdit();
                }
              }}
              autoFocus
              rows={Math.min(6, Math.max(2, Math.ceil(draft.length / 60)))}
              aria-label="Edit message"
              className="max-h-48 w-full resize-none bg-transparent px-1 py-1 text-xs font-sans text-foreground placeholder-muted-foreground outline-none leading-relaxed"
            />
            <div className="mt-2 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={onCancelEdit}
                disabled={busy}
                className="rounded-lg border border-border bg-background px-3 py-1.5 text-[11px] font-mono text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50 cursor-pointer"
                title="Cancel editing (Esc)"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => onSaveEdit(message)}
                disabled={busy || !draft.trim()}
                className="rounded-lg bg-primary px-3 py-1.5 text-[11px] font-mono font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50 cursor-pointer"
                title="Send edited message (Enter)"
              >
                Send
              </button>
            </div>
          </div>
        ) : (
          <div
            className={
              isAssistant
                ? "text-xs leading-relaxed text-foreground"
                : "rounded-2xl rounded-tr-sm border border-border bg-secondary px-4 py-3 text-xs leading-relaxed text-secondary-foreground"
            }
          >
            {/* While waiting for the first content chunk the streaming assistant
                message shows the thinking indicator in place; the first visible
                chunk replaces it with the actual text. */}
            {streaming && message.content.trim() === "" ? (
              <div className="flex items-center gap-2 px-4 py-3">
                <ThinkingIndicator />
              </div>
            ) : (
              <MessageContent content={message.content} isAssistant={isAssistant} />
            )}
            {/* Blinking cursor on the assistant message while content is streaming. */}
            {streaming && message.content.trim() !== "" && (
              <span
                aria-hidden="true"
                className="ml-0.5 inline-block h-3 w-1 animate-pulse rounded-sm bg-primary align-middle"
              />
            )}
            <p className="mt-2 text-right text-[10px] font-mono text-muted-foreground/70">
              {new Date(message.timestamp).toLocaleTimeString([], {
                hour: "numeric",
                minute: "2-digit"
              })}
            </p>
          </div>
        )}

        {/* Action row */}
        {!isEditing && (
          <div
            className={`mt-1 flex items-center gap-1 ${
              isAssistant ? "justify-start" : "justify-end"
            }`}
          >
            <ActionButton
              onClick={() => onCopy(message)}
              disabled={actionsDisabled}
              label={copied ? "Copied" : "Copy message"}
              title={copied ? "Copied" : "Copy message"}
            >
              {copied ? (
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              )}
            </ActionButton>

            {isAssistant ? (
              <ActionButton
                onClick={() => onRegenerate(message)}
                disabled={actionsDisabled}
                label="Regenerate response"
                title="Regenerate response"
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="23 4 23 10 17 10" />
                  <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                </svg>
              </ActionButton>
            ) : (
              <ActionButton
                onClick={() => onStartEdit(message)}
                disabled={actionsDisabled}
                label="Edit message"
                title="Edit message"
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
              </ActionButton>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

function ThinkingIndicator() {
  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1">
        <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground" />
        <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground [animation-delay:150ms]" />
        <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground [animation-delay:300ms]" />
      </div>
      <span className="text-xs font-mono text-muted-foreground">Nexuss is thinking...</span>
    </div>
  );
}

function ActionButton({
  onClick,
  disabled,
  label,
  title,
  children
}: {
  onClick: () => void;
  disabled: boolean;
  label: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={title}
      className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
    >
      {children}
    </button>
  );
}

interface MessageContentProps {
  content: string;
  isAssistant: boolean;
}

function MessageContent({ content, isAssistant }: MessageContentProps) {
  // Terminal access gate: the chat flow answers an action that needs the
  // terminal while it is disconnected with this marker, rendered as an action
  // card the user can click to open the Terminal connection screen.
  if (content.trim() === TERMINAL_CONNECT_REQUIRED_MESSAGE) {
    return <TerminalConnectCard />;
  }
  if (isAssistant) {
    return (
      <div className="prose dark:prose-invert prose-xs max-w-none prose-p:leading-relaxed prose-pre:m-0 font-sans">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            code: CodeBlock,
            pre: PreBlock,
            table: TableBlock
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
    );
  }
  return <p className="whitespace-pre-wrap break-words leading-relaxed">{content}</p>;
}

function TableBlock(props: any) {
  const { node, ...tableProps } = props;
  // The `node` object is react-markdown plumbing and must never reach the DOM.
  void node;
  return (
    <div className="my-3 overflow-x-auto rounded-lg border border-border">
      <table {...tableProps} className="w-full text-left text-xs" />
    </div>
  );
}

function CodeBlock({ node, ...props }: any) {
  const isInline = node?.position?.start.line === node?.position?.end.line;
  if (isInline) {
    return <code {...props} className="rounded bg-muted border border-border px-1.5 py-0.5 text-[11px] font-mono text-emerald-600 dark:text-emerald-400" />;
  }
  return <pre {...props} className="my-2 overflow-x-auto rounded-lg bg-muted border border-border p-3 text-xs font-mono" />;
}

function PreBlock({ children }: any) {
  const [copied, setCopied] = useState(false);
  const codeString =
    typeof children === "string" ? children : String(children?.props?.children || "");

  const handleCopy = async () => {
    await navigator.clipboard.writeText(codeString);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative group my-3">
      <button
        onClick={handleCopy}
        className="absolute right-2.5 top-2.5 rounded bg-background border border-border px-2 py-1 text-[10px] font-mono text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100 cursor-pointer"
      >
        {copied ? "✓ Copied" : "Copy"}
      </button>
      <SyntaxHighlighter
        language="typescript"
        style={oneDark}
        className="overflow-x-auto rounded-xl bg-card border border-border text-xs font-mono"
        showLineNumbers={false}
        customStyle={{
          margin: 0,
          padding: "1rem",
          borderRadius: "0.75rem",
        }}
      >
        {codeString}
      </SyntaxHighlighter>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────── src/components/ChatHeader.tsx */
"use client";


interface ChatHeaderProps {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}

function ChatHeader({
  sidebarOpen,
  onToggleSidebar
}: ChatHeaderProps) {
  const currentChat = useChatStore((s) => s.currentChat);

  return (
    <header className="flex shrink-0 items-center justify-between border-b border-border bg-card px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        {/* Sidebar Toggle Button */}
        <button
          type="button"
          onClick={onToggleSidebar}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground cursor-pointer"
          title={sidebarOpen ? "Close sidebar" : "Open sidebar"}
          aria-label={sidebarOpen ? "Close sidebar" : "Open sidebar"}
        >
          <PanelLeftIcon className="h-4 w-4" />
        </button>

        <div className="flex min-w-0 flex-col">
          <div className="flex items-center gap-2">
            <NexussLogo size={22} color="currentColor" className="text-foreground shrink-0" />
            <span className="text-xs font-mono font-bold uppercase tracking-widest text-muted-foreground">
              NEXUSS AI
            </span>
            <span className="text-[11px] font-mono text-muted-foreground">•</span>
            <span className="truncate text-xs font-semibold text-foreground">
              {currentChat?.title || "New conversation"}
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}

/* ──────────────────────────────────────────────────────────── src/components/ChatComposer.tsx */
"use client";


interface ChatComposerProps {
  onSend: (content: string) => Promise<void>;
  onStop?: () => void;
  loading: boolean;
  disabled?: boolean;
  onStartScreenShare?: () => void;
  onOpenWorkspace?: () => void;
}

function ChatComposer({
  onSend,
  onStop,
  loading,
  disabled,
  onStartScreenShare,
  onOpenWorkspace
}: ChatComposerProps) {
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const provider = useChatStore((s) => s.provider);
  const model = useChatStore((s) => s.model);
  const fallbackNotice = useChatStore((s) => s.fallbackNotice);

  useEffect(() => {
    if (!loading && !disabled) {
      textareaRef.current?.focus();
    }
  }, [loading, disabled]);

  const blocked = !!loading || !!disabled;

  // Space reserved at the bottom of the composer for the on-screen keyboard
  // (iOS Safari) plus the home-indicator safe area on notched devices.
  const keyboardInset = useKeyboardInset();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const content = text.trim();
    if (!content || blocked) return;
    setText("");
    await onSend(content);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void handleSubmit(e as unknown as React.FormEvent);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="shrink-0 bg-background p-3 sm:p-4 dark:bg-[#0f0f0f]"
      style={
        keyboardInset > 0
          ? {
              paddingBottom: `calc(${keyboardInset}px + env(safe-area-inset-bottom, 0px))`
            }
          : undefined
      }
    >
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-2">
        {/* Typing box — borderless and flat, no shadow. ONLY this area gets
            the card background; the controls bar below stays flat. */}
        <div className="flex flex-col rounded-3xl bg-card p-2.5 transition-all duration-150">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="What’s the mission?"
            className="max-h-40 min-h-[44px] w-full resize-none bg-transparent px-3 py-2 text-xs font-sans leading-relaxed text-foreground placeholder-muted-foreground outline-none"
            rows={Math.min(4, Math.max(1, Math.ceil(text.length / 80)))}
            disabled={blocked}
            aria-label="Message input"
            style={{ outline: "none" }}
          />
        </div>

        {/* Composer Controls Bar — unchanged, no shadow/border */}
        <div className="flex items-center justify-between gap-2 px-2">
          <div className="flex min-w-0 items-center gap-2">
            <AttachMenu
              onStartScreenShare={onStartScreenShare}
              onOpenWorkspace={onOpenWorkspace}
            />
            <div className="flex min-w-0 items-center gap-2">
              <ModelSelector
                provider={provider}
                model={model}
                disabled={blocked}
              />
              {fallbackNotice && (
                <span className="truncate text-[10px] font-mono text-amber-500 font-medium">
                  {fallbackNotice}
                </span>
              )}
            </div>
          </div>

          {/* Send / Stop Button — during generation the Send button becomes a
              Stop button that aborts the active request. It stays enabled so it
              is always tappable; the partial response is preserved on stop. */}
          {blocked ? (
            <button
              type="button"
              onClick={onStop}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-foreground text-background transition-all hover:opacity-90 active:scale-95 cursor-pointer"
              title="Stop generating"
              aria-label="Stop generating"
            >
              <SquareIcon className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!text.trim()}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-foreground text-background transition-all hover:opacity-90 active:scale-95 disabled:cursor-not-allowed disabled:opacity-30 cursor-pointer"
              title="Send message"
              aria-label="Send message"
            >
              <SendIcon className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Shortcuts notice */}
        <p className="text-center text-[10px] font-mono text-muted-foreground opacity-80">
        </p>
      </div>
    </form>
  );
}

interface AttachMenuProps {
  onStartScreenShare?: () => void;
  onOpenWorkspace?: () => void;
}

function AttachMenu({ onStartScreenShare, onOpenWorkspace }: AttachMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const panelOpen = useWorkspaceStore((s) => s.panelOpen);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const handleShareScreen = () => {
    setOpen(false);
    onStartScreenShare?.();
  };

  const handleOpenWorkspace = () => {
    setOpen(false);
    // Terminal panel: clicking opens the terminal connection screen, which
    // verifies the local connector automatically — no manual configuration.
    onOpenWorkspace?.();
  };
  // Terminal active when the panel is open (visibility is source of truth)
  const pathActive = panelOpen;

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Add attachment"
        title="Add attachment"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground transition-colors hover:text-foreground cursor-pointer"
      >
        <PlusIcon className="h-4 w-4" />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Add attachment"
          className="absolute bottom-full left-0 z-50 mb-2 w-56 overflow-hidden rounded-xl border border-border bg-popover p-1.5 shadow-2xl animate-fade-in text-popover-foreground"
        >
          {/* Terminal — single toggle for agent workspace/terminal access */}
          <button
            type="button"
            role="menuitem"
            onClick={handleOpenWorkspace}
            className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-xs transition-colors cursor-pointer ${pathActive ? "bg-primary/10 text-primary" : "text-foreground hover:bg-muted"}`}
            aria-pressed={pathActive}
          >
            <TerminalIcon className="h-4 w-4 shrink-0 text-primary" />
            <span className="min-w-0 flex-1">Terminal</span>
            {pathActive && <CheckIcon className="h-3.5 w-3.5 shrink-0 text-primary" />}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={handleShareScreen}
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-xs text-foreground transition-colors hover:bg-muted cursor-pointer"
          >
            <MonitorIcon className="h-4 w-4 shrink-0 text-primary" />
            Share Screen
          </button>
        </div>
      )}
    </div>
  );
}

interface ModelSelectorProps {
  provider: ProviderType;
  model: string;
  disabled: boolean;
}

function ModelSelector({ provider, model, disabled }: ModelSelectorProps) {
  const [open, setOpen] = useState(false);
  const setProvider = useChatStore((s) => s.setProvider);
  const setModel = useChatStore((s) => s.setModel);
  const allLocalModels = useLocalModelStore((s) => s.models);
  const allLocalProviders = useLocalModelStore((s) => s.providers);
  // Models belonging to a disconnected provider are never offered as targets.
  const localModels = useMemo(() => {
    const byId = new Map(allLocalProviders.map((p) => [p.id, p] as const));
    return allLocalModels.filter((m) => {
      if (!m.enabled) return false;
      const owner = byId.get(m.providerId);
      return owner ? owner.enabled : true;
    });
  }, [allLocalModels, allLocalProviders]);
  const rawDiscoveredOllamaModels = useLocalModelStore((s) => s.discoveredOllamaModels);
  const ollamaProviderEnabled = useMemo(() => {
    const ollama = allLocalProviders.find((p) => p.providerType === "ollama");
    return !ollama || ollama.enabled;
  }, [allLocalProviders]);
  const discoveredOllamaModels = useMemo(
    () => (ollamaProviderEnabled ? rawDiscoveredOllamaModels : []),
    [ollamaProviderEnabled, rawDiscoveredOllamaModels]
  );
  const ollamaStatus = useLocalModelStore((s) => s.ollamaStatus);
  const refreshOllamaModels = useLocalModelStore((s) => s.refreshOllamaModels);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    // Auto-discover Ollama models when Local section is opened
    // Do not fetch in production web (will return production message)
    void refreshOllamaModels();
  }, [open, refreshOllamaModels]);

  const handleSelect = async (p: ProviderType, m: string) => {
    if (p === "local") {
      // Same selection path as Settings → Models: persists the discovered
      // model (best-effort) and updates the existing provider/model state.
      await selectLocalModel(m);
      setOpen(false);
      return;
    }
    if (p !== provider) setProvider(p);
    setModel(m);
    setOpen(false);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Select model"
        className="flex items-center gap-1.5 rounded-lg border border-border bg-muted px-2.5 py-1 text-[10px] font-mono text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
      >
        <span className="max-w-[140px] truncate">
          {PROVIDER_LABELS[provider]} • {getModelLabel(provider, model)}
        </span>
        <ChevronDownIcon
          className={`h-3 w-3 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Choose model"
          className="absolute bottom-full left-0 z-50 mb-2 max-h-[min(18rem,50vh)] w-72 overflow-y-auto rounded-xl border border-border bg-popover p-2 shadow-2xl animate-fade-in text-popover-foreground"
        >
          {/* Local models first-class — dynamic Ollama discovery */}
          <div className="mb-1">
            <div className="px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground font-mono flex items-center gap-1.5">
              Ollama
              {ollamaStatus === "connected" && <span className="flex items-center gap-1 text-emerald-600"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Connected</span>}
              {ollamaStatus === "loading" && <span className="text-muted-foreground">Loading…</span>}
            </div>
            {ollamaStatus === "not_connected" || ollamaStatus === "error" ? (
              <div className="px-2.5 py-2 space-y-1.5">
                <p className="text-[11px] text-amber-600 dark:text-amber-400">⚠ Ollama is not connected</p>
                <p className="text-[11px] text-muted-foreground">Start Ollama and try again.</p>
                <button
                  type="button"
                  onClick={() => void refreshOllamaModels()}
                  className="rounded-lg border border-border bg-muted px-2.5 py-1 text-[11px] font-mono hover:bg-card cursor-pointer"
                >
                  Refresh Models
                </button>
              </div>
            ) : (
              <div className="space-y-0.5">
                <div className="flex items-center justify-between px-2.5 py-1">
                  <span className="text-[11px] font-mono text-muted-foreground">
                    {discoveredOllamaModels.length > 0 ? `Models: ${discoveredOllamaModels.length}` : ollamaStatus === "loading" ? "Discovering…" : `Local • ${localModels.length} saved`}
                  </span>
                  <button
                    type="button"
                    onClick={() => void refreshOllamaModels()}
                    className="rounded-lg border border-border bg-muted px-2 py-0.5 text-[10px] font-mono hover:bg-card cursor-pointer"
                  >
                    Refresh Models
                  </button>
                </div>
                {(discoveredOllamaModels.length > 0 ? discoveredOllamaModels : localModels.map((m) => ({ id: m.id, modelId: m.modelId, size: m.size, family: m.family, parameterSize: m.parameterSize }))).length === 0 ? (
                  <div className="px-2.5 py-2 text-[11px] text-muted-foreground">No local models. Add one in Settings → Models or start Ollama.</div>
                ) : (
                  (discoveredOllamaModels.length > 0 ? discoveredOllamaModels : localModels.map((m) => ({ id: m.id, modelId: m.modelId, size: m.size, family: m.family, parameterSize: m.parameterSize }))).map((m) => {
                    const modelId = (m as { modelId: string }).modelId;
                    const selected = provider === "local" && modelId === model;
                    const isStale = provider === "local" && model === modelId && !discoveredOllamaModels.some((d) => d.modelId === model) && discoveredOllamaModels.length > 0;
                    return (
                      <button
                        key={modelId}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        onClick={() => void handleSelect("local", modelId)}
                        className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-colors cursor-pointer ${
                          selected ? "bg-muted text-foreground font-medium" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                        }`}
                      >
                        <span className="min-w-0">
                          <span className="block truncate">{modelId}</span>
                          {(m as { size?: number; family?: string; parameterSize?: string }).size || (m as { family?: string }).family ? (
                            <span className="block truncate text-[10px] font-mono text-muted-foreground">
                              {(m as { family?: string }).family ? `${(m as { family?: string }).family} ` : ""}
                              {(m as { parameterSize?: string }).parameterSize ? `${(m as { parameterSize?: string }).parameterSize} ` : ""}
                              {(m as { size?: number }).size ? `${(((m as { size?: number }).size as number) / 1e9).toFixed(1)}GB` : ""}
                            </span>
                          ) : null}
                          {isStale && <span className="block text-[10px] text-amber-600">Selected model no longer installed – pick another.</span>}
                        </span>
                        {selected && <CheckIcon className="h-3.5 w-3.5 shrink-0 text-primary" />}
                      </button>
                    );
                  })
                )}
                {provider === "local" && model && discoveredOllamaModels.length > 0 && !discoveredOllamaModels.some((d) => d.modelId === model) && (
                  <div className="px-2.5 py-1 text-[11px] text-amber-600">Selected model “{model}” no longer installed. Please select another.</div>
                )}
              </div>
            )}
          </div>
          {PROVIDER_LIST.filter((p) => p !== "local").map((p) => (
            <div key={p} className="mb-1">
              <div className="px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground font-mono">
                {PROVIDER_LABELS[p]}
              </div>
              <div className="space-y-0.5">
                {PROVIDER_MODEL_OPTIONS[p as Exclude<ProviderType, "local">].map((m) => {
                  const selected = p === provider && m.id === model;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      onClick={() => handleSelect(p, m.id)}
                      className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-colors cursor-pointer ${
                        selected
                          ? "bg-muted text-foreground font-medium"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground"
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="block truncate">
                          {m.label}
                          {m.badge ? (
                            <span className="ml-1.5 rounded bg-emerald-500/15 px-1 py-0.5 text-[9px] font-mono font-semibold text-emerald-500">
                              {m.badge}
                            </span>
                          ) : null}
                        </span>
                      </span>
                      {selected && <CheckIcon className="h-3.5 w-3.5 shrink-0 text-primary" />}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────── src/components/ChatPage.tsx */
"use client";


interface ChatPageProps {
  sidebarOpen?: boolean;
  onToggleSidebar?: () => void;
  onOpenSidebar?: () => void;
}

function ChatPage({
  sidebarOpen = false,
  onToggleSidebar,
  onOpenSidebar,
}: ChatPageProps) {
  const {
    messages,
    loading,
    isStreaming,
    streamingMessageId,
    error,
    sendMessageStream,
    stopGeneration,
    clearError
  } = useChat();

  const screenShare = useScreenShare();
  const { isActive: screenShareActive, error: screenShareError, captureFrame } =
    screenShare;

  const handleSidebarToggle = onToggleSidebar || onOpenSidebar || (() => {});

  // While screen sharing is active, capture exactly ONE fresh frame from the
  // live preview and attach it to this request only. The live stream itself is
  // never sent anywhere. If the frame is not ready yet, fall back to a normal
  // text request rather than blocking the chat.
  const handleSend = useCallback(
    async (content: string) => {
      const image = screenShareActive ? captureFrame() ?? undefined : undefined;
      await sendMessageStream(content, image);
    },
    [screenShareActive, captureFrame, sendMessageStream]
  );

  const showScreenSharePanel = screenShareActive || !!screenShareError;

  const workspacePanelOpen = useWorkspaceStore((s) => s.panelOpen);
  const openWorkspacePanel = () => useWorkspaceStore.getState().togglePanel();

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-background text-foreground font-sans transition-colors duration-200 w-full dark:bg-[#0f0f0f]">
      <ChatHeader
        sidebarOpen={sidebarOpen}
        onToggleSidebar={handleSidebarToggle}
      />

      <main className="relative flex min-h-0 flex-1 flex-col">
        {error && (
          <div
            role="alert"
            className="flex shrink-0 items-center gap-2 border-b border-destructive/40 bg-destructive/10 px-4 py-2.5 text-xs font-mono text-destructive"
          >
            <span aria-hidden="true">⚠</span>
            <span className="flex-1">{error}</span>
            <button
              onClick={clearError}
              className="shrink-0 rounded bg-destructive/20 px-2 py-0.5 text-[11px] font-medium hover:bg-destructive/30"
            >
              Dismiss
            </button>
          </div>
        )}
        <MessageList
          messages={messages}
          loading={loading}
          isStreaming={isStreaming}
          streamingMessageId={streamingMessageId}
          onSendSuggestion={handleSend}
          screenShareActive={screenShareActive}
          captureScreenFrame={captureFrame}
        />
        {showScreenSharePanel && <ScreenSharePanel screenShare={screenShare} />}
        {workspacePanelOpen && <WorkspacePanel />}
        <ChatComposer
          onSend={handleSend}
          onStop={stopGeneration}
          loading={loading}
          disabled={isStreaming}
          onStartScreenShare={() => void screenShare.startSharing()}
          onOpenWorkspace={openWorkspacePanel}
        />
      </main>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────── src/components/Sidebar.tsx */
"use client";


interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

function Sidebar({ isOpen, onClose }: SidebarProps) {
  const [search, setSearch] = useState("");
  const chats = useChatStore((s) => s.chats);
  const currentChat = useChatStore((s) => s.currentChat);
  const createNewChat = useChatStore((s) => s.createNewChat);
  const loadChat = useChatStore((s) => s.loadChat);
  const searchChats = useChatStore((s) => s.searchChats);
  const [searchResults, setSearchResults] = useState<Chat[] | null>(null);

  const [renameTarget, setRenameTarget] = useState<Chat | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Chat | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("general");

  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);
  const workspace = useWorkspaceStore((s) => s.workspace);

  const openSettings = (tab: SettingsTab = "general") => {
    setSettingsTab(tab);
    setSettingsOpen(true);
  };

  // Debounced conversation search.
  useEffect(() => {
    let cancelled = false;
    if (!search.trim()) {
      setSearchResults(null);
      return;
    }
    const timer = setTimeout(async () => {
      const results = await searchChats(search);
      if (!cancelled) setSearchResults(results);
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [search, searchChats]);

  // Close the mobile drawer with the Escape key.
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Let a nested surface (profile popover, confirmation dialog) handle it.
      if (hasNestedEscapeOverlay()) return;
      onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose]);

  const displayChats =
    searchResults !== null
      ? searchResults.filter((r) => chats.some((c) => c.id === r.id))
      : chats;
  const searching = searchResults !== null;

  const handleNewChat = async () => {
    await createNewChat();
    if (typeof window !== "undefined" && window.innerWidth < 1024) {
      onClose();
    }
  };

  const handleSelectChat = (id: string) => {
    loadChat(id);
    if (typeof window !== "undefined" && window.innerWidth < 1024) {
      onClose();
    }
  };

  const userEmail = user?.email || "User";
  const avatarChar = userEmail[0]?.toUpperCase() || "U";

  return (
    <>
      {/* Mobile Backdrop Overlay */}
      <div
        className={`fixed inset-0 z-40 bg-black/60 backdrop-blur-xs lg:hidden transition-opacity duration-300 ${
          isOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Sidebar Container with Smooth Slide Animation */}
      <aside
        aria-hidden={!isOpen}
        className={`fixed inset-y-0 left-0 z-50 flex flex-col border-border bg-card text-card-foreground transition-all duration-300 ease-in-out lg:static lg:z-auto shrink-0 shadow-lg lg:shadow-none overflow-hidden ${
          isOpen
            ? "w-72 max-w-[85vw] border-r opacity-100 translate-x-0"
            : "w-0 max-w-0 border-r-0 opacity-0 -translate-x-full pointer-events-none"
        }`}
      >
        {/* Header - Branding + Collapse */}
<button
  type="button"
  onClick={onClose}
  title="Close sidebar"
  aria-label="Close sidebar"
  className="ml-auto h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground cursor-pointer"
>
  <PanelLeftIcon className="h-4 w-4" />
</button>

        {/* Search */}
        <div className="shrink-0 px-3 pb-3">
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              placeholder="Search conversations..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-xs text-foreground placeholder-muted-foreground outline-none transition-colors focus:border-ring focus:ring-1 focus:ring-ring"
              aria-label="Search chats"
            />
          </div>
        </div>

        <SidebarNavigation onNewChat={() => void handleNewChat()} />

        <div className="mx-3 mt-3 h-px shrink-0 bg-border" />

        {/* Recent conversations (scrolls independently) */}
        <RecentChats
          chats={displayChats}
          currentChatId={currentChat?.id ?? null}
          searching={searching}
          onSelect={handleSelectChat}
          onRename={setRenameTarget}
          onDelete={setDeleteTarget}
          onNewChat={() => void handleNewChat()}
        />

        {/* Footer: permanent Settings/Log out actions + user profile */}
        <div className="border-t border-border p-2.5 shrink-0">
          <div className="space-y-1">
            <button
              type="button"
              onClick={() => openSettings("general")}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground cursor-pointer"
              title="Settings"
            >
              <SettingsIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span>Settings</span>
            </button>
            <button
              type="button"
              onClick={() => void signOut()}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs font-medium text-destructive transition-colors hover:bg-destructive/10 cursor-pointer"
              title="Log out"
            >
              <LogOutIcon className="h-4 w-4 shrink-0" />
              <span>Log out</span>
            </button>
          </div>
          <div className="mx-1 my-2 h-px bg-border" />
          <UserProfile
            email={userEmail}
            avatarChar={avatarChar}
            name={user?.displayName || undefined}
            workspaceName={workspace?.name ?? null}
            onOpenAccount={() => openSettings("account")}
            onOpenSettings={() => openSettings("general")}
            onSignOut={() => void signOut()}
          />
        </div>
      </aside>

      {/* Rename Modal */}
      {renameTarget && (
        <RenameModal
          isOpen={!!renameTarget}
          onClose={() => setRenameTarget(null)}
          chatId={renameTarget.id}
          currentTitle={renameTarget.title}
        />
      )}

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <DeleteModal
          isOpen={!!deleteTarget}
          onClose={() => setDeleteTarget(null)}
          chatId={deleteTarget.id}
          chatTitle={deleteTarget.title}
        />
      )}

      {/* Settings Modal */}
      <Settings
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        initialTab={settingsTab}
      />
    </>
  );
}

/* ──────────────────────────────────────────────────────────── src/App.tsx */
/**
 * Nexuss internal application shell (prototype).
 * Starts directly inside the authenticated app — see README for scope notes.
 */
function MainApp() {
  const user = useAuthStore((s) => s.user);
  const hydrate = useChatStore((s) => s.hydrate);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [ready, setReady] = useState(false);

  // Default the sidebar to open on desktop, closed on tablet/mobile.
  useEffect(() => {
    setSidebarOpen(window.innerWidth >= 1024);
  }, []);

  useEffect(() => {
    void hydrate().then(() => setReady(true));
    void useLocalModelStore.getState().hydrate();
  }, [hydrate]);

  if (!user) return <SignedOutScreen />;

  return (
    <div className="flex h-screen supports-[height:100dvh]:h-dvh overflow-hidden bg-background text-foreground">
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      {ready ? (
        <ChatPage
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
        />
      ) : (
        <div className="flex h-full flex-1 items-center justify-center bg-background">
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-primary" />
        </div>
      )}
    </div>
  );
}

function SignedOutScreen() {
  const setUser = useAuthStore((s) => s.setUser);
  return (
    <div className="flex h-screen supports-[height:100dvh]:h-dvh items-center justify-center bg-background px-6 text-foreground">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 text-center shadow-2xl">
        <NexussLogo size={40} color="currentColor" className="mx-auto text-foreground" />
        <h1 className="mt-4 text-sm font-semibold">You&apos;ve been signed out</h1>
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
          This prototype has no sign-in screen — jump straight back into the workspace to keep
          reviewing the interface.
        </p>
        <button
          type="button"
          onClick={() =>
            setUser({ uid: "mock-uid-001", email: "arjun@nexuss.in", displayName: "Arjun Mehta" })
          }
          className="mt-4 w-full rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90 cursor-pointer"
        >
          Sign back in
        </button>
      </div>
    </div>
  );
}

function App() {
  return <MainApp />;
}

/* ===========================================================================
 * Embedded stylesheet: design tokens (light/dark), base styles, animations,
 * scrollbars and prose rules — normally sourced from src/styles/globals.css,
 * embedded here so this file stays self-contained.
 * ========================================================================= */
const NEXUSS_REPLICA_STYLES = `
:root {
    --background: 0 0% 100%;
    --foreground: 222.2 47.4% 11.2%;
    --card: 0 0% 100%;
    --card-foreground: 222.2 47.4% 11.2%;
    --popover: 0 0% 100%;
    --popover-foreground: 222.2 47.4% 11.2%;
    --primary: 262.1 83.3% 57.8%;
    --primary-foreground: 210 40% 98%;
    --secondary: 210 40% 98%;
    --secondary-foreground: 222.2 47.4% 11.2%;
    --muted: 210 40% 98%;
    --muted-foreground: 215.4 16.3% 56.9%;
    --accent: 210 40% 98%;
    --accent-foreground: 222.2 47.4% 11.2%;
    --destructive: 0 84.3% 60.2%;
    --destructive-foreground: 210 40% 98%;
    --border: 214.3 32.7% 91.2%;
    --input: 214.3 32.7% 91.2%;
    --ring: 262.1 83.3% 57.8%;
    --radius: 0.9375rem;
    color-scheme: light;
  }

  .dark {
    /* Very dark neutral main background */
    --background: 0 0% 9%;
    --foreground: 0 0% 95%;
    /* Slightly lighter elevated surface (sidebar, cards, composer) */
    --card: 0 0% 13%;
    --card-foreground: 0 0% 95%;
    --popover: 0 0% 16%;
    --popover-foreground: 0 0% 95%;
    --secondary: 0 0% 17%;
    --secondary-foreground: 0 0% 95%;
    --muted: 0 0% 14%;
    --muted-foreground: 0 0% 58%;
    /* Subtle neutral highlight for the active conversation row */
    --accent: 0 0% 19%;
    --accent-foreground: 0 0% 95%;
    --destructive: 0 72% 51%;
    --destructive-foreground: 0 0% 100%;
    --border: 0 0% 20%;
    --input: 0 0% 22%;
    --ring: 262 83% 66%;
    color-scheme: dark;
  }

  * {
    border-color: hsl(var(--border));
  }

  html {
    -webkit-text-size-adjust: 100%;
    scroll-behavior: smooth;
  }

  body {
    background-color: hsl(var(--background));
    color: hsl(var(--foreground));
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    transition: background-color 200ms ease, color 200ms ease;
  }

  ::selection {
    background: hsl(var(--ring) / 0.25);
  }


@keyframes marquee-left {
  0% {
    transform: translateX(0%);
  }
  100% {
    transform: translateX(-50%);
  }
}

@keyframes marquee-right {
  0% {
    transform: translateX(-50%);
  }
  100% {
    transform: translateX(0%);
  }
}

.animate-marquee-left {
  display: flex;
  width: max-content;
  animation: marquee-left 35s linear infinite;
}

.animate-marquee-left:hover {
  animation-play-state: paused;
}

.animate-marquee-right {
  display: flex;
  width: max-content;
  animation: marquee-right 35s linear infinite;
}

.animate-marquee-right:hover {
  animation-play-state: paused;
}


  .theme-transition {
    transition: background-color 200ms ease, border-color 200ms ease, color 200ms ease;
  }

  .nexuss-glass {
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
  }

  /* Subtle entrance animation for newly rendered chat messages */
  .animate-message-in {
    animation: message-in 220ms ease-out both;
  }

  .animate-fade-in {
    animation: fade-in 150ms ease-out both;
  }

  .animate-fade-in-up {
    animation: fade-in-up 220ms ease-out both;
  }

  /* Safe-area insets (notched phones, home indicator, rounded corners).
     Only meaningful with viewport-fit=cover. */
  .pb-safe {
    padding-bottom: env(safe-area-inset-bottom, 0px);
  }

  .pt-safe {
    padding-top: env(safe-area-inset-top, 0px);
  }

  .pl-safe {
    padding-left: env(safe-area-inset-left, 0px);
  }

  .pr-safe {
    padding-right: env(safe-area-inset-right, 0px);
  }


@keyframes message-in {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes fade-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@keyframes fade-in-up {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* Visible focus ring for keyboard users on interactive elements */
:where(a, button, input, select, textarea, [role="button"]):focus-visible {
  outline: 2px solid hsl(var(--ring) / 0.7);
  outline-offset: 2px;
}

/* Chat markdown must never force the page to scroll horizontally on narrow
   screens: break long unbroken strings, scale images, and keep tables inside a
   locally scrollable container (the table itself sits in an overflow-x-auto
   wrapper rendered by MessageList). */
.prose {
  max-width: 100%;
  overflow-wrap: break-word;
}

.prose img {
  max-width: 100%;
  height: auto;
}

.prose pre {
  max-width: 100%;
}

.prose table {
  border-collapse: collapse;
  width: 100%;
}

.prose th,
.prose td {
  padding: 0.375rem 0.625rem;
  border: 1px solid hsl(var(--border));
  text-align: left;
}

.prose th {
  background: hsl(var(--muted) / 0.6);
  font-weight: 600;
}

::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: hsl(var(--muted-foreground) / 0.3);
  border-radius: 9999px;
  border: 2px solid transparent;
  background-clip: padding-box;
}

::-webkit-scrollbar-thumb:hover {
  background: hsl(var(--muted-foreground) / 0.5);
  border: 2px solid transparent;
  background-clip: padding-box;
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
`;

function NexussReplicaStyle() {
  return <style dangerouslySetInnerHTML={{ __html: NEXUSS_REPLICA_STYLES }} />;
}

/**
 * Root export: renders the complete Nexuss UI/UX replica (sidebar, chat
 * workspace, settings, provider/API-key screens, modals and all UI states).
 */
export default function NexussUIReplica() {
  return (
    <>
      <NexussReplicaStyle />
      <App />
    </>
  );
}

export { NexussUIReplica };
