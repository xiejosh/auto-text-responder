import Database from 'better-sqlite3';
import path from 'path';

// Resolve DB_PATH relative to project root (one level up from dashboard/)
const PROJECT_ROOT = path.join(process.cwd(), '..');
const DB_PATH = path.resolve(PROJECT_ROOT, process.env.DB_PATH || './imessage-agent.db');

const db = new Database(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone_or_handle TEXT UNIQUE NOT NULL,
    display_name TEXT,
    auto_reply INTEGER DEFAULT 0,
    mode TEXT DEFAULT 'always',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS persona (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL,
    example TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS persona_summary (
    id INTEGER PRIMARY KEY DEFAULT 1,
    summary TEXT,
    tone TEXT,
    quirks TEXT,
    sample_phrases TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS message_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone_or_handle TEXT NOT NULL,
    direction TEXT NOT NULL,
    body TEXT NOT NULL,
    auto_generated INTEGER DEFAULT 0,
    sent_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS seen_messages (
    message_id TEXT PRIMARY KEY,
    processed_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  INSERT OR IGNORE INTO settings (key, value) VALUES ('agent_enabled', '0');
  INSERT OR IGNORE INTO settings (key, value) VALUES ('warmup_complete', '0');
  INSERT OR IGNORE INTO settings (key, value) VALUES ('reply_delay_min_ms', '2000');
  INSERT OR IGNORE INTO settings (key, value) VALUES ('reply_delay_max_ms', '8000');
`);

export default db;
