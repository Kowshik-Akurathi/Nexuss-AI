import { store } from "./store";
import { getEventHub } from "./opencode/event-stream";

export interface LabSelections {
  directory: string;
  agent: string;
  model: string;
  sessionID?: string;
}

const DEFAULTS: LabSelections = {
  directory: "",
  agent: "build",
  model: "",
};

/** Current project / agent / model selection, persisted in Lab-local SQLite. */
export function getSelections(): LabSelections {
  return { ...DEFAULTS, ...store().getSetting<Partial<LabSelections>>("selections", {}) };
}

export function setSelections(patch: Partial<LabSelections>): LabSelections {
  const next = { ...getSelections(), ...patch };
  store().setSetting("selections", next);
  // The shared SSE subscription must follow the active project, otherwise
  // OpenCode only sends server-level heartbeats.
  void getEventHub()
    .rescope(next.directory || undefined)
    .catch(() => {
      /* a failed rescope must not reject the caller */
    });
  return next;
}
