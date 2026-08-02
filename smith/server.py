from __future__ import annotations

import os
import asyncio
import threading
import time
import base64
import mimetypes
import json
import difflib
from functools import lru_cache
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .agent import ApprovalHandler, ApprovalRequest, AutoApprovalHandler
from .coordinator import ProjectCoordinator
from .db import sha256_bytes
from .registry_server import notify_agent_event, REGISTRY_URL, registry_lan_url
from .providers import (
    list_providers,
    list_models,
    refresh_provider_models,
    set_project_default_model,
    set_project_task_model,
    get_project_model_selection,
)


def notify_registry_task_complete(*args, **kwargs):
    """Compatibility wrapper for older server call sites.

    Older builds called notify_registry_task_complete(event=..., text=..., ws=...).
    The registry module now exposes notify_agent_event(project_id, root_path, ...).
    """
    try:
        coord = coordinator()
        event = kwargs.get("event", "task_completed")
        text = kwargs.get("text", "Task completed")
        return notify_agent_event(
            project_id=coord.db.project_id,
            root_path=str(coord.db.root_path),
            event=event,
            text=text,
            title=coord.db.project_name,
        )
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


load_dotenv()

ACCESS_TOKEN = os.getenv("SMITH_ACCESS_TOKEN", "")
STATIC_DIR = Path(__file__).resolve().parent / "static"
PROJECT_ROOT = Path(os.getenv("SMITH_PROJECT_ROOT", ".")).expanduser().resolve()
BUILD_ID = "v0.1.0"

app = FastAPI(title="Agent Smith Per-Project LAN Control")


class RunRequest(BaseModel):
    prompt: str
    task_type: str | None = None
    review: str = "auto"


class FileWriteRequest(BaseModel):
    content: str


TEXT_EXTS = {
    ".py", ".js", ".jsx", ".ts", ".tsx", ".json", ".toml", ".yaml", ".yml", ".md",
    ".txt", ".css", ".html", ".sql", ".sh", ".env", ".ini", ".cfg", ".rs", ".go",
    ".java", ".kt", ".c", ".cpp", ".h", ".hpp", ".cs", ".php", ".rb",
}
IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp"}


def safe_project_path(rel_path: str) -> Path:
    root = coordinator().db.root_path
    candidate = (root / rel_path).resolve()
    if candidate == root or root in candidate.parents:
        return candidate
    raise HTTPException(status_code=400, detail="Path escapes project root")


def is_ignored_rel(path: Path) -> bool:
    ignored = {".git", ".agent-smith", "node_modules", "venv", ".venv", "__pycache__", "dist", "build"}
    return any(part in ignored for part in path.parts)


def file_kind(path: Path) -> str:
    if path.is_dir():
        return "directory"
    if path.suffix.lower() in IMAGE_EXTS:
        return "image"
    if path.suffix.lower() in TEXT_EXTS or path.name in {"README", "Dockerfile", ".env"}:
        return "text"
    return "binary"


def require_token(token: str | None):
    if ACCESS_TOKEN and token != ACCESS_TOKEN:
        raise HTTPException(status_code=401, detail="Invalid token")


@lru_cache(maxsize=1)
def coordinator() -> ProjectCoordinator:
    coord = ProjectCoordinator(PROJECT_ROOT)
    coord.start_worker()
    return coord


@app.get("/")
def root():
    return FileResponse(
        STATIC_DIR / "index.html",
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            "Pragma": "no-cache",
            "Expires": "0",
            "X-Agent-Smith-Build": BUILD_ID,
        },
    )


@app.get("/api/build-info")
def build_info():
    return {
        "build_id": BUILD_ID,
        "static_dir": str(STATIC_DIR),
        "project_root": str(PROJECT_ROOT),
        "registry_url": REGISTRY_URL,
        "registry_lan_url": registry_lan_url(),
    }


app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.get("/api/project/status")
def project_status(token: str | None = None):
    require_token(token)
    coord = coordinator()
    return {
        "project": {
            "id": coord.db.project_id,
            "name": coord.db.project_name,
            "root_path": str(coord.db.root_path),
            "db_path": str(coord.db.db_path),
        },
        "index": coord.db.get_index_status(),
        "recent_runs": coord.db.recent_runs(limit=10),
        "model_default": coord.db.get_setting("model.default"),
    }


