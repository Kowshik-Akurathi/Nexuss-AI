import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface AuditEntry {
  ts: number;
  level: LogLevel;
  scope: string;
  message: string;
  data?: Record<string, unknown>;
}

function labRoot(): string {
  return process.env.LAB_DATA_DIR || path.join(process.cwd(), ".lab");
}

/**
 * Append-only audit log kept INSIDE the Lab directory.
 * Never writes outside the Lab, never records secrets.
 */
export class AuditLogger {
  private minLevel: number;
  private file: string;

  constructor(scopeFile = "audit.log") {
    const dir = labRoot();
    this.file = path.join(dir, scopeFile);
    this.minLevel = LEVELS[(process.env.LAB_LOG_LEVEL as LogLevel) || "info"] ?? 20;
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {
      /* read-only fallback: memory only */
    }
  }

  log(level: LogLevel, scope: string, message: string, data?: Record<string, unknown>): AuditEntry {
    const entry: AuditEntry = { ts: Date.now(), level, scope, message, data: redact(data) };
    if (LEVELS[level] >= this.minLevel) {
      try {
        fs.appendFileSync(this.file, JSON.stringify(entry) + "\n", "utf8");
      } catch {
        /* swallow - logging must never break the request */
      }
      if (level === "error") console.error(`[lab:${scope}] ${message}`);
    }
    return entry;
  }

  debug(scope: string, message: string, data?: Record<string, unknown>) {
    return this.log("debug", scope, message, data);
  }
  info(scope: string, message: string, data?: Record<string, unknown>) {
    return this.log("info", scope, message, data);
  }
  warn(scope: string, message: string, data?: Record<string, unknown>) {
    return this.log("warn", scope, message, data);
  }
  error(scope: string, message: string, data?: Record<string, unknown>) {
    return this.log("error", scope, message, data);
  }

  async tail(limit = 200): Promise<AuditEntry[]> {
    try {
      const text = await fsp.readFile(this.file, "utf8");
      const lines = text.split(/\r?\n/).filter(Boolean).slice(-limit);
      const out: AuditEntry[] = [];
      for (const l of lines) {
        try {
          out.push(JSON.parse(l));
        } catch {
          /* skip malformed */
        }
      }
      return out.reverse();
    } catch {
      return [];
    }
  }
}

const SECRET_KEY = /(key|token|secret|password|authorization|credential|apikey)/i;

/** Strip anything that looks like a credential from logged data. */
export function redact(data?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!data) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (SECRET_KEY.test(k)) out[k] = "[redacted]";
    else if (v && typeof v === "object" && !Array.isArray(v)) out[k] = redact(v as Record<string, unknown>);
    else if (typeof v === "string" && /sk-[A-Za-z0-9_-]{16,}/.test(v)) out[k] = "[redacted]";
    else out[k] = v;
  }
  return out;
}

const g = globalThis as unknown as { __nexussAudit?: AuditLogger };

export function audit(): AuditLogger {
  if (!g.__nexussAudit) g.__nexussAudit = new AuditLogger();
  return g.__nexussAudit;
}
