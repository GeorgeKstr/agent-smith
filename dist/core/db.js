import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { seedTags } from "./tags.js";
export function openDatabase(root) {
    const agentDir = path.join(root, ".agent");
    fs.mkdirSync(agentDir, { recursive: true });
    const db = new Database(path.join(agentDir, "index.sqlite"));
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY,
      path TEXT UNIQUE NOT NULL,
      language TEXT,
      hash TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      mtime INTEGER NOT NULL,
      is_test INTEGER DEFAULT 0,
      is_generated INTEGER DEFAULT 0,
      last_indexed_at INTEGER,
      summary TEXT,
      risk_level TEXT DEFAULT 'low',
      status TEXT DEFAULT 'fresh'
    );

    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      description TEXT
    );

    CREATE TABLE IF NOT EXISTS file_tags (
      file_id INTEGER NOT NULL,
      tag_id INTEGER NOT NULL,
      confidence REAL DEFAULT 1.0,
      source TEXT NOT NULL,
      PRIMARY KEY (file_id, tag_id)
    );

    CREATE TABLE IF NOT EXISTS symbols (
      id INTEGER PRIMARY KEY,
      file_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      qualified_name TEXT NOT NULL,
      kind TEXT NOT NULL,
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL,
      start_byte INTEGER,
      end_byte INTEGER,
      signature TEXT,
      summary TEXT,
      hash TEXT,
      status TEXT DEFAULT 'fresh'
    );

    CREATE TABLE IF NOT EXISTS symbol_tags (
      symbol_id INTEGER NOT NULL,
      tag_id INTEGER NOT NULL,
      confidence REAL DEFAULT 1.0,
      source TEXT NOT NULL,
      PRIMARY KEY (symbol_id, tag_id)
    );

    CREATE TABLE IF NOT EXISTS imports (
      id INTEGER PRIMARY KEY,
      from_file_id INTEGER NOT NULL,
      to_file_id INTEGER,
      import_text TEXT NOT NULL,
      resolved_path TEXT,
      confidence REAL DEFAULT 1.0
    );

    CREATE TABLE IF NOT EXISTS symbol_edges (
      id INTEGER PRIMARY KEY,
      from_symbol_id INTEGER,
      to_symbol_id INTEGER,
      from_file_id INTEGER,
      to_file_id INTEGER,
      edge_type TEXT NOT NULL,
      confidence REAL DEFAULT 1.0
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      task_text TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      status TEXT NOT NULL,
      chosen_model TEXT,
      success INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS edits (
      id TEXT PRIMARY KEY,
      task_id TEXT,
      file_id INTEGER,
      old_hash TEXT,
      new_hash TEXT,
      patch TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS test_runs (
      id TEXT PRIMARY KEY,
      task_id TEXT,
      command TEXT NOT NULL,
      exit_code INTEGER,
      stdout TEXT,
      stderr TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_files_status ON files(status);
    CREATE INDEX IF NOT EXISTS idx_symbols_file ON symbols(file_id);
    CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name);
    CREATE INDEX IF NOT EXISTS idx_file_tags_tag ON file_tags(tag_id);
    CREATE INDEX IF NOT EXISTS idx_imports_from ON imports(from_file_id);
    CREATE INDEX IF NOT EXISTS idx_imports_to ON imports(to_file_id);
    CREATE INDEX IF NOT EXISTS idx_edges_from ON symbol_edges(from_file_id);
    CREATE INDEX IF NOT EXISTS idx_edges_to ON symbol_edges(to_file_id);
  `);
    seedTags(db);
    return db;
}
/** Read a value from the key/value meta table. */
export function getMeta(db, key) {
    const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key);
    return row?.value;
}
/** Write a value to the key/value meta table. */
export function setMeta(db, key, value) {
    db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}
