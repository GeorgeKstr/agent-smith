from __future__ import annotations

import os
import socket
import webbrowser
import time
import threading
from pathlib import Path

import typer
import uvicorn
from dotenv import load_dotenv
from rich.console import Console
from rich.table import Table

from .agent import smith_recursion_limit, ApprovalHandler, ApprovalRequest, AutoApprovalHandler
from .coordinator import ProjectCoordinator
from .db import ProjectDB
from .registry_server import register_agent, start_registry_if_needed, REGISTRY_URL
from .compaction import CompactionEngine, auto_compact_run
from .sandbox import get_sandbox_backend, DockerSandboxBackend, DirectSandboxBackend
from .providers import (
    list_providers,
    list_models,
    refresh_provider_models,
    set_project_default_model,
    set_project_task_model,
)


load_dotenv()

app = typer.Typer(help="Agent Smith per-project local coordinator.")
console = Console()


class CLIApprovalHandler(ApprovalHandler):
    """Approval handler that prompts the user interactively on stdin."""

    def __init__(self):
        self._connected = True

    def ready(self) -> bool:
        return self._connected

    def request_approval(self, req: ApprovalRequest) -> bool:
        console.print()
        console.print("[bold yellow]⚠ Command needs approval:[/bold yellow]")
        console.print(f"  [cyan]{req.display}[/cyan]")
        try:
            answer = input("  Approve? [y/N]: ").strip().lower()
        except (EOFError, KeyboardInterrupt):
            self._connected = False
            req.deny("CLI input closed")
            return False
        if answer in ("y", "yes"):
            req.approve()
            console.print("  [green]✓ Approved[/green]")
            return True
        else:
            req.deny("User denied")
            console.print("  [red]✗ Denied[/red]")
            return False


def project_db(path: str) -> ProjectDB:
    db = ProjectDB(path)
    db.init()
    return db


@app.command()
def init(
    path: str = typer.Argument(".", help="Project root path."),
):
    """Initialize .agent-smith/smith.db for a project."""
    db = project_db(path)
    console.print(f"[green]Initialized[/green] {db.db_path}")


@app.command()
def providers():
    """List hardcoded providers."""
    table = Table(title="Hardcoded Providers")
    table.add_column("ID")
    table.add_column("Name")
    table.add_column("Base URL")
    table.add_column("Default model")
    table.add_column("Enabled")
    for p in list_providers():
        table.add_row(p["id"], p["name"], p["base_url"], p["default_model"], "yes" if p["enabled"] else "no")
    console.print(table)


@app.command("refresh-models")
def refresh_models(
    provider_id: str = typer.Argument("lmstudio", help="Provider ID, e.g. lmstudio."),
):
    """Refresh provider models from /v1/models. This is in-memory only."""
    models = refresh_provider_models(provider_id)
    table = Table(title=f"Models from {provider_id}")
    table.add_column("Model")
    table.add_column("Owned by")
    for m in models:
        table.add_row(m["model_id"], str(m.get("owned_by") or ""))
    console.print(table)


@app.command()
def models(
    provider_id: str = typer.Argument("lmstudio", help="Provider ID, e.g. lmstudio."),
    refresh: bool = typer.Option(False, "--refresh", help="Refresh from provider before listing."),
):
    """List models for a hardcoded provider."""
    rows = list_models(provider_id, refresh=refresh)
    table = Table(title=f"Models: {provider_id}")
    table.add_column("Model")
    table.add_column("Owned by")
    table.add_column("Note")
    for m in rows:
        table.add_row(m["model_id"], str(m.get("owned_by") or ""), str(m.get("error") or ""))
    console.print(table)


@app.command("set-default-model")
def set_default_model(
    project: str = typer.Argument(..., help="Project root path."),
    provider_id: str = typer.Argument(..., help="Provider ID."),
    model_id: str = typer.Argument(..., help="Model ID."),
):
    """Store the selected default model in this project's smith.db."""
    db = project_db(project)
    set_project_default_model(db, provider_id, model_id)
    console.print(f"[green]Project default model set[/green] {provider_id}/{model_id}")


@app.command("set-task-model")
def set_task_model(
    project: str = typer.Argument(..., help="Project root path."),
    task_type: str = typer.Argument(..., help="Task profile, e.g. ask/implement/review."),
    provider_id: str = typer.Argument(..., help="Provider ID."),
    model_id: str = typer.Argument(..., help="Model ID."),
):
    """Store a task-specific model in this project's smith.db."""
    db = project_db(project)
    set_project_task_model(db, task_type, provider_id, model_id)
    console.print(f"[green]Project task model set[/green] {task_type} → {provider_id}/{model_id}")


@app.command()
def bash_allow(
    project: str = typer.Argument(".", help="Project root path."),
    command: str = typer.Argument(..., help="Command executable to allow (e.g. git, curl, cargo)."),
):
    """Add a command to the bash allowlist so Smith can run it."""
    db = project_db(project)
    current = db.get_setting("bash.allowed_commands", [])
    if not isinstance(current, list):
        current = []
    if command in current:
        console.print(f"[yellow]Already allowed: {command}[/yellow]")
        return
    current.append(command)
    db.set_setting("bash.allowed_commands", current)
    console.print(f"[green]Allowed[/green] {command}")
    console.print(f"Now allowed: {', '.join(sorted(current))}")


@app.command()
def bash_disallow(
    project: str = typer.Argument(".", help="Project root path."),
    command: str = typer.Argument(..., help="Command executable to disallow."),
):
    """Remove a command from the bash allowlist."""
    db = project_db(project)
    current = db.get_setting("bash.allowed_commands", [])
    if not isinstance(current, list) or command not in current:
        console.print(f"[yellow]Not in allowlist: {command}[/yellow]")
        return
    current.remove(command)
    db.set_setting("bash.allowed_commands", current)
    console.print(f"[red]Disallowed[/red] {command}")
    console.print(f"Now allowed: {', '.join(sorted(current)) if current else '(none)'}")


@app.command()
def bash_block(
    project: str = typer.Argument(".", help="Project root path."),
    arg: str = typer.Argument(..., help="Argument to block (e.g. install, delete)."),
):
    """Add an argument to the bash blocklist."""
    db = project_db(project)
    current = db.get_setting("bash.blocked_args", [])
    if not isinstance(current, list):
        current = []
    if arg in current:
        console.print(f"[yellow]Already blocked: {arg}[/yellow]")
        return
    current.append(arg)
    db.set_setting("bash.blocked_args", current)
    console.print(f"[red]Blocked[/red] argument: {arg}")


@app.command()
def bash_unblock(
    project: str = typer.Argument(".", help="Project root path."),
    arg: str = typer.Argument(..., help="Argument to unblock."),
):
    """Remove an argument from the bash blocklist."""
    db = project_db(project)
    current = db.get_setting("bash.blocked_args", [])
    if not isinstance(current, list) or arg not in current:
        console.print(f"[yellow]Not blocked: {arg}[/yellow]")
        return
    current.remove(arg)
    db.set_setting("bash.blocked_args", current)
    console.print(f"[green]Unblocked[/green] argument: {arg}")


