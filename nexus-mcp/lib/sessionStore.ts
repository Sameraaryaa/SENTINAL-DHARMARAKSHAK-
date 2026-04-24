/**
 * NEXUS Session Store — SQLite-backed persistent storage.
 * DB file: ./nexus.db (created automatically)
 * Tables: sessions, events, agent_outputs
 */
import Database from "better-sqlite3";
import path from "path";

export type AgentName = "research" | "legal" | "devil" | "judge";
export type RiskLevel = "low" | "medium" | "high";
export type SessionStatus = "running" | "paused" | "complete" | "error";

export interface SessionEvent {
  type: string;
  agent?: AgentName;
  data?: any;
  timestamp: string;
}

export interface Session {
  session_id: string;
  topic: string;
  status: SessionStatus;
  risk_level: RiskLevel;
  chat_id?: number;
  events: SessionEvent[];
  agents_output: Partial<Record<AgentName, string>>;
  verdict?: string;
  confidence?: number;
  created_at: string;
}

// ─── Initialize SQLite ──────────────────────────────────────────────
const DB_PATH = path.join(process.cwd(), "nexus.db");
const db = new Database(DB_PATH);

// Enable WAL mode for better write performance
db.pragma("journal_mode = WAL");

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    session_id TEXT PRIMARY KEY,
    topic TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'running',
    risk_level TEXT NOT NULL DEFAULT 'low',
    chat_id INTEGER,
    verdict TEXT,
    confidence REAL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    type TEXT NOT NULL,
    agent TEXT,
    data TEXT,
    timestamp TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(session_id)
  );

  CREATE TABLE IF NOT EXISTS agent_outputs (
    session_id TEXT NOT NULL,
    agent TEXT NOT NULL,
    output TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (session_id, agent),
    FOREIGN KEY (session_id) REFERENCES sessions(session_id)
  );

  CREATE TABLE IF NOT EXISTS security_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    username TEXT,
    chat_id TEXT,
    attack_type TEXT NOT NULL,
    input_preview TEXT,
    timestamp TEXT NOT NULL,
    checks TEXT,
    blocked INTEGER NOT NULL DEFAULT 1
  );

  CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id);
  CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
  CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
  CREATE INDEX IF NOT EXISTS idx_sessions_created ON sessions(created_at);
  CREATE INDEX IF NOT EXISTS idx_security_events_type ON security_events(attack_type);
