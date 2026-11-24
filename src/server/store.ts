import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

/**
 * Lab-local metadata store using Node 24's built-in `node:sqlite`.
 * Holds ONLY Lab bookkeeping (chosen project, selected agent/model, execution
 * history index, settings). No OpenCode source code or transcripts are copied.
 */

export interface LabSessionRow {
  session_id: string;
  title: string;
  directory: string;
  agent: string | null;
  model: string | null;
  created_at: number;
  updated_at: number;
  last_used_at: number;
}

export interface LabExecutionRow {
  id: string;
  session_id: string;
  directory: string;
  prompt: string;
  status: string;
  started_at: number;
  ended_at: number | null;
  tools_used: number;
  files_changed: number;
  error: string | null;
}

function dbPath(): string {
  const dir = process.env.LAB_DATA_DIR || path.join(process.cwd(), ".lab");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "lab.sqlite");
}

class Store {
  private db: DatabaseSync;

  constructor() {
    this.db = new DatabaseSync(dbPath());
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.migrate();
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS lab_sessions (
        session_id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT '',
        directory TEXT NOT NULL,
        agent TEXT,
        model TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_used_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS lab_executions (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        directory TEXT NOT NULL,
        prompt TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        tools_used INTEGER NOT NULL DEFAULT 0,
        files_changed INTEGER NOT NULL DEFAULT 0,
        error TEXT
      );
      CREATE TABLE IF NOT EXISTS lab_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_lab_exec_session ON lab_executions(session_id);
      CREATE INDEX IF NOT EXISTS idx_lab_exec_started ON lab_executions(started_at DESC);
    `);
  }

  // --- sessions -----------------------------------------------------------
  upsertSession(row: Omit<LabSessionRow, "last_used_at"> & { last_used_at?: number }) {
    this.db
      .prepare(
        `INSERT INTO lab_sessions (session_id,title,directory,agent,model,created_at,updated_at,last_used_at)
         VALUES (?,?,?,?,?,?,?,?)
         ON CONFLICT(session_id) DO UPDATE SET
           title=excluded.title, agent=excluded.agent, model=excluded.model,
           updated_at=excluded.updated_at, last_used_at=excluded.last_used_at`
      )
      .run(
        row.session_id,
        row.title,
        row.directory,
        row.agent,
        row.model,
        row.created_at,
        row.updated_at,
        row.last_used_at ?? row.updated_at
      );
  }

  touchSession(sessionId: string, agent?: string, model?: string) {
    this.db
      .prepare(`UPDATE lab_sessions SET last_used_at=?, agent=COALESCE(?,agent), model=COALESCE(?,model) WHERE session_id=?`)
      .run(Date.now(), agent ?? null, model ?? null, sessionId);
  }

  listSessions(limit = 100): LabSessionRow[] {
    return this.db
      .prepare(`SELECT * FROM lab_sessions ORDER BY last_used_at DESC LIMIT ?`)
      .all(limit) as unknown as LabSessionRow[];
  }

  getSession(sessionId: string): LabSessionRow | undefined {
    return this.db.prepare(`SELECT * FROM lab_sessions WHERE session_id=?`).get(sessionId) as
      | LabSessionRow
      | undefined;
  }

  deleteSession(sessionId: string) {
    this.db.prepare(`DELETE FROM lab_sessions WHERE session_id=?`).run(sessionId);
    this.db.prepare(`DELETE FROM lab_executions WHERE session_id=?`).run(sessionId);
  }

  // --- executions ---------------------------------------------------------
  insertExecution(row: LabExecutionRow) {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO lab_executions
         (id,session_id,directory,prompt,status,started_at,ended_at,tools_used,files_changed,error)
         VALUES (?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        row.id,
        row.session_id,
        row.directory,
        row.prompt,
        row.status,
        row.started_at,
        row.ended_at,
        row.tools_used,
        row.files_changed,
        row.error
      );
  }

  listExecutions(limit = 50): LabExecutionRow[] {
    return this.db
      .prepare(`SELECT * FROM lab_executions ORDER BY started_at DESC LIMIT ?`)
      .all(limit) as unknown as LabExecutionRow[];
  }

  // --- settings -----------------------------------------------------------
  setSetting(key: string, value: unknown) {
    this.db
      .prepare(`INSERT INTO lab_settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`)
      .run(key, JSON.stringify(value));
  }

  getSetting<T>(key: string, fallback: T): T {
    const row = this.db.prepare(`SELECT value FROM lab_settings WHERE key=?`).get(key) as
      | { value: string }
      | undefined;
    if (!row) return fallback;
    try {
      return JSON.parse(row.value) as T;
    } catch {
      return fallback;
    }
  }

  stats() {
    const sessions = (this.db.prepare(`SELECT COUNT(*) c FROM lab_sessions`).get() as { c: number }).c;
    const executions = (this.db.prepare(`SELECT COUNT(*) c FROM lab_executions`).get() as { c: number }).c;
    const failed = (
      this.db.prepare(`SELECT COUNT(*) c FROM lab_executions WHERE status='failed'`).get() as { c: number }
    ).c;
    return { sessions, executions, failed };
  }
}

const g = globalThis as unknown as { __nexussLabStore?: Store };

export function store(): Store {
  if (!g.__nexussLabStore) g.__nexussLabStore = new Store();
  return g.__nexussLabStore;
}

export { Store };