@app.post("/api/project/index/start")
def index_start(token: str | None = None):
    require_token(token)
    coord = coordinator()
    job_id = coord.enqueue_scan()
    coord.resume_indexing()
    coord.start_worker()
    return {"queued": job_id}


@app.post("/api/project/index/pause")
def index_pause(token: str | None = None):
    require_token(token)
    coordinator().pause_indexing()
    return {"ok": True}


@app.post("/api/project/index/resume")
def index_resume(token: str | None = None):
    require_token(token)
    coord = coordinator()
    coord.resume_indexing()
    coord.start_worker()
    return {"ok": True}


@app.get("/api/project/index/files")
def index_files_api(q: str = "", status: str = "", limit: int = 120, token: str | None = None):
    """List indexed files with optional search q and status filter."""
    require_token(token)
    return coordinator().db.get_index_files(q=q, status_filter=status, limit=min(limit, 500))


@app.post("/api/project/index/file")
def index_file_api(path: str, token: str | None = None):
    require_token(token)
    coord = coordinator()
    job_id = coord.enqueue_index_file(path, priority=1)
    coord.start_worker()
    return {"queued": job_id}



@app.get("/api/project/files/tree")
def project_files_tree(path: str = "", q: str = "", token: str | None = None):
    """List files/folders under the selected project.

    Kept deliberately bounded so large projects do not make the UI appear to hang.
    """
    require_token(token)
    root = coordinator().db.root_path
    q = (q or "").strip().lower()
    rel = (path or "").strip().strip("/")
    base = safe_project_path(rel)

    if not base.exists():
        raise HTTPException(status_code=404, detail=f"Path not found: {rel or '/'}")
    if not base.is_dir():
        raise HTTPException(status_code=400, detail=f"Not a directory: {rel}")

    items: list[dict[str, Any]] = []
    max_items = 500

    try:
        if q:
            # Bounded search from project root. Avoid deep/full-tree scans hanging the UI.
            count = 0
            for p in root.rglob("*"):
                try:
                    rp = p.relative_to(root)
                except Exception:
                    continue
                if is_ignored_rel(rp):
                    continue
                if q not in str(rp).lower():
                    continue
                items.append({
                    "name": p.name,
                    "path": str(rp),
                    "type": file_kind(p),
                })
                count += 1
                if count >= max_items:
                    break
        else:
            children = []
            for child in base.iterdir():
                try:
                    rp = child.relative_to(root)
                except Exception:
                    continue
                if is_ignored_rel(rp):
                    continue
                children.append(child)

            children.sort(key=lambda p: (not p.is_dir(), p.name.lower()))
            for child in children[:max_items]:
                rp = child.relative_to(root)
                items.append({
                    "name": child.name,
                    "path": str(rp),
                    "type": file_kind(child),
                })
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=f"Permission denied: {exc}") from exc
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Could not list directory: {exc}") from exc

    return {
        "path": "" if base == root else str(base.relative_to(root)),
        "items": items,
        "truncated": len(items) >= max_items,
    }


@app.get("/api/project/files/{path:path}/read")
def project_file_read(path: str, token: str | None = None):
    require_token(token)
    full = safe_project_path(path)
    if not full.exists():
        raise HTTPException(status_code=404, detail="File not found")
    if full.is_dir():
        raise HTTPException(status_code=400, detail="Path is a directory")

    kind = file_kind(full)
    rel = str(full.relative_to(coordinator().db.root_path))
    summary = coordinator().db.get_file_summary(rel)

    if kind == "text":
        try:
            content = full.read_text(encoding="utf-8", errors="replace")
        except OSError as exc:
            raise HTTPException(status_code=500, detail=f"Could not read file: {exc}") from exc
        return {
            "path": rel,
            "type": "text",
            "content": content,
            "summary": summary,
        }

    return {
        "path": rel,
        "type": kind,
        "content": "",
        "summary": summary,
    }


@app.get("/api/project/files/{path:path}/image")
def project_file_image(path: str, token: str | None = None):
    require_token(token)
    full = safe_project_path(path)
    if not full.exists() or not full.is_file():
        raise HTTPException(status_code=404, detail="Image not found")
    if file_kind(full) != "image":
        raise HTTPException(status_code=400, detail="Not an image file")
    media_type = mimetypes.guess_type(str(full))[0] or "application/octet-stream"
    return FileResponse(str(full), media_type=media_type)


