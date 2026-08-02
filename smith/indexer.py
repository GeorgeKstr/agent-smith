from __future__ import annotations

import ast
import os
import re
from pathlib import Path
from typing import Any

from .db import ProjectDB, sha256_bytes

IGNORED_DIRS = {
    ".git", ".agent-smith", "node_modules", "venv", ".venv", "__pycache__",
    ".pytest_cache", ".mypy_cache", ".ruff_cache", "dist", "build", ".next", ".turbo",
}

TEXT_EXTS = {
    ".py", ".js", ".jsx", ".ts", ".tsx", ".json", ".toml", ".yaml", ".yml", ".md",
    ".txt", ".css", ".html", ".sql", ".sh", ".env", ".ini", ".cfg", ".rs", ".go",
    ".java", ".kt", ".c", ".cpp", ".h", ".hpp", ".cs", ".php", ".rb",
}

LANG_BY_EXT = {
    ".py": "python", ".js": "javascript", ".jsx": "javascript-react", ".ts": "typescript",
    ".tsx": "typescript-react", ".json": "json", ".toml": "toml", ".md": "markdown",
    ".css": "css", ".html": "html", ".sql": "sql", ".sh": "shell",
}

IMPORTANT_FILENAMES = {
    "package.json", "pyproject.toml", "requirements.txt", "README.md", "vite.config.ts",
    "next.config.js", "tsconfig.json", "main.py", "app.py", "server.py", "Dockerfile",
}


def should_ignore(path: Path) -> bool:
    return any(part in IGNORED_DIRS for part in path.parts)


def is_text_candidate(path: Path) -> bool:
    if path.name in IMPORTANT_FILENAMES:
        return True
    return path.suffix.lower() in TEXT_EXTS


def classify_kind(path: Path) -> str:
    name = path.name.lower()
    if name in {"package.json", "pyproject.toml", "requirements.txt", "tsconfig.json"}:
        return "config"
    if "test" in path.parts or name.startswith("test_") or name.endswith(".test.ts") or name.endswith(".spec.ts"):
        return "test"
    if name.lower().startswith("readme") or path.suffix.lower() == ".md":
        return "docs"
    if name in {"main.py", "app.py", "server.py", "index.ts", "main.tsx"}:
        return "entrypoint"
    return "source"


def language_for(path: Path) -> str:
    return LANG_BY_EXT.get(path.suffix.lower(), "text")


def scan_project(db: ProjectDB) -> int:
    db.init()
    db.record_event(None, "index_scan_started", {"root": str(db.root_path)})
    with db.connect() as con:
        con.execute(
            "UPDATE index_state SET status='running', mode='scan', last_scan_at=datetime('now'), message='Scanning project tree' WHERE project_id=?",
            (db.project_id,),
        )
    count = 0
    for file_path in db.root_path.rglob("*"):
        if not file_path.is_file():
            continue
        rel = file_path.relative_to(db.root_path)
        if should_ignore(rel) or not is_text_candidate(file_path):
            continue
        try:
            data = file_path.read_bytes()
        except Exception:
            continue
        if b"\x00" in data[:4096] or len(data) > int(os.getenv("SMITH_MAX_INDEX_FILE_BYTES", "300000")):
            continue
        sha = sha256_bytes(data)
        stat = file_path.stat()
        path = str(rel)
        importance = 10 if file_path.name in IMPORTANT_FILENAMES else 0
        db.upsert_file(path, language_for(file_path), classify_kind(rel), stat.st_size, stat.st_mtime, sha, importance)
        summary = db.get_file_summary(path)
        if not summary or summary.get("source_sha256") != sha:
            db.set_file_index_status(path, "queued", last_hash=sha, priority=50 - importance)
            db.enqueue_job("index_file", priority=5, payload={"path": path})
            count += 1
        else:
            db.set_file_index_status(path, "clean", last_hash=sha, indexed_hash=sha)
    db.refresh_index_counters(message=f"Scan finished. Queued {count} file(s).")
    return count


def _extract_python_symbols(text: str) -> list[str]:
    try:
        tree = ast.parse(text)
    except Exception:
        return []
    symbols = []
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            symbols.append(node.name)
    return symbols[:50]