@app.command()
def bash_config(
    project: str = typer.Argument(".", help="Project root path."),
):
    """Show current bash configuration (allowed commands and blocked args)."""
    db = project_db(project)

    allowed = db.get_setting("bash.allowed_commands", None)
    if not allowed:
        from smith.agent import ALLOWED_COMMANDS
        allowed = sorted(ALLOWED_COMMANDS)
    else:
        allowed = sorted(allowed)

    blocked = db.get_setting("bash.blocked_args", None)
    if not blocked:
        from smith.agent import BLOCKED_ARGS
        blocked = sorted(BLOCKED_ARGS)
    else:
        blocked = sorted(blocked)

    table = Table(title=f"Bash Configuration — {project}")
    table.add_column("Setting")
    table.add_column("Value")
    table.add_row("Allowed commands", ", ".join(allowed) if allowed else "(none)")
    table.add_row("Blocked args", ", ".join(blocked) if blocked else "(none)")
    table.add_row("SMITH_ALLOWED_COMMANDS env", os.getenv("SMITH_ALLOWED_COMMANDS", "(not set)"))
    table.add_row("SMITH_BLOCKED_ARGS env", os.getenv("SMITH_BLOCKED_ARGS", "(not set)"))
    console.print(table)
    console.print("\n[yellow]Note:[/yellow] DB settings override env vars. Env vars override hardcoded defaults.")


@app.command()
def compact(
    project: str = typer.Argument(".", help="Project root path."),
    run_id: str | None = typer.Option(None, "--run-id", help="Compact a specific run (default: latest run)."),
    all_runs: bool = typer.Option(False, "--all", help="Compact all runs without entries."),
):
    """Compact a run's transcript into a structured summary."""
    db = project_db(project)
    engine = CompactionEngine(db)
    engine.ensure_tables()

    if run_id:
        targets = [run_id]
    elif all_runs:
        with db.connect() as con:
            rows = con.execute(
                """
                SELECT r.id FROM runs r
                LEFT JOIN compaction_entries c ON c.run_id = r.id AND c.project_id = r.project_id
                WHERE r.project_id=? AND c.id IS NULL
                ORDER BY r.started_at DESC
                """,
                (db.project_id,),
            ).fetchall()
        targets = [r["id"] for r in rows]
        if not targets:
            console.print("[yellow]No uncompacted runs found.[/yellow]")
            return
    else:
        runs = db.recent_runs(limit=1)
        if not runs:
            console.print("[yellow]No runs found.[/yellow]")
            return
        targets = [runs[0]["id"]]

    for rid in targets:
        entry = auto_compact_run(db, rid)
        if entry:
            tokens_k = entry.token_count // 1000
            console.print(f"[green]Compacted[/green] run {rid[:12]} — summary: {entry.summary[:60]}... ({tokens_k}k tokens)")
        else:
            console.print(f"[yellow]Skipped[/yellow] run {rid[:12]} (no transcript or already compacted)")

    stats = engine.get_recent_entries(limit=1)
    if stats:
        total = engine.get_total_token_savings()
        console.print(f"\nTotal token savings: ~{total:,} tokens")


@app.command()
def compact_status(
    project: str = typer.Argument(".", help="Project root path."),
):
    """Show compaction statistics for a project."""
    db = project_db(project)
    engine = CompactionEngine(db)
    engine.ensure_tables()

    entries = engine.get_recent_entries(limit=10)
    if not entries:
        console.print("[yellow]No compaction entries yet. Run `smith compact` to create one.[/yellow]")
        return

    total_tokens = engine.get_total_token_savings()
    table = Table(title=f"Compaction — {project}")
    table.add_column("Date")
    table.add_column("Run")
    table.add_column("Tokens Saved")
    table.add_column("Files Changed")
    table.add_column("Summary")

    for entry in entries:
        date = entry.created_at[:10] if entry.created_at else "?"
        rid = entry.run_id[:12] if entry.run_id else "?"
        tokens = f"{entry.token_count:,}"
        files = str(len(entry.files_changed))
        summary = entry.summary[:80].replace("\n", " ")
        table.add_row(date, rid, tokens, files, summary)

    console.print(table)
    console.print(f"Total token savings from compaction: ~{total_tokens:,}")


@app.command()
def sandbox_config(
    project: str = typer.Argument(".", help="Project root path."),
    mode: str | None = typer.Option(None, "--mode", help="Sandbox mode: 'none' (direct) or 'docker'."),
    image: str | None = typer.Option(None, "--image", help="Docker image (e.g. python:3.14-slim)."),
):
    """Show or configure sandbox settings.

    Examples:
        smith sandbox-config /path/to/project
        smith sandbox-config /path/to/project --mode docker
        smith sandbox-config /path/to/project --mode none
        smith sandbox-config /path/to/project --image python:3.12-slim
    """
    db = project_db(project)

    if mode is not None:
        if mode not in ("none", "docker"):
            console.print(f"[red]Invalid mode: {mode}. Use 'none' or 'docker'.[/red]")
            return
        db.set_setting("sandbox.mode", mode)
        console.print(f"[green]Sandbox mode set to[/green] {mode}")

    if image is not None:
        db.set_setting("sandbox.image", image)
        console.print(f"[green]Sandbox image set to[/green] {image}")

    current_mode = db.get_setting("sandbox.mode", "none")
    current_image = db.get_setting("sandbox.image", "python:3.14-slim")
    backend = get_sandbox_backend(db)

    console.print(f"\nSandbox mode: [bold]{current_mode}[/bold]")
    console.print(f"Docker image: [bold]{current_image}[/bold]")
    console.print(f"Active backend: [bold]{backend.name()}[/bold]")
    console.print(f"Workspace root: [bold]{db.root_path}[/bold]")

    if current_mode == "docker":
        console.print("\n[yellow]Note:[/yellow] 'bash' will execute inside a Docker container.")
        console.print("File operations (read/write/edit) remain on the host via volume mount.")


@app.command()
def run(
    project: str = typer.Argument(..., help="Project root path."),
    prompt: str = typer.Argument(..., help="Prompt for Smith."),
    task_type: str | None = typer.Option(None, "--task-type", help="ask/implement/review. Omit for auto."),
    review: str = typer.Option("auto", "--review", help="auto/never/always."),
    auto_approve: bool = typer.Option(False, "--auto-approve", "-y", help="Auto-approve all commands without prompting."),
):
    """Run an interactive Smith task for a project path."""
    coord = ProjectCoordinator(project)
    coord.start_worker()
    console.print(f"[bold]Project:[/bold] {coord.db.root_path}")

    if auto_approve:
        approval_handler: ApprovalHandler = AutoApprovalHandler()
        console.print("[yellow]Auto-approve enabled — all commands will run without prompts.[/yellow]")
    else:
        approval_handler = CLIApprovalHandler()
        console.print("[dim]Commands outside allowed list will prompt for approval.[/dim]")

    for token in coord.stream_user_task(prompt, task_type=task_type, review_mode=review, approval_handler=approval_handler):
        print(token, end="", flush=True)
    print()


