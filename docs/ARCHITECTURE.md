# Agent Smith — Application Architecture Specification

## 1. Overview

**Agent Smith** is a Matrix-themed, local-first terminal coding agent designed for small/medium codebases and local Ollama models. Its core philosophy: *"The app is the agent. The model is a constrained reasoning and patching engine."*

Instead of dumping the entire repo into a local model's context window, it builds a persistent **project intelligence index** (file hashes, summaries, symbols, import graphs, task memory, and dense context packets) and retrieves only what's relevant for each task.

Beyond single-agent operation, Agent Smith includes a full **agent organizer/orchestrator** system: a built-in HTTP server dashboard that coordinates multiple worker agents, dispatches tasks, tracks iterations, manages change-set reviews, and routes human approvals — all from the same codebase.

### Key metrics
- **Language:** TypeScript, Node.js ≥18
- **Module system:** ESM (`"type": "module"`)
- **Module resolution:** NodeNext (imports use `.js` extensions)
- **Lines of code:** ~19,000 across 81 source files
- **Database:** SQLite via better-sqlite3 (synchronous API) — 2 databases (project index + organizer)
- **TUI framework:** Ink v5 (React renderer for terminals)
- **CLI framework:** Commander v13
- **Config validation:** Zod

---

## 2. Module Architecture