def _extract_generic_symbols(text: str) -> list[str]:
    patterns = [
        r"\bfunction\s+([A-Za-z_][A-Za-z0-9_]*)",
        r"\bclass\s+([A-Za-z_][A-Za-z0-9_]*)",
        r"\bconst\s+([A-Za-z_][A-Za-z0-9_]*)\s*=",
        r"\blet\s+([A-Za-z_][A-Za-z0-9_]*)\s*=",
        r"\bexport\s+function\s+([A-Za-z_][A-Za-z0-9_]*)",
        r"\bdef\s+([A-Za-z_][A-Za-z0-9_]*)",
    ]
    out = []
    for pat in patterns:
        out.extend(re.findall(pat, text))
    seen = []
    for s in out:
        if s not in seen:
            seen.append(s)
    return seen[:50]


def _extract_imports(text: str) -> list[str]:
    imports = []
    for line in text.splitlines()[:300]:
        stripped = line.strip()
        if stripped.startswith(("import ", "from ")):
            imports.append(stripped[:180])
        elif stripped.startswith("import") or " from " in stripped:
            imports.append(stripped[:180])
    return imports[:50]


def summarize_text_heuristic(path: str, text: str, language: str) -> dict[str, Any]:
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    first_commentish = []
    for ln in lines[:80]:
        if ln.startswith(("#", "//", "/*", "*", "<!--")) or len(ln) < 140:
            first_commentish.append(ln)
        if len(first_commentish) >= 8:
            break

    if language == "python":
        symbols = _extract_python_symbols(text)
    else:
        symbols = _extract_generic_symbols(text)

    imports = _extract_imports(text)
    responsibilities = []
    lowered = path.lower()
    if "server" in lowered:
        responsibilities.append("server/runtime entrypoint")
    if "db" in lowered or "database" in lowered:
        responsibilities.append("database/storage logic")
    if "cli" in lowered:
        responsibilities.append("command-line interface")
    if "test" in lowered:
        responsibilities.append("tests")
    if "index" in lowered or "main" in lowered:
        responsibilities.append("application entrypoint")

    excerpt = " ".join(first_commentish[:5])[:500]
    summary = f"{path} ({language})"
    if symbols:
        summary += f" defines {', '.join(symbols[:8])}."
    if imports:
        summary += f" Imports include {', '.join(imports[:3])}."
    if excerpt:
        summary += f" Notable excerpt: {excerpt}"
    if not symbols and not imports and not excerpt:
        summary += " text/config file."

    relationships = []
    for imp in imports:
        m = re.search(r"from\s+[\"'](.+?)[\"']", imp)
        if m:
            relationships.append({"target": m.group(1), "type": "imports", "confidence": 0.5})

    return {
        "summary": summary[:2000],
        "symbols": symbols,
        "imports": imports,
        "exports": [],
        "responsibilities": responsibilities,
        "relationships": relationships[:20],
    }


def index_file(db: ProjectDB, path: str) -> dict[str, Any]:
    db.set_file_index_status(path, "indexing")
    rel = Path(path)
    if should_ignore(rel):
        db.set_file_index_status(path, "ignored")
        return {"path": path, "status": "ignored"}

    file_path = (db.root_path / rel).resolve()
    if not file_path.exists() or not file_path.is_file():
        db.set_file_index_status(path, "deleted")
        return {"path": path, "status": "deleted"}

    data = file_path.read_bytes()
    if b"\x00" in data[:4096]:
        db.set_file_index_status(path, "error", error="binary file")
        return {"path": path, "status": "binary"}

    sha = sha256_bytes(data)
    text = data.decode("utf-8", errors="replace")
    lang = language_for(file_path)
    stat = file_path.stat()

    db.upsert_file(path, lang, classify_kind(rel), stat.st_size, stat.st_mtime, sha, 10 if file_path.name in IMPORTANT_FILENAMES else 0)

    previous = db.get_file_summary(path)
    if previous and previous.get("source_sha256") == sha:
        db.set_file_index_status(path, "clean", last_hash=sha, indexed_hash=sha)
        return {"path": path, "status": "clean"}

    result = summarize_text_heuristic(path, text[: int(os.getenv("SMITH_INDEX_READ_CHARS", "60000"))], lang)
    db.upsert_file_summary(
        path=path,
        summary=result["summary"],
        source_sha256=sha,
        symbols=result["symbols"],
        imports=result["imports"],
        exports=result["exports"],
        responsibilities=result["responsibilities"],
        relationships=result["relationships"],
    )
    db.set_file_index_status(path, "indexed", last_hash=sha, indexed_hash=sha)
    return {"path": path, "status": "indexed", "summary": result["summary"][:300]}