@app.command()
def index(
    project: str = typer.Argument(".", help="Project root path."),
):
    """Start background indexing for this project."""
    coord = ProjectCoordinator(project)
    job_id = coord.enqueue_scan()
    coord.start_worker()
    console.print(f"[green]Queued index scan[/green] {job_id}")
    console.print("Worker started in this process. Keep it running or use `smith serve` for persistent indexing.")
    try:
        while True:
            status = coord.db.get_index_status()
            console.print(status)
            import time
            time.sleep(2)
    except KeyboardInterrupt:
        coord.stop_worker()


@app.command()
def pause(
    project: str = typer.Argument(".", help="Project root path."),
):
    """Pause background indexing for this project."""
    ProjectCoordinator(project).pause_indexing()
    console.print("[yellow]Paused background indexing[/yellow]")


@app.command()
def resume(
    project: str = typer.Argument(".", help="Project root path."),
):
    """Resume background indexing for this project."""
    coord = ProjectCoordinator(project)
    coord.resume_indexing()
    coord.start_worker()
    console.print("[green]Resumed background indexing[/green]")





@app.command()
def status(
    project: str = typer.Argument(".", help="Project root path."),
):
    """Show project indexing status and recent Smith runs."""
    coord = ProjectCoordinator(project)
    console.print(coord.db.get_index_status())
    runs = coord.db.recent_runs(limit=5)
    table = Table(title="Recent Runs")
    table.add_column("Time")
    table.add_column("Type")
    table.add_column("Status")
    table.add_column("Prompt/Summary")
    for r in runs:
        table.add_row(r["started_at"], r["task_type"], r["status"], (r.get("final_summary") or r["user_prompt"] or "")[:100])
    console.print(table)


@app.command()
def serve(
    project: Path = typer.Argument(Path("."), help="Project root to serve."),
    host: str = "0.0.0.0",
    port: int = 8765,
):
    db = ProjectDB(project)
    db.init()
    os.environ["SMITH_PROJECT_ROOT"] = str(db.root_path)

    reg = register_agent(
        project_id=db.project_id,
        root_path=str(db.root_path),
        serve_host=host,
        serve_port=port,
        title=db.root_path.name,
    )
    if reg.get("started_registry"):
        typer.echo(f"Started Agent Smith registry: {reg['registry_url']}")
    else:
        typer.echo(f"Registered with Agent Smith registry: {reg['registry_url']}")
    typer.echo(f"Agent UI: {reg['agent_url']}")
    typer.echo(f"LAN Agent UI: {reg['agent_lan_url']}")
    typer.echo(f"Registry UI: {reg['registry_url']}")
    typer.echo(f"LAN Registry UI: {reg.get('registry_lan_url', reg['registry_url'])}")

    uvicorn.run("smith.server:app", host=host, port=port, reload=False)




def _find_free_port(start: int = 8765) -> int:
    for port in range(start, start + 200):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            try:
                sock.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    return start


@app.command("doctor")
def doctor():
    """Print active Smith install/build diagnostics."""
    import pathlib
    import smith
    from .server import BUILD_ID

    typer.echo(f"smith package: {pathlib.Path(smith.__file__).resolve()}")
    typer.echo(f"server build: {BUILD_ID}")
    typer.echo(f"recursion limit: {smith_recursion_limit()}")
    typer.echo(f"SMITH_RECURSION_LIMIT={os.getenv('SMITH_RECURSION_LIMIT')}")
    typer.echo(f"LANGGRAPH_RECURSION_LIMIT={os.getenv('LANGGRAPH_RECURSION_LIMIT')}")




def _project_picker_suggestions() -> list[Path]:
    home = Path.home()
    try:
        cwd = Path.cwd()
    except (FileNotFoundError, OSError):
        cwd = home
    roots = [
        cwd,
        home / "Desktop" / "Projects",
        home / "Projects",
        home / "Desktop",
        home,
    ]

    suggestions: list[Path] = []
    seen: set[str] = set()

    def add(path: Path):
        try:
            p = path.expanduser().resolve()
        except Exception:
            return
        key = str(p)
        if key not in seen and p.exists() and p.is_dir():
            seen.add(key)
            suggestions.append(p)

    for root in roots:
        add(root)
        try:
            if root.exists() and root.is_dir():
                for child in sorted([p for p in root.iterdir() if p.is_dir()])[:24]:
                    add(child)
        except Exception:
            pass

    return suggestions[:48]