`);

console.log(`💾 [DB] SQLite initialized at ${DB_PATH}`);

// ─── Prepared Statements (reusable for performance) ─────────────────
const stmtInsertSession = db.prepare(`
  INSERT OR REPLACE INTO sessions (session_id, topic, status, risk_level, chat_id, verdict, confidence, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const stmtUpdateSession = db.prepare(`
  UPDATE sessions SET status = COALESCE(?, status), risk_level = COALESCE(?, risk_level),
  verdict = COALESCE(?, verdict), confidence = COALESCE(?, confidence), updated_at = ?
  WHERE session_id = ?
`);

const stmtGetSession = db.prepare(`SELECT * FROM sessions WHERE session_id = ?`);
const stmtGetAllSessions = db.prepare(`SELECT * FROM sessions ORDER BY created_at DESC`);

const stmtInsertEvent = db.prepare(`
  INSERT INTO events (session_id, type, agent, data, timestamp) VALUES (?, ?, ?, ?, ?)
`);
const stmtGetEvents = db.prepare(`SELECT * FROM events WHERE session_id = ? ORDER BY id ASC`);

const stmtUpsertAgentOutput = db.prepare(`
  INSERT OR REPLACE INTO agent_outputs (session_id, agent, output, created_at) VALUES (?, ?, ?, ?)
`);
const stmtGetAgentOutputs = db.prepare(`SELECT agent, output FROM agent_outputs WHERE session_id = ?`);

// ─── In-memory cache for active sessions (fast access) ──────────────
const cache = new Map<string, Session>();

// ─── Public API ─────────────────────────────────────────────────────

export function createSession(
  session_id: string,
  topic: string,
  chat_id?: number
): Session {
  const now = new Date().toISOString();
  const session: Session = {
    session_id,
    topic,
    status: "running",
    risk_level: "low",
    chat_id,
    events: [],
    agents_output: {},
    created_at: now,
  };

  stmtInsertSession.run(
    session_id, topic, "running", "low", chat_id || null, null, null, now, now
  );

  cache.set(session_id, session);
  console.log(`💾 [DB] Session created: ${session_id.slice(0, 8)}`);
  return session;
}

export function getSession(session_id: string): Session | undefined {
  // Check cache first
  if (cache.has(session_id)) return cache.get(session_id);

  // Load from DB
  const row: any = stmtGetSession.get(session_id);
  if (!row) return undefined;

  const events = (stmtGetEvents.all(session_id) as any[]).map((e) => ({
    type: e.type,
    agent: e.agent || undefined,
    data: e.data ? JSON.parse(e.data) : undefined,
    timestamp: e.timestamp,
  }));

  const agentRows = stmtGetAgentOutputs.all(session_id) as any[];
  const agents_output: Partial<Record<AgentName, string>> = {};
  for (const r of agentRows) agents_output[r.agent as AgentName] = r.output;

  const session: Session = {
    session_id: row.session_id,
    topic: row.topic,
    status: row.status,
    risk_level: row.risk_level,
    chat_id: row.chat_id || undefined,
    events,
    agents_output,
    verdict: row.verdict || undefined,
    confidence: row.confidence || undefined,
    created_at: row.created_at,
  };

  cache.set(session_id, session);
  return session;
}

export function getAllSessions(): Session[] {
  const rows = stmtGetAllSessions.all() as any[];
  return rows.map((row) => {
    // Use cache if available, otherwise build from row
    if (cache.has(row.session_id)) return cache.get(row.session_id)!;

    return {
      session_id: row.session_id,
      topic: row.topic,
      status: row.status,
      risk_level: row.risk_level,
      chat_id: row.chat_id || undefined,
      events: [], // Don't load all events for listing
      agents_output: {},
      verdict: row.verdict || undefined,
      confidence: row.confidence || undefined,
      created_at: row.created_at,
    };
  });
}

export function addEvent(session_id: string, event: Omit<SessionEvent, "timestamp">): void {
  const timestamp = new Date().toISOString();
  const dataStr = event.data ? JSON.stringify(event.data) : null;

  stmtInsertEvent.run(session_id, event.type, event.agent || null, dataStr, timestamp);

  // Update cache
  const session = cache.get(session_id);
  if (session) {
    session.events.push({ ...event, timestamp });
  }
}

export function updateSession(
  session_id: string,
  updates: Partial<Pick<Session, "status" | "risk_level" | "verdict" | "confidence">>
): void {
  const now = new Date().toISOString();
  stmtUpdateSession.run(
    updates.status || null,
    updates.risk_level || null,
    updates.verdict || null,
    updates.confidence !== undefined ? updates.confidence : null,
    now,
    session_id
  );

  // Update cache
  const session = cache.get(session_id);
  if (session) {
    Object.assign(session, updates);
  }
}

export function setAgentOutput(session_id: string, agent: AgentName, output: string): void {
  const now = new Date().toISOString();
  stmtUpsertAgentOutput.run(session_id, agent, output, now);

  // Update cache
  const session = cache.get(session_id);
  if (session) {
    session.agents_output[agent] = output;
  }
}

// ─── Stats for dashboard ────────────────────────────────────────────
export function getDbStats() {
  const totalSessions = (db.prepare("SELECT COUNT(*) as c FROM sessions").get() as any).c;
  const totalEvents = (db.prepare("SELECT COUNT(*) as c FROM events").get() as any).c;
  const completedSessions = (db.prepare("SELECT COUNT(*) as c FROM sessions WHERE status = 'complete'").get() as any).c;
  const highRiskSessions = (db.prepare("SELECT COUNT(*) as c FROM sessions WHERE risk_level = 'high'").get() as any).c;
  const avgConfidence = (db.prepare("SELECT AVG(confidence) as avg FROM sessions WHERE confidence IS NOT NULL").get() as any).avg;

  return {
    total_sessions: totalSessions,
    total_events: totalEvents,
    completed: completedSessions,
    high_risk: highRiskSessions,
    avg_confidence: avgConfidence ? Math.round(avgConfidence) : 0,
    db_path: DB_PATH,
  };
}

// ─── Security Event Logging ─────────────────────────────────────────
const stmtInsertSecurityEvent = db.prepare(`
  INSERT INTO security_events (session_id, username, chat_id, attack_type, input_preview, timestamp, checks, blocked)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

const stmtGetSecurityEvents = db.prepare(`SELECT * FROM security_events ORDER BY id DESC LIMIT 50`);

export function logSecurityEvent(data: {
  sessionId: string;
  username: string;
  chatId: string;
  attackType: string;
  input: string;
  timestamp: string;
  checks: any[];
  blocked: boolean;
}): void {
  stmtInsertSecurityEvent.run(
    data.sessionId,
    data.username,
    data.chatId,
    data.attackType,
    data.input,
    data.timestamp,
    JSON.stringify(data.checks),
    data.blocked ? 1 : 0
  );
  console.log(`💾 [DB] Security event logged: ${data.attackType} by @${data.username}`);
}

export function getSecurityEvents() {
  return (stmtGetSecurityEvents.all() as any[]).map((row) => ({
    ...row,
    checks: row.checks ? JSON.parse(row.checks) : [],
    blocked: row.blocked === 1,
  }));
}

// Graceful shutdown
process.on("exit", () => db.close());
process.on("SIGINT", () => { db.close(); process.exit(0); });
