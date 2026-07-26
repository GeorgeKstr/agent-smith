from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterable


def now_id(prefix: str = "") -> str:
    value = uuid.uuid4().hex
    return f"{prefix}{value}" if prefix else value


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8", errors="replace")).hexdigest()


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def json_dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True)


def json_loads(value: str, default: Any = None) -> Any:
    try:
        return json.loads(value)
    except Exception:
        return default


class ProjectDB:
    def __init__(self, root_path: str | Path):
        self.root_path = Path(root_path).expanduser().resolve()
        self.smith_dir = self.root_path / ".agent-smith"
        self.db_path = self.smith_dir / "smith.db"
        self.project_id = hashlib.sha256(str(self.root_path).encode()).hexdigest()[:16]
        self.project_name = self.root_path.name

    def init(self) -> None:
        self.smith_dir.mkdir(parents=True, exist_ok=True)
        schema_path = Path(__file__).with_name("schema.sql")
        schema = schema_path.read_text(encoding="utf-8")
        with self.connect() as con:
            con.executescript(schema)
            # Migration: add full_transcript column to runs
            try:
                con.execute("ALTER TABLE runs ADD COLUMN full_transcript TEXT")
            except Exception:
                pass  # column already exists
            # Migration: compaction_entries table (created by compaction module)
            try:
                con.executescript("""
                    CREATE TABLE IF NOT EXISTS compaction_entries (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        run_id TEXT NOT NULL,
                        project_id TEXT NOT NULL,
                        summary TEXT NOT NULL,
                        token_count INTEGER NOT NULL DEFAULT 0,
                        message_count INTEGER NOT NULL DEFAULT 0,
                        files_changed_json TEXT NOT NULL DEFAULT '[]',
                        commands_run_json TEXT NOT NULL DEFAULT '[]',
                        created_at TEXT NOT NULL DEFAULT (datetime('now'))
                    );
                    CREATE INDEX IF NOT EXISTS idx_compaction_project
                        ON compaction_entries(project_id, created_at DESC);
                """)
            except Exception:
                pass
            con.execute(
                """
                INSERT INTO projects(id, root_path, name, updated_at)
                VALUES (?, ?, ?, datetime('now'))
                ON CONFLICT(id) DO UPDATE SET
                  root_path=excluded.root_path,
                  name=excluded.name,
                  updated_at=datetime('now')
                """,
                (self.project_id, str(self.root_path), self.project_name),
            )
            con.execute(
                """
                INSERT INTO index_state(project_id, status, message)
                VALUES (?, 'idle', 'Ready')
                ON CONFLICT(project_id) DO NOTHING
                """,
                (self.project_id,),
            )

    @contextmanager
    def connect(self):
        self.smith_dir.mkdir(parents=True, exist_ok=True)
        con = sqlite3.connect(self.db_path, timeout=30)
        con.row_factory = sqlite3.Row
        con.execute("PRAGMA journal_mode=WAL")
        con.execute("PRAGMA foreign_keys=ON")
        con.execute("PRAGMA busy_timeout=5000")
        try:
            yield con
            con.commit()
        except Exception:
            con.rollback()
            raise
        finally:
            con.close()

    def start_run(self, prompt: str, task_type: str, review_mode: str = "auto") -> str:
        run_id = now_id("run_")
        with self.connect() as con:
            con.execute(
                """
                INSERT INTO runs(id, project_id, task_type, review_mode, user_prompt, status)
                VALUES (?, ?, ?, ?, ?, 'running')
                """,
                (run_id, self.project_id, task_type, review_mode, prompt),
            )
            self._record_event_con(con, run_id, "user_prompt", {"prompt": prompt}, actor="user")
        return run_id

    def finish_run(
        self,
        run_id: str,
        status: str,
        final_response: str = "",
        final_summary: str = "",
        model_name: str | None = None,
        usage: dict[str, Any] | None = None,
        error: str | None = None,
        full_transcript: str | None = None,
    ) -> None:
        usage = usage or {}
        with self.connect() as con:
            con.execute(
                """
                UPDATE runs
                SET ended_at=datetime('now'),
                    status=?,
                    final_response=?,
                    final_summary=?,
                    full_transcript=?,
                    model_name=coalesce(?, model_name),
                    input_tokens=?,
                    output_tokens=?,
                    reasoning_tokens=?,
                    error=?
                WHERE id=?
                """,
                (
                    status,
                    final_response,
                    final_summary,
                    full_transcript,
                    model_name,
                    usage.get("input_tokens"),
                    usage.get("output_tokens"),
                    usage.get("reasoning_tokens"),
                    error,
                    run_id,
                ),
            )
            self._record_event_con(
                con,
                run_id,
                "run_finished",
                {"status": status, "summary": final_summary, "error": error},
            )

    def record_event(self, run_id: str | None, event_type: str, payload: dict[str, Any], actor: str = "system") -> None:
        with self.connect() as con:
            self._record_event_con(con, run_id, event_type, payload, actor=actor)

    def _record_event_con(
        self,
        con: sqlite3.Connection,
        run_id: str | None,
        event_type: str,
        payload: dict[str, Any],
        actor: str = "system",
    ) -> None:
        con.execute(
            """
            INSERT INTO events(run_id, project_id, type, actor, payload_json)
            VALUES (?, ?, ?, ?, ?)
            """,
            (run_id, self.project_id, event_type, actor, json_dumps(payload)),
        )

    def enqueue_job(self, kind: str, priority: int, payload: dict[str, Any] | None = None) -> str:
        job_id = now_id("job_")
        with self.connect() as con:
            con.execute(
                """
                INSERT INTO jobs(id, project_id, kind, priority, payload_json)
                VALUES (?, ?, ?, ?, ?)
                """,
                (job_id, self.project_id, kind, priority, json_dumps(payload or {})),
            )
        self.refresh_index_counters(message=f"Queued {kind}")
        return job_id

    def next_job(self, include_background: bool = True) -> dict[str, Any] | None:
        with self.connect() as con:
            if not include_background:
                max_priority = 3
            else:
                max_priority = 99
            row = con.execute(
                """
                SELECT * FROM jobs
                WHERE project_id=? AND status='queued' AND priority <= ?
                ORDER BY priority ASC, created_at ASC
                LIMIT 1
                """,
                (self.project_id, max_priority),
            ).fetchone()
            if not row:
                return None
            return dict(row)

    def start_job(self, job_id: str) -> None:
        with self.connect() as con:
            con.execute(
                "UPDATE jobs SET status='running', started_at=datetime('now') WHERE id=?",
                (job_id,),
            )
            con.execute(
                "UPDATE index_state SET status='running', current_job_id=?, message='Running job' WHERE project_id=?",
                (job_id, self.project_id),
            )

    def finish_job(self, job_id: str, status: str = "done", error: str | None = None) -> None:
        with self.connect() as con:
            con.execute(
                "UPDATE jobs SET status=?, ended_at=datetime('now'), error=? WHERE id=?",
                (status, error, job_id),
            )
        self.refresh_index_counters(message=error or "Ready")

    def set_index_paused(self, paused: bool) -> None:
        with self.connect() as con:
            con.execute(
                "UPDATE index_state SET paused=?, message=? WHERE project_id=?",
                (1 if paused else 0, "Paused" if paused else "Ready", self.project_id),
            )

    def get_index_status(self) -> dict[str, Any]:
        with self.connect() as con:
            row = con.execute("SELECT * FROM index_state WHERE project_id=?", (self.project_id,)).fetchone()
            return dict(row) if row else {}

    def is_index_paused(self) -> bool:
        return bool(self.get_index_status().get("paused"))

    def refresh_index_counters(self, message: str | None = None) -> None:
        """Recompute index_state counters from file_index_status and queued jobs."""
        with self.connect() as con:
            total = con.execute(
                "SELECT COUNT(*) AS c FROM file_index_status WHERE project_id=? AND status NOT IN ('ignored', 'deleted')",
                (self.project_id,),
            ).fetchone()["c"]
            done = con.execute(
                "SELECT COUNT(*) AS c FROM file_index_status WHERE project_id=? AND status IN ('clean', 'indexed')",
                (self.project_id,),
            ).fetchone()["c"]
            dirty = con.execute(
                "SELECT COUNT(*) AS c FROM file_index_status WHERE project_id=? AND status IN ('unknown', 'dirty', 'queued', 'indexing', 'error')",
                (self.project_id,),
            ).fetchone()["c"]
            active = con.execute(
                "SELECT COUNT(*) AS c FROM jobs WHERE project_id=? AND status IN ('queued', 'running')",
                (self.project_id,),
            ).fetchone()["c"]
            running = con.execute(
                "SELECT id FROM jobs WHERE project_id=? AND status='running' ORDER BY started_at DESC LIMIT 1",
                (self.project_id,),
            ).fetchone()
            status = "running" if active else "idle"
            current_job_id = running["id"] if running else None
            con.execute(
                """
                UPDATE index_state
                SET status=?,
                    current_job_id=?,
                    files_total=?,
                    files_done=?,
                    files_dirty=?,
                    message=coalesce(?, message)
                WHERE project_id=?
                """,
                (status, current_job_id, int(total), int(done), int(dirty), message, self.project_id),
            )


    def get_setting(self, key: str, default: Any = None) -> Any:
        with self.connect() as con:
            row = con.execute("SELECT value_json FROM settings WHERE key=?", (key,)).fetchone()
            if not row:
                return default
            return json_loads(row["value_json"], default)

    def set_setting(self, key: str, value: Any) -> None:
        with self.connect() as con:
            con.execute(
                """
                INSERT INTO settings(key, value_json, updated_at)
                VALUES (?, ?, datetime('now'))
                ON CONFLICT(key) DO UPDATE SET
                  value_json=excluded.value_json,
                  updated_at=datetime('now')
                """,
                (key, json_dumps(value)),
            )


    def upsert_file(self, path: str, language: str, kind: str, size: int, mtime: float, sha: str, importance: int = 0) -> None:
        with self.connect() as con:
            con.execute(
                """
                INSERT INTO files(path, project_id, language, kind, size_bytes, mtime, sha256, importance, is_deleted, last_seen_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, datetime('now'))
                ON CONFLICT(path) DO UPDATE SET
                  language=excluded.language,
                  kind=excluded.kind,
                  size_bytes=excluded.size_bytes,
                  mtime=excluded.mtime,
                  sha256=excluded.sha256,
                  importance=excluded.importance,
                  is_deleted=0,
                  last_seen_at=datetime('now')
                """,
                (path, self.project_id, language, kind, size, mtime, sha, importance),
            )

    def set_file_index_status(
        self,
        path: str,
        status: str,
        last_hash: str | None = None,
        indexed_hash: str | None = None,
        error: str | None = None,
        priority: int = 100,
    ) -> None:
        with self.connect() as con:
            con.execute(
                """
                INSERT INTO file_index_status(project_id, path, status, last_hash, last_indexed_hash, last_seen_at, last_indexed_at, error, priority)
                VALUES (?, ?, ?, ?, ?, datetime('now'), CASE WHEN ? IS NOT NULL THEN datetime('now') ELSE NULL END, ?, ?)
                ON CONFLICT(project_id, path) DO UPDATE SET
                  status=excluded.status,
                  last_hash=coalesce(excluded.last_hash, file_index_status.last_hash),
                  last_indexed_hash=coalesce(excluded.last_indexed_hash, file_index_status.last_indexed_hash),
                  last_seen_at=datetime('now'),
                  last_indexed_at=CASE WHEN excluded.last_indexed_hash IS NOT NULL THEN datetime('now') ELSE file_index_status.last_indexed_at END,
                  error=excluded.error,
                  priority=excluded.priority
                """,
                (self.project_id, path, status, last_hash, indexed_hash, indexed_hash, error, priority),
            )
        self.refresh_index_counters()

    def get_index_files(self, q: str = "", status_filter: str = "", limit: int = 120) -> list[dict[str, Any]]:
        """List indexed files with optional search query and status filter."""
        with self.connect() as con:
            where = ["fis.project_id=?"]
            params: list[Any] = [self.project_id]
            if q:
                where.append("fis.path LIKE ?")
                params.append(f"%{q}%")
            if status_filter:
                where.append("fis.status=?")
                params.append(status_filter)
            rows = con.execute(
                f"""
                SELECT fis.path, fis.status, fis.error, fs.summary
                FROM file_index_status fis
                LEFT JOIN file_summaries fs ON fs.path=fis.path
                WHERE {' AND '.join(where)}
                ORDER BY fis.path ASC
                LIMIT ?
                """,
                params + [limit],
            ).fetchall()
        return [dict(r) for r in rows]

    def get_file_summary(self, path: str) -> dict[str, Any] | None:
        with self.connect() as con:
            row = con.execute("SELECT * FROM file_summaries WHERE path=?", (path,)).fetchone()
            return dict(row) if row else None

    def upsert_file_summary(
        self,
        path: str,
        summary: str,
        source_sha256: str,
        symbols: list[str] | None = None,
        imports: list[str] | None = None,
        exports: list[str] | None = None,
        responsibilities: list[str] | None = None,
        relationships: list[dict[str, Any]] | None = None,
        source_run_id: str | None = None,
    ) -> None:
        symbols = symbols or []
        imports = imports or []
        exports = exports or []
        responsibilities = responsibilities or []
        relationships = relationships or []
        with self.connect() as con:
            con.execute(
                """
                INSERT INTO file_summaries(path, project_id, summary, symbols_json, imports_json, exports_json,
                                           responsibilities_json, relationships_json, updated_at, source_sha256)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
                ON CONFLICT(path) DO UPDATE SET
                  summary=excluded.summary,
                  symbols_json=excluded.symbols_json,
                  imports_json=excluded.imports_json,
                  exports_json=excluded.exports_json,
                  responsibilities_json=excluded.responsibilities_json,
                  relationships_json=excluded.relationships_json,
                  updated_at=datetime('now'),
                  source_sha256=excluded.source_sha256
                """,
                (
                    path,
                    self.project_id,
                    summary,
                    json_dumps(symbols),
                    json_dumps(imports),
                    json_dumps(exports),
                    json_dumps(responsibilities),
                    json_dumps(relationships),
                    source_sha256,
                ),
            )
            con.execute(
                """
                INSERT INTO file_summary_versions(project_id, path, source_sha256, summary, symbols_json,
                                                  imports_json, exports_json, responsibilities_json,
                                                  relationships_json, source_run_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    self.project_id,
                    path,
                    source_sha256,
                    summary,
                    json_dumps(symbols),
                    json_dumps(imports),
                    json_dumps(exports),
                    json_dumps(responsibilities),
                    json_dumps(relationships),
                    source_run_id,
                ),
            )
            con.execute("DELETE FROM file_summary_fts WHERE path=?", (path,))
            con.execute(
                "INSERT INTO file_summary_fts(path, summary, symbols, responsibilities) VALUES (?, ?, ?, ?)",
                (path, summary, " ".join(symbols), " ".join(responsibilities)),
            )
            for rel in relationships:
                target = rel.get("target")
                rtype = rel.get("type", "related")
                if target:
                    con.execute(
                        """
                        INSERT INTO file_relationships(project_id, source_path, target_path, relationship_type, confidence)
                        VALUES (?, ?, ?, ?, ?)
                        ON CONFLICT(project_id, source_path, target_path, relationship_type) DO UPDATE SET
                          confidence=excluded.confidence,
                          updated_at=datetime('now')
                        """,
                        (self.project_id, path, target, rtype, float(rel.get("confidence", 0.7))),
                    )

    def search_file_summaries(self, query: str, limit: int = 8) -> list[dict[str, Any]]:
        query = " ".join([part for part in query.replace('"', " ").split() if len(part) > 2]) or query
        with self.connect() as con:
            try:
                rows = con.execute(
                    """
                    SELECT fs.*, rank
                    FROM file_summary_fts fts
                    JOIN file_summaries fs ON fs.path = fts.path
                    WHERE file_summary_fts MATCH ?
                    ORDER BY rank
                    LIMIT ?
                    """,
                    (query, limit),
                ).fetchall()
            except sqlite3.OperationalError:
                rows = con.execute(
                    "SELECT * FROM file_summaries WHERE summary LIKE ? OR path LIKE ? LIMIT ?",
                    (f"%{query}%", f"%{query}%", limit),
                ).fetchall()
            return [dict(r) for r in rows]

    def get_related_files(self, path: str, limit: int = 10) -> list[dict[str, Any]]:
        with self.connect() as con:
            rows = con.execute(
                """
                SELECT * FROM file_relationships
                WHERE project_id=? AND (source_path=? OR target_path=?)
                ORDER BY confidence DESC
                LIMIT ?
                """,
                (self.project_id, path, path, limit),
            ).fetchall()
            return [dict(r) for r in rows]

    def upsert_context_item(
        self,
        kind: str,
        title: str,
        content: str,
        status: str = "active",
        priority: int = 0,
        source_run_id: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> int:
        with self.connect() as con:
            existing = con.execute(
                "SELECT id FROM context_items WHERE project_id=? AND kind=? AND title=?",
                (self.project_id, kind, title),
            ).fetchone()
            if existing:
                item_id = int(existing["id"])
                con.execute(
                    """
                    UPDATE context_items
                    SET content=?, status=?, priority=?, source_run_id=coalesce(?, source_run_id),
                        updated_at=datetime('now'), metadata_json=?
                    WHERE id=?
                    """,
                    (content, status, priority, source_run_id, json_dumps(metadata or {}), item_id),
                )
            else:
                cur = con.execute(
                    """
                    INSERT INTO context_items(project_id, kind, title, content, status, priority, source_run_id, metadata_json)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (self.project_id, kind, title, content, status, priority, source_run_id, json_dumps(metadata or {})),
                )
                item_id = int(cur.lastrowid)
            con.execute("DELETE FROM context_fts WHERE item_id=?", (str(item_id),))
            con.execute(
                "INSERT INTO context_fts(title, content, kind, item_id) VALUES (?, ?, ?, ?)",
                (title, content, kind, str(item_id)),
            )
            return item_id

    def list_context_items(self, kinds: Iterable[str] | None = None, limit: int = 20) -> list[dict[str, Any]]:
        with self.connect() as con:
            if kinds:
                placeholders = ",".join("?" for _ in kinds)
                rows = con.execute(
                    f"""
                    SELECT * FROM context_items
                    WHERE project_id=? AND status='active' AND kind IN ({placeholders})
                    ORDER BY priority DESC, updated_at DESC
                    LIMIT ?
                    """,
                    (self.project_id, *list(kinds), limit),
                ).fetchall()
            else:
                rows = con.execute(
                    """
                    SELECT * FROM context_items
                    WHERE project_id=? AND status='active'
                    ORDER BY priority DESC, updated_at DESC
                    LIMIT ?
                    """,
                    (self.project_id, limit),
                ).fetchall()
            return [dict(r) for r in rows]

    def search_context(self, query: str, limit: int = 8) -> list[dict[str, Any]]:
        query = " ".join([part for part in query.replace('"', " ").split() if len(part) > 2]) or query
        with self.connect() as con:
            try:
                rows = con.execute(
                    """
                    SELECT ci.*
                    FROM context_fts fts
                    JOIN context_items ci ON ci.id = CAST(fts.item_id AS INTEGER)
                    WHERE context_fts MATCH ?
                    LIMIT ?
                    """,
                    (query, limit),
                ).fetchall()
            except sqlite3.OperationalError:
                rows = con.execute(
                    "SELECT * FROM context_items WHERE title LIKE ? OR content LIKE ? LIMIT ?",
                    (f"%{query}%", f"%{query}%", limit),
                ).fetchall()
            return [dict(r) for r in rows]

    def add_task_summary(
        self,
        run_id: str,
        summary: str,
        outcome: str = "completed",
        files_touched: list[str] | None = None,
        commands_run: list[str] | None = None,
        followups: list[str] | None = None,
    ) -> None:
        with self.connect() as con:
            con.execute(
                """
                INSERT INTO task_summaries(run_id, project_id, summary, files_touched_json, commands_run_json, outcome, followups_json)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(run_id) DO UPDATE SET
                  summary=excluded.summary,
                  files_touched_json=excluded.files_touched_json,
                  commands_run_json=excluded.commands_run_json,
                  outcome=excluded.outcome,
                  followups_json=excluded.followups_json
                """,
                (
                    run_id,
                    self.project_id,
                    summary,
                    json_dumps(files_touched or []),
                    json_dumps(commands_run or []),
                    outcome,
                    json_dumps(followups or []),
                ),
            )

    def recent_runs(self, limit: int = 10) -> list[dict[str, Any]]:
        with self.connect() as con:
            rows = con.execute(
                "SELECT * FROM runs WHERE project_id=? ORDER BY started_at DESC LIMIT ?",
                (self.project_id, limit),
            ).fetchall()
            return [dict(r) for r in rows]

    def recent_file_changes(self, limit: int = 20) -> list[dict[str, Any]]:
        with self.connect() as con:
            rows = con.execute(
                """
                SELECT fc.*, r.user_prompt, r.started_at, coalesce(d.status, 'pending') AS decision_status
                FROM file_changes fc
                JOIN runs r ON r.id=fc.run_id
                LEFT JOIN run_change_decisions d ON d.run_id=fc.run_id
                WHERE fc.project_id=?
                ORDER BY fc.created_at DESC
                LIMIT ?
                """,
                (self.project_id, limit),
            ).fetchall()
            return [dict(r) for r in rows]

    def get_run_changes(self, run_id: str) -> list[dict[str, Any]]:
        with self.connect() as con:
            rows = con.execute(
                "SELECT * FROM file_changes WHERE project_id=? AND run_id=? ORDER BY created_at ASC",
                (self.project_id, run_id),
            ).fetchall()
            return [dict(r) for r in rows]

    def mark_run_changes(self, run_id: str, status: str, note: str | None = None) -> None:
        with self.connect() as con:
            con.execute(
                """
                INSERT INTO run_change_decisions(run_id, project_id, status, decided_at, note)
                VALUES (?, ?, ?, datetime('now'), ?)
                ON CONFLICT(run_id) DO UPDATE SET
                  status=excluded.status,
                  decided_at=datetime('now'),
                  note=excluded.note
                """,
                (run_id, self.project_id, status, note),
            )
            self._record_event_con(con, run_id, f"changes_{status}", {"note": note})

    def revert_run_changes(self, run_id: str) -> dict[str, Any]:
        changes = self.get_run_changes(run_id)
        restored: list[str] = []
        deleted: list[str] = []
        errors: list[str] = []

        for change in reversed(changes):
            path = change["path"]
            target = (self.root_path / path).resolve()
            try:
                meta = json_loads(change.get("diff_text") or "{}", {})
                before_exists = bool(meta.get("before_exists"))
                backup_rel = meta.get("backup_path")

                if before_exists:
                    if not backup_rel:
                        raise RuntimeError("missing backup path")
                    backup_path = (self.smith_dir / backup_rel).resolve()
                    data = backup_path.read_bytes()
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(data)
                    restored.append(path)
                    self.set_file_index_status(path, "dirty")
                else:
                    if target.exists() and target.is_file():
                        target.unlink()
                        deleted.append(path)
                    self.set_file_index_status(path, "deleted")
            except Exception as exc:
                errors.append(f"{path}: {exc}")

        if errors:
            self.mark_run_changes(run_id, "revert_error", "; ".join(errors))
        else:
            self.mark_run_changes(run_id, "reverted", "Reverted from UI/API")
        return {"run_id": run_id, "restored": restored, "deleted": deleted, "errors": errors}

    def build_context_bundle(self, prompt: str, budget_chars: int = 24000, run_id: str | None = None) -> tuple[str, int]:
        sections: list[str] = []
        inputs: list[tuple[str, str, float, str]] = []

        for item in self.list_context_items(
            ["project_summary", "current_state", "decision", "known_issue", "todo", "architecture_note"],
            limit=20,
        ):
            sections.append(f"## {item['kind']}: {item['title']}\n{item['content']}")
            inputs.append(("context_item", str(item["id"]), float(item.get("priority") or 0), item["kind"]))

        # Keep chat/task threads isolated by default. Previously every new run
        # injected the last 5 Smith runs, which made "new thread" feel like it
        # still had previous conversation context. Project/file memory remains
        # available through context_items and file summaries.
        if os.getenv("SMITH_INCLUDE_RECENT_RUNS", "0").lower() in {"1", "true", "yes"}:
            recent = self.recent_runs(limit=5)
            if recent:
                text = "\n".join(f"- {r['started_at']} [{r['task_type']}]: {r.get('final_summary') or r.get('user_prompt')}" for r in recent)
                sections.append(f"## Recent Smith Runs\n{text}")

        for row in self.search_context(prompt, limit=6):
            sections.append(f"## Relevant memory: {row['title']}\n{row['content']}")
            inputs.append(("context_search", str(row["id"]), 5.0, "fts match"))

        for row in self.search_file_summaries(prompt, limit=10):
            symbols = ", ".join(json_loads(row.get("symbols_json") or "[]", []))
            sections.append(f"## File: {row['path']}\nSummary: {row['summary']}\nSymbols: {symbols}")
            inputs.append(("file_summary", row["path"], 10.0, "file summary search"))

        content = "\n\n".join(sections).strip()

        # Fallback: if no indexed context, include project file listing
        if not content:
            try:
                files = []
                ignored = {".git", ".agent-smith", "node_modules", "venv", ".venv", "__pycache__", "dist", "build"}
                for p in self.root_path.rglob("*"):
                    try:
                        rp = p.relative_to(self.root_path)
                    except ValueError:
                        continue
                    if any(part in ignored for part in rp.parts):
                        continue
                    if p.is_file():
                        files.append(f"  {rp} ({p.stat().st_size} bytes)")
                    elif p.is_dir():
                        files.append(f"  {rp}/")
                    if len(files) > 200:
                        files.append(f"  ... ({sum(1 for _ in self.root_path.rglob('*')) - 200} more entries)")
                        break
                if files:
                    content = "## Project Files\n" + "\n".join(files)
            except Exception:
                content = "(project listing unavailable — explore with list_files)"

        if len(content) > budget_chars:
            content = content[:budget_chars] + "\n\n... context truncated to budget"

        context_hash = sha256_text(content)
        with self.connect() as con:
            cur = con.execute(
                """
                INSERT INTO project_context_snapshots(project_id, run_id, token_budget, content, context_hash)
                VALUES (?, ?, ?, ?, ?)
                """,
                (self.project_id, run_id, budget_chars, content, context_hash),
            )
            snapshot_id = int(cur.lastrowid)
            for source_type, source_id, score, reason in inputs:
                con.execute(
                    """
                    INSERT INTO context_build_inputs(snapshot_id, source_type, source_id, rank_score, reason)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (snapshot_id, source_type, source_id, score, reason),
                )
        return content, snapshot_id
