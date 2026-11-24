/**
 * Nexuss Proxy API server — hosts the migrated Nexuss Lab / OpenCode backend.
 *
 * Runs standalone (`npm run api`) or behind the Vite dev/preview proxy
 * (`npm run dev`). In production it also serves the built frontend from `dist/`.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { handleApiRequest } from "./router";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "../..");

// ------------------------------------------------------------- env loading
/** Minimal .env loader (no dependency): KEY=VALUE lines, never overrides. */
function loadEnvFile(file: string): void {
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvFile(path.join(PROJECT_ROOT, ".env"));
loadEnvFile(path.join(PROJECT_ROOT, ".env.local"));

// ----------------------------------------------------------- HTTP bridging
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json",
  ".txt": "text/plain; charset=utf-8",
};

async function readBody(req: http.IncomingMessage): Promise<Buffer | undefined> {
  const method = (req.method ?? "GET").toUpperCase();
  if (method === "GET" || method === "HEAD") return undefined;
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return undefined;
  return Buffer.concat(chunks);
}

function toWebRequest(
  req: http.IncomingMessage,
  url: URL,
  body: Buffer | undefined,
  signal: AbortSignal
): Request {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) for (const v of value) headers.append(key, v);
    else headers.set(key, value);
  }
  const method = (req.method ?? "GET").toUpperCase();
  const init: RequestInit & { duplex?: "half" } = { method, headers, signal };
  if (body) init.body = new Uint8Array(body);
  return new Request(url, init);
}

async function sendWebResponse(res: http.ServerResponse, response: Response): Promise<void> {
  const status = response.status;
  const outHeaders: Record<string, string | string[]> = {};
  response.headers.forEach((value, key) => {
    outHeaders[key] = value;
  });

  if (!response.body) {
    res.writeHead(status, outHeaders);
    res.end();
    return;
  }

  res.writeHead(status, outHeaders);
  const reader = response.body.getReader();
  const pump = async (): Promise<void> => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!res.writableEnded) res.write(Buffer.from(value));
      }
    } catch {
      /* client disconnected or stream aborted */
    } finally {
      if (!res.writableEnded) res.end();
    }
  };
  res.on("close", () => {
    void reader.cancel().catch(() => {});
  });
  await pump();
}

// ------------------------------------------------------------ static files
function serveStatic(req: http.IncomingMessage, res: http.ServerResponse, url: URL): void {
  const distDir = path.join(PROJECT_ROOT, "dist");
  const notFound = () => {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found. Run `npm run build` to produce dist/.");
  };

  if (!fs.existsSync(distDir)) return notFound();

  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith("/")) rel += "index.html";
  const filePath = path.resolve(distDir, `.${rel}`);
  // Containment: never serve outside dist/.
  if (!filePath.startsWith(distDir + path.sep) && filePath !== distDir) return notFound();

  let target = filePath;
  if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) {
    // SPA fallback for client-side routes.
    target = path.join(distDir, "index.html");
    if (!fs.existsSync(target)) return notFound();
  }

  const ext = path.extname(target).toLowerCase();
  const type = MIME[ext] ?? "application/octet-stream";
  res.writeHead(200, { "content-type": type, "cache-control": ext === ".html" ? "no-cache" : "public, max-age=3600" });
  fs.createReadStream(target).pipe(res);
}

// --------------------------------------------------------------- the server
export function createApiServer(): http.Server {
  return http.createServer((req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
        const body = await readBody(req);

        if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
          const controller = new AbortController();
          res.on("close", () => controller.abort());
          const request = toWebRequest(req, url, body, controller.signal);
          const response = await handleApiRequest(request);
          if (response) {
            await sendWebResponse(res, response);
            return;
          }
        }

        if ((req.method ?? "GET").toUpperCase() !== "GET" && (req.method ?? "").toUpperCase() !== "HEAD") {
          res.writeHead(404, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: { code: "NOT_FOUND", message: "Not found." } }));
          return;
        }

        serveStatic(req, res, url);
      } catch (e) {
        if (!res.headersSent) {
          res.writeHead(500, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              error: { code: "INTERNAL", message: (e as Error).message, detail: "server exception" },
            })
          );
        } else if (!res.writableEnded) {
          res.end();
        }
      }
    })();
  });
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const port = Number(process.env.NEXUSS_API_PORT ?? process.env.PORT ?? 5175);
  const server = createApiServer();
  server.listen(port, "127.0.0.1", () => {
    // eslint-disable-next-line no-console
    console.log(`[nexuss] API server listening on http://127.0.0.1:${port}`);
  });
  const shutdown = () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
