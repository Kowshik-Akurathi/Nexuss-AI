import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOpenCodeStore } from "../store";
import type { ModelRow } from "../types";

interface ModelSelectorProps {
  selectedModel: string;
  onSelect: (modelRef: string) => void;
  onConnectProvider: () => void;
  disabled?: boolean;
}

const RECENT_STORAGE_KEY = "nexuss-recent-models";
const FAVORITES_STORAGE_KEY = "nexuss-favorite-models";
const MAX_RECENT = 8;

function getFriendlyName(model: ModelRow): string {
  const { id, providerID, providerName, name } = model;

  if (providerID === "openrouter") {
    const mappings: Record<string, string> = {
      "~z-ai/glm-flash-latest": "GLM Flash Latest",
      "~z-ai/glm-latest": "GLM Latest",
      "upstage/solar-pro4": "Solar Pro 4",
      "upstage/solar-mini4": "Solar Mini 4",
      "amazon/nova-2-lite-v1": "Amazon Nova 2 Lite",
      "amazon/nova-micro-v1": "Amazon Nova Micro",
      "amazon/nova-pro-v1": "Amazon Nova Pro",
      "amazon/nova-lite-v1": "Amazon Nova Lite",
      "~x-ai/grok-latest": "Grok Latest",
      "mancer/weaver": "Mancer Weaver",
      "openrouter/fusion": "OpenRouter Fusion",
      "openrouter/auto": "OpenRouter Auto",
      "openrouter/pareto-code": "Pareto Code",
      "openrouter/bodybuilder": "Bodybuilder",
      "openrouter/free": "OpenRouter Free",
      "scaledown/summarize": "ScaleDown Summarize",
      "scaledown/extract": "ScaleDown Extract",
      "cohere/command-r-08-2024": "Command R",
      "cohere/command-a-plus": "Command A+",
      "cohere/command-r-plus-08-2024": "Command R+",
      "cohere/command-r7b-12-2024": "Command R7B",
      "cohere/command-a": "Command A",
      "~moonshotai/kimi-latest": "Kimi Latest",
      "google/gemini-3.7-flash": "Gemini 3.7 Flash",
      "google/gemini-2.5-pro-preview": "Gemini 2.5 Pro Preview",
      "google/gemma-3-27b-it": "Gemma 3 27B IT",
      "google/gemini-4-carbon": "Gemini 4 Carbon",
      "google/lyria-3-clip-preview": "Lyria 3 Clip Preview",
      "google/gemma-3-4b-it": "Gemma 3 4B IT",
      "google/gemma-2-27b-it": "Gemma 2 27B",
      "google/gemini-3.1-pro-preview-customtools": "Gemini 3.1 Pro Preview Custom Tools",
      "google/gemini-3.1-flash-lite-image": "Nano Banana 2 Lite",
      "google/gemini-4-neon": "Gemini 4 Neon",
      "google/gemini-3.8-flash": "Gemini 3.8 Flash",
      "google/gemini-omni-1.2-flash": "Gemini Omni 1.2 Flash",
      "google/gemma-3-12b-it": "Gemma 3 12B IT",
      "google/gemini-nano-banana-2.1": "Nano Banana 2.1",
      "google/lyria-3-pro-preview": "Lyria 3 Pro Preview",
      "google/gemini-3.1-flash-lite-preview": "Gemini 3.1 Flash Lite Preview",
      "google/gemini-3.6-flash": "Gemini 3.6 Flash",
      "google/gemini-2.5-flash-image": "Nano Banana",
      "google/gemini-3.1-flash-image-preview": "Nano Banana 2 Preview",
      "google/gemini-3.1-flash-image": "Nano Banana 2",
      "google/gemini-3.1-flash-lite": "Gemini 3.1 Flash Lite",
      "google/gemini-4-argon": "Gemini 4 Argon",
      "google/gemini-4-hydrogen": "Gemini 4 Hydrogen",
      "google/gemini-3-flash-preview": "Gemini 3 Flash Preview",
      "google/gemma-4-31b-it": "Gemma 4 31B IT",
      "google/gemini-3.5-flash": "Gemini 3.5 Flash",
      "google/gemini-3-pro-image": "Nano Banana Pro",
      "google/gemini-omni-1.1-flash": "Gemini Omni 1.1 Flash",
      "google/gemini-3.1-pro-preview": "Gemini 3.1 Pro Preview",
      "google/gemini-3.5-flash-lite": "Gemini 3.5 Flash Lite",
      "google/gemma-4-26b-a4b-it:free": "Gemma 4 26B A4B (free)",
      "google/gemini-3-pro-image-preview": "Nano Banana Pro Preview",
      "google/gemma-4-31b-it:free": "Gemma 4 31B (free)",
      "google/gemini-4-26b-a4b-it": "Gemini 4 26B A4B IT",
      "deepseek/deepseek-v4-flash-0731": "DeepSeek V4 Flash 0731",
      "deepseek/deepseek-v4-pro-0813": "DeepSeek V4 Pro 0813",
      "deepseek/deepseek-v3.2": "DeepSeek V3.2",
      "deepseek/deepseek-v4-flash-vision-exp": "DeepSeek V4 Flash Vision Exp",
      "deepseek/deepseek-v4-pro": "DeepSeek V4 Pro",
      "deepseek/deepseek-r1-0528": "DeepSeek R1 0528",
      "deepseek/deepseek-v4.1-flash": "DeepSeek V4.1 Flash",
      "deepseek/deepseek-chat-v3.1": "DeepSeek V3.1",
      "deepseek/deepseek-v3.2-exp": "DeepSeek V3.2 Exp",
      "deepseek/deepseek-v4.1-flash-1017": "DeepSeek V4.1 Flash 1017",
      "deepseek/deepseek-chat": "DeepSeek Chat",
      "deepseek/deepseek-chat-v3-0324": "DeepSeek V3 0324",
      "deepseek/deepseek-v3.1-terminus": "DeepSeek V3.1 Terminus",
      "deepseek/deepseek-v4-flash": "DeepSeek V4 Flash",
      "baidu/ernie-5.5-flash-preview:free": "ERNIE 5.5 Flash Preview (free)",
      "baidu/ernie-light-dt-1.0-intl": "ERNIE Light DT 1.0",
      "openai/gpt-4o-2024-08-06": "GPT-4o (2024-08-06)",
      "openai/gpt-6-luna": "GPT-6 Luna",
      "openai/gpt-4o-mini-2024-07-18": "GPT-4o-mini (2024-07-18)",
      "openai/gpt-6-astra-pro": "GPT-6 Astra Pro",
      "openai/gpt-3.5-turbo-0613": "GPT-3.5 Turbo (older v0613)",
      "openai/gpt-5.4-mini": "GPT-5.4 mini",
      "openai/gpt-5": "GPT-5",
      "openai/gpt-5-mini": "GPT-5 Mini",
      "openai/gpt-5.4": "GPT-5.4",
      "openai/o3": "o3",
      "openai/gpt-5.5-pro": "GPT-5.5 Pro",
      "openai/gpt-5.6-sol": "GPT-5.6 Sol",
      "openai/gpt-5.5": "GPT-5.5",
      "openai/gpt-6-sol-pro": "GPT-6 Sol Pro",
      "openai/gpt-6.2-astra": "GPT-6.2 Astra",
      "openai/gpt-5.2-pro": "GPT-5.2 Pro",
      "openai/gpt-6.1-sol-pro": "GPT-6.1 Sol Pro",
      "openai/gpt-6-sol": "GPT-6 Sol",
      "openai/gpt-4.1-nano": "GPT-4.1 nano",
      "openai/gpt-5.1-codex": "GPT-5.1 Codex",
      "openai/gpt-audio": "GPT-Audio",
      "openai/gpt-chat-latest": "GPT Chat Latest",
      "openai/gpt-3.5-turbo-16k": "GPT-3.5 Turbo 16k",
      "openai/gpt-6-luna-pro": "GPT-6 Luna Pro",
      "openai/gpt-4o-mini": "GPT-4o mini",
      "openai/gpt-6.2-astra-pro": "GPT-6.2 Astra Pro",
    };
    return (
      mappings[id] ||
      id
        .replace(/^.*\//, "")
        .replace(/-/g, " ")
        .replace(/\b\w/g, (c: string) => c.toUpperCase())
    );
  }

  if (providerID === "nvidia" || providerID === "nvidia-nemotron") {
    const mappings: Record<string, string> = {
      "nvidia/nemotron-3-ultra-550b-a55b": "Nemotron 3 Ultra 550B A55B",
      "nvidia/nemotron-3.5-lightning": "Nemotron 3.5 Lightning (free)",
      "nvidia/nemotron-4-340b": "Nemotron 4 340B",
      "nvidia/nemotron-4-340b-free": "Nemotron 4 340B Free",
    };
    return (
      mappings[id] ||
      id
        .replace(/^.*\//, "")
        .replace(/-/g, " ")
        .replace(/\b\w/g, (c: string) => c.toUpperCase())
    );
  }

  if (providerID === "opencode") {
    const mappings: Record<string, string> = {
      "tidepool-alpha-free": "Tidepool Alpha Free",
      "hy4-flash": "Hy4 Flash",
      "iceman-free": "Iceman Free",
      "longcat-2.5-free": "LongCat 2.5 Free",
      "flint-40b-free": "Flint 40B Free",
      "deepseek-v4.1-flash-free": "DeepSeek V4.1 Flash Free",
      "mimo-v2.6-flash-free": "MiMo-V2.6-Flash Free",
      "ling-3.2-flash-free": "Ling 3.2 Flash (free)",
    };
    return (
      mappings[id] ||
      id
        .replace(/-/g, " ")
        .replace(/\b\w/g, (c: string) => c.toUpperCase())
    );
  }

  if (providerID === "ollama") {
    return id
      .replace(/^.*\//, "")
      .replace(/[:-]/g, " ")
      .replace(/\b\w/g, (c: string) => c.toUpperCase());
  }

  return name || id.replace(/^.*\//, "").replace(/-/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());
}

function isFreeModel(model: ModelRow): boolean {
  const { id, providerID, name } = model;
  const idLower = id.toLowerCase();
  const nameLower = name.toLowerCase();

  if (providerID === "opencode") return true;
  if (idLower.includes("free") || nameLower.includes("free")) return true;

  if (providerID === "openrouter") {
    const freePatterns = [":free", "-free", "free-", "~", "bodybuilder", "pareto-code", "fusion", "auto"];
    return freePatterns.some((p) => idLower.includes(p));
  }

  if (providerID === "nvidia" || providerID === "nvidia-nemotron") {
    return idLower.includes("free") || idLower.includes("lightning");
  }

  return false;
}

function getProviderDisplayName(providerID: string, providerName: string): string {
  const displayNames: Record<string, string> = {
    opencode: "OPENCODE",
    openrouter: "OPENROUTER",
    nvidia: "NVIDIA",
    "nvidia-nemotron": "NVIDIA",
    ollama: "OLLAMA",
    anthropic: "ANTHROPIC",
    openai: "OPENAI",
    google: "GOOGLE",
    azure: "AZURE",
    deepseek: "DEEPSEEK",
  };
  return displayNames[providerID] || providerName.toUpperCase();
}

function getProviderOrder(providerID: string): number {
  const order: Record<string, number> = {
    recent: 0,
    favorites: 0.5,
    opencode: 1,
    openrouter: 2,
    nvidia: 3,
    "nvidia-nemotron": 3,
    ollama: 4,
    anthropic: 5,
    openai: 6,
    google: 7,
    azure: 8,
    deepseek: 9,
  };
  return order[providerID] ?? 10;
}

function loadRecentModels(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = localStorage.getItem(RECENT_STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveRecentModels(models: string[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(models.slice(0, MAX_RECENT)));
  } catch {
    /* ignore */
  }
}

function loadFavorites(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = localStorage.getItem(FAVORITES_STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveFavorites(models: string[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(models));
  } catch {
    /* ignore */
  }
}

function toggleFavorite(ref: string): void {
  const favs = loadFavorites();
  const idx = favs.indexOf(ref);
  if (idx >= 0) favs.splice(idx, 1);
  else favs.unshift(ref);
  saveFavorites(favs);
}

function addToRecent(ref: string): void {
  const recent = loadRecentModels();
  const filtered = recent.filter((r) => r !== ref);
  filtered.unshift(ref);
  saveRecentModels(filtered);
}

export function ModelSelector({
  selectedModel,
  onSelect,
  onConnectProvider,
  disabled = false,
}: ModelSelectorProps) {
  const status = useOpenCodeStore((s) => s.status);
  const models = status?.models ?? [];
  const providers = status?.providers ?? [];

  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [recentModels, setRecentModels] = useState<string[]>([]);
  const [favorites, setFavorites] = useState<string[]>([]);

  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const query = useMemo(() => searchQuery.toLowerCase().trim(), [searchQuery]);

  const modelMap = useMemo(() => new Map(models.map((m) => [m.ref, m])), [models]);
  const providerMap = useMemo(() => new Map(providers.map((p) => [p.id, p])), [providers]);

  const selectedModelObj = useMemo(() => modelMap.get(selectedModel) ?? null, [modelMap, selectedModel]);
  const buttonLabel = useMemo(
    () => (selectedModelObj ? getFriendlyName(selectedModelObj) : "Select model"),
    [selectedModelObj]
  );

  useEffect(() => {
    setRecentModels(loadRecentModels());
    setFavorites(loadFavorites());
  }, []);

  useEffect(() => {
    if (isOpen) {
      setHighlightedIndex(-1);
      setTimeout(() => searchRef.current?.focus(), 0);
    }
  }, [isOpen]);

  const getVisibleModels = useCallback(() => {
    const sections: Array<{ provider: string; models: ModelRow[] }> = [];

    const recentRefs = recentModels.filter((r) => modelMap.has(r));
    if (recentRefs.length > 0) {
      sections.push({
        provider: "recent",
        models: recentRefs.map((r) => modelMap.get(r)!).filter(Boolean) as ModelRow[],
      });
    }

    const favRefs = favorites.filter((f) => modelMap.has(f));
    if (favRefs.length > 0) {
      sections.push({
        provider: "favorites",
        models: favRefs.map((f) => modelMap.get(f)!).filter(Boolean) as ModelRow[],
      });
    }

    const providerGroups = new Map<string, ModelRow[]>();
    for (const m of models) {
      if (!m.authenticated || m.enabled === false) continue;
      if (recentRefs.includes(m.ref) || favRefs.includes(m.ref)) continue;
      if (!providerGroups.has(m.providerID)) providerGroups.set(m.providerID, []);
      providerGroups.get(m.providerID)!.push(m);
    }

    const sortedProviders = Array.from(providerGroups.entries()).sort(
      (a, b) => getProviderOrder(a[0]) - getProviderOrder(b[0])
    );

    for (const [providerID, providerModels] of sortedProviders) {
      const pInfo = providerMap.get(providerID);
      if (!pInfo) continue;
      sections.push({
        provider: providerID,
        models: providerModels.sort((a, b) => getFriendlyName(a).localeCompare(getFriendlyName(b))),
      });
    }

    if (query) {
      const filteredSections = sections
        .map((section) => ({
          ...section,
          models: section.models.filter((m) => {
            const friendly = getFriendlyName(m).toLowerCase();
            const provider = getProviderDisplayName(m.providerID, m.providerName).toLowerCase();
            const ref = m.ref.toLowerCase();
            return friendly.includes(query) || provider.includes(query) || ref.includes(query);
          }),
        }))
        .filter((s) => s.models.length > 0);
      return filteredSections.flatMap((s) => s.models);
    }

    return sections.flatMap((s) => s.models);
  }, [models, providers, recentModels, favorites, query, modelMap, providerMap]);

  const getSectionForModel = useCallback(
    (model: ModelRow) => {
      if (query) return "search";
      if (recentModels.includes(model.ref)) return "recent";
      if (favorites.includes(model.ref)) return "favorites";
      return model.providerID;
    },
    [recentModels, favorites, query]
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;

      if (e.key === "Escape") {
        e.preventDefault();
        setIsOpen(false);
        return;
      }

      const visibleModels = getVisibleModels();
      if (visibleModels.length === 0) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlightedIndex((prev) => Math.min(prev + 1, visibleModels.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlightedIndex((prev) => Math.max(prev - 1, -1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (highlightedIndex >= 0 && highlightedIndex < visibleModels.length) {
          const model = visibleModels[highlightedIndex];
          if (model) {
            onSelect(model.ref);
            addToRecent(model.ref);
            setRecentModels(loadRecentModels());
            setIsOpen(false);
          }
        }
      } else if (e.key === "a" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        onConnectProvider();
      } else if (e.key === "f" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (highlightedIndex >= 0 && highlightedIndex < visibleModels.length) {
          const model = visibleModels[highlightedIndex];
          if (model) {
            toggleFavorite(model.ref);
            setFavorites(loadFavorites());
          }
        }
      } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        searchRef.current?.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, highlightedIndex, onSelect, onConnectProvider, getVisibleModels]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  const visibleModels = useMemo(() => getVisibleModels(), [getVisibleModels]);
  const hasResults = visibleModels.length > 0;

  if (disabled) {
    return (
      <button
        type="button"
        className="field cursor-not-allowed font-mono text-[11px] opacity-50"
        disabled
        title="Connect to OpenCode to select models"
      >
        default
      </button>
    );
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        className="field w-full cursor-pointer text-left font-mono text-[11px]"
        onClick={() => setIsOpen(!isOpen)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        disabled={disabled}
      >
        {buttonLabel}
      </button>

      {isOpen && (
        <div className="fixed z-50 mt-1.5 max-h-[60vh] min-w-[320px] max-w-[480px] animate-slide-down overflow-y-auto rounded-lg border border-border bg-popover text-popover-foreground shadow-2xl shadow-black/40">
          <div className="sticky top-0 z-10 border-b border-border bg-popover/95 px-3 py-2.5 backdrop-blur-sm">
            <div className="relative">
              <input
                ref={searchRef}
                type="text"
                placeholder="Search models..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setHighlightedIndex(-1);
                }}
                className="field w-full py-1.5 pl-8 pr-3 font-mono text-[11px]"
                aria-label="Search models"
              />
              <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 font-mono text-[10px] text-muted-foreground">
                ⌕
              </span>
            </div>
          </div>

          <div className="max-h-[50vh] overflow-y-auto p-1.5">
            {!hasResults && searchQuery && (
              <div className="px-2 py-3 text-center text-[11px] text-muted-foreground">
                No models match &quot;{searchQuery}&quot;
              </div>
            )}

            {!hasResults && !searchQuery && (
              <div className="px-2 py-3 text-center text-[11px] text-muted-foreground">
                No authenticated models available
              </div>
            )}

            {hasResults &&
              (() => {
                let lastSection = "";
                return visibleModels.map((model, index) => {
                  const section = getSectionForModel(model);
                  const showSectionHeader = section !== lastSection && !query;
                  if (showSectionHeader) lastSection = section;

                  const isHighlighted = index === highlightedIndex;
                  const isSelected = model.ref === selectedModel;
                  const isFavorite = favorites.includes(model.ref);
                  const free = isFreeModel(model);

                  return (
                    <div key={model.ref}>
                      {showSectionHeader && (
                        <div className="border-t border-border/50 px-2 py-1 font-mono text-[8.5px] uppercase tracking-widest text-primary first:border-t-0">
                          {section === "recent" && "RECENT"}
                          {section === "favorites" && "FAVORITES"}
                          {section !== "recent" &&
                            section !== "favorites" &&
                            getProviderDisplayName(model.providerID, model.providerName)}
                        </div>
                      )}
                      <button
                        type="button"
                        className={`flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left transition-colors ${
                          isHighlighted
                            ? "bg-muted"
                            : isSelected
                              ? "bg-primary/10"
                              : "hover:bg-muted"
                        }`}
                        onMouseEnter={() => setHighlightedIndex(index)}
                        onClick={() => {
                          onSelect(model.ref);
                          addToRecent(model.ref);
                          setRecentModels(loadRecentModels());
                          setIsOpen(false);
                        }}
                      >
                        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground">
                          {getFriendlyName(model)}
                        </span>
                        <span className="flex shrink-0 items-center gap-1.5">
                          {isFavorite && (
                            <span className="text-amber-500" title="Favorite">
                              ★
                            </span>
                          )}
                          {free && (
                            <span className="rounded border border-emerald-600/50 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[8.5px] text-emerald-600 dark:text-emerald-300">
                              Free
                            </span>
                          )}
                          {!free && !isFavorite && section !== "recent" && section !== "favorites" && (
                            <span className="font-mono text-[9px] text-muted-foreground/70">
                              {getProviderDisplayName(model.providerID, model.providerName)}
                            </span>
                          )}
                          {isSelected && <span className="font-mono text-primary">✓</span>}
                        </span>
                      </button>
                    </div>
                  );
                });
              })()}
          </div>

          <div className="sticky bottom-0 z-10 flex items-center justify-between gap-2 border-t border-border bg-popover/95 px-3 py-2 backdrop-blur-sm">
            <div className="flex gap-3 font-mono text-[9.5px] text-muted-foreground/70">
              <span>⌘F Favorite</span>
              <span>⌘A Connect</span>
              <span>Esc Close</span>
            </div>
            <button
              type="button"
              className="btn btn-ghost px-2 py-1 font-mono text-[9.5px]"
              onClick={onConnectProvider}
            >
              Connect provider
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
