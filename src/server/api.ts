import { LabError, errorResponse } from "@/server/errors";
import { getConnection } from "@/server/opencode/connection";
import { audit } from "@/server/audit-logger";

type RouteContext = { params: Promise<Record<string, string>> };

/** Wrap a route handler with uniform error handling + audit logging. */
export function handler(
  name: string,
  fn: (req: Request, ctx: RouteContext) => Promise<Response>
) {
  return async (req: Request, ctx?: RouteContext) => {
    const started = Date.now();
    const pathname = new URL(req.url).pathname;
    try {
      const res = await fn(req, ctx ?? { params: Promise.resolve({}) });
      audit().debug(name, `${req.method} ${pathname} -> ${res.status}`, {
        ms: Date.now() - started,
      });
      return res;
    } catch (e) {
      const lab = e instanceof LabError ? e : null;
      audit().error(name, `${req.method} ${pathname} failed: ${(e as Error).message}`, {
        code: lab?.code,
        detail: lab?.detail,
        ms: Date.now() - started,
      });
      return errorResponse(e);
    }
  };
}

/** Require a live OpenCode client or throw a UI-friendly NOT_CONNECTED. */
export function client() {
  return getConnection().requireClient();
}

export function json(data: unknown, init?: ResponseInit): Response {
  return Response.json(data, init);
}

export async function readJson<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new LabError({
      code: "INVALID_REQUEST",
      status: 400,
      message: "Request body must be valid JSON.",
      recovery: "Check the request payload.",
    });
  }
}

export function requireParam(url: URL, key: string): string {
  const v = url.searchParams.get(key);
  if (!v) {
    throw new LabError({
      code: "INVALID_REQUEST",
      status: 400,
      message: `Missing required query parameter "${key}".`,
      recovery: `Include ${key}=... in the request.`,
    });
  }
  return v;
}
