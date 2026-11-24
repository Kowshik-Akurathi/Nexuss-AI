import type { ApiErrorBody } from "./types";

/** Error carrying the server's structured Lab error payload. */
export class OpenCodeApiError extends Error {
  code: string;
  status: number;
  recovery?: string;

  constructor(status: number, code: string, message: string, recovery?: string) {
    super(message);
    this.name = "OpenCodeApiError";
    this.status = status;
    this.code = code;
    this.recovery = recovery;
  }
}

async function toError(res: Response): Promise<OpenCodeApiError> {
  let body: ApiErrorBody = {};
  try {
    body = (await res.json()) as ApiErrorBody;
  } catch {
    /* non-JSON error body */
  }
  return new OpenCodeApiError(
    res.status,
    body.error?.code ?? `HTTP_${res.status}`,
    body.error?.message ?? `Request failed (HTTP ${res.status}).`,
    body.error?.recovery
  );
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw await toError(res);
  return (await res.json()) as T;
}

export async function apiSend<T>(
  path: string,
  method: "POST" | "PATCH" | "DELETE",
  body?: unknown
): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  if (!res.ok) throw await toError(res);
  return (await res.json()) as T;
}
