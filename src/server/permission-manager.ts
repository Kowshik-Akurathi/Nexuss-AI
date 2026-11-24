import { LabError } from "./errors";
import type { OpenCodeClient } from "./opencode/client";
import type { PermissionDecision, PermissionRequest, PermissionV2Request } from "./opencode/types";

export interface PendingPermission {
  id: string;
  sessionID: string;
  /** V1 uses `permission` + `patterns`; V2 uses `action` + `resources`. */
  action: string;
  resources: string[];
  /** Patterns OpenCode would save if the user picks "always". */
  savePatterns: string[];
  metadata: Record<string, unknown>;
  tool?: { messageID: string; callID: string };
  source: "v1" | "v2";
  requestedAt: number;
}

const DANGEROUS_ACTIONS = new Set([
  "shell",
  "edit",
  "write",
  "delete",
  "external_directory",
  "webfetch",
  "websearch",
  "execute",
  "subagent",
]);

export function riskLevel(action: string): "high" | "medium" | "low" {
  const a = action.toLowerCase();
  if (a === "shell" || a === "execute" || a.includes("delete")) return "high";
  if (DANGEROUS_ACTIONS.has(a) || a === "edit" || a === "write") return "medium";
  return "low";
}

/** Human-facing description of what is being requested. */
export function describePermission(p: PendingPermission): string {
  const what = p.resources.length ? p.resources.join(", ") : "*";
  const verb =
    p.action === "shell"
      ? "Run command"
      : p.action === "edit" || p.action === "write"
        ? "Modify file"
        : p.action === "read"
          ? "Read file"
          : p.action === "webfetch"
            ? "Fetch URL"
            : p.action === "external_directory"
              ? "Access directory outside the project"
              : `Use ${p.action}`;
  return `${verb}: ${what}`;
}

function fromV1(r: PermissionRequest): PendingPermission {
  return {
    id: r.id,
    sessionID: r.sessionID,
    action: r.permission,
    resources: r.patterns ?? [],
    savePatterns: r.always ?? [],
    metadata: r.metadata ?? {},
    tool: r.tool,
    source: "v1",
    requestedAt: Date.now(),
  };
}

function fromV2(r: PermissionV2Request): PendingPermission {
  return {
    id: r.id,
    sessionID: r.sessionID,
    action: r.action,
    resources: r.resources ?? [],
    savePatterns: r.save ?? [],
    metadata: r.metadata ?? {},
    source: "v2",
    requestedAt: Date.now(),
  };
}

/**
 * Bridges OpenCode's permission system to the Lab UI.
 *
 * Never auto-approves. Never bypasses OpenCode. Rejections are forwarded with
 * OpenCode's own `reject` reply so the agent receives a real denial.
 */
export class PermissionManager {
  private history: Array<PendingPermission & { decision: PermissionDecision; at: number }> = [];

  constructor(private client: OpenCodeClient) {}

  async pending(directory: string): Promise<PendingPermission[]> {
    const out: PendingPermission[] = [];
    const seen = new Set<string>();

    try {
      const v1 = (await this.client.listPermissions({ directory })) ?? [];
      for (const r of v1) {
        if (!r?.id || seen.has(r.id)) continue;
        seen.add(r.id);
        out.push(fromV1(r));
      }
    } catch (e) {
      if (!(e instanceof LabError) || (e.code !== "API_ENDPOINT_MISSING" && e.status !== 404)) throw e;
    }

    try {
      const v2 = await this.client.listPermissionsV2({ directory });
      for (const r of v2?.data ?? []) {
        if (!r?.id || seen.has(r.id)) continue;
        seen.add(r.id);
        out.push(fromV2(r));
      }
    } catch (e) {
      if (!(e instanceof LabError) || (e.code !== "API_ENDPOINT_MISSING" && e.status !== 404)) throw e;
    }

    return out;
  }

  /**
   * Reply to a pending request. `decision` is one of OpenCode's own values:
   * `once` (allow once), `always` (persist an allow rule), `reject`.
   */
  async respond(
    directory: string,
    sessionID: string,
    permissionID: string,
    decision: PermissionDecision,
    message?: string
  ): Promise<void> {
    if (!permissionID.startsWith("per")) {
      throw new LabError({
        code: "INVALID_REQUEST",
        status: 400,
        message: `Invalid permission id "${permissionID}".`,
        recovery: "Permission ids issued by OpenCode start with `per`.",
      });
    }
    let handled = false;
    let lastError: unknown;

    try {
      await this.client.respondPermission(sessionID, permissionID, decision, { directory });
      handled = true;
    } catch (e) {
      lastError = e;
      if (e instanceof LabError && e.code !== "API_ENDPOINT_MISSING" && e.status !== 404) throw e;
    }

    if (!handled) {
      try {
        await this.client.replyPermissionV2(sessionID, permissionID, decision, message);
        handled = true;
      } catch (e) {
        lastError = e;
      }
    }

    if (!handled) {
      throw new LabError({
        code: "PERMISSION_NOT_FOUND",
        status: 404,
        message: `Could not deliver the decision for permission ${permissionID}.`,
        detail: lastError instanceof Error ? lastError.message : String(lastError ?? ""),
        recovery: "The request may have already been answered. Refresh the monitor.",
      });
    }

    this.history.push({
      id: permissionID,
      sessionID,
      action: "",
      resources: [],
      savePatterns: [],
      metadata: {},
      source: "v1",
      requestedAt: Date.now(),
      decision,
      at: Date.now(),
    });
    if (this.history.length > 200) this.history.splice(0, this.history.length - 200);
  }

  recentDecisions() {
    return [...this.history];
  }
}
