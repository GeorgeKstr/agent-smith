from __future__ import annotations

import json
import os
import socket
import threading
import time
from pathlib import Path
from typing import Any

import urllib.error
import urllib.request
import uvicorn
from fastapi import FastAPI
from fastapi.responses import FileResponse

REGISTRY_PORT = int(os.getenv("SMITH_REGISTRY_PORT", "8764"))
REGISTRY_HOST = os.getenv("SMITH_REGISTRY_HOST", "0.0.0.0")
REGISTRY_CONNECT_HOST = os.getenv("SMITH_REGISTRY_CONNECT_HOST", "127.0.0.1")
REGISTRY_URL = os.getenv("SMITH_REGISTRY_URL", f"http://{REGISTRY_CONNECT_HOST}:{REGISTRY_PORT}")
REGISTRY_DIR = Path(os.getenv("SMITH_REGISTRY_DIR", "~/.agent-smith")).expanduser()
REGISTRY_DB_JSON = REGISTRY_DIR / "registry.json"

_registry_thread: threading.Thread | None = None


def local_lan_ip() -> str:
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.connect(("8.8.8.8", 80))
        ip = sock.getsockname()[0]
        sock.close()
        return ip
    except Exception:
        return "127.0.0.1"


def registry_lan_url() -> str:
    return os.getenv("SMITH_REGISTRY_LAN_URL", f"http://{local_lan_ip()}:{REGISTRY_PORT}")



def load_agents() -> dict[str, dict[str, Any]]:
    REGISTRY_DIR.mkdir(parents=True, exist_ok=True)
    if not REGISTRY_DB_JSON.exists():
        return {}
    try:
        return json.loads(REGISTRY_DB_JSON.read_text(encoding="utf-8"))
    except Exception:
        return {}


