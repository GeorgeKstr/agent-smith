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
from pydantic import BaseModel, Field

from .db import ProjectDB, sha256_bytes, json_loads
from .error_logger import ToolErrorLogger, detect_model_anomalies
from .registry import get_task_profile, get_model_profile
from .providers import build_chat_model_for_task
from .sandbox import get_sandbox_backend

load_dotenv()


def _text_tool_prompt(profile, model_id: str = "") -> str:
    """Build text-based tool calling instructions for local models.

    When SMITH_TEXT_TOOL_MODE is enabled, the model receives explicit
    instructions for calling tools using XML-style syntax that our
    tool_parser can reliably extract.
    """
    # Build allowed tools list from profile
    _is_gemma = "gemma" in (model_id or "").lower()
    tool_lines = []
    for tname in profile.tools:
        if tname == "ls":
            tool_lines.append(
                "- ls(path=\\“.\\”, limit=200): List directory. Dirs end with '/'. "
                "Ignored dirs (.git, node_modules, etc.) are hidden."
            )
        elif tname == "read":
            tool_lines.append(
                "- read(path=\"file.py\", offset=1, limit=100): Read a text file. "
                "Use offset (1-indexed line) and limit for large files."
            )
        elif tname == "write":
            tool_lines.append(
                "- write(path=\"file.py\", content=\"...\"): Create or overwrite a file."
            )
        elif tname == "edit":
            # Skip edit for Gemma — it can't format the JSON correctly
            if not _is_gemma:
                tool_lines.append(
                    "- edit(path=\"file.py\", edits=[{oldText: \"exact old\", newText: \"replacement\"}]): "
                    "Surgical find/replace. Read file first to get exact oldText."
                )
        elif tname == "grep":
            tool_lines.append(
                "- grep(pattern=\"regex\", path=\".\", glob=\"*.py\", ignoreCase=False, "
                "literal=False, context=2, limit=30): Search file contents."
            )
        elif tname == "find":
            tool_lines.append(
                "- find(pattern=\"*.py\", path=\".\", limit=50): Find files by glob pattern."
            )
        elif tname == "bash":
            tool_lines.append(
                "- bash(command=\"ls -la\", timeout=60): Run a SINGLE command. "
                "No shell operators (&&, |, >, #)."
            )
        elif tname == "search_project_context":
            tool_lines.append(
                "- search_project_context(query=\"...\", limit=8): Search indexed project memory."
            )
        elif tname == "get_file_summary":
            tool_lines.append(
                "- get_file_summary(path=\"file.py\"): Get indexed file summary."
            )
        elif tname == "get_related_files":
            tool_lines.append(
                "- get_related_files(path=\"file.py\"): Get related file relationships."
            )
        elif tname == "get_run_changes":
            tool_lines.append(
                "- get_run_changes(limit=20): Show recent file changes."
            )
        elif tname == "fetch":
            tool_lines.append(
                "- fetch(url=\"https://...\", maxChars=6000): Fetch a web page as text. "
                "Use this to look up API docs, library references, or examples. "
                "ALWAYS fetch docs before using unfamiliar APIs — NEVER guess."
            )
        elif tname == "docs":
            tool_lines.append(
                "- docs(name=\"better-sqlite3\" or \"laravel/framework\"): Read docs for an installed package. "
                "Works with npm, Composer, pip — auto-detects ecosystem. "
                "ALWAYS call this before using ANY package — NEVER guess its API."
            )

    tools_text = "\n".join(tool_lines) if tool_lines else "(no tools available)"

    if _is_gemma:
        return (
            "TOOL CALLING — You MUST use the <|tool_call> format for every tool call.\n\n"
            "Format:\n"
            '<|tool_call>call:FUNC_NAME{param1:<|"|>value1<|"|>, param2:<|"|>value2<|"|>}<tool_call|>\n\n'
            "Example for writing a file:\n"
            '<|tool_call>call:write{path:<|"|>hello.py<|"|>, content:<|"|>print(\"hello\")<|"|>}<tool_call|>\n\n'
            "CRITICAL RULES:\n"
            '- EVERY tool call MUST start with <|tool_call>call:NAME{ and end with }<tool_call|>.\n'
            '- Parameters are KEY:<|"|>VALUE<|"|> pairs separated by commas.\n'
            '- Use <|"|> around EVERY parameter value — this protects special characters.\n'
            '- For file content, put the ENTIRE file content as the content parameter value, wrapped in <|"|>...<|"|>.\n'
            '- To modify a file, READ it first with read, then use write to replace it COMPLETELY.\n'
            '  Do NOT use edit — always use write with the full file content.\n'
            '- BATCH INDEPENDENT TOOL CALLS: multiple <|tool_call> blocks in ONE response.\n'
            '- After tool results come back, you may call more tools or give your final answer.\n'
            '- DO NOT explain reasoning. Output ONLY tool calls or the final answer.\n\n'
            "AVAILABLE TOOLS:\n"
            f"{tools_text}\n\n"
        )

    return (
        "TOOL CALLING FORMAT — You MUST use this EXACT XML syntax for every tool call:\n\n"
        "<function=NAME>\n"
        "<parameter=param1>\n"
        "value1\n"
        "</parameter>\n"
        "<parameter=param2>\n"
        "value2\n"
        "</parameter>\n"
        "</function>\n"
        "</tool_call>\n\n"
        "Example for writing a file:\n"
        "<function=write>\n"
        "<parameter=path>\n"
        "hello.py\n"
        "</parameter>\n"
        "<parameter=content>\n"
        "print('hello world')\n"
        "</parameter>\n"
        "</function>\n"
        "</tool_call>\n\n"
        "CRITICAL RULES:\n"
        "- EVERY tool call MUST start with <function=NAME> and end with </tool_call>.\n"
        "- Each parameter is <parameter=name>VALUE</parameter> on separate lines.\n"
        "- Content goes BETWEEN the tags — NO escaping needed for quotes, newlines, or special chars.\n"
        "- Write the EXACT file content directly between <parameter=content> and </parameter>.\n"
        "- BATCH INDEPENDENT TOOL CALLS: Read multiple files, write multiple files, or run multiple independent commands in ONE response.\n"
        "  Example: read two files, then write two files — all in one response.\n"
        "  Good: <function=read>...</tool_call><function=read>...</tool_call><function=write>...</tool_call><function=write>...</tool_call>\n"
        "  Bad: read one file → wait → read another → wait → write → wait\n"
        "- After tool results come back, you may call more tools or give your final answer.\n"
        "- DO NOT explain your reasoning. Output ONLY tool calls or the final answer.\n\n"
        "AVAILABLE TOOLS:\n"
        f"{tools_text}\n\n"
    )


