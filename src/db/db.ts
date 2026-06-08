import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { seedTags } from "../index/tags.js";

export type SmithDatabase = Database.Database;

export function openDatabase(root: string): SmithDatabase {
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

    CREATE TABLE IF NOT EXISTS work_items (
      id TEXT PRIMARY KEY,
      parent_id TEXT,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL,
      priority INTEGER DEFAULT 0,
      source TEXT NOT NULL,
      assigned_agent_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_work_items_status ON work_items(status);
    CREATE INDEX IF NOT EXISTS idx_work_items_parent ON work_items(parent_id);

    CREATE TABLE IF NOT EXISTS checkpoints (
      id TEXT PRIMARY KEY,
      task_id TEXT,
      label TEXT NOT NULL,
      git_head TEXT,
      dirty_before INTEGER NOT NULL,
      files_json TEXT NOT NULL,
      pre_diff_path TEXT,
      applied_diff_path TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_checkpoints_task ON checkpoints(task_id);
    CREATE INDEX IF NOT EXISTS idx_checkpoints_created ON checkpoints(created_at);

    CREATE TABLE IF NOT EXISTS change_sets (
      id TEXT PRIMARY KEY,
      task_id TEXT,
      checkpoint_id TEXT,
      diff TEXT NOT NULL,
      status TEXT NOT NULL,
      summary TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS changed_files (
      id TEXT PRIMARY KEY,
      change_set_id TEXT NOT NULL,
      path TEXT NOT NULL,
      status TEXT NOT NULL,
      additions INTEGER DEFAULT 0,
      deletions INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_change_sets_status ON change_sets(status);
    CREATE INDEX IF NOT EXISTS idx_change_sets_task ON change_sets(task_id);
    CREATE INDEX IF NOT EXISTS idx_changed_files_change_set ON changed_files(change_set_id);
    CREATE INDEX IF NOT EXISTS idx_changed_files_path ON changed_files(path);

    CREATE TABLE IF NOT EXISTS changed_hunks (
      id TEXT PRIMARY KEY,
      change_set_id TEXT NOT NULL,
      changed_file_id TEXT NOT NULL,
      path TEXT NOT NULL,
      hunk_index INTEGER NOT NULL,
      header TEXT NOT NULL,
      status TEXT NOT NULL,
      old_start INTEGER NOT NULL,
      old_lines INTEGER NOT NULL,
      new_start INTEGER NOT NULL,
      new_lines INTEGER NOT NULL,
      additions INTEGER DEFAULT 0,
      deletions INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_changed_hunks_change_set ON changed_hunks(change_set_id);
    CREATE INDEX IF NOT EXISTS idx_changed_hunks_file ON changed_hunks(changed_file_id);
    CREATE INDEX IF NOT EXISTS idx_changed_hunks_path ON changed_hunks(path);

    CREATE TABLE IF NOT EXISTS task_plan_steps (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      notes TEXT,
      sort_order INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_task_plan_steps_task ON task_plan_steps(task_id);
    CREATE INDEX IF NOT EXISTS idx_task_plan_steps_status ON task_plan_steps(status);

    CREATE TABLE IF NOT EXISTS chat_sessions (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, scope TEXT NOT NULL,
      task_id TEXT, change_set_id TEXT, remote_agent_id TEXT, remote_session_id TEXT,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL,
      content TEXT NOT NULL, status TEXT NOT NULL, model TEXT,
      action_kind TEXT, runtime_task_id TEXT, parent_message_id TEXT,
      metadata_json TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS user_questions (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL, message_id TEXT NOT NULL,
      kind TEXT NOT NULL, prompt TEXT NOT NULL, options_json TEXT,
      default_value_json TEXT, answer_json TEXT, status TEXT NOT NULL,
      created_at INTEGER NOT NULL, answered_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_chat_sessions_scope ON chat_sessions(scope);
    CREATE INDEX IF NOT EXISTS idx_chat_sessions_task ON chat_sessions(task_id);
    CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id);
    CREATE INDEX IF NOT EXISTS idx_chat_messages_created ON chat_messages(created_at);
    CREATE INDEX IF NOT EXISTS idx_user_questions_session ON user_questions(session_id);
    CREATE INDEX IF NOT EXISTS idx_user_questions_status ON user_questions(status);
  `);

  seedTags(db);

  return db;
}

/** Read a value from the key/value meta table. */
export function getMeta(db: SmithDatabase, key: string): string | undefined {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value;
}

/** Write a value to the key/value meta table. */
export function setMeta(db: SmithDatabase, key: string, value: string): void {
  db.prepare(
    "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(key, value);
}
