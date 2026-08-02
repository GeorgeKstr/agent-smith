# Agent Smith v2

Local-first AI coding agent with surgical editing, configurable command execution, context compaction, and Docker sandboxing. Works with any OpenAI-compatible local model (LM Studio, Ollama, vLLM, etc.).

## Quick Install

```bash
curl -fsSL https://raw.githubusercontent.com/GeorgeKstr/agent-smith/main/install.sh | bash
```

Then run:
```bash
smith2          # Web UI at http://localhost:8080
smith2 app      # Full app with project picker
```

Or manual install:

```bash
git clone https://github.com/GeorgeKstr/agent-smith.git
cd agent-smith
pip install -e .
smith2
```

## Requirements

- Python 3.11+
- An OpenAI-compatible LLM endpoint (default: `http://localhost:1234/v1` — LM Studio)
- Docker (optional, for sandboxed command execution)

## Features

| Feature | Description |
|---------|-------------|
| **Surgical editing** | `edit` tool applies find/replace edits (with fuzzy matching like pi), verifies uniqueness, creates backups, shows diffs |
| **Grep + find** | `grep` (regex/literal, case-insensitive, context lines, glob filtering) and `find` (glob-based) |
| **Read file** | `read` with offset/limit line-range support |
| **Configurable bash** | Command allowlist/blocklist via DB settings, env vars, or hardcoded defaults |
| **Context compaction** | Automatically condenses long histories between runs to fit smaller context windows |
| **Docker sandboxing** | Optional Docker-backed command execution with memory/CPU limits |
| **Web UI** | Built-in web interface with chat, tasks, file browser, and run history |
| **CLI** | Full CLI for configuration, compaction, and sandbox management |
| **Multi-step tasks** | Define task flows with implement → review → fix iterations |
| **Notes propagation** | Implementation notes feed into reviews, review notes feed into fixes |

## Usage

### Web UI

```bash
smith2
```

Opens the web interface at `http://localhost:8080`. The UI has four tabs:

- **Chat** — Interactive chat with the agent (tool calls, file edits, command execution)
- **Tasks** — Define and run multi-step task flows (implement → review → fix)
- **Files** — Browse and edit project files
- **History** — View past runs with raw logs, diffs, and file changes

### CLI

```bash
# Show status
smith2 status

# Configure bash restrictions
smith2 bash-allow python3 pytest    # add to allowlist
smith2 bash-block rm sudo           # add to blocklist
smith2 bash-config                  # show current config

# Manage compaction
smith2 compact                      # manually compact context
smith2 compact-status               # show compaction stats

# Configure sandboxing
smith2 sandbox-config --backend docker
```

## Tool Reference

Available tools in the agent loop:

| Tool | Description | Profiles |
|------|-------------|----------|
| `read` | Read a file with offset/limit | ask, implement, review |
| `write` | Write a new file or overwrite | implement |
| `edit` | Surgical find/replace edits (array of {oldText, newText}) | implement |
| `grep` | Regex/literal pattern search with context | ask, implement, review |
| `find` | Glob-based file discovery | ask, implement |
| `bash` | Execute a command (sandboxed/restricted) | implement, review |
| `ls` | List directory contents | all |
| `search_project_context` | Search indexed project memory | all |
| `get_file_summary` | Get indexed file summary | all |
| `get_related_files` | Get file relationships | all |

## Bash Configuration

Bash restrictions cascade: **DB settings → env vars → hardcoded defaults**.

### Via CLI

```bash
smith2 bash-allow python3 pytest node
smith2 bash-block rm sudo dd
smith2 bash-config
```

### Via environment

```bash
export SMITH_ALLOWED_COMMANDS="python3,pytest,node,npm"
export SMITH_BLOCKED_ARGS="install,add,remove,delete"
```

### Default restrictions

- **Allowed by default**: python3, pytest, npm, pnpm, node, npx
- **Blocked by default**: install, add, remove, uninstall, delete, publish, deploy, start, dev, serve

## Sandboxing

### Direct (default)

Commands run directly on the host with user permissions.

### Docker

```bash
smith2 sandbox-config --backend docker --image python:3.11-slim
# Or via env:
export SMITH_SANDBOX_BACKEND=docker
```

Requires Docker to be installed and the user to have permission to run containers.

## Configuration

Smith stores per-project settings in `.agent-smith/smith.db` (SQLite). Settings are loaded in this order:

1. Database `settings` table
2. Environment variables `SMITH_*`
3. Hardcoded defaults

Key env vars:

| Variable | Default | Description |
|----------|---------|-------------|
| `SMITH_HOST` | `0.0.0.0` | Web server bind address |
| `SMITH_PORT` | `8080` | Web server port |
| `SMITH_PROVIDER` | `lmstudio` | Default LLM provider |
| `SMITH_MODEL` | `gemma4-26b-a4b-uncensored-hauhaucs-balanced` | Default model |
| `SMITH_RECURSION_LIMIT` | `40` | Max tool calls per run |
| `SMITH_SANDBOX_BACKEND` | `direct` | Sandbox backend (`direct` or `docker`) |
| `SMITH_ALLOWED_COMMANDS` | — | Comma-separated allowlist |
| `SMITH_BLOCKED_ARGS` | — | Comma-separated blocklist |

## Project Structure

```
agent-smith-v2/
├── smith/
│   ├── agent.py          # Tool definitions & streaming agent loop
│   ├── cli.py            # Typer CLI (smith2 command)
│   ├── coordinator.py    # Project coordinator, auto-compaction
│   ├── db.py             # SQLite project database
│   ├── providers.py      # LLM provider configs
│   ├── registry.py       # Task profiles
│   ├── server.py         # FastAPI web server + WebSocket
│   ├── compaction.py     # Context compaction engine
│   ├── sandbox.py        # Docker & direct sandbox backends
│   ├── schema.sql        # Database schema
│   └── ...
├── static/
│   ├── index.html        # Single-page web UI
│   └── registry.html     # Registry sidebar
├── pyproject.toml        # Package metadata & entry points
└── README.md
```

## License

MIT
