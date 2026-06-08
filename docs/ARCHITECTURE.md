# Agent Smith — Application Architecture Specification

## 1. Overview

**Agent Smith** is a local-first terminal coding agent designed for small/medium codebases and local and cloud LLM models. Its core philosophy: *"The app is the agent. The model is a constrained reasoning and patching engine."*

Instead of dumping the entire repo into a model's context window, it builds a persistent **project intelligence index** (file hashes, summaries, symbols, import graphs, task memory, and dense context packets) and retrieves only what's relevant for each task.

Beyond single-agent operation, Agent Smith includes a full **agent organizer/orchestrator** system: a built-in HTTP server dashboard that coordinates multiple worker agents, dispatches tasks, tracks iterations, manages change-set reviews, and routes human approvals — all from the same codebase.

### Key metrics
- **Language:** TypeScript, Node.js ≥18
- **Module system:** ESM (`"type": "module"`)
- **Module resolution:** NodeNext (imports use `.js` extensions)
- **Lines of code:** ~20,500 across 85 source files
- **Database:** SQLite via better-sqlite3 (synchronous API) — 2 databases with shared tables (project index + organizer)
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
│   └── providers.ts            # Multi-provider registry: Ollama/OpenAI/Anthropic/OpenRouter/DeepSeek/Google
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
├── agent/                      # 🤖 Agent pipeline (task execution)
│   ├── taskRunner.ts           # Ask/patch orchestrator (~789 lines)
│   ├── summarizer.ts           # LLM file summarization
│   ├── safety.ts               # Patch safety: forbidden paths, root confinement, file/line limits
│   ├── checks.ts               # Run configured commands (typecheck/test/lint/build) via execa
│   ├── patch.ts                # Unified diff validation/parsing
│   ├── memory.ts               # Task/edits/test-runs persistence
│   └── tools/
│       ├── qwenTools.ts         # Qwen function-calling loop
│       └── localTools.ts        # Local project tools (find_files, find_symbols, read_file, etc.)
│
├── chat/                       # 💬 Chat session system (shared DB tables)
│   ├── chatRuntime.ts          # Chat orchestration: session dispatch, answer routing, question detection
│   ├── chatStore.ts            # CRUD for sessions, messages, questions (67 lines)
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
│   ├── server.ts               # Organizer HTTP server (572 lines) — REST API for agents, tasks,
│   │                           #   projects, buckets, iterations, chat proxy, models proxy, import
│   ├── organizerDb.ts          # Organizer DB (SQLite): agents, tasks, projects, buckets, events
│   ├── taskDispatcher.ts       # Task dispatch orchestration
│   ├── taskTimeline.ts         # Task timeline builder (iterations + events)
│   ├── heartbeat.ts            # Heartbeat sender to organizer
│   ├── workerClient.ts         # Worker client abstraction
│   ├── workerApiClient.ts      # Worker API client (HTTP calls to remote agent APIs)
│   │                           #   Added: getChatSession(), listModels()
│   └── web/                    # Organizer Dashboard web UI (inline HTML/CSS/JS, no framework)
│       ├── html.ts             # SPA shell (~28 lines export)
│       ├── styles.ts           # GitHub-dark theme CSS (~420 lines export)
│       └── client.ts           # Full SPA (~690 lines export) — views, chat, tasks, ingest
│
├── lan/                        # 🌐 Web LAN interface (agent's own web UI)
│   └── server.ts               # HTTP server (1821 lines) — standalone web app with chat,
│                               #   file browser, dashboard, inline HTML/CSS/JS
│
├── api/                        # 🔌 Agent API server (used by organizer)
│   └── server.ts               # HTTP API (493 lines) — REST + SSE endpoints
│                               #   Added: GET /api/models
│
├── utils/                      # Shared utilities
│   ├── json.ts                 # extractJson: balanced JSON extraction from prose
│   ├── language.ts             # detectLanguage: file extension → language name map
│   └── network.ts              # LAN address discovery
│
└── tui/                        # 🖥 Terminal UI (Ink/React)
    ├── theme.ts                # Color palette (9 constants, green-on-black Matrix theme)
    ├── App.tsx                 # Main component (~1769 lines) — Added: TUI→chat session sync
    ├── screens/
    │   ├── BootScreen.tsx       # Animated boot screen
    │   ├── MainScreen.tsx       # Main chat layout
    │   ├── IndexDashboard.tsx   # 4-panel index view
    │   ├── ContextPreview.tsx   # Context packet inspector
    │   ├── ChangesScreen.tsx    # Change set review screen
    │   └── OrganizerScreen.tsx  # Compact monitor (225 lines) — agent stats, tasks, model usage
    └── components/
        ├── Header.tsx           # Project name, model name, provider status
        ├── ContentArea.tsx      # Chat history, streaming, patches
        ├── InfoPanel.tsx        # Sidebar with project/context stats
        ├── MatrixRain.tsx       # Animated overlay
        └── ChangeSetView.tsx    # Change set review layout