IGNORED_DIRS = {".git", ".agent-smith", "node_modules", "vendor", "venv", ".venv", "__pycache__", "dist", "build"}
ALLOWED_COMMANDS = {
    # Runtime / package managers
    "python", "python3", "pytest", "npm", "pnpm", "node", "npx",
    "php", "composer", "artisan",  # PHP / Laravel
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


def _split_on_operator(parts: list[str], operator: str) -> list[list[str]]:
    """Split a command on a shell operator (&&, ||, |, ;).

    Example: ['ps', 'aux', '|', 'grep', 'node'] with '|'
    returns [['ps', 'aux'], ['grep', 'node']].
    """
    segments: list[list[str]] = []
    current: list[str] = []
    for part in parts:
        if part == operator:
            if current:
                segments.append(current)
                current = []
        else:
            current.append(part)
    if current:
        segments.append(current)
    return segments


def _get_allowed_commands(db) -> set[str]:
    """Resolve allowed commands from DB settings / env / defaults."""
    allowed_setting = db.get_setting("bash.allowed_commands")
    if allowed_setting and isinstance(allowed_setting, list) and len(allowed_setting) > 0:
        return set(allowed_setting)
    env_val = os.getenv("SMITH_ALLOWED_COMMANDS", ",".join(sorted(ALLOWED_COMMANDS)))
    return set(c.strip() for c in env_val.split(",") if c.strip())


def _get_blocked_args(db) -> set[str]:
    """Resolve blocked args from DB settings / env / defaults."""
    blocked_setting = db.get_setting("bash.blocked_args")
    if blocked_setting and isinstance(blocked_setting, list) and len(blocked_setting) > 0:
        return set(blocked_setting)
    env_val = os.getenv("SMITH_BLOCKED_ARGS", ",".join(sorted(BLOCKED_ARGS)))
    return set(c.strip() for c in env_val.split(",") if c.strip())


def _exec_shell_chain(
    parts: list[str],
    sandbox,
    cwd: str,
    timeout: int,
    allowed_commands_cache: set[str] | None = None,
    blocked_args_cache: set[str] | None = None,
    approval_handler=None,
    db=None,
    run_id: str | None = None,
    error_logger=None,
    stdin_data: str | None = None,
) -> dict:
    """Recursively execute a command list that may contain shell operators.

    Processes operators in shell precedence order:
      1. ;  (sequence — lowest precedence)
      2. && / ||  (logical chaining)
      3. |  (pipe — highest precedence, processed per-segment)

    Each leaf sub-command undergoes the same approval + sandbox checks.
    Returns {"exit_code": int, "output": str, "operators": list[str]}.
    """
    out = []
    last_exit = 0
    operators_used: list[str] = []

    # Step 1: split on ; (sequence)
    seq_segments = _split_on_operator(parts, ";")
    if len(seq_segments) > 1:
        for seg in seq_segments:
            result = _exec_shell_chain(
                seg, sandbox, cwd, timeout,
                allowed_commands_cache, blocked_args_cache,
                approval_handler, db, run_id, error_logger,
            )
            out.append(result["output"])
            last_exit = result["exit_code"]
            operators_used.extend(result.get("operators", []))
        if not operators_used:
            operators_used.append(";")
        return {"exit_code": last_exit, "output": "\n---\n".join(out), "operators": operators_used}

    # Step 2: split on && (logical AND)
    and_segments = _split_on_operator(parts, "&&")
    if len(and_segments) > 1:
        for seg in and_segments:
            result = _exec_shell_chain(
                seg, sandbox, cwd, timeout,
                allowed_commands_cache, blocked_args_cache,
                approval_handler, db, run_id, error_logger,
            )
            out.append(result["output"])
            last_exit = result["exit_code"]
            operators_used.extend(result.get("operators", []))
            if last_exit != 0:
                break  # short-circuit on failure
        if not operators_used:
            operators_used.append("&&")
        return {"exit_code": last_exit, "output": "\n---\n".join(out), "operators": operators_used}

    # Step 3: split on || (logical OR)
    or_segments = _split_on_operator(parts, "||")
    if len(or_segments) > 1:
        for seg in or_segments:
            result = _exec_shell_chain(
                seg, sandbox, cwd, timeout,
                allowed_commands_cache, blocked_args_cache,
                approval_handler, db, run_id, error_logger,
            )
            out.append(result["output"])
            last_exit = result["exit_code"]
            operators_used.extend(result.get("operators", []))
            if last_exit == 0:
                break  # short-circuit on success
        if not operators_used:
            operators_used.append("||")
        return {"exit_code": last_exit, "output": "\n---\n".join(out), "operators": operators_used}

    # Step 4: split on | (pipe)
    pipe_segments = _split_on_operator(parts, "|")
    if len(pipe_segments) > 1:
        pipe_input: str | None = stdin_data
        for seg in pipe_segments:
            cmd = " ".join(seg)
            result = _exec_shell_chain(
                seg, sandbox, cwd, timeout,
                allowed_commands_cache, blocked_args_cache,
                approval_handler, db, run_id, error_logger,
                stdin_data=pipe_input,
            )
            out.append(result["output"])
            last_exit = result["exit_code"]
            operators_used.extend(result.get("operators", []))
            # Pass stdout as stdin to the next pipe segment
            pipe_input = result.get("stdout", "")
        if not operators_used:
            operators_used.append("|")
        return {"exit_code": last_exit, "output": "\n---\n".join(out), "operators": operators_used}

    # Leaf case: no operators — execute the single command
    # Strip shell redirect tokens (2>&1, > /dev/null, 2>/dev/null, etc.)
    # since the sandbox does not use a shell.
    # For 2>&1 we merge stderr into stdout output.
    import re as _re
    _REDIRECT_RE = _re.compile(r"^(\d+)?(>|>>|<|>&|>\|)(/[^\s]*|\S*)?$")
    clean_parts = [p for p in parts if not _REDIRECT_RE.match(p)]
    has_merge_stderr = any("2>&1" in p or "2>" in p or "1>&2" in p for p in parts)
    cmd = " ".join(clean_parts) if clean_parts else cmd

    seg_result = sandbox.exec(cmd, cwd=cwd, timeout=timeout, stdin_data=stdin_data)
    out_parts = [f"$ {cmd}", f"exit_code={seg_result.exit_code}"]
    if seg_result.timed_out:
        out_parts.append(f"\nCommand timed out after {timeout}s")
    stdout = seg_result.stdout or ""
    stderr = seg_result.stderr or ""
    # If 2>&1 was used, merge stderr into stdout for display
    if has_merge_stderr and stderr:
        stdout = stdout + "\n" + stderr if stdout else stderr
    if stdout:
        out_parts.append("\nSTDOUT:\n" + stdout[-8000:])
    elif stderr and not has_merge_stderr:
        out_parts.append("\nSTDERR:\n" + stderr[-8000:])
    return {
        "exit_code": seg_result.exit_code,
        "output": "\n".join(out_parts),
        "stdout": stdout,
        "operators": [],
    }


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


# ── Tool input schema (mirrors the pi agent exactly) ───────────────────────
# Local models are far more reliable when tool names + parameter names match a
# schema they have seen in training. These mirror pi's TypeBox schemas 1:1.

class EditItem(BaseModel):
    """A single find/replace edit applied by the `edit` tool."""
    oldText: str = Field(..., description="Exact text to find in the file.")
    newText: str = Field(..., description="Text to replace the matched text with.")


_PLACEHOLDER_PATTERNS = [
    "... existing code ...", "// ...", "/* ...", "# ...",
    "<!-- ...", "... rest of file ...", "... other methods",
    "... remain unchanged", "{{ ... }}", "{% ... %}",
    "// rest of the code", "/* rest of the code */",
]


def _normalize_for_fuzzy(t: str) -> str:
    """Normalize text for fuzzy matching (mirrors pi's normalizeForFuzzyMatch).

    Collapses line-ending, trailing-whitespace, smart-quote, dash and NBSP
    differences so that edits authored by a model still match the file even
    when the model slightly misremembers whitespace or punctuation.
    """
    t = t.replace("\r\n", "\n").replace("\r", "\n")
    t = "\n".join(line.rstrip() for line in t.split("\n"))
    t = t.replace("\u2018", "'").replace("\u2019", "'")
    t = t.replace("\u201c", "\"").replace("\u201d", "\"")
    t = t.replace("\u2013", "-").replace("\u2014", "-").replace("\u2212", "-")
    t = t.replace("\u00a0", " ").replace("\u200b", "")
    return t


def _locate_match(haystack: str, needle: str) -> tuple[int, int, bool]:
    """Find `needle` in `haystack`. Returns (start, length_in_haystack, used_fuzzy).

    Tries an exact match first, then a fuzzy match in normalized space (mirrors
    pi's edit tool). Returns (-1, -1, False) when not found.
    """
    idx = haystack.find(needle)
    if idx != -1:
        return idx, len(needle), False

    norm_hay = _normalize_for_fuzzy(haystack)
    norm_needle = _normalize_for_fuzzy(needle)
    fidx = norm_hay.find(norm_needle)
    if fidx == -1:
        return -1, -1, False

    # Map the normalized index back to an index in the original haystack by
    # walking both strings in lockstep.
    orig_pos = 0
    norm_pos = 0
    while norm_pos < fidx and orig_pos < len(haystack):
        nc = _normalize_for_fuzzy(haystack[orig_pos])
        if nc == norm_hay[norm_pos:norm_pos + len(nc)]:
            norm_pos += len(nc)
        orig_pos += 1
    start = orig_pos

    # Determine the length in the original that the normalized needle covers.
    actual_len = 0
    npos = 0
    snippet = haystack[start:]
    while npos < len(norm_needle) and actual_len < len(snippet):
        nc = _normalize_for_fuzzy(snippet[actual_len])
        npos += len(nc)
        actual_len += 1
    return start, actual_len, True


def make_tools(db: ProjectDB, task_type: str, run_id: str | None = None, cancel_event=None, approval_handler: ApprovalHandler | None = None, error_logger: ToolErrorLogger | None = None, model_context: list[dict[str, Any]] | None = None, model_id: str = ""):
    root = db.root_path
    profile = get_task_profile(task_type)
    if approval_handler is None:
        approval_handler = SilentDenyHandler()
    if error_logger is None:
        error_logger = ToolErrorLogger(db)

    def _log_error(tool_name: str, args: dict[str, Any] | None, error_result: str) -> None:
        """Record a tool error for debugging."""
        try:
            error_logger.record_tool_error(
                run_id=run_id or "unknown",
                tool_name=tool_name,
                tool_args=args,
                error_result=error_result,
                model_messages=model_context,
            )
        except Exception:
            pass  # Never let error logging break the tool

    @tool
    def ls(path: str = ".", limit: int = 200) -> str:
        """List the contents of a directory inside the project workspace.

        Returns relative paths, one per line. Directories are suffixed with '/'.
        Paths inside ignored directories (.git, node_modules, venv, ...) are hidden.
        """
        try:
            target = safe_path(root, path)
            if not target.exists():
                return f"Path does not exist: {path}"
            if target.is_file():
                return str(target.relative_to(root))
            limit = max(1, min(2000, int(limit or 200)))
            out = []
            for item in sorted(target.iterdir()):
                rel = item.relative_to(root)
                if is_ignored_rel(rel):
                    continue
                out.append(str(rel) + ("/" if item.is_dir() else ""))
                if len(out) >= limit:
                    out.append(f"... truncated after {limit} entries")
                    break
            db.record_event(run_id, "tool_list_files", {"path": path, "count": len(out)}, actor="agent")
            return "\n".join(out) if out else "(empty)"
        except Exception as exc:
            err_msg = f"ls error: {exc}"
            _log_error("ls", {"path": path, "limit": limit}, err_msg)
            return err_msg

    @tool
    def read(path: str, offset: int | None = None, limit: int | None = None) -> str:
        """Read a text file inside the project workspace.

        Args:
            path: Relative or absolute path inside the workspace.
            offset: Optional line number to start reading from (1-indexed).
            limit: Optional max number of lines to read.
        """
        max_chars = 200_000
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

            # Apply offset/limit (line-based slicing before the char limit)
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
            err_msg = f"read error: {exc}"
            _log_error("read", {"path": path, "offset": offset, "limit": limit}, err_msg)
            return err_msg

    write_count = {"total": 0}
    write_counts_by_path: dict[str, int] = {}
    max_writes_per_run = max(1, min(100, int(os.getenv("SMITH_MAX_WRITES_PER_RUN", "30"))))
    max_writes_per_file = max(1, min(30, int(os.getenv("SMITH_MAX_WRITES_PER_FILE", "8"))))
    max_write_chars = max(500, min(8000, int(os.getenv("SMITH_MAX_WRITE_CHARS", "4000"))))

    # Create sandbox backend for isolated command execution
    sandbox = get_sandbox_backend(db)

    @tool
    def write(path: str, content: str) -> str:
        """Write a text file inside the project workspace, creating it if needed.

        Returns a verified result containing existence, size, hash and line stats.
        Use this to create new files or to overwrite an existing file completely.
        """
        if not profile.can_write:
            err_msg = "WRITE_BLOCKED: This task profile cannot write files."
            _log_error("write", {"path": path}, err_msg)
            return err_msg
        try:
            if cancel_event is not None and cancel_event.is_set():
                err_msg = "WRITE_INTERRUPTED: user interruption requested; do not call more tools."
                _log_error("write", {"path": path, "content_chars": len(content)}, err_msg)
                return err_msg

            target = safe_path(root, path)
            rel = target.relative_to(root)
            rel_str = str(rel)
            if is_ignored_rel(rel):
                err_msg = f"WRITE_BLOCKED: Refusing ignored path: {path}"
                _log_error("write", {"path": path, "content_chars": len(content)}, err_msg)
                return err_msg

            write_count["total"] += 1
            write_counts_by_path[rel_str] = write_counts_by_path.get(rel_str, 0) + 1
            if write_count["total"] > max_writes_per_run:
                err_msg = (
                    f"WRITE_BLOCKED: per-run write limit reached ({max_writes_per_run}). "
                    "Stop calling tools and return a concise summary of the changes already made."
                )
                _log_error("write", {"path": path, "content_chars": len(content)}, err_msg)
                return err_msg
            if write_counts_by_path[rel_str] > max_writes_per_file:
                err_msg = (
                    f"WRITE_BLOCKED: per-file write limit reached for {rel_str} ({max_writes_per_file}). "
                    "Stop rewriting this file and return a concise summary."
                )
                _log_error("write", {"path": path, "content_chars": len(content)}, err_msg)
                return err_msg
            if len(content) > max_write_chars:
                err_msg = (
                    f"WRITE_TOO_LARGE: content is {len(content)} chars, max is {max_write_chars}. "
                    "Split this file into multiple smaller writes, or simplify the content. "
                    "Write the most important parts first, then add more in subsequent calls."
                )
                _log_error("write", {"path": path, "content_chars": len(content)}, err_msg)
                return err_msg

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
                err_msg = (
                    f"WRITE_FAILED_VERIFICATION: attempted {rel_str}; exists_after={exists_after}; "
                    f"verified={verified}; size_bytes={size_bytes}. Stop and report this failure."
                )
                _log_error("write", {"path": path, "content_chars": len(content)}, err_msg)
                return err_msg

            return (
                f"VERIFIED_WRITE_OK path={rel_str} chars={len(content)} bytes={size_bytes} "
                f"sha256={after} lines_added={lines_added} lines_removed={lines_removed}. "
                "The file now exists on disk. If this satisfied the request, stop calling tools and return the final answer."
            )
        except Exception as exc:
            err_msg = f"WRITE_ERROR: {type(exc).__name__}: {exc}. Stop and report this error instead of retrying blindly."
            _log_error("write", {"path": path, "content_chars": len(content)}, err_msg)
            return err_msg

    @tool
    def edit(path: str, edits: list[EditItem]) -> str:
        """Apply surgical find/replace edits to an existing file.

        Each edit in `edits` finds `oldText` and replaces it with `newText`.
        All edits are applied to the file in order, in a single write. Always
        read the file first with `read` to get the exact text to match.

        Include enough surrounding context in `oldText` so it matches uniquely.
        Do NOT use placeholder ellipses like "... existing code ..." — pass the
        real text from the file.

        Args:
            path: Path to the file to edit (relative to project root).
            edits: List of {oldText, newText} edits to apply in order.
        """
        if not profile.can_write:
            err_msg = "EDIT_BLOCKED: This task profile cannot edit files."
            _log_error("edit", {"path": path}, err_msg)
            return err_msg

        if not edits:
            err_msg = (
                "EDIT_NEEDS_EDITS: the 'edits' parameter is required and must be a non-empty array "
                "of {oldText, newText} objects. Read the file first, then pass the exact text to "
                "replace as oldText and the replacement as newText."
            )
            _log_error("edit", {"path": path}, err_msg)
            return err_msg

        # Reject placeholder ellipses models sometimes use instead of real content.
        for e in edits:
            combined = (e.oldText + "\n" + e.newText).lower()
            found_ph = [p for p in _PLACEHOLDER_PATTERNS if p in combined]
            if found_ph:
                err_msg = (
                    f"EDIT_FAILED: placeholder text detected in edit arguments ({found_ph[0]!r}).\n"
                    "Placeholders are not actual file content. Read the file with `read`, then pass "
                    "the literal text as oldText. Do NOT abbreviate with placeholders."
                )
                _log_error("edit", {"path": path, "edits_count": len(edits)}, err_msg)
                return err_msg
            if not e.oldText:
                err_msg = (
                    "EDIT_NEEDS_OLDTEXT: one of your edits has an empty oldText. To overwrite an "
                    "entire file, use the `write` tool instead."
                )
                _log_error("edit", {"path": path, "edits_count": len(edits)}, err_msg)
                return err_msg

        try:
            if cancel_event is not None and cancel_event.is_set():
                err_msg = "EDIT_INTERRUPTED: user interruption requested; do not call more tools."
                _log_error("edit", {"path": path, "edits_count": len(edits)}, err_msg)
                return err_msg

            target = safe_path(root, path)
            rel = target.relative_to(root)
            rel_str = str(rel)
            if is_ignored_rel(rel):
                err_msg = f"EDIT_BLOCKED: Refusing ignored path: {path}"
                _log_error("edit", {"path": path, "edits_count": len(edits)}, err_msg)
                return err_msg

            # Respect the same write limits as `write`.
            write_count["total"] += 1
            write_counts_by_path[rel_str] = write_counts_by_path.get(rel_str, 0) + 1
            if write_count["total"] > max_writes_per_run:
                err_msg = (
                    f"EDIT_BLOCKED: per-run edit limit reached ({max_writes_per_run}). "
                    "Stop calling tools and return a concise summary of the changes already made."
                )
                _log_error("edit", {"path": path, "edits_count": len(edits)}, err_msg)
                return err_msg
            if write_counts_by_path[rel_str] > max_writes_per_file:
                err_msg = (
                    f"EDIT_BLOCKED: per-file edit limit reached for {rel_str} ({max_writes_per_file}). "
                    "Stop rewriting this file and return a concise summary."
                )
                _log_error("edit", {"path": path, "edits_count": len(edits)}, err_msg)
                return err_msg

            if not target.exists():
                err_msg = f"EDIT_ERROR: File does not exist: {path}. Use the `write` tool to create new files."
                _log_error("edit", {"path": path, "edits_count": len(edits)}, err_msg)
                return err_msg
            if not target.is_file():
                err_msg = f"EDIT_ERROR: Not a file: {path}"
                _log_error("edit", {"path": path, "edits_count": len(edits)}, err_msg)
                return err_msg

            before_bytes = target.read_bytes()
            if b"\x00" in before_bytes[:4096]:
                err_msg = f"EDIT_ERROR: Refusing binary file: {path}"
                _log_error("edit", {"path": path, "edits_count": len(edits)}, err_msg)
                return err_msg

            before_text = before_bytes.decode("utf-8", errors="replace")
            after_text = before_text

            # Apply each edit in order, locating it in the *current* after_text so
            # earlier edits shift offsets for later ones (mirrors pi's edit tool).
            applied = []
            for idx, e in enumerate(edits):
                start, length, used_fuzzy = _locate_match(after_text, e.oldText)
                if start == -1:
                    lines = after_text.splitlines()
                    hint_lines = []
                    search = e.oldText.strip()[:30].lower()
                    for i, line in enumerate(lines, 1):
                        if search and search in line.lower():
                            hint_lines.append(f"  Line {i}: {line[:200]}")
                            if len(hint_lines) >= 5:
                                break
                    hint = "\n".join(hint_lines)
                    extra = f"\nDid you mean one of these lines?\n{hint}" if hint else ""

                    # Detect if the model put reasoning/comments in the oldText
                    oldtext = e.oldText
                    reasoning_markers = [
                        "# Wait", "# Actually", "# Let", "# Since", "# But",
                        "// Wait", "// Actually", "// Let", "# Note", "# The",
                        "# I should", "# We should", "# First", "# Next",
                    ]
                    reasoning_hint = ""
                    for marker in reasoning_markers:
                        if marker.lower() in oldtext.lower():
                            reasoning_hint = (
                                "\n⚠ Your oldText appears to contain reasoning or commentary "
                                f"('{marker}...'). Remove ALL reasoning — oldText must contain "
                                "ONLY the exact text from the file, character-for-character."
                            )
                            break

                    err_msg = (
                        f"EDIT_FAILED: oldText not found in {rel_str} (edit #{idx + 1}). "
                        f"The provided text does not appear anywhere in the file.{extra}\n"
                        f"{reasoning_hint}\n"
                        "TIP: If you are unsure about the exact text, re-read the file with `read`, "
                        "or use `write` to replace the entire file content instead of `edit`."
                    )
                    _log_error("edit", {"path": path, "edits_count": len(edits), "failed_edit_index": idx}, err_msg)
                    return err_msg

                # Uniqueness check (in the same matching space as the hit).
                check_text = _normalize_for_fuzzy(after_text) if used_fuzzy else after_text
                check_needle = _normalize_for_fuzzy(e.oldText) if used_fuzzy else e.oldText
                count = check_text.count(check_needle)
                if count > 1:
                    err_msg = (
                        f"EDIT_FAILED: oldText appears {count} times in {rel_str} (edit #{idx + 1}). "
                        "Include more surrounding context in oldText to make it unique."
                    )
                    _log_error("edit", {"path": path, "edits_count": len(edits), "failed_edit_index": idx}, err_msg)
                    return err_msg

                after_text = after_text[:start] + e.newText + after_text[start + length:]
                applied.append({"old_len": len(e.oldText), "new_len": len(e.newText), "fuzzy": used_fuzzy})

            # Backup, write, verify.
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

            verified_text = after_bytes.decode("utf-8", errors="replace")
            verified = verified_text == after_text

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
                "edits_applied": len(applied),
                "fuzzy_used": any(a["fuzzy"] for a in applied),
            }

            db.record_event(run_id, "tool_edit_file", {
                "path": rel_str,
                "edits": len(applied),
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
                err_msg = f"EDIT_FAILED_VERIFICATION: edit applied but verification failed for {rel_str}."
                _log_error("edit", {"path": path, "edits_count": len(edits)}, err_msg)
                return err_msg

            return (
                f"VERIFIED_EDIT_OK path={rel_str} edits={len(applied)} lines_added={lines_added} "
                f"lines_removed={lines_removed} sha256={after}. "
                "The edit has been applied. If this satisfied the request, stop calling tools and return the final answer."
            )
        except Exception as exc:
            err_msg = f"EDIT_ERROR: {type(exc).__name__}: {exc}. Stop and report this error instead of retrying blindly."
            _log_error("edit", {"path": path, "edits_count": len(edits)}, err_msg)
            return err_msg

    @tool
    def bash(command: str, timeout: int = 60) -> str:
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
            err_msg = "This task profile cannot run commands."
            _log_error("bash", {"command": command}, err_msg)
            return err_msg

        # ── Parse command safely ───────────────────────────────────────────
        # Normalize: ensure shell operators have spaces around them so shlex
        # splits them as separate tokens even when the model writes e.g.
        # "2>&1;" or "2>&1||echo" without spaces.
        import re as _norm_re
        _normalized = command
        # Insert spaces around ;, &&, ||, | when they touch other chars
        _OP_SPACER = _norm_re.compile(r"(\&\&|\|\||\;|\|)")
        _normalized = _OP_SPACER.sub(r" \1 ", _normalized)
        _normalized = _OP_SPACER.sub(r" \1 ", _normalized)
        # Cleanup: collapse multiple spaces
        _normalized = _norm_re.sub(r"\s+", " ", _normalized).strip()
        try:
            parts = shlex.split(_normalized)
        except ValueError as exc:
            err_msg = (
                f"COMMAND_PARSE_ERROR: could not parse command: {exc}\n"
                "Remove shell comments (# ...), fix any unmatched quotes, "
                "and remove newlines from inside the command string."
            )
            _log_error("bash", {"command": command}, err_msg)
            return err_msg
        if not parts:
            err_msg = "No command provided."
            _log_error("bash", {"command": command}, err_msg)
            return err_msg

        # ── Detect shell metacharacters and auto-process them ─────────
        # Many models (especially Qwen, DeepSeek, etc.) habitually use shell
        # operators like &&, ||, |, ; in bash commands. Instead of returning
        # an error, we recursively process them in shell precedence order:
        #   1. ;  (sequence — run all regardless of exit code)
        #   2. && / ||  (logical chaining — short-circuit)
        #   3. |  (piping — feed stdout of left to stdin of right)
        #
        # Each sub-command still goes through approval and sandbox checks.
        shell_tokens = {"&&", "||", "|", ";"}
        found_shell = [t for t in parts if t in shell_tokens]

        if found_shell:
            result = _exec_shell_chain(
                parts, sandbox, root, timeout,
                allowed_commands_cache=_get_allowed_commands(db),
                blocked_args_cache=_get_blocked_args(db),
                approval_handler=approval_handler,
                db=db, run_id=run_id, error_logger=error_logger,
            )
            db.record_event(run_id, "tool_run_command", {"command": command, "exit_code": result["exit_code"], "auto_split": True, "operators": result.get("operators", [])}, actor="agent")
            return result["output"]

        # Also catch leading comment chars
        if parts[0].startswith("#"):
            err_msg = (
                f"SHELL_COMMENT_DETECTED: command starts with '#'. Remove the comment and try again.\n"
                "This tool does not use a shell, so '#' is treated as a command name."
            )
            _log_error("bash", {"command": command}, err_msg)
            return err_msg

        # ── Single command with no shell operators ──
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
                    err_msg = (
                        f"Command not auto-approved: {exe}. {approval_reason}\n"
                        f"Allowed commands: {', '.join(sorted(allowed_commands))}\n"
                        "No approval handler is available. Run via 'smith run' (CLI) or the Web UI, "
                        "or set SMITH_AUTO_APPROVE=true to auto-approve all commands."
                    )
                    _log_error("bash", {"command": command}, err_msg)
                    return err_msg
                else:
                    # Format command for display
                    display = f"$ {' '.join(parts)}\nReason: {approval_reason}\nWorkspace: {root}"
                    req = ApprovalRequest(command, display)
                    if approval_handler.request_approval(req):
                        pass  # approved, continue to execution
                    else:
                        err_msg = f"APPROVAL_DENIED: {req.denied_reason or 'User denied the command.'}"
                        _log_error("bash", {"command": command}, err_msg)
                        return err_msg
            timeout = max(1, min(int(timeout), 120))
            result = sandbox.exec(command, cwd=root, timeout=timeout)
            db.record_event(
                run_id,
                "tool_run_command",
                {"command": command, "exit_code": result.exit_code},
                actor="agent",
            )
            out = [f"$ {' '.join(parts)}", f"exit_code={result.exit_code}"]
            if result.timed_out:
                out.append(f"\nCommand timed out after {timeout}s")
            if result.stdout:
                out.append("\nSTDOUT:\n" + result.stdout[-12000:])
            if result.stderr:
                out.append("\nSTDERR:\n" + result.stderr[-12000:])
            return "\n".join(out)
        except Exception as exc:
            err_msg = f"bash error: {exc}"
            _log_error("bash", {"command": command}, err_msg)
            return err_msg

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
    def grep(pattern: str, path: str = ".", glob: str | None = None, ignoreCase: bool = False, literal: bool = False, context: int = 2, limit: int = 30) -> str:
        """Search file contents for a pattern, like the Unix 'grep' command.

        Use this to find where functions are defined, variables are referenced, or any text pattern.
        Returns matching lines with surrounding context lines.

        Args:
            pattern: The search pattern (regex or literal string).
            path: Directory or file to search. Defaults to project root.
            glob: Optional glob to filter files (e.g. "*.py" searches only Python files).
            ignoreCase: When true, perform a case-insensitive search.
            literal: When true, treat `pattern` as a literal string instead of a regex.
            context: Number of context lines before and after each match (0-10).
            limit: Maximum matches to return (1-200).
        """
        import re as _re
        try:
            target = safe_path(root, path)
            if not target.exists():
                return f"Path does not exist: {path}"

            ctx = max(0, min(10, int(context or 0)))
            limit = max(1, min(200, int(limit or 30)))
            is_regex = not literal
            flags = _re.IGNORECASE if ignoreCase else 0

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
                    if glob and not p.match(glob):
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
                            matched = _re.search(pattern, line, flags)
                        except _re.error:
                            return f"GREP_ERROR: Invalid regex: {pattern}"
                    else:
                        if ignoreCase:
                            matched = pattern.lower() in line.lower()
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
            err_msg = f"grep error: {exc}"
            _log_error("grep", {"pattern": pattern, "path": path, "glob": glob}, err_msg)
            return err_msg

    @tool
    def docs(name: str) -> str:
        """Read documentation for an installed package from the project's package manager.

        Works across ecosystems: npm (node_modules), Composer (vendor), pip, etc.
        Auto-detects where to look based on project files. Falls back to fetching
        from the package registry if not found locally.

        This is your PRIMARY tool for understanding any library API.
        ALWAYS call this before using a package — NEVER guess its API.

        Args:
            name: The package name (e.g. "better-sqlite3", "laravel/framework", "requests").
        """
        import json as _json

        name = name.strip().replace("..", "").replace("\\", "")
        if not name:
            return "DOCS_ERROR: package name required"

        parts: list[str] = []
        found = False

        # ── Detect package ecosystem and look for local docs ──────────
        # npm: node_modules/<name>/package.json + README.md
        for nm_dir in [root / "node_modules" / name]:
            if nm_dir.is_dir():
                found = True
                pkg_json = nm_dir / "package.json"
                if pkg_json.exists():
                    try:
                        data = _json.loads(pkg_json.read_text(encoding="utf-8"))
                        parts.append(f"## {data.get('name', name)} v{data.get('version', '?')} (npm)")
                        if data.get("description"):
                            parts.append(data["description"])
                    except Exception:
                        pass
                for rm in ("README.md", "README.markdown", "readme.md", "README"):
                    rp = nm_dir / rm
                    if rp.exists():
                        text = rp.read_text(encoding="utf-8", errors="replace")[:4000]
                        parts.append(f"\n{text}")
                        break
                break

        # Composer: vendor/<name>/composer.json + README.md
        if not found:
            vendor_dir = root / "vendor" / name
            if vendor_dir.is_dir():
                found = True
                cjson = vendor_dir / "composer.json"
                if cjson.exists():
                    try:
                        data = _json.loads(cjson.read_text(encoding="utf-8"))
                        parts.append(f"## {data.get('name', name)} v{data.get('version', '?')} (composer)")
                        if data.get("description"):
                            parts.append(data["description"])
                    except Exception:
                        pass
                for rm in ("README.md", "README.markdown", "readme.md", "README"):
                    rp = vendor_dir / rm
                    if rp.exists():
                        text = rp.read_text(encoding="utf-8", errors="replace")[:4000]
                        parts.append(f"\n{text}")
                        break

        # ── Fallback: fetch from package registry ────────────────────
        if not found:
            # Try to guess the registry from the name format
            if "/" in name:
                # Looks like a Composer package (vendor/name)
                url = f"https://repo.packagist.org/p2/{name}.json"
                label = "packagist"
            else:
                # Try npm first (most common)
                url = f"https://registry.npmjs.org/{name}/latest"
                label = "npm"

            try:
                from urllib.request import Request, urlopen
                req = Request(url, headers={"User-Agent": "Agent-Smith/1.0"})
                with urlopen(req, timeout=10) as resp:
                    raw = resp.read(100 * 1024)
                data = _json.loads(raw.decode("utf-8", errors="replace"))

                if label == "packagist":
                    pkg_data = data.get("packages", {}).get(name, [{}])[0]
                    parts.append(f"## {name} v{pkg_data.get('version', '?')} ({label})")
                    if pkg_data.get("description"):
                        parts.append(pkg_data["description"])
                    # Try to also fetch README from GitHub or homepage
                    source_url = pkg_data.get("source", {}).get("url", "")
                    if source_url:
                        parts.append(f"Source: {source_url}")
                else:
                    parts.append(f"## {data.get('name', name)} v{data.get('version', '?')} ({label})")
                    if data.get("description"):
                        parts.append(data["description"])
                    readme = data.get("readme", "") or data.get("README", "")
                    if readme:
                        parts.append(f"\n{readme[:4000]}")
            except Exception as exc:
                parts.append(f"(could not fetch from {label} registry: {exc})")
                parts.append("Try `fetch` with a direct URL for this package's documentation.")

        if not parts:
            return f"DOCS_ERROR: could not find docs for '{name}'. Try `fetch` with a direct URL."

        result = "\n".join(parts)
        db.record_event(run_id, "tool_docs", {"name": name, "chars": len(result)}, actor="agent")
        return result

    @tool
    def fetch(url: str, maxChars: int = 6000) -> str:
        """Fetch a web page and return readable text content.

        Use this to look up API documentation, library references, or any
        information you need. IMPORTANT: use this whenever you are unsure
        about a library's API — do NOT guess or hallucinate.

        Args:
            url: The URL to fetch (must start with http:// or https://).
            maxChars: Maximum characters to return (default 6000, max 15000).
        """
        import re as _re
        from urllib.request import Request, urlopen
        from urllib.error import URLError

        url = url.strip()
        if not url.startswith(("http://", "https://")):
            return "FETCH_ERROR: URL must start with http:// or https://"

        maxChars = max(500, min(15000, int(maxChars or 6000)))

        try:
            req = Request(url, headers={"User-Agent": "Agent-Smith/1.0"})
            with urlopen(req, timeout=15) as resp:
                # Respect size limits
                content_type = resp.headers.get("Content-Type", "")
                raw = resp.read(500 * 1024)  # Max 500KB raw

            # Decode
            charset = "utf-8"
            if "charset=" in content_type:
                match = _re.search(r"charset=([^\s;]+)", content_type)
                if match:
                    charset = match.group(1)

            try:
                text = raw.decode(charset, errors="replace")
            except (UnicodeDecodeError, LookupError):
                text = raw.decode("utf-8", errors="replace")

            # Strip HTML tags for HTML content
            if "text/html" in content_type or text.strip().startswith("<!"):
                # Remove scripts and styles
                text = _re.sub(r"<script[^>]*>.*?</script>", "", text, flags=_re.DOTALL | _re.IGNORECASE)
                text = _re.sub(r"<style[^>]*>.*?</style>", "", text, flags=_re.DOTALL | _re.IGNORECASE)
                # Remove HTML tags
                text = _re.sub(r"<[^>]+>", " ", text)
                # Decode common entities
                text = text.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
                text = text.replace("&quot;", '"').replace("&#39;", "'").replace("&apos;", "'")
                text = text.replace("&#x27;", "'").replace("&#x2F;", "/")
                # Collapse whitespace
                text = _re.sub(r"[ \t]+", " ", text)
                text = _re.sub(r"\n{3,}", "\n\n", text)
                text = text.strip()

            # Truncate
            if len(text) > maxChars:
                text = text[:maxChars] + f"\n\n... truncated at {maxChars} chars (original: {len(text)} chars)"

            db.record_event(run_id, "tool_fetch", {"url": url, "chars": len(text)}, actor="agent")
            return text if text.strip() else "FETCH_RESULT: page returned empty or unreadable content"

        except URLError as exc:
            err_msg = f"FETCH_ERROR: could not fetch URL: {exc}"
            _log_error("fetch", {"url": url}, err_msg)
            return err_msg
        except Exception as exc:
            err_msg = f"FETCH_ERROR: {type(exc).__name__}: {exc}"
            _log_error("fetch", {"url": url}, err_msg)
            return err_msg

    @tool
    def find(pattern: str, path: str = ".", limit: int = 50) -> str:
        """Find files matching a glob pattern, like the Unix 'find' command.

        Use this to locate files by name, extension, or path pattern.

        Args:
            pattern: Glob pattern to match (e.g. "*.py", "**/test_*.py", "src/**/*.ts").
            path: Directory to search from. Defaults to project root.
            limit: Maximum results to return (1-200).
        """
        try:
            target = safe_path(root, path)
            if not target.exists():
                return f"Path does not exist: {path}"
            if not target.is_dir():
                return f"Not a directory: {path}"

            limit = max(1, min(200, int(limit or 50)))
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
            err_msg = f"find error: {exc}"
            _log_error("find", {"pattern": pattern, "path": path}, err_msg)
            return err_msg

    all_tools = {
        "ls": ls,
        "read": read,
        "write": write,
        "edit": edit,
        "grep": grep,
        "find": find,
        "fetch": fetch,
        "docs": docs,
        "bash": bash,
        "search_project_context": search_project_context,
        "get_file_summary": get_file_summary,
        "get_related_files": get_related_files,
        "get_run_changes": get_run_changes,
    }
    _is_gemma = "gemma" in (model_id or "").lower()
    _tool_names = [n for n in profile.tools if n in all_tools and not (_is_gemma and n == "edit")]
    return [all_tools[name] for name in _tool_names]


def build_agent_with_handler(db: ProjectDB, task_type: str, context_bundle: str, run_id: str | None = None, model_override: dict[str, str] | None = None, cancel_event=None, approval_handler: ApprovalHandler | None = None, error_logger: ToolErrorLogger | None = None, model_context: list[dict[str, Any]] | None = None):
    """Build a LangChain agent with approval handler wired to the bash tool."""
    profile = get_task_profile(task_type)
    model_profile = get_model_profile(profile.model_profile)
    llm = build_chat_model_for_task(db, task_type, max_tokens=model_profile.max_tokens, model_override=model_override)
    actual_handler = approval_handler or SilentDenyHandler()

    # Auto-detected: check if the model uses text-based tool calling
    # (build_chat_model_for_task already decided based on model family + env var)
    text_tool_mode = getattr(llm, "text_tool_mode", False)
    _model_id = getattr(llm, "model_name", "") or getattr(llm, "model", "")

    if text_tool_mode:
        tool_instructions = _text_tool_prompt(profile, model_id=_model_id)
    else:
        tool_instructions = (
            "TOOLS (use these exactly):\n"
            "- ls(path?, limit?): list a directory. Returns relative paths; dirs end with '/'.\n"
            "- read(path, offset?, limit?): read a file. Use offset/limit for large files.\n"
            "- write(path, content): create or completely overwrite a file.\n"
            "- edit(path, edits): apply find/replace edits. `edits` is an array of {oldText, newText}.\n"
            "- grep(pattern, path?, glob?, ignoreCase?, literal?, context?, limit?): search file contents.\n"
            "- find(pattern, path?, limit?): find files by glob pattern.\n"
            "- fetch(url, maxChars?): fetch a web page as text. Use to look up docs.\n"
            "- docs(name): read docs + metadata of any installed package (npm, Composer, pip, etc.).\n"
            "- bash(command, timeout?): run a single shell-free command (no &&, |, >, #).\n\n"
        )

    system_prompt = (
        f"You are Agent Smith, a coding agent working on project: {db.root_path}\n"
        f"Task: {task_type} — {profile.system_role}\n\n"
        "COMPACT PROJECT CONTEXT:\n"
        f"{context_bundle or '(no indexed context yet — explore carefully)'}\n\n"
        f"{tool_instructions}"
        "CRITICAL RULES:\n"
        "1. Read a file with `read` before editing it. Never guess paths.\n"
        "2. To change an existing file, use `edit(path, edits=[{oldText, newText}])` with the EXACT text from the file.\n"
        "   To create or fully replace a file, use `write(path, content)`. Never use placeholder ellipses like '... existing code ...'.\n"
        "3. Find code with `grep`; locate files with `find`.\n"
        "4. BATCH INDEPENDENT TOOL CALLS: emit multiple reads, writes, or edits in ONE response when they don't depend on each other.\n"
        "   Good: read two files in parallel, then write both edited versions.\n"
        "   Bad: read one file → wait → edit → wait → read another → wait → edit → wait\n"
        "5. After `write` returns VERIFIED_WRITE_OK or `edit` returns VERIFIED_EDIT_OK, do NOT re-read or re-edit. Move on.\n"
        "6. If a write/edit fails, report the failure. Do not retry blindly.\n"
        "7. Never loop. If you lack information, ask or use grep/find first.\n"
        "8. After your final tool call, output a brief summary of what you changed, then STOP.\n"
        "9. If the task is done, just report what was accomplished. Do not invent extra work.\n"
    )
    return create_agent(model=llm, tools=make_tools(db, task_type, run_id, cancel_event=cancel_event, approval_handler=actual_handler, error_logger=error_logger, model_context=model_context, model_id=_model_id), system_prompt=system_prompt)


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

    # Tool error messages should appear in the visible stream so the user
    # can see what went wrong (parsing errors, approval denials, etc.).
    if cls_name == "ToolMessage" or msg_type == "tool":
        content = getattr(token, "content", "")
        if isinstance(content, list):
            content = "\n".join(str(x) for x in content)
        content = str(content or "").strip()
        _tool_error_prefixes = (
            "COMMAND_PARSE_ERROR", "SHELL_SYNTAX_DETECTED", "SHELL_COMMENT_DETECTED",
            "APPROVAL_DENIED", "Command not auto-approved", "No approval handler",
            "EDIT_NEEDS_REAL_CONTENT", "EDIT_NEEDS_EDITS", "EDIT_NEEDS_OLDTEXT",
            "EDIT_FAILED", "EDIT_FAILED_VERIFICATION", "EDIT_BLOCKED",
            "EDIT_ERROR", "EDIT_INTERRUPTED", "WRITE_BLOCKED", "WRITE_FAILED_VERIFICATION",
            "WRITE_ERROR", "WRITE_INTERRUPTED", "READ_BLOCKED", "LIST_BLOCKED",
        )
        if content.startswith(_tool_error_prefixes):
            return f"\n[smith] ⚠ {content[:600]}\n"
        # Also catch dynamic errors
        if any(content.startswith(p) for p in ("Error", "ERROR", "error", "DENIED", "BLOCKED", "FAILED")):
            return f"\n[smith] ⚠ {content[:600]}\n"
        return ""

    # Only stream assistant messages. Explicitly ignore non-error tool outputs.
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
                # bash errors
                "COMMAND_PARSE_ERROR",
                "SHELL_SYNTAX_DETECTED",
                "SHELL_COMMENT_DETECTED",
                "APPROVAL_DENIED",
                "Command not auto-approved",
                "No approval handler",
                # edit errors
                "EDIT_NEEDS_REAL_CONTENT",
                "EDIT_NEEDS_EDITS",
                "EDIT_NEEDS_OLDTEXT",
                "EDIT_FAILED_VERIFICATION",
                "EDIT_BLOCKED",
                "EDIT_ERROR",
                "EDIT_INTERRUPTED",
                # tool errors
                "read error",
                "ls error",
                "grep error",
                "find error",
                "bash error",
                "search error",
            )
            # Also check for any error/denied/blocked/parse prefix dynamically
            is_error = content.startswith(visible_prefixes) or any(
                content.startswith(p) for p in (
                    "Error", "ERROR", "error",
                    "DENIED", "BLOCKED", "FAILED", "INTERRUPTED",
                    "Cannot", "Could not", "Refusing",
                )
            )
            if is_error:
                first = content.splitlines()[0][:1200]
                return f"[smith] ⚠ tool result: {name} — {first}\n"

            # Safe generic summaries for common tools.
            if name == "ls" or "ls" in str(name):
                entries = [ln for ln in content.splitlines() if ln.strip()]
                return f"[smith] tool result: {name} — {len(entries)} item(s) in directory\n"
            if name == "read" or "read" in str(name):
                return f"[smith] tool result: {name} — {lines_count} lines, {char_count} chars\n"
            if name == "write" or "write" in str(name):
                # Extract path from the result if present
                path_hint = ""
                for line in content.splitlines()[:3]:
                    if "path=" in line or "wrote" in line.lower() or "written" in line.lower():
                        path_hint = f" — {line[:200]}"
                        break
                return f"[smith] tool result: {name} — wrote {lines_count} lines, {char_count} chars{path_hint}\n"
            if name == "bash" or "bash" in str(name):
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

    # Tool error logger with model context tracking
    error_logger = ToolErrorLogger(db)
    model_context: list[dict[str, Any]] = [
        {"role": "user", "content": prompt[:2000]}
    ]

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
    agent = build_agent_with_handler(db, task_type=task_type, context_bundle=context, run_id=run_id, model_override=model_override, cancel_event=cancel_event, approval_handler=approval_handler, error_logger=error_logger, model_context=model_context)
    full = []
    started = False
    seen_progress: set[str] = set()
    try:
        # Build the input once
        # When in text tool mode, don't suppress reasoning/thinking — the model
        # needs to "think through" how to call tools.
        from .providers import _should_use_text_tools as _auto_text_mode, get_project_model_selection as _get_sel
        _sel = model_override or _get_sel(db, task_type)
        _text_mode = _auto_text_mode(_sel["model_id"])
        if _text_mode:
            _input = {"messages": [{"role": "user", "content": prompt}]}
        else:
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
        # Track the assistant response in model context for error debugging
        if final:
            model_context.append({"role": "assistant", "content": final[:2000]})
            # Detect model-side anomalies (raw tool-call text, placeholders, etc.)
            anomalies = detect_model_anomalies(final)
            for a in anomalies[:5]:
                error_logger.record_model_anomaly(
                    run_id=run_id,
                    assistant_text=final,
                    anomaly_type=a["type"],
                    details=a,
                )
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

