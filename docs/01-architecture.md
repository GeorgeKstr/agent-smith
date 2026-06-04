# Agent Smith - Architecture

## Runtime stack

- Node.js 22+
- TypeScript
- Ink + React TUI
- SQLite via better-sqlite3
- chokidar watcher
- fast-glob + ignore scanner
- Ollama HTTP API
- later: tree-sitter, ripgrep, git apply

## Process

```text
CLI/TUI
  ├─ Event bus
  ├─ SQLite index
  ├─ Scanner
  ├─ Watcher
  ├─ Indexer
  ├─ Retriever
  ├─ Context packer
  ├─ Ollama client
  └─ Patch/check/reindex pipeline
```

## Startup

1. detect project root
2. ensure `.agent/config.json`
3. open `.agent/index.sqlite`
4. render boot screen
5. scan files
6. compare hashes
7. write file table
8. start watcher
9. switch to main UI
10. later phases add symbol/tag background work