def _web_project_picker() -> Path | None:
    """Browser-based project folder selector.

    This version is intentionally server-rendered so folders and shortcuts show up
    even if browser JavaScript fails. Links/forms do the navigation.
    """
    import html
    import http.server
    import urllib.parse
    import json

    selected: dict[str, str | None] = {"path": None, "error": None}
    done = threading.Event()
    port = _find_free_port(18865)

    def _safe_resolve(raw_path: str | None) -> Path:
        raw = (raw_path or "").strip() or str(Path.home())
        return Path(raw).expanduser().resolve()

    def _project_marker(path: Path) -> str:
        try:
            if (path / ".git").exists():
                return "git"
            if (path / "package.json").exists():
                return "node"
            if (path / "pyproject.toml").exists() or (path / "requirements.txt").exists():
                return "python"
        except Exception:
            pass
        return ""

    def _list_dir(raw_path: str | None) -> dict:
        base = _safe_resolve(raw_path)
        if not base.exists():
            raise ValueError(f"Folder does not exist: {base}")
        if not base.is_dir():
            raise ValueError(f"Not a folder: {base}")

        dirs = []
        try:
            children = sorted([p for p in base.iterdir() if p.is_dir()], key=lambda p: p.name.lower())
        except PermissionError:
            children = []
        except OSError as exc:
            raise ValueError(f"Could not list folder: {exc}") from exc

        for child in children[:400]:
            dirs.append({"name": child.name, "path": str(child), "marker": _project_marker(child)})

        return {
            "path": str(base),
            "name": base.name or str(base),
            "parent": str(base.parent) if base.parent != base else "",
            "dirs": dirs,
        }

    def _shortcuts() -> list[Path]:
        return _project_picker_suggestions()[:48]

    def _url_for_path(path: str) -> str:
        return "/?path=" + urllib.parse.quote(path)

    def render_page(error: str = "", current_path: str | None = None) -> bytes:
        # Start the picker in the directory where the user ran `smith app`
        try:
            default_path = str(Path.cwd().resolve())
        except (FileNotFoundError, OSError):
            # CWD was deleted (e.g. temp dir) — fall back to home
            default_path = str(Path.home())
        current_raw = current_path or default_path

        try:
            listing = _list_dir(current_raw)
        except Exception as exc:
            listing = {"path": str(_safe_resolve(current_raw)), "name": "", "parent": "", "dirs": []}
            error = error or str(exc)

        current = listing["path"]
        parent = listing.get("parent") or ""

        shortcut_html = "\n".join(
            f"""<a class="shortcut" href="{html.escape(_url_for_path(str(p)))}">
                  <strong>{html.escape(p.name or str(p))}</strong>
                  <span>{html.escape(str(p))}</span>
                </a>"""
            for p in _shortcuts()
        ) or '<div class="empty compact">No shortcuts found.</div>'

        parts = [part for part in Path(current).parts]
        crumbs = []
        accum = ""
        for i, part in enumerate(parts):
            if i == 0 and part == "/":
                accum = "/"
                label = "/"
            else:
                accum = str(Path(accum) / part) if accum else part
                label = part
            crumbs.append(f'<a class="crumb" href="{html.escape(_url_for_path(accum))}">{html.escape(label)}</a>')
        crumb_html = "\n".join(crumbs)

        folder_html = "\n".join(
            f"""<a class="folder-row" href="{html.escape(_url_for_path(d["path"]))}">
                  <span class="folder-icon">📁</span>
                  <span class="folder-main">
                    <span class="folder-name">{html.escape(d["name"])}</span>
                    <span class="folder-path">{html.escape(d["path"])}</span>
                  </span>
                  {f'<span class="tag">{html.escape(d["marker"])}</span>' if d.get("marker") else '<span></span>'}
                </a>"""
            for d in listing.get("dirs", [])
        ) or '<div class="empty">No subfolders here.<br>You can still select this folder.</div>'

        up_button = (
            f'<a class="button" href="{html.escape(_url_for_path(parent))}">← Up</a>'
            if parent else '<span class="button disabled">← Up</span>'
        )

        page = f"""<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Agent Smith Project Picker</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    :root {{
      color-scheme: dark;
      --bg:#06090f; --panel:#0f1720; --panel-2:#121c27; --panel-3:#0b1119;
      --border:#263445; --border-soft:rgba(255,255,255,.07);
      --text:#e8eef7; --muted:#91a0b3; --accent:#8ab4f8; --accent-2:#7ee787;
      --danger:#ff7b72; --shadow:rgba(0,0,0,.45);
    }}
    * {{ box-sizing:border-box; }}
    html, body {{
      margin:0; height:100%; overflow:hidden;
      background:
        radial-gradient(circle at 16% -10%, rgba(138,180,248,.14), transparent 34%),
        radial-gradient(circle at 100% 0%, rgba(126,231,135,.10), transparent 30%),
        linear-gradient(180deg, #070b12, var(--bg));
      color:var(--text);
      font-family:Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }}
    body {{ height:100vh; padding:18px; display:flex; }}
    a {{ color:inherit; text-decoration:none; }}
    button, input {{ font:inherit; }}
    .button, button {{
      border:1px solid var(--border); background:var(--panel-2); color:var(--text);
      border-radius:12px; padding:10px 12px; cursor:pointer; font-weight:650;
      display:inline-flex; align-items:center; justify-content:center; min-height:42px;
    }}
    .button:hover, button:hover {{ border-color:var(--accent); background:#172335; }}
    .button.disabled {{ opacity:.45; cursor:not-allowed; pointer-events:none; }}
    button.primary, .primary {{
      background:linear-gradient(180deg, #9cc2ff, var(--accent));
      border-color:var(--accent); color:#07111f;
    }}
    button.good, .good {{
      background:linear-gradient(180deg, #92f5a0, var(--accent-2));
      border-color:var(--accent-2); color:#07110a;
    }}
    .app {{
      width:min(1180px, 100%); height:calc(100vh - 36px); margin:auto;
      display:grid; grid-template-rows:auto minmax(0, 1fr);
      border:1px solid var(--border); border-radius:22px; overflow:hidden;
      background:rgba(15,23,32,.94); box-shadow:0 28px 90px var(--shadow);
    }}
    .top {{
      display:flex; align-items:center; justify-content:space-between; gap:14px;
      padding:18px 20px; border-bottom:1px solid var(--border);
      background:linear-gradient(180deg, rgba(255,255,255,.055), transparent), rgba(15,23,32,.94);
    }}
    .title {{ min-width:0; }}
    .title h1 {{ margin:0; font-size:22px; letter-spacing:-.02em; }}
    .title p {{ margin:4px 0 0; color:var(--muted); font-size:13px; line-height:1.35; }}
    .selected-card {{
      min-width:280px; max-width:46%; border:1px solid var(--border);
      background:var(--panel-3); border-radius:14px; padding:10px 12px;
    }}
    .selected-label {{
      color:var(--muted); font-size:11px; text-transform:uppercase; letter-spacing:.12em; margin-bottom:4px;
    }}
    .selected-path {{
      font-family:ui-monospace, SFMono-Regular, Menlo, monospace; font-size:12px;
      color:var(--accent-2); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
    }}
    .content {{ min-height:0; display:grid; grid-template-columns:260px minmax(0, 1fr); overflow:hidden; }}
    .sidebar {{
      min-width:0; border-right:1px solid var(--border); background:rgba(11,17,25,.72);
      display:grid; grid-template-rows:auto minmax(0, 1fr);
    }}
    .sidebar-head {{ padding:14px; border-bottom:1px solid var(--border-soft); }}
    .section-title {{
      margin:0; color:var(--muted); font-size:11px; text-transform:uppercase; letter-spacing:.14em;
    }}
    .shortcut-list {{
      min-height:0; overflow:auto; padding:10px; display:flex; flex-direction:column; gap:8px;
    }}
    .shortcut {{
      width:100%; text-align:left; display:grid; gap:3px; background:rgba(18,28,39,.9);
      border:1px solid var(--border-soft); border-radius:12px; padding:10px;
    }}
    .shortcut:hover {{ border-color:var(--accent); background:#172335; }}
    .shortcut strong, .shortcut span {{
      min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
    }}
    .shortcut strong {{ font-size:13px; }}
    .shortcut span {{ color:var(--muted); font-size:11px; font-family:ui-monospace, SFMono-Regular, Menlo, monospace; }}
    .browser {{
      min-width:0; min-height:0; height:100%; max-height:100%; overflow:hidden;
      display:grid; grid-template-rows:auto auto minmax(0, 1fr) auto; gap:10px; padding:14px;
    }}
    .toolbar {{ display:grid; grid-template-columns:auto auto minmax(0, 1fr); gap:8px; align-items:center; }}
    .toolbar form {{ display:grid; grid-template-columns:minmax(0,1fr) auto; gap:8px; }}
    .address {{
      width:100%; min-width:0; border:1px solid var(--border); background:var(--panel-3);
      color:var(--text); border-radius:12px; padding:11px 12px; outline:none; font-size:13px;
      font-family:ui-monospace, SFMono-Regular, Menlo, monospace;
    }}
    .address:focus {{ border-color:var(--accent); box-shadow:0 0 0 3px rgba(138,180,248,.14); }}
    .crumbs {{ display:flex; gap:6px; overflow:auto; padding-bottom:1px; scrollbar-width:thin; }}
    .crumb {{
      border:1px solid var(--border-soft); background:rgba(18,28,39,.78); border-radius:10px;
      padding:7px 9px; font-size:12px; max-width:180px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
    }}
    .folder-list {{
      min-height:0; overflow-y:auto; overflow-x:hidden; border:1px solid var(--border);
      border-radius:16px; background:rgba(6,9,15,.34); padding:8px;
      display:flex; flex-direction:column; gap:6px; overscroll-behavior:contain;
    }}
    .folder-row {{
      flex:0 0 auto; width:100%; min-height:54px; display:grid;
      grid-template-columns:34px minmax(0, 1fr) auto; align-items:center; gap:10px;
      text-align:left; border:1px solid var(--border-soft); border-radius:12px;
      background:rgba(18,28,39,.82); padding:9px 10px;
    }}
    .folder-row:hover {{ border-color:var(--accent); background:#172335; }}
    .folder-icon {{
      width:34px; height:34px; display:grid; place-items:center; border-radius:10px;
      background:rgba(138,180,248,.10); color:var(--accent); font-size:18px;
    }}
    .folder-main {{ min-width:0; }}
    .folder-name {{
      display:block; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:700;
    }}
    .folder-path {{
      display:block; margin-top:2px; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
      color:var(--muted); font-size:11px; font-family:ui-monospace, SFMono-Regular, Menlo, monospace;
    }}
    .tag {{
      border:1px solid var(--border-soft); color:var(--muted); border-radius:999px;
      padding:3px 7px; font-size:10px; text-transform:uppercase; letter-spacing:.08em;
    }}
    .bottom-bar {{
      display:grid; grid-template-columns:minmax(0, 1fr) auto; gap:10px; align-items:end;
      border:1px solid var(--border); background:rgba(11,17,25,.72); border-radius:16px; padding:10px;
    }}
    .bottom-left {{ min-width:0; }}
    .error {{
      color:var(--danger); font-size:13px; min-height:18px; min-width:0; overflow:hidden; text-overflow:ellipsis;
    }}
    .hint {{ color:var(--muted); font-size:12px; margin-top:3px; }}
    .create-folder {{
      display:grid; grid-template-columns:minmax(0, 1fr) auto; gap:8px; align-items:center; margin-top:8px;
    }}
    .create-folder input {{
      width:100%; min-width:0; border:1px solid var(--border); background:var(--panel-3);
      color:var(--text); border-radius:10px; padding:10px 11px; outline:none; font-size:13px;
    }}
    .empty {{ color:var(--muted); padding:16px; text-align:center; line-height:1.45; }}
    .empty.compact {{ padding:8px; font-size:12px; }}
    @media (max-width:780px) {{
      body {{ padding:8px; }}
      .app {{ height:calc(100vh - 16px); border-radius:16px; }}
      .top {{ align-items:stretch; flex-direction:column; padding:14px; }}
      .selected-card {{ max-width:none; min-width:0; }}
      .content {{ grid-template-columns:1fr; grid-template-rows:auto minmax(0, 1fr); }}
      .sidebar {{ border-right:0; border-bottom:1px solid var(--border); grid-template-rows:auto; }}
      .sidebar-head {{ display:none; }}
      .shortcut-list {{ display:flex; flex-direction:row; overflow:auto; padding:8px; max-height:92px; }}
      .shortcut {{ min-width:190px; }}
      .browser {{ padding:10px; gap:8px; grid-template-rows:auto minmax(0, 1fr) auto; }}
      .toolbar {{ grid-template-columns:1fr 1fr; }}
      .toolbar form {{ grid-column:1 / -1; order:-1; }}
      .crumbs {{ display:none; }}
      .folder-row {{ grid-template-columns:32px minmax(0,1fr); }}
      .folder-row .tag {{ display:none; }}
      .bottom-bar {{ grid-template-columns:1fr; }}
      .create-folder {{ grid-template-columns:1fr; }}
    }}

    /* Reliable scrolling: server-rendered picker + flex-bounded folder list. */
    .browser {{
      display:flex !important;
      flex-direction:column !important;
      min-height:0 !important;
      height:100% !important;
      max-height:100% !important;
      overflow:hidden !important;
    }}
    .toolbar,
    .crumbs,
    .bottom-bar {{
      flex:0 0 auto !important;
    }}
    .folder-list {{
      flex:1 1 auto !important;
      min-height:120px !important;
      max-height:none !important;
      height:auto !important;
      overflow-y:auto !important;
      overflow-x:hidden !important;
      -webkit-overflow-scrolling:touch;
      scrollbar-gutter:stable;
    }}
    .folder-row {{
      flex:0 0 auto !important;
    }}
    .content {{
      min-height:0 !important;
      overflow:hidden !important;
    }}
    .shortcut-list {{
      min-height:0 !important;
      overflow-y:auto !important;
      -webkit-overflow-scrolling:touch;
    }}
    @media (max-width:780px) {{
      .browser {{
        display:flex !important;
        flex-direction:column !important;
      }}
      .shortcut-list {{
        flex:0 0 auto !important;
        max-height:92px !important;
        overflow-x:auto !important;
        overflow-y:hidden !important;
      }}
      .folder-list {{
        flex:1 1 auto !important;
        min-height:140px !important;
        overflow-y:auto !important;
      }}
    }}


    /* Hard scroll boxes: do not rely on parent grid/flex height inference. */
    .shortcut-list {{
      height:calc(100vh - 210px) !important;
      max-height:calc(100vh - 210px) !important;
      min-height:120px !important;
      overflow-y:scroll !important;
      overflow-x:hidden !important;
      display:flex !important;
      flex-direction:column !important;
      overscroll-behavior:contain;
      -webkit-overflow-scrolling:touch;
    }}
    .folder-list {{
      height:calc(100vh - 355px) !important;
      max-height:calc(100vh - 355px) !important;
      min-height:180px !important;
      overflow-y:scroll !important;
      overflow-x:hidden !important;
      display:flex !important;
      flex-direction:column !important;
      overscroll-behavior:contain;
      -webkit-overflow-scrolling:touch;
      scrollbar-gutter:stable both-edges;
    }}
    .folder-row,
    .shortcut {{
      flex:0 0 auto !important;
    }}
    @media (max-width:780px) {{
      .shortcut-list {{
        height:86px !important;
        max-height:86px !important;
        min-height:86px !important;
        overflow-x:auto !important;
        overflow-y:hidden !important;
        flex-direction:row !important;
      }}
      .folder-list {{
        height:calc(100vh - 420px) !important;
        max-height:calc(100vh - 420px) !important;
        min-height:180px !important;
        overflow-y:scroll !important;
      }}
    }}

  </style>
</head>
<body>
  <main class="app">
    <header class="top">
      <div class="title">
        <h1>Select a project</h1>
        <p>Choose the folder Agent Smith should inspect and edit.</p>
      </div>
      <div class="selected-card">
        <div class="selected-label">Current folder</div>
        <div class="selected-path" title="{html.escape(current)}">{html.escape(current)}</div>
      </div>
    </header>

    <div class="content">
      <aside class="sidebar">
        <div class="sidebar-head"><h2 class="section-title">Shortcuts</h2></div>
        <div class="shortcut-list">{shortcut_html}</div>
      </aside>

      <section class="browser">
        <div class="toolbar">
          {up_button}
          <a class="button" href="{html.escape(_url_for_path(str(Path.home().resolve())))}">Home</a>
          <form method="get" action="/">
            <input class="address" name="path" value="{html.escape(current)}" spellcheck="false" autocomplete="off" />
            <button class="primary" type="submit">Go</button>
          </form>
        </div>

        <div class="crumbs">{crumb_html}</div>

        <div class="folder-list">{folder_html}</div>

        <div class="bottom-bar">
          <div class="bottom-left">
            <div class="error">{html.escape(error or "")}</div>
            <div class="hint">Open folders until this is the project root, then select it.</div>
            <form class="create-folder" method="post" action="/mkdir">
              <input type="hidden" name="path" value="{html.escape(current)}" />
              <input name="name" type="text" placeholder="New folder name..." autocomplete="off" />
              <button type="submit">Create folder</button>
            </form>
          </div>
          <form method="post" action="/select">
            <input type="hidden" name="path" value="{html.escape(current)}" />
            <button class="good" type="submit">Select current folder</button>
          </form>
        </div>
      </section>
    </div>
  </main>
</body>
</html>"""
        return page.encode("utf-8")

    class Handler(http.server.BaseHTTPRequestHandler):
        def log_message(self, format, *args):
            return

        def _redirect_to(self, path: str):
            self.send_response(303)
            self.send_header("Location", path)
            self.send_header("Cache-Control", "no-store")
            self.end_headers()

        def do_GET(self):
            if self.path.startswith("/api/list"):
                parsed = urllib.parse.urlparse(self.path)
                params = urllib.parse.parse_qs(parsed.query)
                raw_path = (params.get("path") or [str(Path.home())])[0]
                try:
                    payload = _list_dir(raw_path)
                    self.send_response(200)
                except Exception as exc:
                    payload = {"error": str(exc), "path": raw_path, "parent": "", "dirs": []}
                    self.send_response(400)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(json.dumps(payload).encode("utf-8"))
                return

            if self.path.startswith("/cancel"):
                done.set()
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b"Cancelled. You can close this tab.")
                return

            parsed = urllib.parse.urlparse(self.path)
            params = urllib.parse.parse_qs(parsed.query)
            current = (params.get("path") or [None])[0]

            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(render_page(selected.get("error") or "", current))

        def do_POST(self):
            length = int(self.headers.get("Content-Length", "0") or "0")
            raw = self.rfile.read(length).decode("utf-8", errors="replace")
            form = urllib.parse.parse_qs(raw)

            if self.path.startswith("/mkdir"):
                base_raw = (form.get("path") or [""])[0].strip()
                name_raw = (form.get("name") or [""])[0].strip()
                try:
                    if not name_raw:
                        raise ValueError("Folder name is required.")
                    if "/" in name_raw or "\\" in name_raw:
                        raise ValueError("Folder name must not contain slashes.")
                    base = _safe_resolve(base_raw)
                    if not base.exists() or not base.is_dir():
                        raise ValueError(f"Current folder is not valid: {base}")
                    new_dir = (base / name_raw).resolve()
                    if base not in new_dir.parents:
                        raise ValueError("Folder path escapes current directory.")
                    new_dir.mkdir(parents=False, exist_ok=False)
                    self._redirect_to(_url_for_path(str(new_dir)))
                    return
                except Exception as exc:
                    self.send_response(200)
                    self.send_header("Content-Type", "text/html; charset=utf-8")
                    self.send_header("Cache-Control", "no-store")
                    self.end_headers()
                    self.wfile.write(render_page(str(exc), base_raw))
                    return

            if self.path.startswith("/api/mkdir"):
                base_raw = (form.get("path") or [""])[0].strip()
                name_raw = (form.get("name") or [""])[0].strip()
                try:
                    if not name_raw:
                        raise ValueError("Folder name is required.")
                    if "/" in name_raw or "\\" in name_raw:
                        raise ValueError("Folder name must not contain slashes.")
                    base = _safe_resolve(base_raw)
                    if not base.exists() or not base.is_dir():
                        raise ValueError(f"Current folder is not valid: {base}")
                    new_dir = (base / name_raw).resolve()
                    if base not in new_dir.parents:
                        raise ValueError("Folder path escapes current directory.")
                    new_dir.mkdir(parents=False, exist_ok=False)
                    payload = _list_dir(str(new_dir))
                    self.send_response(200)
                except Exception as exc:
                    payload = {"error": str(exc)}
                    self.send_response(400)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(json.dumps(payload).encode("utf-8"))
                return

            chosen_raw = (form.get("path") or [""])[0].strip()
            try:
                chosen = _safe_resolve(chosen_raw)
                if not chosen.exists():
                    raise ValueError(f"Folder does not exist: {chosen}")
                if not chosen.is_dir():
                    raise ValueError(f"Not a folder: {chosen}")
                selected["path"] = str(chosen)
                # Send response BEFORE signalling done — otherwise httpd.shutdown()
                # in the main thread may close the socket mid-write.
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.end_headers()
                self.wfile.write(b"<html><body style='font-family:sans-serif;background:#070a0f;color:#e8eef7;padding:24px'><h2>Agent Smith is starting.</h2><p>You can close this tab.</p></body></html>")
                self.wfile.flush()
                done.set()
                return
            except Exception as exc:
                selected["error"] = str(exc)

            self.send_response(400)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(render_page(selected.get("error") or "", chosen_raw))

    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    url = f"http://127.0.0.1:{port}"
    typer.echo(f"Project picker: {url}")
    try:
        webbrowser.open(url)
    except Exception:
        pass

    try:
        while not done.wait(0.1):
            pass
    except KeyboardInterrupt:
        selected["path"] = None
    finally:
        try:
            httpd.shutdown()
        except Exception:
            pass

    return Path(selected["path"]) if selected.get("path") else None