```
src/
├── main.ts                     # Entry point (shebang, calls createCli)
├── cli.ts                      # CLI commands + TUI launcher (~1592 lines)
│
├── types/index.ts              # All shared TypeScript types (801 lines, zero imports)
│
├── config/                     # Configuration
│   ├── config.ts               # Zod schema, defaults, load/ensure
│   └── projectRoot.ts          # Detects project root (walks up to .git/package.json)
│
├── events/events.ts            # EventEmitter factory (1 function)
│
├── db/db.ts                    # SQLite schema (10+ tables, 8+ indexes) + key-value meta helpers
│
├── providers/                  # 🔌 LLM provider connections
│   ├── ollama.ts               # Ollama HTTP API (generate + chat), Qwen message normalization
│   └── providers.ts            # Multi-provider registry: Ollama/OpenAI/Anthropic providers,
│                               #   factory, global caching, model resolution, convenience wrappers
│
├── index/                      # 🔍 Codebase knowledge indexing
│   ├── scanner.ts              # File discovery (fast-glob + .gitignore/.agentignore)
│   ├── hashing.ts              # SHA-256 file hashing
│   ├── extractor.ts            # Symbol/import extraction (regex-based for TS/JS/Python/C-like)
│   ├── tags.ts                 # 30-tag global taxonomy + heuristic keyword tagging
│   ├── tagger.ts               # Thin async wrapper over heuristicTags
│   ├── graph.ts                # Import graph (resolve, rebuild, BFS expansion, ASCII render)
│   ├── indexer.ts              # Index orchestrator: scan → hash → symbol extract → import graph
│   │                           #   → heuristic tags → background LLM summary/tag queue
│   ├── reindexer.ts            # Re-index files touched by patches
│   └── watcher.ts              # Chokidar file watcher with debounced reindexing
│
├── context/                    # 📦 Context assembly
│   ├── tokenEstimate.ts        # Rough token counter (text.length / 4)
│   ├── retriever.ts            # Task classification + multi-signal file scoring (8 signals)
│   ├── contextPacker.ts        # Dense context packet builder (token-budgeted)
│   ├── contextPlanner.ts       # Context planning adapter (buildContextPlan)
│   └── intent.ts               # Regex-based prompt intent classification (task/chat/meta)
│
├── agent/                      # 🤖 Agent pipeline
│   ├── taskRunner.ts           # Ask/patch orchestrator (~789 lines)
│   ├── summarizer.ts           # LLM file summarization (one-liner summary + importance 1-10)
│   ├── safety.ts               # Patch safety: forbidden paths, root confinement, file/line limits
│   ├── checks.ts               # Run configured commands (typecheck/test/lint/build) via execa
│   ├── patch.ts                # Unified diff validation/parsing
│   ├── memory.ts               # Task/edits/test-runs persistence
│   └── tools/
│       ├── qwenTools.ts         # Qwen function-calling loop (chat → extract calls → execute → repeat)
│       └── localTools.ts        # Local project tools (find_files, find_symbols, read_file, etc.)
│
├── chat/                       # 💬 Chat subsystem
│   ├── chatRuntime.ts          # Chat runtime logic
│   ├── chatStore.ts            # Chat sessions + messages persistence
│   ├── questions.ts            # User question handling
│   └── markdown.ts             # Markdown utilities
│
├── tasks/                      # 📋 Task management
│   ├── taskStore.ts            # Work items CRUD
│   ├── taskPlanStore.ts        # Task plan steps CRUD
│   ├── taskPlanGenerator.ts    # Generate task plans
│   ├── taskImport.ts           # Bulk import tasks
│   ├── taskImportParser.ts     # Parse various import formats (plain/markdown/csv/json)
│   ├── taskFlowTemplates.ts    # Pre-built task flow templates
│   └── taskFlowTemplateRenderer.ts  # Render templates to text
│
├── changes/                    # 🔄 Change set / diff review system
│   ├── changeSetStore.ts       # CRUD for change sets + file/hunk reviews
│   ├── changeSetApply.ts       # Apply accepted hunks/files
│   ├── hunkDiffBuilder.ts      # Build diff from accepted hunks
│   ├── diffParser.ts           # Parse unified diffs
│   ├── diffPreview.ts          # Compact diff previews
│   ├── diffStats.ts            # Diff statistics
│   └── diffFilter.ts           # Diff filtering
│
├── checkpoints/                # 🔖 Git checkpoint system
│   ├── checkpointStore.ts      # Checkpoint CRUD
│   └── gitCheckpoint.ts        # Git-based checkpoint/revert
│
├── runtime/                    # ⚡ Runtime engine
│   ├── smithRuntime.ts         # Runtime wrapper: dispatch actions → runAsk/runPatch/indexer
│   └── actions.ts              # Action type re-exports + action label helpers
│
├── organizer/                  # 🎛 Agent orchestration system
│   ├── server.ts               # Organizer HTTP server (~562 lines) — API routes for agents,
│   │                           #   tasks, projects, buckets, iterations, chat proxy, task import
│   ├── organizerDb.ts          # Organizer database (SQLite): agents, tasks, projects, buckets,
│   │                           #   iterations, events
│   ├── taskDispatcher.ts       # Task dispatch orchestration (~382 lines)
│   ├── taskTimeline.ts         # Task timeline builder (iterations + events)
│   ├── heartbeat.ts            # Heartbeat sender to organizer
│   ├── workerClient.ts         # Worker client abstraction
│   ├── workerApiClient.ts      # Worker API client (HTTP calls to remote agent APIs)
│   └── web/                    # Organizer Dashboard web UI (inline HTML/CSS/JS)
│       ├── html.ts             # Single-page app HTML template (~32 lines export)
│       ├── styles.ts           # Inline CSS (~214 lines export)
│       └── client.ts           # Inline vanilla JavaScript (~448 lines export)
│
├── lan/                        # 🌐 Web LAN interface
│   └── server.ts               # HTTP server + inline HTML/CSS/JS web app (~1821 lines)
│
├── api/                        # 🔌 Agent API server
│   └── server.ts               # API server skeleton (actions, tasks, chat, questions endpoints)
│
├── utils/                      # Shared utilities
│   ├── json.ts                 # extractJson: balanced JSON extraction from prose
│   ├── language.ts             # detectLanguage: file extension → language name map
│   └── network.ts              # LAN address discovery
│
└── tui/                        # 🖥 Terminal UI (Ink/React)
    ├── theme.ts                # Color palette (9 constants, green-on-black Matrix theme)
    ├── App.tsx                 # Main component: state, keyboard input, slash commands, streaming
    │                           #   (~1732 lines)
    ├── screens/                # Full-screen views
    │   ├── BootScreen.tsx       # Animated boot screen with progress spinner
    │   ├── MainScreen.tsx       # Main layout: Header, ContentArea, InfoPanel, PromptBar, StatusLine
    │   ├── IndexDashboard.tsx   # 4-panel index view (Overview, Summaries, Graph, Tags)
    │   ├── ContextPreview.tsx   # Context packet inspector
    │   ├── ChangesScreen.tsx    # Change set review screen (hunk-level accept/reject)
    │   └── OrganizerScreen.tsx  # Agent organizer view — full-screen dashboard with agent list
    │                           #   on left, tabbed detail panel (Overview/Tasks/Capabilities) on right
    └── components/             # Reusable TUI components
        ├── Header.tsx           # Project name, model name, Ollama status LED
        ├── ContentArea.tsx      # Chat history bubbles, streaming text, patch display
        ├── InfoPanel.tsx        # Right sidebar (project, model, provider, context budget)
        ├── MatrixRain.tsx       # Animated katakana rain overlay
        └── ChangeSetView.tsx    # Change set file/hunk review layout
```

