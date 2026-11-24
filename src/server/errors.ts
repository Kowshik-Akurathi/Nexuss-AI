/**
 * Lab error taxonomy. Every error carries:
 *  - a human explanation (shown in the UI)
 *  - a machine code (stable, testable)
 *  - recovery guidance (shown in the UI)
 *  - an optional diagnostic detail (logged, never a false success)
 */

export type LabErrorCode =
  | "OPENCODE_NOT_INSTALLED"
  | "OPENCODE_BINARY_UNRESOLVED"
  | "SERVER_NOT_RUNNING"
  | "SERVER_START_FAILED"
  | "SERVER_START_TIMEOUT"
  | "SERVER_PORT_IN_USE"
  | "SERVER_UNREACHABLE"
  | "INVALID_SERVER_ADDRESS"
  | "AUTH_FAILED"
  | "API_VERSION_UNSUPPORTED"
  | "API_ENDPOINT_MISSING"
  | "SDK_ERROR"
  | "CONNECTION_TIMEOUT"
  | "STREAM_INTERRUPTED"
  | "MODEL_UNAVAILABLE"
  | "AGENT_UNAVAILABLE"
  | "PERMISSION_REJECTED"
  | "PERMISSION_NOT_FOUND"
  | "SESSION_NOT_FOUND"
  | "SESSION_BUSY"
  | "SESSION_FAILURE"
  | "INVALID_PROJECT_DIRECTORY"
  | "PATH_TRAVERSAL_BLOCKED"
  | "PROJECT_OUTSIDE_ROOT"
  | "PORT_CONFLICT"
  | "BACKEND_CRASH"
  | "NOT_CONNECTED"
  | "INVALID_REQUEST"
  | "UPSTREAM_ERROR"
  | "UNKNOWN";

export interface LabErrorInit {
  code: LabErrorCode;
  message: string;
  detail?: string;
  recovery?: string;
  status?: number;
  cause?: unknown;
}

export class LabError extends Error {
  readonly code: LabErrorCode;
  readonly detail?: string;
  readonly recovery?: string;
  readonly status: number;
  readonly cause?: unknown;

  constructor(init: LabErrorInit) {
    super(init.message);
    this.name = "LabError";
    this.code = init.code;
    this.detail = init.detail;
    this.recovery = init.recovery;
    this.status = init.status ?? 500;
    this.cause = init.cause;
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        detail: this.detail,
        recovery: this.recovery,
      },
    };
  }
}

export function isLabError(e: unknown): e is LabError {
  return e instanceof LabError;
}

/** Map an upstream HTTP failure to a LabError with recovery guidance. */
export function fromUpstream(status: number, bodyText: string, endpoint: string): LabError {
  const snippet = bodyText.slice(0, 500);
  if (status === 401 || status === 403) {
    return new LabError({
      code: "AUTH_FAILED",
      status,
      message: `OpenCode rejected the request (HTTP ${status}) at ${endpoint}.`,
      detail: snippet,
      recovery:
        "The server is likely protected by OPENCODE_SERVER_PASSWORD. Set OPENCODE_SERVER_PASSWORD in the Lab .env.local to the same value used when starting the server, then reconnect.",
    });
  }
  if (status === 404) {
    return new LabError({
      code: "API_ENDPOINT_MISSING",
      status,
      message: `Endpoint ${endpoint} is not available on this OpenCode version.`,
      detail: snippet,
      recovery:
        "The installed OpenCode build does not expose this route. Check Diagnostics for the detected version and supported capabilities.",
    });
  }
  if (status === 409) {
    return new LabError({
      code: "SESSION_BUSY",
      status,
      message: `OpenCode reported a conflict at ${endpoint}.`,
      detail: snippet,
      recovery: "The session already has work in flight. Wait for it to finish or interrupt it first.",
    });
  }
  if (status === 400) {
    return new LabError({
      code: "INVALID_REQUEST",
      status,
      message: `OpenCode rejected the request to ${endpoint}.`,
      detail: snippet,
      recovery: "This is a request-shape mismatch. See the technical detail and the Diagnostics page.",
    });
  }
  if (status === 503) {
    return new LabError({
      code: "SERVER_UNREACHABLE",
      status,
      message: `OpenCode is not ready at ${endpoint} (HTTP 503).`,
      detail: snippet,
      recovery: "Wait a moment and reconnect; the server may still be loading providers.",
    });
  }
  return new LabError({
    code: "UPSTREAM_ERROR",
    status,
    message: `OpenCode returned HTTP ${status} for ${endpoint}.`,
    detail: snippet,
    recovery: "Inspect the technical detail and the Lab logs for the underlying cause.",
  });
}

/** Standard JSON error body for Lab API routes. */
export function errorResponse(err: unknown, statusHint?: number): Response {
  if (isLabError(err)) {
    return Response.json(err.toJSON(), { status: statusHint ?? err.status });
  }
  const e = err as { message?: string; stack?: string };
  const lab = new LabError({
    code: "BACKEND_CRASH",
    message: e?.message || "Unexpected Lab backend failure.",
    detail: e?.stack?.slice(0, 1200),
    recovery: "Check the Lab server logs. Restart the Lab if the problem persists.",
  });
  return Response.json(lab.toJSON(), { status: statusHint ?? 500 });
}
