import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH      = join(__dirname, 'chinook.db');
const CHINOOK_SQL  = join(__dirname, 'Chinook_Sqlite.sql');

// Open (or create) the database file
const db = new Database(DB_PATH);

// Enable WAL mode for better read performance
db.pragma('journal_mode = WAL');
// Enforce foreign keys
db.pragma('foreign_keys = ON');

// ── Chinook schema bootstrap ────────────────────────────────────────────────
// The Chinook_Sqlite.sql file already uses CREATE TABLE (no IF NOT EXISTS),
// so we only run it when the database is genuinely empty (Artist table missing).
const chinookReady = db
  .prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='Artist'`)
  .get().n > 0;

if (!chinookReady) {
  console.log('[DB] Bootstrapping ChinookDB from Chinook_Sqlite.sql …');
  const sql = readFileSync(CHINOOK_SQL, 'utf8');
  db.exec(sql);
  console.log('[DB] Chinook schema + data loaded.');
} else {
  console.log('[DB] ChinookDB already initialised — skipping seed.');
}

// ── Chat history schema ───────────────────────────────────────────────────────
// Kept separate from Chinook so chat persistence is never wiped.
db.exec(`
  CREATE TABLE IF NOT EXISTS Conversations (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ConversationMessages (
    id              TEXT    PRIMARY KEY,
    conversation_id TEXT    NOT NULL REFERENCES Conversations(id) ON DELETE CASCADE,
    role            TEXT    NOT NULL,
    type            TEXT    NOT NULL,
    content         TEXT    NOT NULL,
    payload         TEXT,
    created_at      INTEGER NOT NULL
  );
`);

console.log(`[DB] ChinookDB ready at ${DB_PATH}`);

export default db;