### Module dependency graph (simplified)

```
types/  ←  (everything depends on this — zero imports)
  ↑
utils/  ←  (json.ts, language.ts, network.ts — pure utilities, zero deps on src/)
  ↑
config/ events/ db/
  ↑        ↑      ↑
providers/ ← index/ ← context/ ← agent/ ← runtime/ ← organizer/
  ↑                         ↑        ↑          ↑
chat/ ← tasks/ ← changes/ ← checkpoints/
  ↑      ↑         ↑           ↑
  └────────── api/ ────────────┘
  └────────── lan/ ────────────┘
  └────────── tui/ ────────────┘
  └────────── cli.ts
```

---

## 3. Data Flow: Two Interaction Modes

### 3.1 Discuss Mode (`runAsk`, triggered by `/mode discuss` or chat-ish prompts)

```
User input
  → evaluatePrompt()         [context/intent.ts] — classify intent (task/chat/meta)
  → classifyTask()           [context/retriever.ts] — extract file hints, symbol hints, keywords
  → retrieve()               [context/retriever.ts] — score files by 8 signals:
        1. ripgrep keyword hits (weight 8x)
        2. Tag overlap (7x)
        3. Summary text match (6x)
        4. Symbol name match (5x)
        5. File-hint match (4x)
        6. Task memory boost (3x)
        7. Import graph expansion (2x)
        8. Related test inclusion (1x)
  → packContext()            [context/contextPacker.ts] — build token-budgeted prompt with:
        - Task header + rules
        - File contents (whole for small files, symbol-windows for large)
        - Footer
  → generateWithProvider()   [providers/providers.ts] — send to LLM
  → finalizeAnswer()         [agent/taskRunner.ts] — post-process: retry on failure, extract JSON
  → Display in TUI
```

### 3.2 Build Mode (`runPatch`, triggered by `/mode build` or task-ish prompts)

```
User input
  → evaluatePrompt()         — intent classification
  → (optional) runPlanningTools() — offline tool execution (find_files, find_symbols)
  → classifyTask()           — classification
  → retrieve()               — file scoring
  → packContext()            — context assembly
  → generateWithProvider()   — LLM generates unified diff in markdown fences
  → validateUnifiedDiff()    [agent/patch.ts] — parse diff, validate format
  → checkPatchSafety()       [agent/safety.ts] — forbidden paths, root confines, limits
  → gitApply()               — git apply --check, then apply
  → reindexAffected()        [index/reindexer.ts] — re-scan changed files
  → runChecks()              [agent/checks.ts] — typecheck, test, lint, build
  → (if checks fail) repairLoop (max 3 attempts):
        send failures + diff to debugger model → regenerate → re-validate
  → recordEdit()             [agent/memory.ts] — persist to DB
  → finishTask()
  → Display outcome in TUI
```

---

## 4. Database Architecture

### 4.1 Project Intelligence DB (`.agent/index.sqlite`)

#### Tables