@app.command("app")
def app_launcher(
    project: Path | None = typer.Argument(None, help="Optional project folder. If omitted, a folder picker opens."),
    host: str = "0.0.0.0",
    port: int = 0,
):
    """Launch the central Smith app: choose a folder, start registry + agent UI, open browser."""
    chosen = project

    if chosen is None:
        chosen = _web_project_picker()
        if chosen is None:
            typer.echo("No folder selected.")
            typer.echo("Run with an explicit folder instead, for example:")
            typer.echo("  smith app /home/spark/Desktop/Projects/agent-smith-v2")
            raise typer.Exit(1)

    chosen = chosen.expanduser().resolve()
    serve_port = port or _find_free_port(8765)

    db = ProjectDB(chosen)
    db.init()
    os.environ["SMITH_PROJECT_ROOT"] = str(db.root_path)

    reg = register_agent(
        project_id=db.project_id,
        root_path=str(db.root_path),
        serve_host=host,
        serve_port=serve_port,
        title=db.root_path.name,
    )

    typer.echo(f"Project: {db.root_path}")
    typer.echo(f"Registry UI: {reg['registry_url']}")
    typer.echo(f"LAN Registry UI: {reg.get('registry_lan_url', reg['registry_url'])}")
    typer.echo(f"Agent UI: {reg['agent_url']}")
    typer.echo(f"LAN Agent UI: {reg['agent_lan_url']}")

    # Start the agent server in a background thread so we can open the browser
    # after it is ready. uvicon.run() is blocking, so we run it in a thread.
    import threading as _threading
    import time as _time

    def _run_agent_server():
        from smith.server import app as _app
        uvicorn.run(_app, host=host, port=serve_port, reload=False)

    _svr = _threading.Thread(target=_run_agent_server, daemon=True)
    _svr.start()

    # Give the server a moment to bind, then open the browser
    _time.sleep(1.0)
    try:
        webbrowser.open(reg["agent_url"])
    except Exception:
        pass

    typer.echo(f"Server running on {reg['agent_url']}")
    try:
        _svr.join()
    except KeyboardInterrupt:
        typer.echo()