def save_agents(agents: dict[str, dict[str, Any]]) -> None:
    REGISTRY_DIR.mkdir(parents=True, exist_ok=True)
    tmp = REGISTRY_DB_JSON.with_suffix(".tmp")
    tmp.write_text(json.dumps(agents, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp.replace(REGISTRY_DB_JSON)


def prune_agents(agents: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
    now = time.time()
    return {
        k: v for k, v in agents.items()
        if now - float(v.get("last_seen_ts", 0)) < 60 * 60 * 24
    }


registry_app = FastAPI(title="Agent Smith Registry")


@registry_app.get("/")
def registry_root():
    static_dir = Path(__file__).resolve().parent.parent / "static"
    return FileResponse(
        static_dir / "registry.html",
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            "Pragma": "no-cache",
            "Expires": "0",
        },
    )


@registry_app.get("/api/registry/info")
def registry_info():
    return {
        "ok": True,
        "name": "Agent Smith Registry",
        "registry_url": REGISTRY_URL,
        "registry_lan_url": registry_lan_url(),
        "bind_host": REGISTRY_HOST,
        "build_id": "v0.1.0",
    }


@registry_app.get("/api/registry/agents")
def registry_agents():
    agents = prune_agents(load_agents())
    save_agents(agents)
    return sorted(
        agents.values(),
        key=lambda a: (a.get("last_seen_ts", 0), a.get("title", "")),
        reverse=True,
    )


@registry_app.post("/api/registry/register")
def registry_register(payload: dict[str, Any]):
    agents = prune_agents(load_agents())
    project_id = str(payload.get("project_id") or "")
    if not project_id:
        return {"ok": False, "error": "missing project_id"}

    now = time.time()
    previous = agents.get(project_id, {})
    item = {
        "project_id": project_id,
        "title": payload.get("title") or payload.get("root_path") or project_id,
        "root_path": payload.get("root_path"),
        "url": payload.get("url"),
        "lan_url": payload.get("lan_url"),
        "port": payload.get("port"),
        "started_at": previous.get("started_at") or payload.get("started_at") or now,
        "last_seen_ts": now,
        "unread_count": int(previous.get("unread_count") or 0),
        "last_completed_ts": previous.get("last_completed_ts"),
        "last_event": previous.get("last_event"),
        "last_event_text": previous.get("last_event_text"),
    }
    agents[project_id] = item
    save_agents(agents)
    return {"ok": True, "agent": item, "count": len(agents)}


@registry_app.post("/api/registry/notify")
def registry_notify(payload: dict[str, Any]):
    agents = prune_agents(load_agents())
    project_id = str(payload.get("project_id") or "")
    if not project_id:
        return {"ok": False, "error": "missing project_id"}

    now = time.time()
    item = agents.get(project_id, {"project_id": project_id})
    item["title"] = payload.get("title") or item.get("title") or project_id
    item["root_path"] = payload.get("root_path") or item.get("root_path")
    item["url"] = payload.get("url") or item.get("url")
    item["lan_url"] = payload.get("lan_url") or item.get("lan_url")
    item["last_seen_ts"] = now
    item["last_completed_ts"] = now
    item["last_event"] = payload.get("event") or "task_completed"
    item["last_event_text"] = payload.get("text") or "Task completed"
    item["unread_count"] = int(item.get("unread_count") or 0) + 1
    agents[project_id] = item
    save_agents(agents)
    return {"ok": True, "agent": item}


@registry_app.delete("/api/registry/agents/{project_id}")
def registry_delete_agent(project_id: str):
    """Delete/remove an agent from the registry entirely."""
    agents = prune_agents(load_agents())
    if project_id not in agents:
        return {"ok": False, "error": "agent not found"}
    removed = agents.pop(project_id)
    save_agents(agents)
    return {"ok": True, "removed": removed.get("title", project_id), "count": len(agents)}


@registry_app.post("/api/registry/agents/{project_id}/read")
def registry_mark_read(project_id: str):
    agents = prune_agents(load_agents())
    item = agents.get(project_id)
    if not item:
        return {"ok": False, "error": "agent not found"}
    item["unread_count"] = 0
    item["last_read_ts"] = time.time()
    agents[project_id] = item
    save_agents(agents)
    return {"ok": True, "agent": item}


def notify_agent_event(
    project_id: str,
    root_path: str,
    event: str = "task_completed",
    text: str = "Task completed",
    title: str | None = None,
    serve_url: str | None = None,
    lan_url: str | None = None,
) -> dict[str, Any]:
    """Notify the registry that a Smith instance completed visible work."""
    if not registry_is_up():
        return {"ok": False, "error": "registry not up"}

    payload = {
        "project_id": project_id,
        "title": title or Path(root_path).name or project_id,
        "root_path": root_path,
        "event": event,
        "text": text,
        "url": serve_url,
        "lan_url": lan_url,
    }

    try:
        body = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            f"{REGISTRY_URL}/api/registry/notify",
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=1.0) as res:
            return json.loads(res.read().decode("utf-8", errors="replace"))
    except Exception as exc:
        return {"ok": False, "error": str(exc)}



def registry_is_up(url: str = REGISTRY_URL) -> bool:
    try:
        with urllib.request.urlopen(f"{url}/api/registry/info", timeout=0.6) as res:
            data = json.loads(res.read().decode("utf-8", errors="replace"))
            return bool(data.get("ok"))
    except Exception:
        return False


def start_registry_if_needed() -> bool:
    """Start embedded registry server if no registry is already reachable.

    Returns True if this process started the registry, False if an existing registry was found.
    """
    global _registry_thread
    if registry_is_up():
        return False
    if _registry_thread and _registry_thread.is_alive():
        return True

    def run():
        uvicorn.run(registry_app, host=REGISTRY_HOST, port=REGISTRY_PORT, log_level="warning")

    _registry_thread = threading.Thread(target=run, daemon=True)
    _registry_thread.start()

    # Give the thread a brief chance to bind before first registration.
    for _ in range(20):
        if registry_is_up():
            break
        time.sleep(0.1)
    return True


def register_agent(project_id: str, root_path: str, serve_host: str, serve_port: int, title: str | None = None) -> dict[str, Any]:
    started_registry = start_registry_if_needed()

    ip = local_lan_ip()
    public_host = "127.0.0.1" if serve_host in {"0.0.0.0", "::"} else serve_host
    url = f"http://{public_host}:{serve_port}"
    lan_url = f"http://{ip}:{serve_port}"

    payload = {
        "project_id": project_id,
        "title": title or Path(root_path).name or project_id,
        "root_path": root_path,
        "url": url,
        "lan_url": lan_url,
        "port": serve_port,
    }

    try:
        body = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            f"{REGISTRY_URL}/api/registry/register",
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=1.2) as res:
            data = json.loads(res.read().decode("utf-8", errors="replace"))
    except Exception as exc:
        data = {"ok": False, "error": str(exc)}

    return {
        "started_registry": started_registry,
        "registry_url": REGISTRY_URL,
        "registry_lan_url": registry_lan_url(),
        "agent_url": url,
        "agent_lan_url": lan_url,
        "registration": data,
    }