| Table | Purpose | Key columns |
|-------|---------|-------------|
| `files` | Indexed source files | path (PK), language, hash, size_bytes, is_test, is_generated, summary, status (fresh/dirty) |
| `tags` | Global tag taxonomy (30 tags) | id, name, description |
| `file_tags` | File-to-tag associations | file_id, tag_id, confidence, source (heuristic/model) |
| `symbols` | Extracted code symbols | file_id, name, kind, start_line, end_line, signature, summary, hash |
| `symbol_tags` | Symbol-to-tag associations | symbol_id, tag_id, confidence, source |
| `imports` | Import graph edges | from_file_id, to_file_id, import_text, resolved_path |
| `symbol_edges` | Symbol-level relationships | from_symbol_id, to_symbol_id, edge_type |
| `tasks` | Task execution history | id, task_text, created_at, status, chosen_model, success |
| `edits` | Applied patches | task_id, file_id, old_hash, new_hash, patch, created_at |
| `meta` | Key-value store | key, value (used for: project_summary, provider_available, summary caches) |

#### Indexes
- `files(status)`, `symbols(file_id)`, `symbols(name)`, `file_tags(tag_id)`, `imports(from_file_id)`, `imports(to_file_id)`, `edges(from_file_id)`, `edges(to_file_id)`

### 4.2 Organizer DB (separate SQLite, managed by `organizerDb.ts`)

#### Tables

| Table | Purpose | Key columns |
|-------|---------|-------------|
| `agents` | Registered worker agents | id (PK), name, hostname, project_name, project_root, status, api_base_url, api_enabled, actions_json, models_json, index_json, capabilities_json, current_task_id, last_heartbeat_at, registered_at, updated_at |
| `tasks` | Orchestrated tasks | id (PK), project_id, bucket_id, title, prompt, mode, priority, status, assigned_agent_id, implement_model, review_model, max_iterations, current_iteration, auto_approve, auto_apply, require_checks, checks_json, result_json, remote_task_id, remote_change_set_id, created_at, updated_at |
| `task_iterations` | Per-iteration records | id, task_id, iteration_index, status, implement_model, review_model, implementation_summary, create_files, modify_files, delete_files, review_decision, review_feedback, review_next_prompt, check_results, error_message, started_at, completed_at |
| `task_events` | Task event log | id, task_id, agent_id, event_type, message, created_at |
| `projects` | Project grouping | id, name, description, created_at, updated_at |
| `buckets` | Task buckets within projects | id, project_id, name, description, sort_order, created_at, updated_at |

---

## 5. Provider Architecture

### Supported backends
- **Ollama** (local): HTTP API at configurable base URL, `/api/generate` and `/api/chat` endpoints
- **OpenAI**: Chat completions API
- **Anthropic**: Messages API

### Provider interface
```typescript
interface Provider {
  generate(prompt, system?, options?) → GenerateResult
  chat(messages, functions?, options?) → ChatResult
  listModels() → string[]
  isAvailable() → boolean
}
```

### Key flows
- **resolveModelProvider**: Parses `provider:model` colon syntax, resolves to provider instance + model name
- **Global caching**: `getProviders()` is a module-level singleton; `invalidateProviderCache()` resets it
- **Qwen function calling**: `chatWithQwenFunctions()` sends tools to Ollama `/api/chat`, normalizes responses (handles Ollama `tool_calls`, OpenAI `function_call`, and raw `<tool_call>` XML blocks)

---

## 6. Indexing Subsystem

### Startup sequence
1. `scanProjectFiles()` — glob all files, filter through `.gitignore` + `.agentignore` + config patterns
2. For each file:
   - Hash with SHA-256
   - Detect language from extension
   - Upsert into `files` table
   - If changed + parseable: read content
3. Extract symbols (regex-based for TS/JS, Python, C-like)
4. Extract imports
5. Apply heuristic tags (keyword matching against 30-taxonomy)
6. Build import graph edges
7. Queue changed files for background LLM summarization

### Background intelligence queue
- Runs with concurrency 1 (sequentially)
- Pause/resume support (TUI pauses during user prompts so model is fully available)
- For each file: LLM generates one-sentence summary + importance score (1-10)
- Generates project-level summary from aggregate stats

