PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  root_path TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  task_type TEXT NOT NULL,
  review_mode TEXT NOT NULL DEFAULT 'auto',
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  user_prompt TEXT NOT NULL,
  final_response TEXT,
  final_summary TEXT,
  model_name TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  reasoning_tokens INTEGER,
  error TEXT,
  full_transcript TEXT
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT,
  project_id TEXT NOT NULL,
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  type TEXT NOT NULL,
  actor TEXT NOT NULL DEFAULT 'system',
  payload_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS tool_calls (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  args_json TEXT NOT NULL DEFAULT '{}',
  result_text TEXT,
  error TEXT
);

CREATE TABLE IF NOT EXISTS files (
  path TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  language TEXT,
  kind TEXT,
  size_bytes INTEGER,
  mtime REAL,
  sha256 TEXT,
  importance INTEGER NOT NULL DEFAULT 0,
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  is_deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS file_summaries (
  path TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  symbols_json TEXT NOT NULL DEFAULT '[]',
  imports_json TEXT NOT NULL DEFAULT '[]',
  exports_json TEXT NOT NULL DEFAULT '[]',
  responsibilities_json TEXT NOT NULL DEFAULT '[]',
  relationships_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  source_sha256 TEXT
);

CREATE TABLE IF NOT EXISTS file_summary_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  path TEXT NOT NULL,
  source_sha256 TEXT,
  summary TEXT NOT NULL,
  symbols_json TEXT NOT NULL DEFAULT '[]',
  imports_json TEXT NOT NULL DEFAULT '[]',
  exports_json TEXT NOT NULL DEFAULT '[]',
  responsibilities_json TEXT NOT NULL DEFAULT '[]',
  relationships_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  source_run_id TEXT
);

CREATE TABLE IF NOT EXISTS file_relationships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  source_path TEXT NOT NULL,
  target_path TEXT NOT NULL,
  relationship_type TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 1.0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(project_id, source_path, target_path, relationship_type)
);

CREATE TABLE IF NOT EXISTS file_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  path TEXT NOT NULL,
  change_type TEXT NOT NULL,
  before_sha256 TEXT,
  after_sha256 TEXT,
  diff_text TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS context_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  priority INTEGER NOT NULL DEFAULT 0,
  source_run_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS task_summaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL UNIQUE,
  project_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  files_touched_json TEXT NOT NULL DEFAULT '[]',
  commands_run_json TEXT NOT NULL DEFAULT '[]',
  outcome TEXT NOT NULL,
  followups_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS project_context_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  run_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  token_budget INTEGER NOT NULL,
  content TEXT NOT NULL,
  context_hash TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS context_build_inputs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_id INTEGER NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  rank_score REAL NOT NULL DEFAULT 0,
  reason TEXT
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  priority INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT,
  ended_at TEXT,
  error TEXT,
  progress_current INTEGER DEFAULT 0,
  progress_total INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS index_state (
  project_id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'idle',
  mode TEXT,
  paused INTEGER NOT NULL DEFAULT 0,
  current_job_id TEXT,
  last_scan_at TEXT,
  last_full_reindex_at TEXT,
  files_total INTEGER DEFAULT 0,
  files_done INTEGER DEFAULT 0,
  files_dirty INTEGER DEFAULT 0,
  message TEXT
);

CREATE TABLE IF NOT EXISTS file_index_status (
  project_id TEXT NOT NULL,
  path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unknown',
  last_hash TEXT,
  last_indexed_hash TEXT,
  last_seen_at TEXT,
  last_indexed_at TEXT,
  error TEXT,
  priority INTEGER NOT NULL DEFAULT 100,
  PRIMARY KEY (project_id, path)
);

CREATE TABLE IF NOT EXISTS approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  request_type TEXT NOT NULL,
  request_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  decided_at TEXT,
  decision_note TEXT
);

CREATE VIRTUAL TABLE IF NOT EXISTS context_fts USING fts5(
  title,
  content,
  kind UNINDEXED,
  item_id UNINDEXED
);

CREATE VIRTUAL TABLE IF NOT EXISTS file_summary_fts USING fts5(
  path UNINDEXED,
  summary,
  symbols,
  responsibilities
);

CREATE INDEX IF NOT EXISTS idx_runs_project_started ON runs(project_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_project_ts ON events(project_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_events_run ON events(run_id, id);
CREATE INDEX IF NOT EXISTS idx_tool_calls_run ON tool_calls(run_id);
CREATE INDEX IF NOT EXISTS idx_files_project ON files(project_id, path);
CREATE INDEX IF NOT EXISTS idx_context_project_kind ON context_items(project_id, kind, status, priority DESC);

CREATE TABLE IF NOT EXISTS run_change_decisions (
  run_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  decided_at TEXT,
  note TEXT
);

CREATE INDEX IF NOT EXISTS idx_run_change_decisions_project ON run_change_decisions(project_id, status);

CREATE INDEX IF NOT EXISTS idx_jobs_project_priority ON jobs(project_id, status, priority, created_at);
