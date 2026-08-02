"""Context compaction for Agent Smith.

Compaction summarizes older conversation history to free up context
window for the LLM. This module handles:

- Token estimation (chars → token heuristic)
- Run transcript summarization
- Compaction entry storage and retrieval
- Context budget management

Inspired by Pi.dev's compaction approach but adapted for Agent Smith's
per-run stateless execution model.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .db import ProjectDB, json_dumps, json_loads


# ── Token estimation ─────────────────────────────────────────────────

def estimate_tokens(text: str) -> int:
    """Heuristic token count: ~4 characters per token for most languages.

    This is intentionally conservative (overestimates slightly) so we
    don't accidentally blow past context limits.
    """
    if not text:
        return 0
    return len(text) // 3 + 1  # slightly generous


# ── Compaction entry ─────────────────────────────────────────────────

@dataclass
class CompactionEntry:
    """A single compaction record for a run or conversation segment."""

    id: int = 0
    run_id: str = ""
    project_id: str = ""
    summary: str = ""
    token_count: int = 0
    message_count: int = 0
    files_changed: list[str] = field(default_factory=list)
    commands_run: list[str] = field(default_factory=list)
    created_at: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "run_id": self.run_id,
            "project_id": self.project_id,
            "summary": self.summary,
            "token_count": self.token_count,
            "message_count": self.message_count,
            "files_changed": self.files_changed,
            "commands_run": self.commands_run,
            "created_at": self.created_at,
        }


# ── Compaction engine ────────────────────────────────────────────────

class CompactionEngine:
    """Manages compaction of conversation history.

    In Agent Smith, each run is a single prompt → tool-loop → answer cycle.
    Compaction happens *between* runs, summarizing the previous run's
    transcript into a structured entry that future context bundles can
    include instead of raw transcripts.
    """

    def __init__(self, db: ProjectDB):
        self.db = db
        self.project_id = db.project_id

    # ── Schema ───────────────────────────────────────────────────

    def ensure_tables(self) -> None:
        """Create the compaction_entries table if it doesn't exist."""
        with self.db.connect() as con:
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

    # ── Store ────────────────────────────────────────────────────

    def store_compaction(
        self,
        run_id: str,
        summary: str,
        token_count: int = 0,
        message_count: int = 0,
        files_changed: list[str] | None = None,
        commands_run: list[str] | None = None,
    ) -> int:
        """Save a compaction entry and return its ID."""
        with self.db.connect() as con:
            cur = con.execute(
                """
                INSERT INTO compaction_entries
                    (run_id, project_id, summary, token_count, message_count,
                     files_changed_json, commands_run_json)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    run_id,
                    self.project_id,
                    summary,
                    token_count,
                    message_count,
                    json_dumps(files_changed or []),
                    json_dumps(commands_run or []),
                ),
            )
            return cur.lastrowid or 0

    # ── Retrieve ─────────────────────────────────────────────────

    def get_recent_entries(self, limit: int = 5) -> list[CompactionEntry]:
        """Get the most recent compaction entries."""
        with self.db.connect() as con:
            rows = con.execute(
                """
                SELECT * FROM compaction_entries
                WHERE project_id=?
                ORDER BY created_at DESC
                LIMIT ?
                """,
                (self.project_id, limit),
            ).fetchall()
        return [self._row_to_entry(r) for r in rows]

    def get_entry_by_run(self, run_id: str) -> CompactionEntry | None:
        """Get the compaction entry for a specific run."""
        with self.db.connect() as con:
            row = con.execute(
                """
                SELECT * FROM compaction_entries
                WHERE project_id=? AND run_id=?
                """,
                (self.project_id, run_id),
            ).fetchone()
        return self._row_to_entry(row) if row else None

    def get_total_token_savings(self) -> int:
        """Return total tokens saved across all compactions."""
        with self.db.connect() as con:
            row = con.execute(
                """
                SELECT COALESCE(SUM(token_count), 0) AS total
                FROM compaction_entries
                WHERE project_id=?
                """,
                (self.project_id,),
            ).fetchone()
        return row["total"] if row else 0

    def _row_to_entry(self, row: Any) -> CompactionEntry:
        return CompactionEntry(
            id=row["id"],
            run_id=row["run_id"],
            project_id=row["project_id"],
            summary=row["summary"],
            token_count=row["token_count"],
            message_count=row["message_count"],
            files_changed=json_loads(row["files_changed_json"], []),
            commands_run=json_loads(row["commands_run_json"], []),
            created_at=row["created_at"],
        )

    # ── Compact a single run ─────────────────────────────────────

    def compact_run(self, run_id: str, transcript: str | None = None) -> CompactionEntry | None:
        """Generate a compaction summary from a completed run's transcript.

        Looks up the run by ID, extracts key information, generates a
        structured summary, and stores it as a compaction entry.

        Returns the CompactionEntry, or None if the run doesn't exist
        or the transcript is empty.
        """
        # Get run data from DB
        with self.db.connect() as con:
            run = con.execute(
                """
                SELECT user_prompt, final_response, full_transcript,
                       task_type, model_name, input_tokens, output_tokens
                FROM runs WHERE id=? AND project_id=?
                """,
                (run_id, self.project_id),
            ).fetchone()

            if not run:
                return None

            user_prompt = run["user_prompt"] or ""
            final_response = run["final_response"] or ""
            full_transcript = transcript or run["full_transcript"] or ""
            task_type = run["task_type"] or "ask"

            if not full_transcript and not user_prompt:
                return None

            # Collect events for this run
            events = con.execute(
                """
                SELECT type, payload_json FROM events
                WHERE run_id=? AND project_id=?
                ORDER BY id ASC
                """,
                (run_id, self.project_id),
            ).fetchall()

            # Collect file changes for this run
            changes = con.execute(
                """
                SELECT path, change_type FROM file_changes
                WHERE run_id=? AND project_id=?
                ORDER BY created_at ASC
                """,
                (run_id, self.project_id),
            ).fetchall()

        if not full_transcript and not user_prompt:
            return None

        # Extract file changes
        files_changed = sorted(set(
            c["path"] for c in changes if c["path"]
        ))

        # Extract commands run
        commands_run = []
        for ev in events:
            if ev["type"] == "tool_run_command":
                payload = json_loads(ev["payload_json"], {})
                cmd = payload.get("command", "")
                if cmd:
                    commands_run.append(cmd)

        # Count messages in transcript (rough: count user/assistant markers)
        message_count = 0
        for marker in ["[User]:", "[Assistant]:", "user:", "assistant:"]:
            message_count += full_transcript.count(marker)
        message_count = max(message_count, 1)

        # Estimate original token count
        token_count = estimate_tokens(full_transcript + user_prompt + (final_response or ""))

        # Generate summary
        if task_type in ("implement", "fix", "refactor"):
            summary = self._build_implementation_summary(
                user_prompt, final_response, files_changed, commands_run
            )
        else:
            summary = self._build_general_summary(
                user_prompt, final_response, files_changed, commands_run
            )

        # Store
        self.store_compaction(
            run_id=run_id,
            summary=summary,
            token_count=token_count,
            message_count=message_count,
            files_changed=files_changed,
            commands_run=commands_run,
        )

        return self.get_entry_by_run(run_id)

    def _build_implementation_summary(
        self,
        prompt: str,
        response: str,
        files_changed: list[str],
        commands_run: list[str],
    ) -> str:
        """Build a structured summary for an implementation run."""
        parts = [f"## Goal\n{prompt[:800]}"]
        if files_changed:
            parts.append("## Files Changed\n" + "\n".join(f"- {f}" for f in files_changed))
        if commands_run:
            parts.append("## Commands Run\n" + "\n".join(f"- `{c}`" for c in commands_run[:20]))
        if response:
            parts.append(f"## Outcome\n{response[:1000]}")
        return "\n\n".join(parts)

    def _build_general_summary(
        self,
        prompt: str,
        response: str,
        files_changed: list[str],
        commands_run: list[str],
    ) -> str:
        """Build a structured summary for an ask/review run."""
        parts = [f"## Question\n{prompt[:800]}"]
        if files_changed:
            parts.append("## Files Referenced\n" + "\n".join(f"- {f}" for f in files_changed))
        if commands_run:
            parts.append("## Commands Run\n" + "\n".join(f"- `{c}`" for c in commands_run[:10]))
        if response:
            parts.append(f"## Answer\n{response[:1200]}")
        return "\n\n".join(parts)

    # ── Context integration ──────────────────────────────────────

    def build_compacted_context(self, prompt: str, budget_chars: int = 24000) -> str:
        """Build a context string that includes compaction summaries
        instead of raw transcripts when the total exceeds budget.

        This is called by build_context_bundle to include previous run
        summaries efficiently.
        """
        entries = self.get_recent_entries(limit=5)
        if not entries:
            return ""

        parts: list[str] = []
        chars_used = 0
        char_budget = max(1000, budget_chars // 2)  # use half budget for compaction history

        for entry in entries:
            header = f"## Previous Run ({entry.created_at[:10] if entry.created_at else '?'})"
            block = f"{header}\n{entry.summary}\n"
            block_chars = len(block)
            if chars_used + block_chars > char_budget:
                # Include a truncated pointer instead
                remaining = len(entries) - len(parts)
                if remaining > 0:
                    parts.append(
                        f"## Previous Runs ({remaining} more)\n"
                        f"See .agent-smith/smith.db compaction_entries table for details."
                    )
                break
            parts.append(block)
            chars_used += block_chars

        return "\n\n".join(parts)


# ── Convenience ──────────────────────────────────────────────────────

def auto_compact_run(db: ProjectDB, run_id: str, transcript: str | None = None) -> CompactionEntry | None:
    """Convenience: create a CompactionEngine for a project and compact a run."""
    engine = CompactionEngine(db)
    engine.ensure_tables()
    return engine.compact_run(run_id, transcript=transcript)


def get_context_with_compaction(db: ProjectDB, prompt: str, budget_chars: int = 24000) -> str:
    """Convenience: get compaction-enriched context string."""
    engine = CompactionEngine(db)
    engine.ensure_tables()
    return engine.build_compacted_context(prompt, budget_chars=budget_chars)