@app.post("/api/project/files/{path:path}/write")
def project_file_write(path: str, req: FileWriteRequest, token: str | None = None):
    require_token(token)
    coord = coordinator()
    full = safe_project_path(path)
    if full.exists() and full.is_dir():
        raise HTTPException(status_code=400, detail="Path is a directory")
    try:
        full.parent.mkdir(parents=True, exist_ok=True)
        old_text = full.read_text(encoding="utf-8", errors="replace") if full.exists() else ""
        old_bytes = old_text.encode("utf-8")
        full.write_text(req.content, encoding="utf-8")
        new_bytes = full.read_bytes()
        rel = str(full.relative_to(coord.db.root_path))
        diff_text = "\n".join(difflib.unified_diff(
            old_text.splitlines(),
            req.content.splitlines(),
            fromfile=f"a/{rel}",
            tofile=f"b/{rel}",
            lineterm="",
        ))
        with coord.db.connect() as con:
            con.execute(
                """
                INSERT INTO file_changes(run_id, project_id, path, change_type, before_sha256, after_sha256, diff_text)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    "manual_file_editor",
                    coord.db.project_id,
                    rel,
                    "edit" if old_text else "create",
                    sha256_bytes(old_bytes) if old_text else None,
                    sha256_bytes(new_bytes),
                    diff_text,
                ),
            )
        return {"ok": True, "path": rel, "bytes": len(new_bytes)}
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Could not write file: {exc}") from exc



@app.get("/api/project/files/{path:path}/summary")
def file_summary(path: str, token: str | None = None):
    require_token(token)
    row = coordinator().db.get_file_summary(path)
    if not row:
        raise HTTPException(status_code=404, detail="No summary for file")
    return row


@app.get("/api/providers")
def providers_api(token: str | None = None):
    require_token(token)
    return list_providers()


@app.get("/api/providers/{provider_id}/models")
def provider_models_api(provider_id: str, refresh: bool = False, token: str | None = None):
    require_token(token)
    return list_models(provider_id, refresh=refresh)


@app.post("/api/providers/{provider_id}/refresh-models")
def refresh_models_api(provider_id: str, token: str | None = None):
    require_token(token)
    return {"models": refresh_provider_models(provider_id)}


@app.post("/api/models/default")
def set_default_model_api(provider_id: str, model_id: str, token: str | None = None):
    require_token(token)
    set_project_default_model(coordinator().db, provider_id, model_id)
    return {"ok": True}


@app.post("/api/models/task")
def set_task_model_api(task_type: str, provider_id: str, model_id: str, token: str | None = None):
    require_token(token)
    set_project_task_model(coordinator().db, task_type, provider_id, model_id)
    return {"ok": True}


@app.get("/api/models/selection")
def model_selection_api(task_type: str = "ask", token: str | None = None):
    require_token(token)
    return get_project_model_selection(coordinator().db, task_type)



def _json_loads_safe(value: str | None, default: Any = None) -> Any:
    try:
        return json.loads(value or "")
    except Exception:
        return default


def _change_stats_from_text(before_text: str, after_text: str, path: str) -> dict[str, Any]:
    diff_lines = list(difflib.unified_diff(
        before_text.splitlines(),
        after_text.splitlines(),
        fromfile=f"{path}.before",
        tofile=path,
        lineterm="",
    ))
    added = sum(1 for line in diff_lines if line.startswith("+") and not line.startswith("+++"))
    removed = sum(1 for line in diff_lines if line.startswith("-") and not line.startswith("---"))
    return {
        "lines_added": added,
        "lines_removed": removed,
        "diff_preview": "\n".join(diff_lines[:220]),
    }


def _enrich_change(row: dict[str, Any], db) -> dict[str, Any]:
    meta = _json_loads_safe(row.get("diff_text"), {}) or {}
    path = row.get("path") or ""
    enriched = dict(row)
    enriched["meta"] = meta

    added = meta.get("lines_added")
    removed = meta.get("lines_removed")
    diff_preview = meta.get("diff_preview")

    if added is None or removed is None:
        try:
            backup_rel = meta.get("backup_path")
            before_exists = bool(meta.get("before_exists"))
            before_text = ""
            if before_exists and backup_rel:
                backup_path = (db.smith_dir / backup_rel).resolve()
                if backup_path.exists():
                    before_text = backup_path.read_text(encoding="utf-8", errors="replace")
            target = (db.root_path / path).resolve()
            after_text = target.read_text(encoding="utf-8", errors="replace") if target.exists() and target.is_file() else ""
            stats = _change_stats_from_text(before_text, after_text, path)
            added = stats["lines_added"]
            removed = stats["lines_removed"]
            diff_preview = diff_preview or stats["diff_preview"]
        except Exception:
            added = added if added is not None else None
            removed = removed if removed is not None else None

    enriched["lines_added"] = added
    enriched["lines_removed"] = removed
    enriched["diff_preview"] = diff_preview or ""
    return enriched


def _run_changes_detailed(db, run_id: str) -> list[dict[str, Any]]:
    return [_enrich_change(ch, db) for ch in db.get_run_changes(run_id)]


@app.get("/api/project/changes")
def project_changes(token: str | None = None):
    require_token(token)
    return coordinator().db.recent_file_changes(limit=30)



@app.get("/api/project/changes/detailed")
def project_changes_detailed(limit: int = 30, token: str | None = None):
    require_token(token)
    coord = coordinator()
    db = coord.db
    limit = max(1, min(limit, 100))
    with db.connect() as con:
        rows = con.execute(
            """
            SELECT fc.*, r.user_prompt, r.started_at, r.ended_at, r.status AS run_status,
                   coalesce(d.status, 'pending') AS decision_status
            FROM file_changes fc
            JOIN runs r ON r.id=fc.run_id
            LEFT JOIN run_change_decisions d ON d.run_id=fc.run_id
            WHERE fc.project_id=?
            ORDER BY fc.created_at DESC
            LIMIT ?
            """,
            (db.project_id, limit),
        ).fetchall()

    groups: dict[str, dict[str, Any]] = {}
    for raw in rows:
        ch = _enrich_change(dict(raw), db)
        run_id = ch["run_id"]
        group = groups.setdefault(run_id, {
            "run_id": run_id,
            "user_prompt": ch.get("user_prompt"),
            "started_at": ch.get("started_at"),
            "ended_at": ch.get("ended_at"),
            "run_status": ch.get("run_status"),
            "decision_status": ch.get("decision_status") or "pending",
            "changes": [],
            "files": [],
            "lines_added": 0,
            "lines_removed": 0,
        })
        group["changes"].append(ch)
        if ch.get("path") not in group["files"]:
            group["files"].append(ch.get("path"))
        if isinstance(ch.get("lines_added"), int):
            group["lines_added"] += ch["lines_added"]
        if isinstance(ch.get("lines_removed"), int):
            group["lines_removed"] += ch["lines_removed"]

    return list(groups.values())



@app.get("/api/project/activity")
def project_activity(limit: int = 200, token: str | None = None):
    """Return a chronological activity log — tasks, tool calls, file edits,
    command runs, and summaries — formatted for easy reading/copying."""
    require_token(token)
    coord = coordinator()
    db = coord.db
    limit = max(1, min(limit, 500))
    entries: list[dict[str, Any]] = []

    with db.connect() as con:
        con.row_factory = lambda cursor, row: dict(
            zip([col[0] for col in cursor.description], row)
        )

        # ── Runs (tasks) ──────────────────────────────────────────
        runs = con.execute(
            """SELECT id, task_type, status, user_prompt, final_summary,
                      started_at, ended_at
               FROM runs WHERE project_id=?
               ORDER BY started_at ASC""",
            (db.project_id,),
        ).fetchall()

        for r in runs:
            entries.append({
                "ts": r["started_at"] or "",
                "type": "task_started",
                "run_id": r["id"],
                "text": f"Task [{r['task_type']}]: {(r['user_prompt'] or '')[:200]}",
                "meta": {"task_type": r["task_type"], "status": r["status"]},
            })

        # ── Tool calls (from events) ──────────────────────────────
        tool_events = con.execute(
            """SELECT e.created_at, e.run_id, e.type, e.payload_json
               FROM events e
               WHERE e.project_id=?
                 AND e.type IN ('tool_run_command','tool_write_file','tool_edit_file',
                                'tool_read_file','tool_list_files','tool_grep_search',
                                'tool_find_files','tool_fetch','tool_docs','tool_note')
               ORDER BY e.id ASC""",
            (db.project_id,),
        ).fetchall()

        for ev in tool_events:
            payload = _json_loads_safe(ev["payload_json"], {})
            run_id = ev["run_id"]
            ts = ev["created_at"] or ""

            if ev["type"] == "tool_run_command":
                cmd = payload.get("command", "?")[:120]
                exit_code = payload.get("exit_code")
                entries.append({
                    "ts": ts, "type": "bash", "run_id": run_id,
                    "text": f"$ {cmd}" if exit_code == 0 else f"$ {cmd} [exit={exit_code}]",
                })
            elif ev["type"] in ("tool_write_file", "tool_edit_file"):
                path = payload.get("path", "?")
                is_edit = ev["type"] == "tool_edit_file"
                edits = payload.get("edits", 1) if is_edit else 1
                action = f"{edits} surgical edit(s)" if is_edit else "wrote"
                entries.append({
                    "ts": ts, "type": "file_write", "run_id": run_id,
                    "text": f"✏️ {action} → {path}",
                })
            elif ev["type"] == "tool_read_file":
                path = payload.get("path", "?")
                chars = payload.get("chars", 0)
                entries.append({
                    "ts": ts, "type": "file_read", "run_id": run_id,
                    "text": f"📖 read {path} ({chars} chars)",
                })
            elif ev["type"] == "tool_list_files":
                entries.append({
                    "ts": ts, "type": "ls", "run_id": run_id,
                    "text": f"📂 ls {payload.get('path', '.')} ({payload.get('count', 0)} entries)",
                })
            elif ev["type"] == "tool_note":
                entries.append({
                    "ts": ts, "type": "note", "run_id": run_id,
                    "text": f"📝 note: {payload.get('title', '?')} ({payload.get('chars', 0)} chars)",
                })
            else:
                entries.append({
                    "ts": ts, "type": ev["type"].replace("tool_", ""), "run_id": run_id,
                    "text": json.dumps(payload)[:150] if payload else ev["type"],
                })

        # ── Task completions ──────────────────────────────────────
        for r in runs:
            if r["final_summary"] and r["status"] in ("done", "interrupted"):
                summary = r["final_summary"].strip()[:300]
                entries.append({
                    "ts": r["ended_at"] or "",
                    "type": "task_finished",
                    "run_id": r["id"],
                    "text": f"{'✅' if r['status'] == 'done' else '⚠️'} {summary}",
                    "meta": {"status": r["status"]},
                })

    # ── Sort chronologically ───────────────────────────────────────
    entries.sort(key=lambda e: e["ts"])
    entries = entries[-limit:]

    return {"entries": entries, "total": len(entries)}


@app.get("/api/project/errors")
def project_errors(limit: int = 50, token: str | None = None):
    """Return recent tool-level errors."""
    require_token(token)
    coord = coordinator()
    db = coord.db
    limit = max(1, min(limit, 200))

    with db.connect() as con:
        con.row_factory = lambda cursor, row: dict(
            zip([col[0] for col in cursor.description], row)
        )
        rows = con.execute(
            """SELECT ts, type, payload_json
               FROM events WHERE project_id=? AND type LIKE '%error%'
               ORDER BY id DESC LIMIT ?""",
            (db.project_id, limit),
        ).fetchall()

    results = []
    for r in rows:
        payload = _json_loads_safe(r.get("payload_json") or "{}", {})
        results.append({
            "ts": r["ts"] or "",
            "type": r["type"],
            "error": payload.get("error") or payload.get("message") or str(payload)[:300],
        })
    return results


@app.get("/api/project/skeletal-context")
def skeletal_context(token: str | None = None):
    """Return the project's skeletal context graph."""
    require_token(token)
    coord = coordinator()
    items = coord.db.list_context_items(kinds=["skeletal_context"], limit=1)
    if items:
        item = items[0]
        return {
            "exists": True,
            "content": item["content"],
            "updated_at": item.get("updated_at") or item.get("created_at"),
        }
    return {"exists": False, "content": ""}


@app.post("/api/project/sudo-password")
def set_sudo_password(data: dict[str, Any], token: str | None = None):
    """Set the sudo password for the current server session."""
    require_token(token)
    pw = (data.get("password") or "").strip()
    if pw:
        os.environ["SMITH_SUDO_PASSWORD"] = pw
        return {"ok": True}
    os.environ.pop("SMITH_SUDO_PASSWORD", None)
    return {"ok": True, "cleared": True}


@app.post("/api/project/skeletal-context/delete")
def skeletal_context_delete(token: str | None = None):
    """Delete the project's skeletal context so it can be regenerated."""
    require_token(token)
    coord = coordinator()
    items = coord.db.list_context_items(kinds=["skeletal_context"], limit=1)
    if items:
        with coord.db.connect() as con:
            con.execute("DELETE FROM context_items WHERE id=?", (items[0]["id"],))
        return {"deleted": True}
    return {"deleted": False}


@app.get("/api/project/runs")
def project_runs(limit: int = 20, offset: int = 0, token: str | None = None):
    require_token(token)
    coord = coordinator()
    db = coord.db
    limit = max(1, min(limit, 100))
    offset = max(0, offset)
    with db.connect() as con:
        rows = con.execute(
            """
            SELECT * FROM runs
            WHERE project_id=?
            ORDER BY started_at DESC
            LIMIT ? OFFSET ?
            """,
            (db.project_id, limit, offset),
        ).fetchall()
    return {"runs": [dict(r) for r in rows]}


@app.delete("/api/project/runs/{run_id}")
def delete_project_run(run_id: str, token: str | None = None):
    require_token(token)
    coord = coordinator()
    db = coord.db
    with db.connect() as con:
        run = con.execute(
            "SELECT id FROM runs WHERE project_id=? AND id=?",
            (db.project_id, run_id),
        ).fetchone()
        if not run:
            raise HTTPException(status_code=404, detail="Run not found")

        # Delete run metadata/thread only. This intentionally does not revert file
        # changes; use Revert for that. Backups remain on disk for safety.
        for table in [
            "events",
            "tool_calls",
            "file_changes",
            "task_summaries",
            "run_change_decisions",
            "approvals",
            "project_context_snapshots",
        ]:
            try:
                con.execute(f"DELETE FROM {table} WHERE run_id=? AND project_id=?", (run_id, db.project_id))
            except Exception:
                try:
                    con.execute(f"DELETE FROM {table} WHERE run_id=?", (run_id,))
                except Exception:
                    pass

        # Remove context items directly sourced by this run, but keep general file summaries.
        try:
            con.execute(
                "DELETE FROM context_items WHERE project_id=? AND source_run_id=?",
                (db.project_id, run_id),
            )
        except Exception:
            pass

        con.execute("DELETE FROM runs WHERE project_id=? AND id=?", (db.project_id, run_id))

    return {"ok": True, "deleted_run_id": run_id}


@app.get("/api/project/runs/{run_id}")
def project_run_detail(run_id: str, token: str | None = None):
    require_token(token)
    coord = coordinator()
    db = coord.db
    with db.connect() as con:
        run = con.execute(
            "SELECT * FROM runs WHERE project_id=? AND id=?",
            (db.project_id, run_id),
        ).fetchone()
        if not run:
            raise HTTPException(status_code=404, detail="Run not found")

        event_cols = {
            row["name"]
            for row in con.execute("PRAGMA table_info(events)").fetchall()
        }
        time_col = "created_at" if "created_at" in event_cols else ("ts" if "ts" in event_cols else None)
        base_cols = ["id", "type", "actor", "payload_json"]
        select_cols = [c for c in base_cols if c in event_cols]
        if time_col:
            select_sql = ", ".join(select_cols + [f"{time_col} AS created_at"])
        else:
            select_sql = ", ".join(select_cols + ["NULL AS created_at"])

        events = []
        if select_cols:
            events = con.execute(
                f"SELECT {select_sql} FROM events WHERE project_id=? AND run_id=? ORDER BY id ASC",
                (db.project_id, run_id),
            ).fetchall()

    return {
        "run": dict(run),
        "events": [dict(e) for e in events],
        "changes": _run_changes_detailed(db, run_id),
    }


@app.post("/api/project/runs/{run_id}/accept")
def accept_run_changes(run_id: str, token: str | None = None):
    require_token(token)
    coordinator().db.mark_run_changes(run_id, "accepted", "Accepted from UI/API")
    return {"ok": True, "run_id": run_id, "status": "accepted"}


@app.post("/api/project/runs/{run_id}/revert")
def revert_run_changes(run_id: str, token: str | None = None):
    require_token(token)
    result = coordinator().db.revert_run_changes(run_id)
    return result


class WebSocketApprovalHandler(ApprovalHandler):
    """Approval handler that communicates with the caller via WebSocket.

    The agent tool thread calls request_approval() (blocking).
    We bridge to the async WS world through a queue:
    1. request_approval() enqueues the request + blocks on threading.Event
    2. The async poll loop picks it up, sends WS message, waits for user reply
    3. On reply, it signals the event → thread unblocks
    """

    def __init__(self, loop: asyncio.AbstractEventLoop):
        self._loop = loop
        self._queue: asyncio.Queue[ApprovalRequest] = asyncio.Queue()
        self._pending: dict[str, asyncio.Future] = {}  # request id → future resolved by WS message
        self._counter = 0

    def ready(self) -> bool:
        return True

    def request_approval(self, req: ApprovalRequest) -> bool:
        """Block the tool thread until the user responds via WS."""
        self._counter += 1
        req_id = str(self._counter)
        # Create a future on the event loop that the async side will resolve
        fut: asyncio.Future = asyncio.run_coroutine_threadsafe(
            self._send_and_wait(req, req_id), self._loop
        ).result()

        try:
            approved = fut.result(timeout=300)  # 5 min timeout
            if approved:
                req.approve()
            else:
                req.deny("User denied the command via Web UI")
            return approved
        except Exception:
            req.deny("Approval timed out or connection lost")
            return False

    async def _send_and_wait(self, req: ApprovalRequest, req_id: str) -> bool:
        """Async side: enqueue the request so the WS handler can pick it up."""
        await self._queue.put(req)
        # We need a way to get the result back. Use a future stored on the
        # ApprovalRequest itself (we'll add a private attribute).
        fut: asyncio.Future = asyncio.get_running_loop().create_future()
        req._ws_future = fut  # type: ignore[attr-defined]
        return await fut

    async def poll(self, ws: WebSocket) -> None:
        """Called from ws_run: poll for pending approvals, send WS messages,
        and wait for user responses.
        """
        while True:
            req = await self._queue.get()
            display = req.display[:2000]
            await ws.send_json({
                "type": "approval_required",
                "command": req.command,
                "display": display,
            })
            # Wait for the user's approve/deny message
            try:
                msg = await ws.receive_json()
                approved = msg.get("approve", False)
                if hasattr(req, '_ws_future'):
                    fut: asyncio.Future = req._ws_future  # type: ignore[assignment]
                    if not fut.done():
                        fut.set_result(approved)
            except Exception:
                if hasattr(req, '_ws_future'):
                    fut = req._ws_future  # type: ignore[assignment]
                    if not fut.done():
                        fut.set_result(False)


async def stream_sync_generator_to_ws(ws: WebSocket, generator, cancel_event: threading.Event | None = None):
    import time as _smith_time
    """Run a blocking sync generator in a thread and forward chunks in real time.

    Sends heartbeat events while the local model/tool loop is quiet so the UI can
    distinguish an active run from a frozen one.
    """
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue = asyncio.Queue()
    started = _smith_time.time()
    heartbeat_count = 0

    def worker():
        try:
            for chunk in generator:
                if cancel_event is not None and cancel_event.is_set():
                    break
                loop.call_soon_threadsafe(queue.put_nowait, ("chunk", chunk))
            loop.call_soon_threadsafe(queue.put_nowait, ("done", None))
        except Exception as exc:
            loop.call_soon_threadsafe(queue.put_nowait, ("error", str(exc)))

    thread = threading.Thread(target=worker, daemon=True)
    thread.start()

    while True:
        try:
            kind, payload = await asyncio.wait_for(queue.get(), timeout=2.0)
        except asyncio.TimeoutError:
            if cancel_event is not None and cancel_event.is_set():
                # Cancel was requested but generator is still blocked (model in inference).
                # Wait up to 3 more heartbeats (=6s), then force-close the generator.
                for _ in range(3):
                    try:
                        await asyncio.wait_for(queue.get(), timeout=2.0)
                        # Got a chunk — let normal processing handle it
                        kind, payload = "chunk", queue.get_nowait()
                        break
                    except asyncio.TimeoutError:
                        if cancel_event is not None and cancel_event.is_set():
                            continue
                    except Exception:
                        pass
                else:
                    # Force-close the generator — GeneratorExit will be raised inside
                    try:
                        generator.close()
                    except Exception:
                        pass
                return
            heartbeat_count += 1
            msg = "processing"
            try:
                await ws.send_json({
                    "type": "heartbeat",
                    "elapsed": round(_smith_time.time() - started, 1),
                    "count": heartbeat_count,
                    "message": msg,
                })
            except Exception:
                if cancel_event is not None:
                    cancel_event.set()
                return
            continue

        if kind == "chunk":
            try:
                await ws.send_json({"type": "token", "text": payload})
            except Exception:
                if cancel_event is not None:
                    cancel_event.set()
                return
        elif kind == "error":
            await ws.send_json({"type": "error", "message": payload})
            return
        elif kind == "done":
            return


@app.websocket("/ws/run")
async def ws_run(ws: WebSocket):
    await ws.accept()

    async def safe_send(payload: dict) -> bool:
        """Send a JSON message, tolerating a client that already closed."""
        try:
            await ws.send_json(payload)
            return True
        except (RuntimeError, WebSocketDisconnect):
            return False

    try:
        first = await ws.receive_json()
        token = first.get("token")
        if ACCESS_TOKEN and token != ACCESS_TOKEN:
            await safe_send({"type": "error", "message": "Invalid token"})
            await ws.close()
            return

        prompt = first["prompt"]
        task_type = first.get("task_type")
        review = first.get("review", "auto")
        model_override = None
        review_model_override = None
        if first.get("provider_id") and first.get("model_id"):
            model_override = {"provider_id": first["provider_id"], "model_id": first["model_id"]}
        if first.get("review_provider_id") and first.get("review_model_id"):
            review_model_override = {"provider_id": first["review_provider_id"], "model_id": first["review_model_id"]}
        coord = coordinator()
        cancel_event = threading.Event()

        # Set up approval handler — respect auto_approve flag from client
        approval_task = None
        auto_approve = first.get("auto_approve", False)
        if auto_approve:
            from .agent import AutoApprovalHandler
            approval_handler = AutoApprovalHandler()
        else:
            loop = asyncio.get_running_loop()
            approval_handler = WebSocketApprovalHandler(loop)
            approval_task = asyncio.create_task(approval_handler.poll(ws))

        await safe_send({"type": "started", "project_id": coord.db.project_id})
        gen = coord.stream_user_task(
            prompt,
            task_type=task_type,
            review_mode=review,
            model_override=model_override,
            review_model_override=review_model_override,
            cancel_event=cancel_event,
            approval_handler=approval_handler,
        )
        await stream_sync_generator_to_ws(ws, gen, cancel_event=cancel_event)
        notify_registry_task_complete(
            event="task_completed",
            text=f"{task_type or 'auto'} prompt completed",
            ws=ws,
        )
        await safe_send({"type": "done"})
    except WebSocketDisconnect:
        try:
            cancel_event.set()
        except Exception:
            pass
        return
    except Exception as exc:
        # Client may have already closed — never raise from the error send.
        await safe_send({"type": "error", "message": str(exc)})
    finally:
        if approval_task is not None:
            try:
                approval_task.cancel()
            except Exception:
                pass


@app.websocket("/ws/events")
async def ws_events(ws: WebSocket):
    await ws.accept()
    try:
        while True:
            coord = coordinator()
            await ws.send_json({"type": "index_status", "data": coord.db.get_index_status()})
            import asyncio
            await asyncio.sleep(1.5)
    except WebSocketDisconnect:
        try:
            cancel_event.set()
        except Exception:
            pass
        return
