import type { DiscoveredOllamaModelDetailed } from "./localModels";
import { discoverOllamaModelsDetailed, verifyLocalChat } from "./localModels";
import { DISCOVERED_OLLAMA_MODELS } from "@/data/mockData";

/**
 * Mocked local-AI setup detection.
 * The real implementation probes Ollama through the local connector; the
 * prototype always reports "Ollama running with models installed" so the
 * primary setup path is reviewable. Toggle `MOCK_DETECTION_STATE` to walk the
 * other screens (not installed / stopped / no models / unknown).
 */

export type SetupDetectionState =
  | "models"
  | "no_models"
  | "stopped"
  | "not_installed"
  | "unknown";

export type SetupDetectionReason = "connector_unreachable" | "timeout" | "blocked";
export type SetupDetectionVia = "connector" | "direct" | "desktop";

export interface SetupDetection {
  state: SetupDetectionState;
  models?: DiscoveredOllamaModelDetailed[];
  installed?: boolean;
  reason?: SetupDetectionReason;
  via: SetupDetectionVia;
}

/** Change this to preview a different setup state. */
export const MOCK_DETECTION_STATE: SetupDetectionState = "models";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function detectOllamaSetup(
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

export function unknownReasonCopy(reason?: SetupDetectionReason): string {
  switch (reason) {
    case "timeout":
      return "Checking your device timed out.";
    case "connector_unreachable":
      return "Nexuss couldn't reach Ollama on this device.";
    default:
      return "We couldn't check your device.";
  }
}

export function friendlySetupError(e: unknown): string {
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

export { discoverOllamaModelsDetailed, verifyLocalChat };