@app.command("flow-import")
def flow_import(
    flow_file: str = typer.Argument(..., help="Path to a JSON file describing tasks to run."),
    project: str = typer.Argument(".", help="Project root path."),
    auto_approve: bool = typer.Option(False, "--auto-approve", "-y", help="Auto-approve commands."),
    verbose: bool = typer.Option(False, "--verbose", "-v", help="Show detailed tool error logs after run."),
):
    """Import and execute tasks from a flow JSON file.

    The flow JSON file can be either a plain array or an object with
    optional "flow_context" and "tasks" keys:

    {
      "flow_context": "## Goal\\nBuild a Laravel todo app with auth.",
      "tasks": [
        {"prompt": "...", "task_type": "implement", "label": "step-1"},
        {"prompt": "...", "task_type": "implement", "label": "step-2"}
      ]
    }

    The "flow_context" field is injected into every step so the agent
    knows the overall goal. Completed steps are tracked and shown as
    progress automatically.

    Each task supports:
    - prompt (required): The user prompt for the agent.
    - task_type (optional): "ask", "implement", or "review". Auto-detected if omitted.
    - review (optional): "auto", "never", or "always". Defaults to "auto".
    - label (optional): A display label for the task.
    - model (optional): {"provider_id": "...", "model_id": "..."} to override the model for this task.
    """
    import json as _json
    from pathlib import Path as _Path

    flow_path = _Path(flow_file).expanduser().resolve()
    if not flow_path.exists():
        typer.echo(f"[red]Flow file not found: {flow_file}[/red]")
        raise typer.Exit(1)

    try:
        raw = _json.loads(flow_path.read_text(encoding="utf-8"))
    except Exception as exc:
        typer.echo(f"[red]Failed to parse flow JSON: {exc}[/red]")
        raise typer.Exit(1)

    # Support both new {"flow_context": ..., "tasks": [...]} and old [...] formats
    if isinstance(raw, list):
        flow_context = ""
        tasks = raw
    elif isinstance(raw, dict):
        flow_context = (raw.get("flow_context") or raw.get("context") or "").strip()
        tasks = raw.get("tasks", [])
    else:
        typer.echo("[red]Flow JSON must be an array or an object with 'tasks'.[/red]")
        raise typer.Exit(1)

    if not isinstance(tasks, list) or not tasks:
        typer.echo("[red]Flow JSON must contain a non-empty 'tasks' array.[/red]")
        raise typer.Exit(1)

    if flow_context:
        console.print(f"[dim]Flow context: {flow_context[:120]}{'...' if len(flow_context) > 120 else ''}[/dim]")

    setup_step = raw.get("setup") if isinstance(raw, dict) else None

    db = project_db(project)
    from smith.agent import ToolErrorLogger
    error_logger_global = ToolErrorLogger(db)

    approval_handler: ApprovalHandler = AutoApprovalHandler() if auto_approve else CLIApprovalHandler()
    if auto_approve:
        console.print("[yellow]Auto-approve enabled[/yellow]")

    # ── Flow setup step: analyze flow + build skeletal context ──────
    if setup_step and isinstance(setup_step, dict):
        setup_prompt = setup_step.get("prompt", "")
        setup_model = setup_step.get("model")
        if setup_prompt:
            console.print()
            console.print("[bold cyan]── Flow Setup ──[/bold cyan]")
            console.print(f"[dim]Model: {setup_model or 'default'}[/dim]")

            # Build a comprehensive setup prompt
            tasks_summary = "\n".join(
                f"  {i+1}. [{t.get('task_type', 'implement')}] {t.get('label', 'step-'+str(i+1))}: {t.get('prompt', '')[:200]}"
                for i, t in enumerate(tasks) if isinstance(t, dict)
            )
            full_setup_prompt = (
                f"{setup_prompt}\n\n"
                f"## Flow Goal\n{flow_context or 'See tasks below.'}\n\n"
                f"## Tasks ({len(tasks)} steps)\n{tasks_summary}\n\n"
                f"## Instructions\n"
                f"Analyze the flow above and create a skeletal project context document.\n"
                f"This document will be visible to every implementation and review step.\n\n"
                f"Your response MUST be a structured markdown document with these sections:\n\n"
                f"## Architecture Overview\n"
                f"High-level architecture: framework, language, key design decisions.\n\n"
                f"## Component Graph\n"
                f"Mermaid or ASCII graph showing components and their relationships.\n"
                f"For each component note: files to create, dependencies, data flow.\n\n"
                f"## Prerequisites\n"
                f"What tools/packages must be installed. Check them with `bash('which ...')`.\n\n"
                f"## Step-by-Step Implementation Plan\n"
                f"For each task step, list: what to build, files to touch, edge cases to handle.\n\n"
                f"## Progress Tracker\n"
                f"A checklist of all steps with `[ ]` markers for tracking.\n\n"
                f"Output ONLY the skeletal context document. Do not add conversation text.\n"
                f"Use `edit_skeletal_context(content)` to save the document.\n"
                f"Then output 'SETUP COMPLETE' and nothing else."
            )

            coord = ProjectCoordinator(project)
            coord.start_worker()
            output_chunks: list[str] = []
            try:
                for token in coord.stream_user_task(
                    full_setup_prompt,
                    task_type="implement",
                    review_mode="never",
                    model_override=setup_model,
                    approval_handler=approval_handler,
                ):
                    output_chunks.append(token)
                full_output = "".join(output_chunks)
                # Check if skeletal context was created
                items = db.list_context_items(kinds=["skeletal_context"], limit=1)
                if items:
                    console.print("[green]  ✓ Skeletal context created[/green]")
                else:
                    console.print("[yellow]  ⚠ Setup ran but no skeletal context saved[/yellow]")
            except Exception as exc:
                console.print(f"[red]  ✗ Setup failed: {exc}[/red]")

    total = len(tasks)
    results: list[dict] = []
    flow_progress: list[str] = []  # accumulated step summaries

    for i, task in enumerate(tasks):
        if not isinstance(task, dict):
            console.print(f"[yellow]Skipping task {i + 1}: not a dict[/yellow]")
            continue

        prompt = task.get("prompt", "")
        if not prompt:
            console.print(f"[yellow]Skipping task {i + 1}: no prompt[/yellow]")
            continue

        task_type = task.get("task_type")
        review = task.get("review", "auto")
        label = task.get("label", f"task-{i + 1}")
        model_override = task.get("model")
        review_model_override = None
        if task.get("review_provider_id") and task.get("review_model_id"):
            review_model_override = {
                "provider_id": task["review_provider_id"],
                "model_id": task["review_model_id"],
            }

        # ── Build augmented prompt with flow context + progress ──────
        augmented_prompt = prompt
        flow_bits: list[str] = []
        flow_bits.append(f"[FLOW] Step {i + 1}/{total} — {label}")
        if flow_context:
            flow_bits.append(f"[FLOW] Overall Goal:\n{flow_context}")
        if flow_progress:
            prog = "\n".join(f"  {entry}" for entry in flow_progress[-12:])
            flow_bits.append(f"[FLOW] Steps completed so far:\n{prog}")
        augmented_prompt = "\n\n".join(flow_bits) + "\n\n---\n\n" + prompt

        console.print()
        console.print(f"[bold]── Flow task {i + 1}/{total}: {label} ──[/bold]")
        console.print(f"[dim]Type: {task_type or 'auto'} | Review: {review}[/dim]")
        console.print(f"[dim]Prompt: {prompt[:200]}{'...' if len(prompt) > 200 else ''}[/dim]")

        coord = ProjectCoordinator(project)
        coord.start_worker()
        task_error_count_before = len(error_logger_global.get_recent_errors(200))

        # ── Run step with one retry on backend crash ──────────────────
        full_output = ""
        for attempt in (1, 2):
            try:
                output_chunks: list[str] = []
                for token in coord.stream_user_task(
                    augmented_prompt,
                    task_type=task_type,
                    review_mode=review,
                    model_override=model_override,
                    review_model_override=review_model_override,
                    approval_handler=approval_handler,
                ):
                    output_chunks.append(token)
                    if verbose:
                        console.print(token, end="", highlight=False)

                full_output = "".join(output_chunks)
                if not verbose:
                    for line in full_output.splitlines():
                        if "[smith]" in line or "VERIFIED" in line or "error" in line.lower() or "ERROR" in line:
                            console.print(line.strip()[:200])
                break  # success

            except Exception as exc:
                err = str(exc)
                # If the backend (LM Studio / llama-server) crashed, restart it and retry
                is_backend_crash = (
                    "Engine protocol predict request failed" in err
                    or "fetch failed" in err
                    or "Connection error" in err
                    or "RemoteProtocolError" in err
                )
                if is_backend_crash and attempt == 1:
                    console.print(f"[yellow]  ⚡ Backend crash detected, restarting model...[/yellow]")
                    _restart_model_backend()
                    console.print(f"[dim]  Retrying step...[/dim]")
                    # Fresh coordinator for retry (new DB connection)
                    coord = ProjectCoordinator(project)
                    coord.start_worker()
                    continue
                # Non-recoverable or retry exhausted
                console.print(f"[red]Task error: {exc}[/red]")
                results.append({
                    "label": label,
                    "prompt": prompt[:200],
                    "task_type": task_type,
                    "status": "error",
                    "error": str(exc),
                })
                flow_progress.append(f"❌ {label}: {str(exc)[:100]}")
                break
        else:
            continue  # skip to next iteration of outer loop if error after retry

        if not full_output:
            continue  # step failed after retries

        # Extract a brief summary from the output for progress tracking
        step_summary = _extract_flow_step_summary(full_output)
        flow_progress.append(f"✅ {label}: {step_summary}")

        # Collect new errors since this task started
        task_errors = error_logger_global.get_recent_errors(200)
        new_errors = task_errors[:max(0, len(task_errors) - task_error_count_before)]

        results.append({
            "label": label,
            "prompt": prompt[:200],
            "task_type": task_type,
            "status": "completed",
            "tool_errors": len(new_errors),
            "error_types": list(set(e.get("error_type", "?") for e in new_errors)),
        })

        if new_errors:
            console.print(f"[yellow]  ⚠ {len(new_errors)} tool error(s) detected[/yellow]")
            for e in new_errors[:5]:
                console.print(f"[dim]    - [{e.get('error_type', '?')}] {e.get('tool_name', '?')}: {e.get('error_result', '')[:120]}[/dim]")

        # Check for model anomalies from THIS task's errors only
        # Filter by looking at entries that don't have 'error_type' (tool errors)
        # and do have 'anomaly_type' (model anomalies)
        task_anomalies = [e for e in new_errors if "anomaly_type" in e]
        if task_anomalies:
            console.print(f"[yellow]  ⚡ {len(task_anomalies)} model anomaly(s) in this task[/yellow]")
            for a in task_anomalies[:3]:
                atype = a.get("anomaly_type", "?")
                snippet = a.get("assistant_text_snippet", "")[:120]
                console.print(f"[dim]    - [{atype}] {snippet}[/dim]")

    # Final summary
    console.print()
    console.print("[bold]══ Flow Results ══[/bold]")
    table = Table(title="Task Results")
    table.add_column("Label")
    table.add_column("Status")
    table.add_column("Type")
    table.add_column("Tool Errors")
    for r in results:
        status_style = "green" if r["status"] == "completed" else "red"
        table.add_row(
            r["label"],
            f"[{status_style}]{r['status']}[/{status_style}]",
            r.get("task_type", "auto") or "auto",
            str(r.get("tool_errors", 0)),
        )
    console.print(table)

    # Show global error summary
    error_summary = error_logger_global.error_summary()
    if error_summary["total_errors"] > 0:
        console.print()
        console.print(f"[bold]Total tool errors across flow: {error_summary['total_errors']}[/bold]")
        console.print(f"By type: {error_summary['by_type']}")
        console.print(f"By tool: {error_summary['by_tool']}")
        console.print(f"Error log: {error_logger_global._jsonl_path}")

    if verbose:
        console.print()
        console.print("[bold]Detailed error log:[/bold]")
        for e in error_logger_global.get_recent_errors(20):
            console.print(f"  [{e.get('iso_time', '?')}] {e.get('tool_name', '?')}: {e.get('error_type', '?')}")
            console.print(f"    Args: {e.get('tool_args_summary', '?')}")
            console.print(f"    Result: {e.get('error_result', '')[:200]}")
            if e.get("model_messages"):
                msgs = e["model_messages"]
                if msgs:
                    last = msgs[-1]
                    console.print(f"    Model context: [{last.get('role', '?')}] {last.get('content', '')[:150]}")


def _restart_model_backend() -> None:
    """Restart the LM Studio / llama-server backend after a crash.

    Kills any stuck llama-server processes and triggers LM Studio
    to reload the model on the next API request.
    """
    import subprocess as _sp
    import time as _time
    try:
        # Kill stuck llama-server processes
        _sp.run(["pkill", "-f", "llama-server"], timeout=5)
        _time.sleep(1)
        # Touch LM Studio's API so it knows to reload on next request
    except Exception:
        pass


def _extract_flow_step_summary(output: str, max_chars: int = 120) -> str:
    """Extract a brief summary from a completed flow step's output.

    Scans backwards through the output for the last substantial
    non-status line that looks like a natural-language summary.
    Falls back to a compacted version of the last line.
    """
    lines = output.splitlines()
    for line in reversed(lines):
        stripped = line.strip()
        if not stripped:
            continue
        # Skip status / metadata lines
        if stripped.startswith(("[smith]", "VERIFIED_WRITE_OK", "VERIFIED_EDIT_OK",
                                "---", "===", "⏺", "🔧", "🛠", "⚠")):
            continue
        if len(stripped) < 15:
            continue
        # Good candidate
        return stripped[:max_chars]
    return "completed"


if __name__ == "__main__":
    app()