### File watcher
- Chokidar watches for file changes
- Debounced re-indexing (default 350ms)
- Changed files re-enter the background intelligence queue

---

## 7. Configuration System

Config stored at `.agent/config.json` in project root. Validated by Zod on load.

### Key configuration sections

```typescript
models: {
  tagger: "qwen2.5-coder:3b-16k",      // model for file tagging
  summarizer: "qwen2.5-coder:3b-16k",   // model for file summaries
  patcher: "qwen2.5-coder:7b-8k",       // model for generating patches
  debugger: "deepseek-r1:7b-8k"         // model for repair loop
}
providers: Record<string, ProviderEntry>  // named provider configs
defaultProvider: "ollama"
ollama: { baseUrl, temperature, numPredict }
index: { watch, debounceMs, workerCount, summaryConcurrency, ignore[] }
context: { maxPromptTokens: 8000, maxFiles: 6, maxSymbols: 20, graphDepth: 2, ... }
commands: { test, typecheck, lint, build }  // project commands for patch validation
safety: { forbiddenPaths[], maxPatchFiles: 6, maxPatchLines: 500 }
lan: { port: 3000 }
organizer: { port: 8787, heartbeatMs: 10000, staleAfterMs: 15000, token, dbPath }
theme: { mode: "matrix", animations, showBootAnimation }
```

---

## 8. Agent Orchestration System

The organizer subsystem enables multi-agent coordination from a single dashboard.

### Architecture
```
Organizer Server (HTTP, port 8787)
├── Organizer DB (SQLite)
├── Dashboard Web UI (served at /dashboard)
├── REST API (/api/*)
│   ├── Agent registration + heartbeat
│   ├── Task CRUD + assignment + dispatch
│   ├── Iteration tracking + event log
│   ├── Chat proxy to worker agents
│   ├── Question proxy to worker agents
│   ├── Task import (plain/markdown/csv/json)
│   ├── Task flow templates
│   └── Project + bucket management
└── Worker communication
    ├── Heartbeat receiver (agents register via POST /api/agents/register)
    ├── Task dispatcher (sends actions to agent API)
    └── Worker API client (proxies chat/tasks/changes to agent endpoints)
```

### Agent lifecycle
1. **Registration**: Worker sends `POST /api/agents/register` with heartbeat payload (agentId, name, hostname, project info, API base URL, models, capabilities, index status)
2. **Heartbeat**: Worker sends periodic heartbeats to `POST /api/agents/:id/heartbeat`; agents not seen within `staleAfterMs` (default 15s) are marked offline
3. **Task dispatch**: Organizer sends actions to agent's API (`/api/actions`) via `workerApiClient.ts`, tracking iterations and events
4. **Review flow**: Tasks can auto-approve or require human review; organizer collects iteration data (diffs, check results, summaries) for the review panel

### Agent statuses
- `idle` — online, available
- `busy` — executing a task
- `indexing` — building the project index
- `offline` — not seen recently
- `error` — encountered an error
- `paused` — temporarily suspended

### Task statuses
- `queued` — awaiting assignment
- `assigned` — assigned to an agent, not yet dispatched
- `running` — agent is executing
- `iterating` — between iterations (reviewer is thinking)
- `reviewing` — being reviewed
- `needs_review` — requires human approval
- `auto_approved` — automatically approved
- `completed` — finished successfully
- `failed` — encountered an error
- `skipped` / `cancelled` — terminated

### Dashboard Web UI
The dashboard (`/dashboard`) is served as inline HTML/CSS/JS from template literal strings with the following layout:
- **Left panel**: Narrow agent list (~230px) showing each agent's name, status dot, current task, index stats, and last seen time
- **Right panel**: When no agent is selected, shows system overview with clickable metric cards (Agents Online, Running, Needs Review, Failed, Completed, Queued) that navigate to filtered views. When an agent is selected, shows tabbed detail:
  - **Chat tab**: Full chat interface proxied to the agent's `/api/chat/sessions` 
  - **Tasks tab**: Agent's tasks grouped by status with Dispatch/Approve/Restart/Skip actions, task creation form, agent assignment
  - **Reviews tab**: Tasks needing human review with approve/restart/skip buttons
  - **Status tab**: Agent info (ID, host, project, API URL, capabilities, models, index stats, current task)
