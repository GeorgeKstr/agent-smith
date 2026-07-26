from __future__ import annotations

import os
import json
import difflib
import shlex
import subprocess
import threading
import time
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any, Iterable

from dotenv import load_dotenv
from langchain.agents import create_agent
from langchain_core.tools import tool
from langchain_openai import ChatOpenAI

from .db import ProjectDB, sha256_bytes, json_loads
from .registry import get_task_profile
from .providers import build_chat_model_for_task
from .sandbox import get_sandbox_backend

load_dotenv()

IGNORED_DIRS = {".git", ".agent-smith", "node_modules", "venv", ".venv", "__pycache__", "dist", "build"}
ALLOWED_COMMANDS = {
    # Runtime / package managers
    "python", "python3", "pytest", "npm", "pnpm", "node", "npx",
    # Unix read-only / informational
    "ls", "cat", "head", "tail", "wc", "grep", "find", "echo", "which",
    "file", "stat", "du", "df", "sort", "uniq", "cut", "tr", "diff", "xargs",
    # Unix safe writes
    "mkdir", "touch", "cp", "mv",
    # Editors (--no-wait modes are safe)
    "code",
    # SCM
    "git",
    # Fetch
    "curl", "wget",
}
BLOCKED_ARGS = {"install", "add", "remove", "uninstall", "delete", "publish", "deploy", "start", "dev", "serve"}


# ── Approval handler protocol ──────────────────────────────────────────────

class ApprovalRequest:
    """Describes a command that needs user approval."""
    __slots__ = ("command", "display", "event", "_approved", "_denied_reason")

    def __init__(self, command: str, display: str):
        self.command = command
        self.display = display
        self.event = threading.Event()
        self._approved = False
        self._denied_reason = ""

    def approve(self) -> None:
        self._approved = True
        self.event.set()

    def deny(self, reason: str = "") -> None:
        self._approved = False
        self._denied_reason = reason
        self.event.set()

    def wait(self, timeout: float | None = None) -> bool:
        self.event.wait(timeout)
        return self._approved

    @property
    def approved(self) -> bool:
        return self._approved

    @property
    def denied_reason(self) -> str:
        return self._denied_reason


class ApprovalHandler(ABC):
    """Abstract handler that tools call when a command needs user approval.

    Concrete implementations bridge the tool-running thread (blocking) with
    the user-facing I/O layer (CLI prompt, WebSocket message, etc.).
    """

    @abstractmethod
    def ready(self) -> bool:
        """Return True if the handler is fully wired and capable of
        delivering approval requests to a user right now."""
        ...

    @abstractmethod
    def request_approval(self, req: ApprovalRequest) -> bool:
        """Block until the user approves or denies the request.

        Returns True if approved, False if denied.
        """
        ...


class AutoApprovalHandler(ApprovalHandler):
    """Always auto-approves every command immediately."""

    def ready(self) -> bool:
        return True

    def request_approval(self, req: ApprovalRequest) -> bool:
        req.approve()
        return True


class SilentDenyHandler(ApprovalHandler):
    """Always denies commands — used when no interactive handler is wired."""

    def ready(self) -> bool:
        return False

    def request_approval(self, req: ApprovalRequest) -> bool:
        req.deny("No approval handler is wired. Set SMITH_AUTO_APPROVE=true or run via server/CLI.")
        return False


def safe_path(root: Path, path: str) -> Path:
    candidate = (root / path).resolve()
    if candidate == root or root in candidate.parents:
        return candidate
    raise ValueError(f"Path escapes workspace: {path}")


def is_ignored_rel(path: Path) -> bool:
    return any(part in IGNORED_DIRS for part in path.parts)




