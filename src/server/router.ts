import { GET as statusGET } from "@/server/routes/status";
import { GET as connectionGET, POST as connectionPOST } from "@/server/routes/connection";
import { GET as agentsGET } from "@/server/routes/agents";
import { GET as modelsGET, POST as modelsPOST } from "@/server/routes/models";
import { GET as sessionsGET, POST as sessionsPOST } from "@/server/routes/sessions";
import { GET as sessionGET, PATCH as sessionPATCH, DELETE as sessionDELETE } from "@/server/routes/session";
import { GET as promptGET, POST as promptPOST, DELETE as promptDELETE } from "@/server/routes/prompt";
import { GET as projectsGET, POST as projectsPOST } from "@/server/routes/projects";
import { GET as permissionsGET, POST as permissionsPOST } from "@/server/routes/permissions";
import { GET as executionsGET } from "@/server/routes/executions";
import { GET as eventsGET } from "@/server/routes/events";
import { GET as settingsGET, PATCH as settingsPATCH } from "@/server/routes/settings";
import { GET as diagnosticsGET } from "@/server/routes/diagnostics";
import { GET as installGET, POST as installPOST, GET_EVENTS as installEventsGET } from "@/server/routes/install";

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

interface Route {
  method: string;
  segments: string[];
  handler: Handler;
}

function route(method: string, path: string, handler: Handler): Route {
  return { method, segments: path.split("/").filter(Boolean), handler };
}

const ROUTES: Route[] = [
  route("GET", "/api/status", statusGET),
  route("GET", "/api/connection", connectionGET),
  route("POST", "/api/connection", connectionPOST),
  route("GET", "/api/agents", agentsGET),
  route("GET", "/api/models", modelsGET),
  route("POST", "/api/models", modelsPOST),
  route("GET", "/api/sessions", sessionsGET),
  route("POST", "/api/sessions", sessionsPOST),
  route("GET", "/api/sessions/:id", sessionGET),
  route("PATCH", "/api/sessions/:id", sessionPATCH),
  route("DELETE", "/api/sessions/:id", sessionDELETE),
  route("GET", "/api/sessions/:id/prompt", promptGET),
  route("POST", "/api/sessions/:id/prompt", promptPOST),
  route("DELETE", "/api/sessions/:id/prompt", promptDELETE),
  route("GET", "/api/projects", projectsGET),
  route("POST", "/api/projects", projectsPOST),
  route("GET", "/api/permissions", permissionsGET),
  route("POST", "/api/permissions", permissionsPOST),
  route("GET", "/api/executions", executionsGET),
  route("GET", "/api/events", eventsGET),
  route("GET", "/api/settings", settingsGET),
  route("PATCH", "/api/settings", settingsPATCH),
  route("GET", "/api/diagnostics", diagnosticsGET),
  route("GET", "/api/install", installGET),
  route("POST", "/api/install", installPOST),
  route("GET", "/api/install/events", installEventsGET),
];

console.log("[router] registered routes:", ROUTES.map(r => `${r.method} /${r.segments.join("/")}`));

function match(r: Route, method: string, segments: string[]): Record<string, string> | null {
  if (r.method !== method) return null;
  if (r.segments.length !== segments.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < r.segments.length; i++) {
    const expected = r.segments[i];
    const actual = segments[i];
    if (expected.startsWith(":")) {
      params[expected.slice(1)] = decodeURIComponent(actual);
    } else if (expected !== actual) {
      return null;
    }
  }
  return params;
}

/**
 * Dispatch a request against the migrated Nexuss Lab API surface.
 * Returns null when the path does not match any API route so the caller
 * can fall through to static file serving.
 */
export async function handleApiRequest(req: Request): Promise<Response | null> {
  const url = new URL(req.url);
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments[0] !== "api") return null;

  for (const r of ROUTES) {
    const params = match(r, req.method, segments);
    if (params) {
      return r.handler(req, { params: Promise.resolve(params) });
    }
  }

  // Known API prefix but no matching route -> 404 JSON, never static HTML.
  return Response.json(
    {
      error: {
        code: "NOT_FOUND",
        message: `No API route for ${req.method} ${url.pathname}.`,
        detail: "Unrouted API path.",
        recovery: "Check the endpoint against the Nexuss Lab API surface.",
      },
    },
    { status: 404 }
  );
}