- **Top bar**: Live agent/task/review counts, refresh button
- **Auto-refresh**: 3-second polling cycle

### TUI Organizer View
Accessible via `/organize` command. Full-screen dashboard with:
- **Header**: Port, URL, global stats (agent counts, task counts), keyboard shortcuts
- **Left panel**: Agent list with status dots, names, status, active task count, heartbeat age. Navigate with `↑/↓`/`j/k`
- **Right panel**: Tabbed detail for selected agent (`Tab` or `1`/`2`/`3`):
  - **Overview**: Name, ID, status, host, project, API URL, model, index stats, current task details
  - **Tasks**: All tasks assigned to the agent, grouped by status
  - **Capabilities**: Listed capabilities, available actions
- **Footer**: Global task/agent counts
- **Auto-refresh**: 2-second polling cycle

---

## 9. TUI Architecture

### Component tree
```
App (root — state, keyboard input, slash commands, streaming)
├── BootScreen           (animated intro with progress spinner)
├── MainScreen            (main layout after boot)
│   ├── Header            (project name, model name, Ollama status)
│   ├── MatrixRain        (animated katakana rain overlay)
│   ├── ContentArea       (chat history bubbles, streaming text, diff display)
│   ├── InfoPanel         (right sidebar: project info, context budget bar)
│   ├── PromptBar         (inline in MainScreen — command input with autocomplete)
│   └── StatusLine        (inline in MainScreen — bottom status)
├── IndexDashboard        (4-section view: Overview, Summaries with search, Graph, Tags)
│                         (navigate sections with 1/2/3/4 keys)
├── ContextPreview        (context packet inspector: task, tokens, files, symbols, prompt)
├── ChangesScreen         (change set review: hunk-level accept/reject, file/chunk tabs)
│                         (keyboard: a/r accept/reject, Tab/f/h focus, p apply)
└── OrganizerScreen       (full-screen agent dashboard: left agent list + right tabbed detail)
                          (keyboard: ↑/↓/j/k select, Tab/1/2/3 switch tabs, Esc exit)
```

### View state switching
Central `view` state in App.tsx: `"main" | "index" | "context" | "changes" | "organizer"`. Each non-main view renders a dedicated full-screen component and returns to `"main"` on Escape.

### Key patterns
- **Alternate screen buffer**: Entered on mount (`\u001B[?1049h`), exited on unmount + `process.on('exit')` fallback
- **Streaming**: Tokens buffered in `useRef`, flushed to React state at ~12fps to avoid Ink reconciliation overhead
- **Signal handling**: SIGINT/SIGTERM/SIGHUP cleanly unmount Ink, stop watcher, restore terminal
- **State persistence**: TUI state (mode, model, output buffer, prompt history) saved to `.agent/tui-state.json` (version 3)
- **Web sync**: LAN server syncs chat entries, mode, and model selection via SSE events
- **Autocomplete**: For `/` commands, model names, provider subcommands; shows suggestions popup below prompt bar
- **Modal system**: Question select modal (for `/model list`, `/setup`) and text input modal (for API key entry)

### Slash commands (built into App.tsx)
`/help`, `/mode`, `/model`, `/provider`, `/setup`, `/reindex`, `/index`, `/organize`, `/clear`, `/summarize`, `/lan`, `/api`, `/changes`, `/change`, `/accept`, `/reject`, `/apply`, `/revert`, `/undo`, `/exit`, `/quit`, `/animation`, `/context`

### Global keyboard shortcuts
- `Enter` → submit prompt
- `Esc` → clear input / abort task (double-tap within 400ms) / return to main from sub-view
- `↑/↓` → scroll output
- `Ctrl+↑/↓` → prompt history
- `PgUp/PgDn` → fast scroll
- `Tab` → autocomplete
- `Ctrl+C` → quit