def make_tools(db: ProjectDB, task_type: str, run_id: str | None = None, cancel_event=None, approval_handler: ApprovalHandler | None = None):
    root = db.root_path
    profile = get_task_profile(task_type)
    if approval_handler is None:
        approval_handler = SilentDenyHandler()

    @tool
    def list_files(path: str = ".", recursive: bool = False, max_entries: int = 300) -> str:
        """List files inside the project workspace."""
        try:
            target = safe_path(root, path)
            if not target.exists():
                return f"Path does not exist: {path}"
            if target.is_file():
                return str(target.relative_to(root))
            it = target.rglob("*") if recursive else target.iterdir()
            out = []
            for item in sorted(it):
                rel = item.relative_to(root)
                if is_ignored_rel(rel):
                    continue
                out.append(str(rel) + ("/" if item.is_dir() else ""))
                if len(out) >= max_entries:
                    out.append(f"... truncated after {max_entries} entries")
                    break
            db.record_event(run_id, "tool_list_files", {"path": path, "count": len(out)}, actor="agent")
            return "\n".join(out) if out else "(empty)"
        except Exception as exc:
            return f"list_files error: {exc}"

    @tool
    def read_file(path: str, offset: int | None = None, limit: int | None = None, max_chars: int = 8000) -> str:
        """Read a text file inside the project workspace.

        Args:
            path: Relative or absolute path inside the workspace.
            offset: Optional line number to start reading from (1-indexed).
            limit: Optional max lines to read.
            max_chars: Maximum characters to return.
        """
        try:
            target = safe_path(root, path)
            if not target.exists():
                return f"File does not exist: {path}"
            if not target.is_file():
                return f"Not a file: {path}"
            data = target.read_bytes()
            if b"\x00" in data[:4096]:
                return f"Refusing likely binary file: {path}"
            text = data.decode("utf-8", errors="replace")

            # Apply offset/limit (line-based truncation before char limit)
            if offset is not None or limit is not None:
                lines = text.splitlines()
                start = max(0, (offset or 1) - 1)
                end = min(len(lines), start + (limit or len(lines)))
                text = "\n".join(lines[start:end])
                if not text:
                    total_lines = len(lines)
                    return f"(empty section at offset={offset}, limit={limit}; file has {total_lines} lines)"

            db.record_event(run_id, "tool_read_file", {"path": path, "chars": min(len(text), max_chars)}, actor="agent")
            if len(text) > max_chars:
                return text[:max_chars] + f"\n\n... truncated at {max_chars} chars"
            return text
        except Exception as exc:
            return f"read_file error: {exc}"

    write_count = {"total": 0}
    write_counts_by_path: dict[str, int] = {}
    max_writes_per_run = max(1, min(100, int(os.getenv("SMITH_MAX_WRITES_PER_RUN", "30"))))
    max_writes_per_file = max(1, min(30, int(os.getenv("SMITH_MAX_WRITES_PER_FILE", "8"))))
    read_counts_by_path: dict[str, int] = {}
    list_count = {"total": 0}
    max_reads_per_run = max(1, min(200, int(os.getenv("SMITH_MAX_READS_PER_RUN", "35"))))
    max_reads_per_file = max(1, min(20, int(os.getenv("SMITH_MAX_READS_PER_FILE", "4"))))
    max_lists_per_run = max(1, min(50, int(os.getenv("SMITH_MAX_LISTS_PER_RUN", "6"))))

    # Create sandbox backend for isolated command execution
    sandbox = get_sandbox_backend(db)

    @tool
    def write_file(path: str, content: str) -> str:
        """Write a text file inside the project workspace.

        Returns a verified result containing existence, size, hash, and line stats.
        """
        if not profile.can_write:
            return "WRITE_BLOCKED: This task profile cannot write files."
        try:
            if cancel_event is not None and cancel_event.is_set():
                return "WRITE_INTERRUPTED: user interruption requested; do not call more tools."

            target = safe_path(root, path)
            rel = target.relative_to(root)
            rel_str = str(rel)
            if is_ignored_rel(rel):
                return f"WRITE_BLOCKED: Refusing ignored path: {path}"

            write_count["total"] += 1
            write_counts_by_path[rel_str] = write_counts_by_path.get(rel_str, 0) + 1
            if write_count["total"] > max_writes_per_run:
                return (
                    f"WRITE_BLOCKED: per-run write limit reached ({max_writes_per_run}). "
                    "Stop calling tools and return a concise summary of the changes already made."
                )
            if write_counts_by_path[rel_str] > max_writes_per_file:
                return (
                    f"WRITE_BLOCKED: per-file write limit reached for {rel_str} ({max_writes_per_file}). "
                    "Stop rewriting this file and return a concise summary."
                )

            before_exists = target.exists() and target.is_file()
            before_bytes = target.read_bytes() if before_exists else b""
            before = sha256_bytes(before_bytes) if before_exists else None

            backup_rel = None
            if run_id and before_exists:
                backup_rel = f"backups/{run_id}/{rel_str}.before"
                backup_path = (db.smith_dir / backup_rel).resolve()
                backup_path.parent.mkdir(parents=True, exist_ok=True)
                backup_path.write_bytes(before_bytes)

            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(content, encoding="utf-8")
            after_bytes = target.read_bytes()

            # Verify the exact text landed on disk. This makes local models less likely
            # to loop because the tool result explicitly confirms creation.
            try:
                verified_text = after_bytes.decode("utf-8")
            except Exception:
                verified_text = after_bytes.decode("utf-8", errors="replace")
            verified = verified_text == content
            after = sha256_bytes(after_bytes)
            exists_after = target.exists() and target.is_file()
            size_bytes = target.stat().st_size if exists_after else 0

            before_text = before_bytes.decode("utf-8", errors="replace") if before_exists else ""
            diff_lines = list(difflib.unified_diff(
                before_text.splitlines(),
                content.splitlines(),
                fromfile=f"{rel_str}.before",
                tofile=rel_str,
                lineterm="",
            ))
            lines_added = sum(1 for line in diff_lines if line.startswith("+") and not line.startswith("+++"))
            lines_removed = sum(1 for line in diff_lines if line.startswith("-") and not line.startswith("---"))

            meta = {
                "before_exists": before_exists,
                "backup_path": backup_rel,
                "after_sha256": after,
                "lines_added": lines_added,
                "lines_removed": lines_removed,
                "diff_preview": "\n".join(diff_lines[:220]),
                "verified": verified,
                "exists_after": exists_after,
                "size_bytes": size_bytes,
            }

            db.record_event(
                run_id,
                "tool_write_file",
                {
                    "path": rel_str,
                    "chars": len(content),
                    "verified": verified,
                    "exists_after": exists_after,
                    "size_bytes": size_bytes,
                    "lines_added": lines_added,
                    "lines_removed": lines_removed,
                },
                actor="agent",
            )
            with db.connect() as con:
                con.execute(
                    """
                    INSERT INTO file_changes(run_id, project_id, path, change_type, before_sha256, after_sha256, diff_text)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (run_id or "", db.project_id, rel_str, "write", before, after, json.dumps(meta, ensure_ascii=False)),
                )
            db.set_file_index_status(rel_str, "dirty", last_hash=after, priority=10)
            db.enqueue_job("index_file", priority=4, payload={"path": rel_str})

            if not verified or not exists_after:
                return (
                    f"WRITE_FAILED_VERIFICATION: attempted {rel_str}; exists_after={exists_after}; "
                    f"verified={verified}; size_bytes={size_bytes}. Stop and report this failure."
                )

            return (
                f"VERIFIED_WRITE_OK path={rel_str} chars={len(content)} bytes={size_bytes} "
                f"sha256={after} lines_added={lines_added} lines_removed={lines_removed}. "
                "The file now exists on disk. If this satisfied the request, stop calling tools and return the final answer."
            )
        except Exception as exc:
            return f"WRITE_ERROR: {type(exc).__name__}: {exc}. Stop and report this error instead of retrying blindly."

    @tool
    def edit_file(path: str, old_text: str = "", new_text: str = "") -> str:
        """Apply a surgical edit to a file by finding exact old text and replacing it with new text.

        Use this for targeted changes instead of writing the whole file. Provide old_text to
        surgically replace text, OR omit old_text to write the entire file (same as write_file).

        Always read the file first with read_file to find the exact text to replace.
        Include surrounding context in old_text to ensure uniqueness.

        Args:
            path: Path to the file to edit (relative to project root).
            old_text: Exact text to find and replace. Must match exactly and uniquely.
                If omitted or empty, the entire file is overwritten (like write_file).
            new_text: Replacement text. Can be empty to delete text.
        """
        # Common placeholder patterns models use instead of actual file content
        _PLACEHOLDER_PATTERNS = [
            "... existing code ...", "// ...", "/* ...", "# ...",
            "<!-- ...", "... rest of file ...", "... other methods",
            "... remain unchanged", "{{ ... }}", "{% ... %}",
            "// rest of the code", "/* rest of the code */",
        ]

        if not profile.can_write:
            return "EDIT_BLOCKED: This task profile cannot edit files."

        # If old_text is missing/empty, the model probably meant write_file.
        # Only auto-fallback if new_text looks like a full file (>= 200 chars
        # and contains multiple lines), otherwise give a clear hint.
        if not old_text:
            # Check for placeholder patterns in new_text even for full writes
            combined = new_text.lower()
            found_ph = [p for p in _PLACEHOLDER_PATTERNS if p in combined]
            if found_ph:
                return (
                    f"EDIT_NEEDS_REAL_CONTENT: new_text contains placeholder markers like {found_ph[0]!r}.\n"
                    f"  Placeholders are not actual file content. Use write_file(path, content) with the\n"
                    f"  COMPLETE content of the file including all existing code you want to preserve.\n"
                    f"  Read the file with read_file first, then pass its entire content to write_file."
                )
            if len(new_text) >= 200 and new_text.count("\n") >= 3:
                return write_file(path=path, content=new_text)
            return (
                f"EDIT_NEEDS_OLDTEXT: You called edit_file without the required 'old_text' parameter.\n"
                f"  - To overwrite the entire file, use write_file(path=\"{path}\", content=...).\n"
                f"  - To make a surgical edit, provide the exact 'old_text' to find and replace.\n"
                f"  Read the file first with read_file to find the exact text to match."
            )
        try:
            if cancel_event is not None and cancel_event.is_set():
                return "EDIT_INTERRUPTED: user interruption requested; do not call more tools."

            target = safe_path(root, path)
            rel = target.relative_to(root)
            rel_str = str(rel)
            if is_ignored_rel(rel):
                return f"EDIT_BLOCKED: Refusing ignored path: {path}"

            # Respect same write limits as write_file
            write_count["total"] += 1
            write_counts_by_path[rel_str] = write_counts_by_path.get(rel_str, 0) + 1
            if write_count["total"] > max_writes_per_run:
                return (
                    f"EDIT_BLOCKED: per-run edit limit reached ({max_writes_per_run}). "
                    "Stop calling tools and return a concise summary of the changes already made."
                )
            if write_counts_by_path[rel_str] > max_writes_per_file:
                return (
                    f"EDIT_BLOCKED: per-file edit limit reached for {rel_str} ({max_writes_per_file}). "
                    "Stop rewriting this file and return a concise summary."
                )

            if not target.exists():
                return f"EDIT_ERROR: File does not exist: {path}. Use write_file to create new files."
            if not target.is_file():
                return f"EDIT_ERROR: Not a file: {path}"

            before_bytes = target.read_bytes()
            if b"\x00" in before_bytes[:4096]:
                return f"EDIT_ERROR: Refusing binary file: {path}"

            before_text = before_bytes.decode("utf-8", errors="replace")

            combined = old_text + "\n" + new_text
            found_placeholders = [p for p in _PLACEHOLDER_PATTERNS if p in combined.lower()]
            if found_placeholders:
                return (
                    f"EDIT_FAILED: placeholder text detected in edit_file arguments.\n"
                    f"You used placeholder markers like {found_placeholders[0]!r} instead of actual file content.\n"
                    f"Placeholders do not match real file contents. Use write_file(path, content) to write\n"
                    f"the COMPLETE new file content, or provide exact text from the file as old_text.\n"
                    f"Read the file contents again and pass them literally — do NOT abbreviate with placeholders."
                )

            # ── Fuzzy matching (like Pi agent) ──
            # Normalize text for matching: line endings, NFKC, smart quotes, dashes, trailing whitespace
            def _norm(t):
                """Normalize text for fuzzy matching (like Pi's normalizeForFuzzyMatch)."""
                # Normalize line endings
                t = t.replace("\r\n", "\n").replace("\r", "\n")
                # Strip trailing whitespace per line
                t = "\n".join(l.rstrip() for l in t.split("\n"))
                # Normalize smart quotes, dashes, spaces
                t = t.replace("\u2018", "'").replace("\u2019", "'")
                t = t.replace("\u201c", "\"").replace("\u201d", "\"")
                t = t.replace("\u2013", "-").replace("\u2014", "-").replace("\u2212", "-")
                t = t.replace("\u00a0", " ").replace("\u200b", "")
                return t
            norm_content = _norm(before_text)
            norm_old = _norm(old_text)

            # 1. Try exact match
            match_idx = before_text.find(old_text)
            used_fuzzy = False

            # 2. If that fails, try fuzzy match in normalized space
            if match_idx == -1:
                fidx = norm_content.find(norm_old)
                if fidx != -1:
                    # Map normalized position back to original text position
                    # Walk both strings simultaneously
                    orig_pos = 0
                    norm_pos = 0
                    while norm_pos < fidx and orig_pos < len(before_text):
                        # Advance orig_pos by 1 normalized char
                        nc = _norm(before_text[orig_pos])
                        if nc == norm_content[norm_pos:norm_pos+len(nc)]:
                            norm_pos += len(nc)
                        orig_pos += 1
                    match_idx = orig_pos
                    used_fuzzy = True

            if match_idx == -1:
                # old_text not found — show hints
                lines = before_text.splitlines()
                hint_lines = []
                search = old_text.strip()[:30].lower()
                for i, line in enumerate(lines, 1):
                    if search and search in line.lower():
                        hint_lines.append(f"  Line {i}: {line[:200]}")
                        if len(hint_lines) >= 5:
                            break
                hint = "\n".join(hint_lines)
                extra = f"\nDid you mean one of these lines?\n{hint}" if hint else ""
                return (
                    f"EDIT_FAILED: old_text not found in {rel_str}. "
                    f"The provided text does not appear anywhere in the file.{extra}\n\n"
                    "Read the file again to find the exact text, then retry with the correct old_text.\n"
                    "If you want to rewrite the entire file, use write_file(path, content) instead."
                )

            # Check uniqueness
            check_text = norm_content if used_fuzzy else before_text
            check_old = norm_old if used_fuzzy else old_text
            count = check_text.count(check_old)
            if count > 1:
                return (
                    f"EDIT_FAILED: old_text appears {count} times in {rel_str}. "
                    "Include more surrounding context in old_text to make it unique.\n"
                    "Read the file to see the exact lines, then retry with more context."
                )

            # Apply replacement at the matched position
            if used_fuzzy:
                # Find the length of the matched text in the original
                match_len = len(old_text)
                # Normalize the original snippet at match_idx to find the actual boundary
                orig_snippet = before_text[match_idx:]
                norm_snippet = _norm(orig_snippet)
                # The match in normalized space has length len(norm_old)
                # Walk norm_snippet to find how many original chars that corresponds to
                actual_len = 0
                npos = 0
                while npos < len(norm_old) and actual_len < len(orig_snippet):
                    nc = _norm(orig_snippet[actual_len])
                    npos += len(nc)
                    actual_len += 1
                after_text = before_text[:match_idx] + new_text + before_text[match_idx + actual_len:]
            else:
                after_text = before_text.replace(old_text, new_text, 1)

            # Backup
            before = sha256_bytes(before_bytes)
            backup_rel = None
            if run_id:
                backup_rel = f"backups/{run_id}/{rel_str}.before"
                backup_path = (db.smith_dir / backup_rel).resolve()
                backup_path.parent.mkdir(parents=True, exist_ok=True)
                backup_path.write_bytes(before_bytes)

            target.write_text(after_text, encoding="utf-8")
            after_bytes = target.read_bytes()
            after = sha256_bytes(after_bytes)

            # Verify
            verified_text = after_bytes.decode("utf-8", errors="replace")
            verified = verified_text == after_text

            # Compute diff
            diff_lines = list(difflib.unified_diff(
                before_text.splitlines(),
                after_text.splitlines(),
                fromfile=f"{rel_str}.before",
                tofile=rel_str,
                lineterm="",
            ))
            lines_added = sum(1 for line in diff_lines if line.startswith("+") and not line.startswith("+++"))
            lines_removed = sum(1 for line in diff_lines if line.startswith("-") and not line.startswith("---"))

            meta = {
                "before_exists": True,
                "backup_path": backup_rel,
                "after_sha256": after,
                "lines_added": lines_added,
                "lines_removed": lines_removed,
                "diff_preview": "\n".join(diff_lines[:220]),
                "verified": verified,
                "edit_type": "surgical",
            }

            db.record_event(run_id, "tool_edit_file", {
                "path": rel_str,
                "old_text_len": len(old_text),
                "new_text_len": len(new_text),
                "verified": verified,
                "lines_added": lines_added,
                "lines_removed": lines_removed,
            }, actor="agent")

            with db.connect() as con:
                con.execute(
                    """
                    INSERT INTO file_changes(run_id, project_id, path, change_type, before_sha256, after_sha256, diff_text)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (run_id or "", db.project_id, rel_str, "edit", before, after, json.dumps(meta, ensure_ascii=False)),
                )
            db.set_file_index_status(rel_str, "dirty", last_hash=after, priority=10)
            db.enqueue_job("index_file", priority=4, payload={"path": rel_str})

            if not verified:
                return (
                    f"EDIT_FAILED_VERIFICATION: edit applied but verification failed for {rel_str}. "
                )

            return (
                f"VERIFIED_EDIT_OK path={rel_str} lines_added={lines_added} lines_removed={lines_removed} "
                f"sha256={after}. "
                "The edit has been applied. If this satisfied the request, stop calling tools and return the final answer."
            )
        except Exception as exc:
            return f"EDIT_ERROR: {type(exc).__name__}: {exc}. Stop and report this error instead of retrying blindly."

    @tool
    def run_command(command: str, timeout_seconds: int = 60) -> str:
        """Run a short safe command inside the workspace. Does not use a shell.

        IMPORTANT: This tool does NOT use a shell. Do NOT use shell syntax like:
          - && (chaining) — run each command separately
          - | (pipes) — run first command, then second
          - # (comments) — remove them
          - >, >>, < (redirects) — not supported
          - $VAR, $(cmd) (expansions) — not supported
        Pass a SINGLE command with plain arguments. Example: ls -la
        """
        if not profile.can_run_commands:
            return "This task profile cannot run commands."

        # ── Parse command safely ───────────────────────────────────────────
        try:
            parts = shlex.split(command)
        except ValueError as exc:
            return (
                f"COMMAND_PARSE_ERROR: could not parse command: {exc}\n"
                "Remove shell comments (# ...), fix any unmatched quotes, "
                "and remove newlines from inside the command string."
            )
        if not parts:
            return "No command provided."

        # ── Detect shell metacharacters the model shouldn't use ────────────
        shell_tokens = {"&&", "||", "|", ";"}
        found_shell = [t for t in parts if t in shell_tokens]
        if found_shell:
            return (
                f"SHELL_SYNTAX_DETECTED: found shell operator(s): {', '.join(found_shell)}.\n"
                "This tool does NOT use a shell. Run each command as a separate call.\n"
                "Example: instead of 'cmd1 && cmd2', call run_command twice."
            )
        # Also catch leading comment chars
        if parts[0].startswith("#"):
            return (
                f"SHELL_COMMENT_DETECTED: command starts with '#'. Remove the comment and try again.\n"
                "This tool does not use a shell, so '#' is treated as a command name."
            )

        try:

            # Read allowed commands and blocked args from settings with env/fallback
            allowed_setting = db.get_setting("bash.allowed_commands")
            if allowed_setting and isinstance(allowed_setting, list) and len(allowed_setting) > 0:
                allowed_commands = set(allowed_setting)
            else:
                env_val = os.getenv("SMITH_ALLOWED_COMMANDS", ",".join(sorted(ALLOWED_COMMANDS)))
                allowed_commands = set(c.strip() for c in env_val.split(",") if c.strip())

            blocked_setting = db.get_setting("bash.blocked_args")
            if blocked_setting and isinstance(blocked_setting, list) and len(blocked_setting) > 0:
                blocked_args = set(blocked_setting)
            else:
                env_val = os.getenv("SMITH_BLOCKED_ARGS", ",".join(sorted(BLOCKED_ARGS)))
                blocked_args = set(c.strip() for c in env_val.split(",") if c.strip())

            exe = Path(parts[0]).name
            needs_approval = False
            approval_reason = ""

            if exe not in allowed_commands:
                needs_approval = True
                approval_reason = f"'{exe}' is not in allowed commands ({', '.join(sorted(allowed_commands))})"

            blocked = sorted({arg.lower() for arg in parts[1:]} & blocked_args)
            if blocked:
                needs_approval = True
                reason2 = f"blocked argument(s): {', '.join(blocked)}"
                approval_reason = f"{approval_reason}; {reason2}" if approval_reason else reason2

            if needs_approval:
                # Check if auto-approve is enabled
                auto_setting = db.get_setting("approval.auto", False)
                auto_env = os.getenv("SMITH_AUTO_APPROVE", "").strip().lower()
                if auto_env in ("1", "true", "yes"):
                    auto_setting = True

                if auto_setting or isinstance(approval_handler, AutoApprovalHandler):
                    pass  # auto-approved, skip the approval request
                elif not approval_handler.ready():
                    return (
                        f"Command not auto-approved: {exe}. {approval_reason}\n"
                        f"Allowed commands: {', '.join(sorted(allowed_commands))}\n"
                        "No approval handler is available. Run via 'smith run' (CLI) or the Web UI, "
                        "or set SMITH_AUTO_APPROVE=true to auto-approve all commands."
                    )
                else:
                    # Format command for display
                    display = f"$ {' '.join(parts)}\nReason: {approval_reason}\nWorkspace: {root}"
                    req = ApprovalRequest(command, display)
                    if approval_handler.request_approval(req):
                        pass  # approved, continue to execution
                    else:
                        return f"APPROVAL_DENIED: {req.denied_reason or 'User denied the command.'}"
            timeout_seconds = max(1, min(int(timeout_seconds), 120))
            result = sandbox.exec(command, cwd=root, timeout=timeout_seconds)
            db.record_event(
                run_id,
                "tool_run_command",
                {"command": command, "exit_code": result.exit_code},
                actor="agent",
            )
            out = [f"$ {' '.join(parts)}", f"exit_code={result.exit_code}"]
            if result.timed_out:
                out.append(f"\nCommand timed out after {timeout_seconds}s")
            if result.stdout:
                out.append("\nSTDOUT:\n" + result.stdout[-12000:])
            if result.stderr:
                out.append("\nSTDERR:\n" + result.stderr[-12000:])
            return "\n".join(out)
        except Exception as exc:
            return f"run_command error: {exc}"

    @tool
    def search_project_context(query: str, limit: int = 8) -> str:
        """Search Smith's SQLite project memory and file summaries."""
        items = db.search_context(query, limit=limit)
        files = db.search_file_summaries(query, limit=limit)
        lines = []
        for item in items:
            lines.append(f"[{item['kind']}] {item['title']}: {item['content'][:600]}")
        for fs in files:
            lines.append(f"[file] {fs['path']}: {fs['summary'][:700]}")
        return "\n\n".join(lines) if lines else "No indexed context matched."

    @tool
    def get_file_summary(path: str) -> str:
        """Get Smith's latest indexed summary for a file."""
        row = db.get_file_summary(path)
        if not row:
            return f"No summary indexed for {path}"
        return (
            f"File: {row['path']}\n"
            f"Summary: {row['summary']}\n"
            f"Symbols: {row['symbols_json']}\n"
            f"Responsibilities: {row['responsibilities_json']}"
        )

    @tool
    def get_related_files(path: str) -> str:
        """Get indexed relationships for a file."""
        rows = db.get_related_files(path)
        if not rows:
            return f"No related files indexed for {path}"
        return "\n".join(f"{r['source_path']} --{r['relationship_type']}--> {r['target_path']}" for r in rows)

    @tool
    def get_run_changes(limit: int = 20) -> str:
        """Show recent file changes made by Smith."""
        with db.connect() as con:
            rows = con.execute(
                "SELECT * FROM file_changes WHERE project_id=? ORDER BY created_at DESC LIMIT ?",
                (db.project_id, limit),
            ).fetchall()
        if not rows:
            return "No Smith file changes recorded."
        return "\n".join(f"{r['created_at']} {r['path']} {r['change_type']}" for r in rows)

    @tool
    def grep_search(pattern: str, path: str = ".", pattern_type: str = "regex", include: str | None = None, context_lines: int = 2, max_results: int = 30) -> str:
        """Search file contents for a pattern, like the Unix 'grep' command.

        Use this to find where functions are defined, variables are referenced, or any text pattern.
        Returns matching lines with surrounding context lines.

        Args:
            pattern: The search pattern (regex or literal string).
            path: Directory or file to search. Defaults to project root.
            pattern_type: "regex" or "literal".
            include: Optional glob to filter files (e.g. "*.py" includes only Python files).
            context_lines: Number of context lines before and after each match (0-10).
            max_results: Maximum matches to return (1-200).
        """
        import re as _re
        try:
            target = safe_path(root, path)
            if not target.exists():
                return f"Path does not exist: {path}"

            ctx = max(0, min(10, int(context_lines or 0)))
            limit = max(1, min(200, int(max_results or 30)))
            is_regex = pattern_type == "regex"

            # Collect files to search
            if target.is_file():
                files_to_search = [target]
            else:
                files_to_search = []
                for p in target.rglob("*"):
                    if not p.is_file():
                        continue
                    try:
                        rp = p.relative_to(root)
                    except ValueError:
                        continue
                    if is_ignored_rel(rp):
                        continue
                    if include and not p.match(include):
                        continue
                    files_to_search.append(p)
                    if len(files_to_search) > 500:
                        break

            results = []
            match_count = 0

            for file_path in files_to_search:
                if match_count >= limit:
                    break
                try:
                    data = file_path.read_bytes()
                    if b"\x00" in data[:4096]:
                        continue  # skip binary
                    text = data.decode("utf-8", errors="replace")
                    lines = text.splitlines()
                except Exception:
                    continue

                try:
                    rel = str(file_path.relative_to(root))
                except ValueError:
                    rel = str(file_path)

                for i, line in enumerate(lines):
                    if match_count >= limit:
                        break
                    matched = False
                    if is_regex:
                        try:
                            matched = _re.search(pattern, line)
                        except _re.error:
                            return f"GREP_ERROR: Invalid regex: {pattern}"
                    else:
                        matched = pattern in line

                    if not matched:
                        continue

                    match_count += 1
                    start = max(0, i - ctx)
                    end = min(len(lines), i + ctx + 1)
                    for j in range(start, end):
                        separator = ":" if j == i else "-"
                        results.append(f"{rel}{separator}{j + 1}: {lines[j][:500]}")
                    if ctx > 0:
                        results.append("--")

            if not results:
                return f"No matches found for pattern: {pattern}"

            output = "\n".join(results)
            if len(output) > 15000:
                output = output[:15000] + "\n... truncated at 15000 chars"

            db.record_event(run_id, "tool_grep_search", {
                "pattern": pattern, "path": path, "matches": match_count
            }, actor="agent")

            return output
        except Exception as exc:
            return f"grep_search error: {exc}"

    @tool
    def find_files(pattern: str, path: str = ".", max_results: int = 50) -> str:
        """Find files matching a glob pattern, like the Unix 'find' command.

        Use this to locate files by name, extension, or path pattern.

        Args:
            pattern: Glob pattern to match (e.g. "*.py", "**/test_*.py", "src/**/*.ts").
            path: Directory to search from. Defaults to project root.
            max_results: Maximum results to return (1-200).
        """
        try:
            target = safe_path(root, path)
            if not target.exists():
                return f"Path does not exist: {path}"
            if not target.is_dir():
                return f"Not a directory: {path}"

            limit = max(1, min(200, int(max_results or 50)))
            results = []

            for p in target.rglob(pattern):
                try:
                    rp = p.relative_to(root)
                except ValueError:
                    continue
                if is_ignored_rel(rp):
                    continue
                results.append(str(rp) + ("/" if p.is_dir() else ""))
                if len(results) >= limit:
                    results.append(f"... truncated after {limit} results")
                    break

            if not results:
                return f"No files found matching: {pattern}"

            db.record_event(run_id, "tool_find_files", {
                "pattern": pattern, "path": path, "count": len(results)
            }, actor="agent")

            return "\n".join(results)
        except Exception as exc:
            return f"find_files error: {exc}"

    all_tools = {
        "list_files": list_files,
        "read_file": read_file,
        "write_file": write_file,
        "edit_file": edit_file,
        "grep_search": grep_search,
        "find_files": find_files,
        "run_command": run_command,
        "search_project_context": search_project_context,
        "get_file_summary": get_file_summary,
        "get_related_files": get_related_files,
        "get_run_changes": get_run_changes,
    }
    return [all_tools[name] for name in profile.tools if name in all_tools]


def build_agent(db: ProjectDB, task_type: str, context_bundle: str, run_id: str | None = None, model_override: dict[str, str] | None = None, cancel_event=None):
    profile = get_task_profile(task_type)
    llm = build_chat_model_for_task(db, task_type, model_override=model_override)
    system_prompt = (
        f"You are Agent Smith working on project: {db.root_path}\n"
        f"Task: {task_type} — {profile.system_role}\n\n"
        "COMPACT PROJECT CONTEXT:\n"
        f"{context_bundle or '(no indexed context yet — explore carefully)'}\n\n"
        "CRITICAL RULES:\n"
        "1. Read a file before editing it (use read_file with offset/limit for large files). Do not blindly guess paths.\n"
        "2. To change an existing file, first read it with read_file, then:\n"
        "   - For full rewrites: use write_file(path, content).\n"
        "   - For surgical edits: use edit_file(path, old_text, new_text) with the EXACT text to replace.\n"
        "   Do NOT call edit_file without old_text — that will fail. Pick the right tool.\n"
        "3. Use grep_search to find function definitions, variable references, and patterns. Use find_files to locate files by glob.\n"
        "4. After write_file returns VERIFIED_WRITE_OK or edit_file returns VERIFIED_EDIT_OK, STOP. Do not re-read or re-edit.\n"
        "5. If a write/edit fails, report the failure. Do not retry blindly.\n"
        "6. Never loop: if you lack information, ask or give your best answer. Max 8 tool calls per response.\n"
        "7. After your final tool call, output a brief summary of what you changed. Then STOP — do not call more tools.\n"
        "8. You have limited context budget. Keep tool outputs relevant.\n"
        "9. If the task seems done, just report what was accomplished. Do not invent extra work.\n"
    )
    return create_agent(model=llm, tools=make_tools(db, task_type, run_id, cancel_event=cancel_event, approval_handler=None), system_prompt=system_prompt)


def build_agent_with_handler(db: ProjectDB, task_type: str, context_bundle: str, run_id: str | None = None, model_override: dict[str, str] | None = None, cancel_event=None, approval_handler: ApprovalHandler | None = None):
    """Same as build_agent but threads an ApprovalHandler to the run_command tool."""
    profile = get_task_profile(task_type)
    llm = build_chat_model_for_task(db, task_type, model_override=model_override)
    actual_handler = approval_handler or SilentDenyHandler()
    system_prompt = (
        f"You are Agent Smith working on project: {db.root_path}\n"
        f"Task: {task_type} — {profile.system_role}\n\n"
        "COMPACT PROJECT CONTEXT:\n"
        f"{context_bundle or '(no indexed context yet — explore carefully)'}\n\n"
        "CRITICAL RULES:\n"
        "1. Read a file before editing it (use read_file with offset/limit for large files). Do not blindly guess paths.\n"
        "2. To change an existing file, first read it with read_file, then:\n"
        "   - For full rewrites: use write_file(path, content).\n"
        "   - For surgical edits: use edit_file(path, old_text, new_text) with the EXACT text to replace.\n"
        "   Do NOT call edit_file without old_text — that will fail. Pick the right tool.\n"
        "3. Use grep_search to find function definitions, variable references, and patterns. Use find_files to locate files by glob.\n"
        "4. After write_file returns VERIFIED_WRITE_OK or edit_file returns VERIFIED_EDIT_OK, STOP. Do not re-read or re-edit.\n"
        "5. If a write/edit fails, report the failure. Do not retry blindly.\n"
        "6. Never loop: if you lack information, ask or give your best answer. Max 8 tool calls per response.\n"
        "7. After your final tool call, output a brief summary of what you changed. Then STOP — do not call more tools.\n"
        "8. You have limited context budget. Keep tool outputs relevant.\n"
        "9. If the task seems done, just report what was accomplished. Do not invent extra work.\n"
    )
    return create_agent(model=llm, tools=make_tools(db, task_type, run_id, cancel_event=cancel_event, approval_handler=actual_handler), system_prompt=system_prompt)


def smith_recursion_limit() -> int:
    """Graph recursion limit for model/tool loops.

    Supports both env names:
    - SMITH_RECURSION_LIMIT
    - LANGGRAPH_RECURSION_LIMIT

    Default is 40. Small models with limited context should stay well under this.
    Set SMITH_RECURSION_LIMIT=60 for larger models.
    """
    raw = os.getenv("SMITH_RECURSION_LIMIT") or os.getenv("LANGGRAPH_RECURSION_LIMIT") or "100"
    try:
        return max(12, min(400, int(raw)))
    except Exception:
        return 100


def extract_stream_text(chunk: Any) -> str:
    """Extract only assistant-visible text from LangChain message stream chunks.

    LangChain's `stream_mode="messages"` can emit:
    - AIMessageChunk / AIMessage: assistant text and tool-call deltas
    - ToolMessage: tool results, such as file contents
    - HumanMessage/SystemMessage and other internal messages

    The CLI/UI should not print ToolMessage content directly, otherwise file reads,
    directory listings, and command output get dumped as if they were final prose.
    """
    if isinstance(chunk, dict):
        if chunk.get("type") != "messages":
            return ""
        token, metadata = chunk["data"]
    else:
        try:
            token, metadata = chunk
        except Exception:
            token = chunk
            metadata = {}

    cls_name = token.__class__.__name__
    msg_type = getattr(token, "type", None)

    # Only stream assistant messages. Explicitly ignore tool outputs.
    if cls_name not in {"AIMessageChunk", "AIMessage"} and msg_type not in {"ai", "AIMessageChunk"}:
        return ""

    # Ignore pure tool-call chunks.
    if getattr(token, "tool_call_chunks", None) or getattr(token, "tool_calls", None):
        content = getattr(token, "content", "")
        if not content:
            return ""

    content = getattr(token, "content", "")
    if isinstance(content, str):
        return content

    # Some providers emit block-style content. Only include text blocks from AI messages.
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, dict) and block.get("type") in {"text", "output_text"}:
                parts.append(block.get("text", ""))
        return "".join(parts)

    return ""


def _compact_tool_args(args: object) -> str:
    """Return a short, safe tool-argument summary without dumping file contents."""
    try:
        if isinstance(args, str):
            return args[:220]
        if not isinstance(args, dict):
            return str(args)[:220]

        parts: list[str] = []
        path = args.get("path")
        if path:
            parts.append(f"path={path}")

        command = args.get("command")
        if command:
            parts.append(f"command={str(command)[:160]}")

        query = args.get("query")
        if query:
            parts.append(f"query={str(query)[:160]}")

        if "content" in args:
            content = args.get("content") or ""
            parts.append(f"content_chars={len(str(content))}")
            parts.append(f"content_lines={len(str(content).splitlines())}")

        if not parts:
            # Keep only primitive short values.
            for key, value in list(args.items())[:6]:
                if key.lower() in {"content", "text", "body"}:
                    parts.append(f"{key}_chars={len(str(value or ''))}")
                else:
                    parts.append(f"{key}={str(value)[:80]}")
        return " ".join(parts)[:320]
    except Exception:
        return ""


def describe_stream_progress(chunk, seen: set[str]) -> str:
    """Produce detailed progress text for the UI.

    Shows:
    - tool name + arguments (path, command, query)
    - content line/char counts for writes
    - write results (verified/error sizes)
    - read results (file size summary)
    - command results (exit code + truncated output)
    - running tool call count
    - live "model is generating..." during tool_call_chunks
    """
    # Track running tool call count across all describe_stream_progress calls
    _tool_call_counter = getattr(describe_stream_progress, "_call_count", 0)
    token = None
    if isinstance(chunk, tuple) and chunk:
        token = chunk[0]
    else:
        token = chunk

    if token is None:
        return ""

    cls_name = token.__class__.__name__
    msg_type = getattr(token, "type", None)

    # ── Mid-inference tool_call_chunks (partial JSON before full tool_calls) ──
    tool_call_chunks = getattr(token, "tool_call_chunks", None) or []
    if tool_call_chunks and not getattr(token, "tool_calls", None):
        # Each chunk carries partial tool metadata. We can read the tool name
        # immediately from the first chunk, even before arguments finish streaming.
        lines = []
        for chunk in tool_call_chunks:
            chunk_id = chunk.get("id", "") or ""
            chunk_name = chunk.get("name", "") or ""
            if not chunk_name:
                continue
            # Only announce each tool once (using its id as key)
            seen_key = f"__generating_{chunk_id}"
            if seen_key in seen:
                continue
            seen.add(seen_key)
            # Show partial args if available
            partial_args = chunk.get("args", "") or ""
            if partial_args and len(partial_args) > 4:
                # Try to extract a path or key from partial JSON
                import re as _re
                path_m = _re.search(r'"path"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"', partial_args)
                if path_m:
                    lines.append(f"[smith] 🛠 generating {chunk_name} — path={path_m.group(1)[:80]}...\n")
                else:
                    lines.append(f"[smith] 🛠 generating {chunk_name}...\n")
            else:
                lines.append(f"[smith] 🛠 generating {chunk_name}...\n")
        if lines:
            return "".join(lines)
        return ""
    # Reset any generation tracking when a full tool_call or text arrives.
    for key in list(seen):
        if key.startswith("__generating_"):
            seen.discard(key)

    # AI/tool-call metadata.
    tool_calls = getattr(token, "tool_calls", None) or []
    if tool_calls:
        lines = []
        for call in tool_calls:
            if isinstance(call, dict):
                name = call.get("name") or call.get("function", {}).get("name") or "tool"
                call_id = call.get("id") or f"{name}:{len(seen)}"
                args = call.get("args")
                if args is None and isinstance(call.get("function"), dict):
                    args = call["function"].get("arguments")
            else:
                name = getattr(call, "name", "tool")
                call_id = getattr(call, "id", f"{name}:{len(seen)}")
                args = getattr(call, "args", None)

            key = f"tool_call:{call_id}"
            if key in seen:
                continue
            seen.add(key)
            _tool_call_counter = getattr(describe_stream_progress, "_call_count", 0) + 1
            setattr(describe_stream_progress, "_call_count", _tool_call_counter)
            summary = _compact_tool_args(args)
            if summary:
                lines.append(f"[smith] 🔧 #{_tool_call_counter} {name} — {summary}\n")
            else:
                lines.append(f"[smith] 🔧 #{_tool_call_counter} {name}\n")
        return "".join(lines)

    # Tool result returned to the graph. Show a useful summary without dumping raw content.
    if cls_name == "ToolMessage" or msg_type == "tool":
        name = getattr(token, "name", None) or getattr(token, "tool_call_id", None) or "tool"
        key = f"tool_result:{name}:{len(seen)}"
        if key not in seen:
            seen.add(key)
            content = getattr(token, "content", "")
            if isinstance(content, list):
                content = "\n".join(str(x) for x in content)
            content = str(content or "").strip()

            lines_count = len(content.splitlines()) if content else 0
            char_count = len(content)

            visible_prefixes = (
                "VERIFIED_WRITE_OK",
                "WRITE_ERROR",
                "WRITE_FAILED_VERIFICATION",
                "WRITE_BLOCKED",
                "WRITE_INTERRUPTED",
                "READ_BLOCKED",
                "LIST_BLOCKED",
            )
            if content.startswith(visible_prefixes):
                first = content.splitlines()[0][:1200]
                return f"[smith] tool result: {name} — {first}\n"

            # Safe generic summaries for common tools.
            if name == "list_files" or "list_files" in str(name):
                entries = [ln for ln in content.splitlines() if ln.strip()]
                return f"[smith] tool result: {name} — {len(entries)} item(s) in directory\n"
            if name == "read_file" or "read_file" in str(name):
                return f"[smith] tool result: {name} — {lines_count} lines, {char_count} chars\n"
            if name == "write_file" or "write_file" in str(name):
                # Extract path from the result if present
                path_hint = ""
                for line in content.splitlines()[:3]:
                    if "path=" in line or "wrote" in line.lower() or "written" in line.lower():
                        path_hint = f" — {line[:200]}"
                        break
                return f"[smith] tool result: {name} — wrote {lines_count} lines, {char_count} chars{path_hint}\n"
            if name == "run_command" or "run_command" in str(name):
                first_line = content.splitlines()[0][:180] if content else "command completed"
                return f"[smith] tool result: {name} — {first_line} ({lines_count} lines)\n"

            return f"[smith] tool result: {name} ({lines_count} lines)\n"

    return ""


def _reset_progress_counters():
    """Reset the tool call counter between runs."""
    setattr(describe_stream_progress, "_call_count", 0)

    return ""


def build_fallback_final_response(db: ProjectDB, run_id: str, task_type: str) -> str:
    """Build a user-visible completion summary when the model performs tools but emits no final text."""
    with db.connect() as con:
        changes = con.execute(
            """
            SELECT path, change_type
            FROM file_changes
            WHERE run_id=? AND project_id=?
            ORDER BY created_at ASC
            """,
            (run_id, db.project_id),
        ).fetchall()
        commands = con.execute(
            """
            SELECT payload_json
            FROM events
            WHERE run_id=? AND project_id=? AND type='tool_run_command'
            ORDER BY id ASC
            """,
            (run_id, db.project_id),
        ).fetchall()
        writes = con.execute(
            """
            SELECT payload_json
            FROM events
            WHERE run_id=? AND project_id=? AND type='tool_write_file'
            ORDER BY id ASC
            """,
            (run_id, db.project_id),
        ).fetchall()

    lines = ["Task completed."]

    if changes:
        lines.append("")
        lines.append("Files changed:")
        for row in changes:
            lines.append(f"- {row['path']} ({row['change_type']})")
    elif writes:
        lines.append("")
        lines.append("A file write tool was used.")

    if commands:
        lines.append("")
        lines.append("Commands run:")
        for row in commands:
            payload = json_loads(row["payload_json"], {})
            command = payload.get("command")
            exit_code = payload.get("exit_code")
            if command:
                lines.append(f"- `{command}` exit_code={exit_code}")

    if not changes and not writes and not commands:
        lines.append("The model did not return a final message, and no tool changes were recorded.")

    lines.append("")
    lines.append("Note: the local model did not emit a final assistant response after the tool call, so Smith generated this completion summary from recorded tool activity.")
    return "\n".join(lines)


def stream_agent(db: ProjectDB, prompt: str, task_type: str = "ask", review_mode: str = "auto", model_override: dict[str, str] | None = None, cancel_event: threading.Event | None = None, approval_handler: ApprovalHandler | None = None):
    db.init()
    _reset_progress_counters()
    # Collect everything into a transcript for history replay
    full_transcript_parts: list[str] = []
    _tool_call_count = 0
    MAX_TOOL_CALLS = 50  # hard cap to prevent runaway tool loops

    def _yield_and_save(text: str):
        full_transcript_parts.append(text)
        return text

    yield _yield_and_save(f"[smith] starting run: {task_type}\n")
    run_id = db.start_run(prompt, task_type=task_type, review_mode=review_mode)
    profile = get_task_profile(task_type)

    yield _yield_and_save("[smith] building context...\n")
    context, snapshot_id = db.build_context_bundle(prompt, budget_chars=profile.context_budget_chars, run_id=run_id)
    db.record_event(run_id, "context_built", {"snapshot_id": snapshot_id, "chars": len(context)})
    yield _yield_and_save(f"[smith] context ready: {len(context)} chars\n")

    limit = smith_recursion_limit()
    yield _yield_and_save(f"[smith] starting model/tool loop...\n")
    yield _yield_and_save(f"[smith] recursion limit: {limit}\n")
    agent = build_agent_with_handler(db, task_type=task_type, context_bundle=context, run_id=run_id, model_override=model_override, cancel_event=cancel_event, approval_handler=approval_handler)
    full = []
    started = False
    seen_progress: set[str] = set()
    try:
        # Build the input once
        _input = {"messages": [{"role": "user", "content": f"{prompt}\n\nIMPORTANT: Output only the final answer. Do not show your internal reasoning or chain-of-thought."}]}
        _config = {"recursion_limit": limit}
        # Yield a "generating" message before blocking on the LLM call
        yield _yield_and_save("[smith] waiting for model response...\n")
        # Wrap agent.stream() in a manual iterator so we can catch GeneratorExit
        # from server-side cancellation and clean up immediately.
        _stream_iter = iter(agent.stream(_input, _config, stream_mode="messages", version="v2"))
        yield _yield_and_save("[smith] model is generating...\n")
        while True:
            if cancel_event is not None and cancel_event.is_set():
                final = "".join(full).strip() or "Interrupted by user before a final response was produced."
                full_transcript = "".join(full_transcript_parts)
                db.finish_run(run_id, "interrupted", final_response=final, final_summary=final[:1000], full_transcript=full_transcript)
                yield _yield_and_save("\n[smith] interrupted by user; stopped reading model/tool loop.\n")
                return
            try:
                chunk = next(_stream_iter)
            except StopIteration:
                break
            if cancel_event is not None and cancel_event.is_set():
                final = "".join(full).strip() or "Interrupted by user before a final response was produced."
                full_transcript = "".join(full_transcript_parts)
                db.finish_run(run_id, "interrupted", final_response=final, final_summary=final[:1000], full_transcript=full_transcript)
                yield _yield_and_save("\n[smith] interrupted by user; stopped reading model/tool loop.\n")
                return

            progress = describe_stream_progress(chunk, seen_progress)
            if progress:
                yield _yield_and_save(progress)

            # Track tool calls and stop early if over limit
            if "[smith] 🔧" in progress:
                _tool_call_count += progress.count("[smith] 🔧")
                if _tool_call_count > MAX_TOOL_CALLS:
                    yield _yield_and_save(f"\n[smith] tool call limit ({MAX_TOOL_CALLS}) reached; forcing stop.\n")
                    break

            text = extract_stream_text(chunk)
            if not text:
                continue
            if not started:
                text = text.lstrip()
                if not text:
                    continue
                started = True
                yield _yield_and_save("\n[smith] assistant response:\n")
            full.append(text)
            yield _yield_and_save(text)

        final = "".join(full).strip()
        if not final:
            final = build_fallback_final_response(db, run_id, task_type)
            yield _yield_and_save("\n[smith] fallback completion summary:\n")
            yield _yield_and_save(final)
        full_transcript = "".join(full_transcript_parts)
        db.finish_run(run_id, "done", final_response=final, final_summary=final[:1000], full_transcript=full_transcript)
        db.add_task_summary(run_id, summary=final[:1000], outcome="done")
        yield _yield_and_save("\n[smith] run finished\n")
    except Exception as exc:
        err = str(exc)
        if "Recursion limit" in err or "GRAPH_RECURSION_LIMIT" in err:
            # Always produce a graceful fallback, even if no file changes were recorded
            partial = "".join(full).strip()
            changes = db.get_run_changes(run_id)
            if changes or not partial:
                final = build_fallback_final_response(db, run_id, task_type)
                if changes:
                    final += (
                        "\n\nWarning: the model continued calling tools until Smith's recursion limit was reached. "
                        "Smith stopped the loop and summarized the recorded changes."
                    )
                else:
                    final += (
                        "\n\nThe model called tools repeatedly without making file changes or producing a final answer. "
                        "This usually means the model is stuck in a loop (e.g., reading the same files over and over). "
                        "Try rephrasing the prompt or breaking the task into smaller steps."
                    )
                yield _yield_and_save("\n[smith] recursion limit reached; stopping tool loop.\n")
                yield _yield_and_save("\n[smith] fallback completion summary:\n")
                yield _yield_and_save(final)
                full_transcript = "".join(full_transcript_parts)
                db.finish_run(run_id, "done", final_response=final, final_summary=final[:1000], full_transcript=full_transcript)
                db.add_task_summary(run_id, summary=final[:1000], outcome="done_with_recursion_warning")
                return

        full_transcript = "".join(full_transcript_parts)
        db.finish_run(run_id, "error", final_response="".join(full), error=err, full_transcript=full_transcript)
        yield _yield_and_save(f"\n[smith] run error: {exc}\n")
        raise
    except GeneratorExit:
        # Generator was force-closed (e.g., server-side cancel timeout).
        # Save partial work if any.
        if run_id:
            partial = "".join(full).strip()
            try:
                db.finish_run(run_id, "interrupted", final_response=partial or "Interrupted", final_summary=("Interrupted" if not partial else partial[:1000]), full_transcript="".join(full_transcript_parts))
            except Exception:
                pass
        raise