```

### Module dependency graph (simplified)

```
types/  ←  (everything depends on this — zero imports)
  ↑
utils/  ←  (json.ts, language.ts, network.ts — pure utilities)
  ↑
config/ events/ db/  (db/ now includes chat session tables: chat_sessions, chat_messages, user_questions)
  ↑        ↑      ↑
providers/ ← index/ ← context/ ← agent/ ← runtime/ ← organizer/
  ↑                         ↑        ↑          ↑
chat/ ← tasks/ ← changes/ ← checkpoints/
  ↑      ↑         ↑           ↑
  ├── api/ (API server — /api/models, /api/chat/sessions, /api/actions, etc.)
  ├── lan/ (LAN server — web UI with chat, file browser, SSE events)
  ├── tui/ (TUI: writes subtasks to tasks DB, syncs chat to chat sessions)
  └── organizer/ ←→ api/ (organizer proxies chat/models/tasks to agent APIs)
```

## 3. Data Flow: Two Interaction Modes

### 3.1 Discuss Mode (`runAsk`, triggered by `/mode discuss` or chat-ish prompts)

```
User input
  → evaluatePrompt()         [context/intent.ts] — classify intent (task/chat/meta)
  → classifyTask()           [context/retriever.ts] — extract file hints, symbol hints, keywords
  → retrieve()               [context/retriever.ts] — score files by 8 signals
  → packContext()            [context/contextPacker.ts] — build token-budgeted prompt
  → generateWithProvider()   [providers/providers.ts] — send to LLM
  → finalizeAnswer()         [agent/taskRunner.ts] — post-process
  → Display in TUI
  → (NEW) Sync to chat session — user msg + AI answer written to "TUI" chat session
