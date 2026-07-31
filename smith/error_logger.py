"""
Tool error logger for Agent Smith.

Captures structured tool error information including:
- The tool call that failed
- The model's context (prompt, preceding assistant messages)
- The error response returned to the model
- Timestamps and run metadata

Errors are logged to:
1. A JSONL file: .agent-smith/errors/tool_errors.jsonl
2. The existing tool_calls SQL table with error column populated

Usage:
    from .error_logger import ToolErrorLogger

    logger = ToolErrorLogger(db)
    logger.record_tool_error(
        run_id="...",
        tool_name="write",
        tool_args={"path": "foo.py", "content": "..."},
        error_result="WRITE_ERROR: ...",
        model_messages=[...],
    )
"""

from __future__ import annotations

import json
import os
import threading
import time
from pathlib import Path
from typing import Any

import re

from .db import ProjectDB, json_dumps


class ToolErrorLogger:
    """Logs tool call errors with full context for debugging."""

    def __init__(self, db: ProjectDB):
        self.db = db
        self._lock = threading.Lock()
        self._errors_dir = db.smith_dir / "errors"
        self._errors_dir.mkdir(parents=True, exist_ok=True)
        self._jsonl_path = self._errors_dir / "tool_errors.jsonl"
        self._max_entries = int(os.getenv("SMITH_ERROR_LOG_MAX", "5000"))

    def record_tool_error(
        self,
        run_id: str,
        tool_name: str,
        tool_args: dict[str, Any] | None,
        error_result: str,
        model_messages: list[dict[str, Any]] | None = None,
        extra_meta: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Record a tool error with full context.

        Args:
            run_id: The run that was active when the error occurred.
            tool_name: Name of the tool (write, edit, bash, read, etc.).
            tool_args: Arguments passed to the tool.
            error_result: The error string returned to the model.
            model_messages: Recent model messages for context (prompt, assistant replies).
            extra_meta: Any additional metadata to include.

        Returns the error entry dict.
        """
        entry = {
            "timestamp": time.time(),
            "iso_time": time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime()),
            "run_id": run_id,
            "project_id": self.db.project_id,
            "project_name": self.db.project_name,
            "tool_name": tool_name,
            "tool_args_summary": self._summarize_args(tool_args),
            "tool_args": tool_args,
            "error_result": error_result[:2000],
            "error_type": self._classify_error(error_result),
            "model_messages": (model_messages or [])[-10:],  # last 10 messages
            "extra": extra_meta or {},
        }

        # Write to JSONL file
        with self._lock:
            self._write_jsonl(entry)
            self._prune_jsonl()
            self._record_to_db(entry)

        return entry

    def _write_jsonl(self, entry: dict[str, Any]) -> None:
        """Append a JSON line to the error log file."""
        try:
            with open(self._jsonl_path, "a", encoding="utf-8") as f:
                f.write(json.dumps(entry, ensure_ascii=False, default=str) + "\n")
        except Exception:
            pass  # Don't let logging failures break the agent

    def _prune_jsonl(self) -> None:
        """Keep only the most recent N entries in the JSONL file."""
        try:
            lines = []
            with open(self._jsonl_path, "r", encoding="utf-8") as f:
                lines = f.readlines()
            if len(lines) > self._max_entries:
                with open(self._jsonl_path, "w", encoding="utf-8") as f:
                    f.writelines(lines[-self._max_entries:])
        except Exception:
            pass

    def _record_to_db(self, entry: dict[str, Any]) -> None:
        """Also record to the tool_calls table if it exists."""
        try:
            with self.db.connect() as con:
                con.execute(
                    """
                    INSERT INTO tool_calls(id, run_id, tool_name, started_at, ended_at,
                                           status, args_json, result_text, error)
                    VALUES (?, ?, ?, datetime('now'), datetime('now'), 'error', ?, ?, ?)
                    """,
                    (
                        f"tc_{int(entry['timestamp'] * 1000)}",
                        entry["run_id"],
                        entry["tool_name"],
                        json_dumps(entry.get("tool_args") or {}),
                        entry["error_result"][:2000],
                        entry["error_type"],
                    ),
                )
        except Exception:
            pass  # Table might not exist yet

    def _classify_error(self, error_str: str) -> str:
        """Classify the error into a category for analysis."""
        s = error_str.lower()
        if "not found" in s or "does not exist" in s:
            return "NOT_FOUND"
        if "placeholder" in s or "needs_edits" in s or "needs_oldtext" in s:
            return "INVALID_ARGS"
        if "blocked" in s or "denied" in s or "approval" in s:
            return "BLOCKED"
        if "parse_error" in s or "shell_syntax" in s or "shell_comment" in s:
            return "PARSE_ERROR"
        if "verification" in s or "verified" in s:
            return "VERIFICATION_FAILED"
        if "interrupted" in s:
            return "INTERRUPTED"
        if "limit" in s or "max" in s:
            return "LIMIT_REACHED"
        if "binary" in s or "refusing" in s:
            return "INVALID_TARGET"
        if "timeout" in s or "timed out" in s:
            return "TIMEOUT"
        return "UNKNOWN"

    def _summarize_args(self, args: dict[str, Any] | None) -> str:
        """Create a short safe summary of tool arguments."""
        if not args:
            return ""
        try:
            parts = []
            if "path" in args:
                parts.append(f"path={args['path']}")
            if "command" in args:
                parts.append(f"command={str(args['command'])[:120]}")
            if "content" in args:
                content = str(args.get("content") or "")
                parts.append(f"content={len(content)}chars")
            if "edits" in args:
                edits = args["edits"]
                if isinstance(edits, list):
                    parts.append(f"edits={len(edits)}items")
            if "pattern" in args:
                parts.append(f"pattern={str(args['pattern'])[:80]}")
            if "query" in args:
                parts.append(f"query={str(args['query'])[:80]}")
            if not parts:
                parts.append(str(args)[:200])
            return " ".join(parts)
        except Exception:
            return str(args)[:200]

    def get_recent_errors(self, limit: int = 50) -> list[dict[str, Any]]:
        """Read recent errors from the JSONL file."""
        try:
            lines = []
            with open(self._jsonl_path, "r", encoding="utf-8") as f:
                lines = f.readlines()
            entries = []
            for line in reversed(lines[-limit:]):
                try:
                    entries.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
            return entries
        except FileNotFoundError:
            return []
        except Exception:
            return []

    def error_summary(self) -> dict[str, Any]:
        """Return a summary of recent errors grouped by type."""
        errors = self.get_recent_errors(50)
        by_type: dict[str, int] = {}
        by_tool: dict[str, int] = {}
        for e in errors:
            etype = e.get("error_type", "UNKNOWN")
            tool = e.get("tool_name", "unknown")
            by_type[etype] = by_type.get(etype, 0) + 1
            by_tool[tool] = by_tool.get(tool, 0) + 1
        return {
            "total_errors": len(errors),
            "by_type": by_type,
            "by_tool": by_tool,
            "latest_error": errors[0] if errors else None,
        }

    def record_model_anomaly(
        self,
        run_id: str,
        assistant_text: str,
        anomaly_type: str,
        details: dict[str, Any] | None = None,
    ) -> dict[str, Any] | None:
        """Log a model-side anomaly (not a tool error, but suspicious model behavior).

        Examples:
        - Raw tool-call syntax in text output instead of structured calls
        - Placeholder ellipses in model responses
        - Repeated content suggesting model looping
        """
        entry = {
            "timestamp": time.time(),
            "iso_time": time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime()),
            "run_id": run_id,
            "project_id": self.db.project_id,
            "project_name": self.db.project_name,
            "anomaly_type": anomaly_type,
            "assistant_text_snippet": assistant_text[:1000],
            "details": details or {},
        }
        with self._lock:
            self._write_jsonl(entry)
        return entry

    def clear_logs(self) -> None:
        """Clear the error log file."""
        with self._lock:
            try:
                if self._jsonl_path.exists():
                    self._jsonl_path.unlink()
            except Exception:
                pass


# ── Model output anomaly detection ───────────────────────────────────

# Patterns that indicate the model emitted tool calls as text instead of
# using the proper function-calling API.
_RAW_TOOL_CALL_PATTERNS = [
    re.compile(r"<tool_call[^>]*>", re.IGNORECASE),
    re.compile(r"<function_calls?[^>]*>", re.IGNORECASE),
    re.compile(r"</tool_call>", re.IGNORECASE),
    re.compile(r"</function_calls?>", re.IGNORECASE),
    re.compile(r"<parameter[^>]*>", re.IGNORECASE),
    re.compile(r"<invoke[^>]*>", re.IGNORECASE),
]

# Patterns that indicate the model is using placeholder ellipses in its output
# instead of real content.
_PLACEHOLDER_IN_OUTPUT = [
    re.compile(r"\.\.\.\s*(existing|rest|other|remain)", re.IGNORECASE),
    re.compile(r"//\s*\.\.\.", re.IGNORECASE),
    re.compile(r"#\s*\.\.\.", re.IGNORECASE),
]


def detect_model_anomalies(text: str) -> list[dict[str, Any]]:
    """Check model output text for suspicious patterns.

    Returns a list of anomaly descriptions found in the text.
    Each anomaly has a type, snippet, and position.
    """
    anomalies: list[dict[str, Any]] = []

    if not text or len(text.strip()) < 10:
        return anomalies

    # Check for raw tool-call syntax that should have been structured calls
    for pattern in _RAW_TOOL_CALL_PATTERNS:
        for match in pattern.finditer(text):
            start = max(0, match.start() - 40)
            end = min(len(text), match.end() + 40)
            snippet = text[start:end]
            anomalies.append({
                "type": "RAW_TOOL_CALL_SYNTAX",
                "pattern": pattern.pattern,
                "match": match.group(),
                "snippet": snippet,
                "position": match.start(),
            })

    # Check for placeholder ellipses in model output
    for pattern in _PLACEHOLDER_IN_OUTPUT:
        for match in pattern.finditer(text):
            start = max(0, match.start() - 20)
            end = min(len(text), match.end() + 40)
            snippet = text[start:end]
            anomalies.append({
                "type": "PLACEHOLDER_IN_OUTPUT",
                "pattern": pattern.pattern,
                "match": match.group(),
                "snippet": snippet,
                "position": match.start(),
            })

    # Check for excessively long output (model might be looping)
    if len(text) > 8000:
        anomalies.append({
            "type": "EXCESSIVE_OUTPUT_LENGTH",
            "length": len(text),
            "snippet": text[:200] + "...",
        })

    # Check for repeated lines (model might be stuck in a loop)
    lines = text.splitlines()
    if len(lines) > 10:
        line_counts: dict[str, int] = {}
        for line in lines:
            stripped = line.strip()
            if len(stripped) > 15:
                line_counts[stripped] = line_counts.get(stripped, 0) + 1
        for stripped, count in line_counts.items():
            if count >= 4:
                anomalies.append({
                    "type": "REPEATED_LINE",
                    "line": stripped[:200],
                    "count": count,
                })
                break  # One example is enough

    return anomalies