### Non-TUI mode (CLI subcommands)
- `smith index` — bootstrap scan/index
- `smith status` — project/index status (JSON)
- `smith ask <task>` — ask question with dense context (text output)
- `smith patch <task>` — generate/validate/apply unified diff (text output)
- `smith inspect <target>` — inspect file or symbol
- `smith graph <target>` — show import neighborhood
- `smith config` — manage configuration

---

## 10. Agent Pipeline Detail

### runAsk (Discuss mode)
1. `evaluatePrompt()` — returns `PromptPlan` with intent, objective, tasks, keywords
2. If task intent + Ollama available: optionally run offline tools (find_files, find_symbols) for planning
3. `classifyTask()` — extract file hints (regex on filenames), symbol hints (PascalCase identifiers), keyword hints
4. `retrieve()` — multi-signal file scoring, returns top N files + seed symbols
5. `packContext()` — build dense context packet under token budget
6. `generateWithProvider()` — send to LLM
7. `finalizeAnswer()` — post-process: retry if empty, extract structured JSON payload

### runPatch (Build mode)
1–5: Same as runAsk
6. `generateWithProvider()` — LLM generates unified diff in ```diff fences
7. `stripFences()` — extract diff from markdown fences
8. `validateUnifiedDiff()` — validate diff format, extract file paths
9. `checkPatchSafety()` — enforce safety rules
10. `gitApply(checkOnly: true)` — dry-run git apply
11. `gitApply()` — actually apply the patch
12. `recordEdit()` — persist to DB
13. `reindexAffected()` — re-scan changed files (extract symbols, imports, tags)
14. `runChecks()` — execute typecheck, test, lint, build
15. If checks fail → repair loop (max 3): send failures to debugger model → generate new diff → repeat from step 7
16. `finishTask()`

### Answer post-processing
- `normalizeAnswer()`: Strips markdown fences, detects JSON envelopes (8 known key names: `answer`, `summary`, `explanation`, `patch`, `diff`, `error`, `suggestion`, `note`), detects placeholder junk
- `extractJson()`: Balanced brace/bracket extraction from prose
- Retry logic: If answer is empty/junk, retry once with explicit formatting instructions

---

## 11. Change Set Review System

The `changes/` module provides a formal review workflow for agent-generated patches:

### Data model
- **ChangeSet**: Groups related file changes, tracked with overall status (`pending`/`reviewing`/`accepted`/`rejected`/`applied`)
- **ChangedFileReview**: Per-file review with individual accept/reject status
- **ChangedHunkReview**: Per-hunk review with individual accept/reject status

### TUI review screen (`/change <id>`)
- Left: file list with status indicators (navigate with `↑/↓`)
- Right: diff preview for selected file
- Bottom: hunk-level review for selected file (navigate with `Tab` between files/hunks)
- Keyboard shortcuts: `a` accept, `r` reject, `A` accept all, `R` reject all, `p` apply accepted changes

### Git checkpoint system (`checkpoints/`)
- Creates git commits as checkpoints before applying changes
- Supports revert via `gitCheckpoint.ts`
- Checkpoint store for persistence

---

## 12. Web LAN Interface

- Node HTTP server (no framework) on configurable port (default 3000)
- Inline HTML/CSS/JS embedded as a TypeScript template literal (~1821 lines)
- Endpoints: `/api/state`, `/api/events` (SSE), `/api/chat`, `/api/command`, `/api/dashboard`, `/api/models`, `/api/filetree`, `/api/file`
- Real-time sync with TUI via EventEmitter (chat entries, mode, model changes)
- Matrix-themed web UI with chat, dashboard, file browser, file preview/editor

---

## 13. API Server

The `api/` module provides a local HTTP API for programmatic agent access:

- **Endpoints**: `/api/status`, `/api/actions`, `/api/tasks`, `/api/tasks/:id/patch`, `/api/changes`, `/api/chat/sessions`, `/api/questions`
- Used by the organizer system to communicate with worker agents remotely
- Supports action dispatch, task creation/patching, change set retrieval, chat proxy

---

## 14. Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| SQLite + synchronous API (better-sqlite3) | Fast, zero-config, single-file DB. Synchronous API avoids async complexity in TUI |
| Regex-based symbol extraction (not real tree-sitter) | Avoids native compilation complexity. Covers TS/JS/Python/C-like well enough |
| 30-tag fixed taxonomy | Model reasons about numbered tags, not free-form labels. Consistent across projects |
| Alternate screen buffer for TUI | Clean separation from prior terminal output. Restored on exit + crash fallback |
| Token budget (not context window) | Small models work better with dense, relevant context vs. dumping everything |
| Repair loop (max 3) | Local models produce imperfect patches; automatic retry with debugger model recovers |
| Inline HTML/CSS/JS (no framework) | Zero-build web UIs. No bundler complexity. Dashboard and LAN UI are self-contained |
| Organizer as embedded HTTP server | No external orchestrator needed. Dashboard + API share the same process |
| Change set review at hunk level | Fine-grained human review of AI changes without overwhelming diff volume |
| Agent chat proxy via organizer | Single dashboard can interact with any agent's chat, tasks, and questions |
| No semantic release/versioning | Simple MVP build pipeline. Version is pinned in package.json |

---

## 15. Package Dependencies

| Dependency | Version | Purpose |
|------------|---------|---------|
| `better-sqlite3` | ^11.7 | SQLite database |
| `chokidar` | ^4.0 | File system watcher |
| `commander` | ^13.1 | CLI framework |
| `execa` | ^9.5 | Shell command execution (test, typecheck, etc.) |
| `fast-glob` | ^3.3 | File discovery |
| `ignore` | ^7.0 | .gitignore parsing |
| `ink` | ^5.1 | Terminal UI framework (React) |
| `nanoid` | ^5.1 | ID generation |
| `pino` | ^9.7 | Structured logging |
| `react` | ^18.3 | UI component model (used by Ink) |
| `zod` | ^3.24 | Configuration schema validation |
| `tsx` | ^4.19 | TypeScript execution (dev) |
| `typescript` | ^5.8 | Compiler (dev) |
| `@types/better-sqlite3` | ^7.6 | SQLite type definitions (dev) |
| `@types/node` | ^22.13 | Node.js type definitions (dev) |
| `@types/react` | ^18.3 | React type definitions (dev) |

---

## 16. Module Replaceability

Each module can be replaced independently:

- **providers/**: Implement the `Provider` interface, register in `createProviders()`. Swap Ollama for LM Studio, llama.cpp, etc.
- **index/**: Replace regex-based extraction with real tree-sitter. Swap scanner for ripgrep. The rest of the system only consumes `Indexer` type.
- **context/**: Replace scoring algorithm in `retriever.ts`. Swap context packing strategy. The rest only consumes `ContextPacket` and `TaskClassification`.
- **agent/**: Replace `taskRunner.ts` with a different orchestration pattern. Swap safety rules, check commands, or tool definitions independently.
- **tui/**: Swap Ink for Blessed, terminal-kit, or a web-based UI. CLI subcommands work independently.
- **lan/**: Replace inline HTML with a proper frontend framework. Swap HTTP server for Express/Fastify.
- **organizer/**: Replace inline dashboard UI with React/Svelte/Vue. Swap task dispatcher for a message queue. The agent registration protocol (heartbeat + API) stays the same.
- **changes/**: Replace file/hunk review with git-based merge conflict resolution. The review abstraction layer keeps the rest of the system decoupled.

### Cross-module contracts
- **types/index.ts**: All shared types. Zero imports. Universal dependency.
- **utils/**: Pure functions with zero project imports. Safe to use from anywhere.
- **db/db.ts**: Exports `SmithDatabase` type and `openDatabase()`. Provides schema + meta helpers.
- **events/events.ts**: Exports `createEventBus()`. Event names: `index:*`, `ollama:*`, `chat:*`, `watcher:*`.