```

### 3.2 Build Mode (`runPatch`, triggered by `/mode build` or task-ish prompts)

Same as Discuss Mode, plus:
- LLM generates unified diff in markdown fences
- `validateUnifiedDiff()` parses and validates the diff
- `checkPatchSafety()` enforces safety rules
- `gitApply()` applies the patch
- `reindexAffected()` re-scans changed files
- `runChecks()` executes typecheck, test, lint, build
- Repair loop (max 3 attempts) on check failures
- Patches and check results are also synced to the chat session

---

## 4. Database Architecture

### 4.1 Project Intelligence DB (`.agent/index.sqlite`)

Shared by all agent features — the single source of truth.

#### Tables

| Table | Purpose | Key columns |
|-------|---------|-------------|
| `files` | Indexed source files | path (PK), language, hash, size_bytes, summary, status (fresh/dirty) |
| `tags` | Global tag taxonomy (30 tags) | id, name, description |
| `file_tags` | File-to-tag associations | file_id, tag_id, confidence, source (heuristic/model) |
| `symbols` | Extracted code symbols | file_id, name, kind, start_line, end_line, signature, summary |
| `symbol_tags` | Symbol-to-tag associations | symbol_id, tag_id, confidence, source |
| `imports` | Import graph edges | from_file_id, to_file_id, import_text, resolved_path |
| `symbol_edges` | Symbol-level relationships | from_symbol_id, to_symbol_id, edge_type |
| `tasks` | Task execution history | id, task_text, created_at, status, chosen_model, success |
| `edits` | Applied patches | task_id, file_id, old_hash, new_hash, patch, created_at |
| `meta` | Key-value store | key, value |
| **`chat_sessions`** | Chat sessions | id, title, scope, task_id, created_at, updated_at |
| **`chat_messages`** | Chat messages | id, session_id, role, content, model, action_kind, runtime_task_id, created_at |
| **`user_questions`** | Pending questions | id, session_id, kind, prompt, options_json, answer_json, status |
| `work_items` | Work items (task store) | id, title, description, status, priority, assigned_agent_id, source |
| `task_plan_steps` | Task plan steps | id, task_id, title, status, sort_order, notes |
| `change_sets` | Change sets | id, task_id, status, summary, diff, checkpoint_id, created_at |
| `checkpoints` | Git checkpoints | id, task_id, commit_hash, created_at |

### 4.2 Organizer DB (separate SQLite, `~/.agent-smith/organizer.sqlite`)

| Table | Purpose | Key columns |
|-------|---------|-------------|
| `organizer_agents` | Registered worker agents | id, name, hostname, project_name, status, api_base_url, models_json, capabilities_json, last_heartbeat_at |
| `organizer_tasks` | Orchestrated tasks | id, project_id, title, prompt, status, assigned_agent_id, implement_model, review_model, max_iterations, current_iteration, auto_approve, auto_apply |
| `organizer_task_iterations` | Per-iteration records | id, task_id, iteration_index, status, implementation_summary, changed_files, check_results, review_decision, diff_preview |
| `organizer_task_events` | Task event log | id, task_id, agent_id, event_type, message |
| `organizer_projects` | Project grouping | id, name, description |
| `organizer_buckets` | Task buckets | id, project_id, name, sort_order |

---

## 5. Provider Architecture

### Supported backends
- **Ollama** (local): HTTP API at configurable base URL
- **OpenAI**: Chat completions
- **Anthropic**: Messages API
- **OpenRouter**: Multi-model proxy
- **Google Gemini**: Generative AI
- **DeepSeek**: Chat completions
- **OpenCode Zen / Zen Go**: Managed AI gateway

### Key functions
- `listProviderModels(config, providerId?)` → returns all models from all providers with `provider:model` syntax for non-default providers. The TUI and API server both call this.
- `isProviderAvailable(config, providerId?)` → health check
- `resolveProviderModelName(config, preferred, installed)` → fuzzy-matches model names
- `generateWithProvider(config, modelSpec, prompt, options)` → send single prompt
- `chatWithProvider(config, modelSpec, messages, functions?, options?)` → chat with function calling

---

## 6. Indexing Subsystem

### Startup sequence
1. `scanProjectFiles()` — glob with `.gitignore` + `.agentignore` filtering
2. For each file: SHA-256 hash → detect language → upsert into `files` table
3. Extract symbols + imports (regex-based)
4. Apply heuristic tags (keyword matching against 30-taxonomy)
5. Build import graph edges
6. Queue changed files for background LLM summarization (concurrency 1, pause/resume support)

---

## 7. Configuration System

Config stored at `.agent/config.json`. Validated by Zod.

Key sections: `models`, `providers`, `defaultProvider`, `ollama`, `index`, `context`, `commands`, `safety`, `lan`, `organizer`, `theme`

---

## 8. Agent Orchestration System

### Architecture
```
Organizer Server (HTTP, port 8787)
├── Organizer DB (SQLite)
├── Dashboard Web UI (served at /dashboard)
├── REST API (/api/*)
│   ├── Agent registration + heartbeat
│   ├── Task CRUD + assignment + dispatch
│   ├── Iteration tracking + event log
│   ├── Chat proxy → worker agents (sessions, messages, questions)
│   ├── Models proxy → worker agents (GET /api/agents/:id/models)
│   ├── Task import (plain/markdown/csv/json)
│   ├── Task flow templates
│   └── Project + bucket management
└── Worker communication
    ├── Heartbeat receiver (POST /api/agents/register)
    ├── Task dispatcher (sends actions to agent API)
    └── Worker API client (proxies chat/tasks/changes/models to agent endpoints)
```

### Agent lifecycle
1. **Registration**: Worker sends heartbeat payload with agentId, name, hostname, project info, API base URL, models, capabilities, index status
2. **Heartbeat**: Periodic heartbeats; agents not seen within 15s are marked offline
3. **Task dispatch**: Organizer sends actions to agent's `/api/actions` via `workerApiClient.ts`
4. **Review flow**: Auto-approve or human review; organizer collects diff previews, check results, iteration summaries

### Dashboard Web UI
The organizer dashboard (`/dashboard`) is a server-side-rendered (in-memory from TS template literals) vanilla JavaScript SPA with:

- **Visual design**: GitHub-dark color scheme (`#0d1117` bg, `#c9d1d9` text, `#58a6ff` accent blue), system fonts, semantic status colors
- **Left panel (220px)**: Agent cards with status dots, project name, heartbeat age, task counts (running/review)
- **Right panel**: When agent selected, shows a tab bar with Tasks/Chat tabs
  - **Tasks tab**: Filterable/searchable task list grouped by status, inline task card expansion (click to load iteration timeline with prompts, policy editor, diffs, check results, review feedback), Dispatch/Approve/Restart/Skip buttons, "Ingest Flow" panel (paste markdown/JSON/CSV), +New Task form
  - **Chat tab**: Session picker, full model selector (agent's configured models + all provider models), message bubbles with markdown rendering (code fences, bold, italic, lists), action-kind selector (ask/patch/retrieve/context), open questions panel, Enter to send
- **Mobile**: Bottom nav bar (←Agents | Tasks | Chat), agent panel fills 35vh or hides behind main panel, safe-area-inset padding
- **Auto-refresh**: 3-second polling, paused while typing

### TUI Organizer View
Accessible via `/organize` — lightweight compact monitor (225 lines):
- Title line with dashboard URL
- Agent counts (online/busy/offline)
- Task counts (active/review/done/queued/failed)
- Model usage summary
- Recent activity (last 12 task status changes, truncated)
- Footer with key hints (q quit, r refresh, full controls at dashboard URL)
- Only q/Esc and r keybinds — no task controls in TUI

---

## 9. TUI Architecture

### Component tree
```
App (root — state, keyboard input, slash commands, streaming, chat session sync)
├── BootScreen           (animated intro)
├── MainScreen            (main chat layout)
│   ├── Header / ContentArea / InfoPanel / PromptBar / StatusLine
│   └── MatrixRain        (animated overlay)
├── IndexDashboard        (4-panel index view)
├── ContextPreview        (context packet inspector)
├── ChangesScreen         (hunk-level change set review)
└── OrganizerScreen       (compact monitor: stats + models + recent activity)
```

### View state switching
`"main" | "index" | "context" | "changes" | "organizer"` — Escape returns to main.

### Chat session sync
The TUI now writes each interaction to the shared `chat_sessions`/`chat_messages` DB tables:
- Creates a "TUI" session (scope: "local") on first use
- After each `runAsk`/`runPatch` completes, writes user prompt + AI answer as `chat_messages` rows
- The organizer dashboard lists and displays these sessions via the agent's API chat proxy
- Deduplication prevents re-writing the same exchange on re-render cycles

### Slash commands
`/help`, `/mode`, `/model`, `/provider`, `/setup`, `/reindex`, `/index`, `/organize`, `/clear`, `/summary`, `/lan`, `/api`, `/changes`, `/change`, `/accept`, `/reject`, `/apply`, `/revert`, `/undo`, `/exit`, `/quit`, `/animation`, `/context`

---

## 10. Agent Pipeline Detail

### runAsk (Discuss mode)
evaluatePrompt → classifyTask → retrieve (8-signal scoring) → packContext → generateWithProvider → finalizeAnswer

### runPatch (Build mode)
Same as runAsk + validateUnifiedDiff → checkPatchSafety → gitApply → reindexAffected → runChecks → repair loop (max 3) → finishTask

---

## 11. Change Set Review System

Hunk-level review workflow for agent-generated patches. File and hunk accept/reject. Git checkpoint/revert. TUI and API access.

---

## 12. Web Interfaces

### LAN Server (`lan/server.ts`, port 3000)
- Standalone web UI served inline: chat, file browser, dashboard
- SSE events for real-time TUI sync (mode, model, chat entries)
- Endpoints: `/api/state`, `/api/events`, `/api/dashboard`, `/api/filetree`, `/api/file`, `/api/config`, `/api/models`, `/api/prompt`, `/api/cancel`, `/api/command`

### API Server (`api/server.ts`, port 31337)
- REST API for programmatic agent access (used by the organizer)
- Endpoints: `/api/status`, `/api/actions`, `/api/tasks`, `/api/tasks/:id/patch`, `/api/changes`, `/api/chat/sessions`, `/api/chat/sessions/:id`, `/api/chat/messages`, `/api/models`, `/api/questions`, `/api/task-flow-templates`, `/api/task-flow-templates/render`, `/api/tasks/:id/plan`
- Authentication: Bearer token, or local-only by default

### Organizer Dashboard (`organizer/web/`)
- Server-side from TS template literals → browser renders vanilla JS SPA
- Communicates with worker agents through the organizer server's REST API
- Full detail in the Agent-Web Integration doc (`docs/AGENT-WEB-INTEGRATION.md`)

---

## 13. Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| SQLite + synchronous API (better-sqlite3) | Fast, zero-config DB. Synchronous API avoids async TUI complexity |
| Regex-based symbol extraction | No native compilation. Covers TS/JS/Python/C-like well enough |
| 30-tag fixed taxonomy | Consistent across projects, model reasons about numbered tags |
| Alternate screen buffer for TUI | Clean terminal separation. Restored on exit + crash fallback |
| Token budget for context assembly | Small models work better with dense, relevant context |
| Repair loop (max 3) | Local models produce imperfect patches; auto-retry recovers |
| Inline HTML/CSS/JS (no framework) | Zero-build web UIs. Dashboard and LAN UI are self-contained |
| Organizer as embedded HTTP server | No external orchestrator. Dashboard + API share process |
| Change set review at hunk level | Fine-grained human review of AI changes |
| Agent chat proxy via organizer | Single dashboard interacts with any agent's chat and tasks |
| TUI writes to chat sessions | Bidirectional sync: TUI interactions visible in organizer dashboard |
| Shared provider model listing | `listProviderModels()` used by TUI, API, and dashboard via proxy |
| GitHub-dark palette for dashboard | Readable contrast, familiar UI pattern, system fonts for accessibility |

---

## 14. Package Dependencies

| Dependency | Version | Purpose |
|------------|---------|---------|
| `better-sqlite3` | ^11.7 | SQLite database |
| `chokidar` | ^4.0 | File system watcher |
| `commander` | ^13.1 | CLI framework |
| `execa` | ^9.5 | Shell command execution |
| `fast-glob` | ^3.3 | File discovery |
| `ignore` | ^7.0 | .gitignore parsing |
| `ink` | ^5.1 | Terminal UI framework (React) |
| `nanoid` | ^5.1 | ID generation |
| `pino` | ^9.7 | Structured logging |
| `react` | ^18.3 | UI component model (used by Ink) |
| `zod` | ^3.24 | Configuration schema validation |

---

## 15. Module Replaceability

Each module can be replaced independently:
- **providers/**: Swap Ollama for LM Studio, OpenRouter, etc. Implement the `Provider` interface
- **index/**: Replace regex extraction with tree-sitter
- **tui/**: Swap Ink for Blessed, terminal-kit, or web-based UI
- **lan/**: Replace inline HTML with React/Svelte frontend
- **organizer/web/**: Replace vanilla JS SPA with any framework
- **organizer/**: Replace task dispatcher with message queue. Registration protocol stays

### Cross-module contracts
- **types/index.ts**: All shared types. Zero imports.
- **utils/**: Pure functions, zero project imports.
- **db/db.ts**: `SmithDatabase` type, `openDatabase()`. Schema + meta helpers.
- **events/events.ts**: `createEventBus()`. Events: `index:*`, `ollama:*`, `chat:*`, `watcher:*`, `task:*`, `ui:*`.
