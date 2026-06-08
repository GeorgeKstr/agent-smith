# Agent Smith — Complete Changes Summary

## What happened

This was a two-phase overhaul: (1) **module reorganization** then (2) **9 incremental feature tasks** adding types, config, runtime, API, TUI controls, and task list — all behavior-preserving.

---

## Phase 1: Module Reorganization

### Before → After

```
src/core/* (28 files, monolithic)     →  12 focused modules:
                                          config/     (2)
                                          db/         (1)
                                          events/     (1)
                                          providers/  (2)
                                          index/      (9)
                                          context/    (5)
                                          agent/      (8)
                                          lan/        (1)
                                          tui/        (6)
                                          types/      (1)
                                          utils/      (2)
                                          runtime/    (2)  ← added in phase 2
                                          api/        (1)  ← added in phase 2
                                          tasks/      (1)  ← added in phase 2
```

- **27 files moved** from `core/` into domain-named directories
- **All import paths updated** across ~40 files
- **3 dead TUI components removed** (InputBar, LiveOutputPane, StatusBar)
- **2 utilities extracted**: `extractJson` (from ollama) → `utils/json.ts`, `detectLanguage` (from indexer) → `utils/language.ts`
- **Signal handling fix**: `cli.ts` now saves the Ink render instance, handles SIGINT/SIGTERM/SIGHUP with clean shutdown (alternate screen buffer restore)
- **App.tsx**: `process.on('exit')` fallback restores terminal if cleanup cycle is skipped

---

## Phase 2: Feature Tasks (Tasks 1–9)

### Task 1: Shared Runtime/Action/Config Types

Added to `src/types/index.ts`:
- `CompatibilityMode` = `"auto" | "small-local" | "large-model" | "cloud-agent"`
- `ToolMode` = `"auto" | "diff_only" | "json_protocol" | "native_tools"`
- `RuntimeActionKind` (11 values: ask, patch, retrieve, context, inspect, graph, index, reindex, check, smoke, setup-check)
- `RuntimeAction` — { kind, prompt?, target?, paths?, model?, apply?, dryRun?, json? }
- `RuntimeTaskStatus` (12 values: queued → cancelled)
- `RuntimeTaskResult` — { taskId, ok, status, message?, answer?, diff?, files?, checks?, packet?, data? }
- `ContextPlan` — planning struct with mode, objective, search queries, file/symbol/tag hints, limits
- `ModelProfile` — { id, provider, supportsNativeTools, supportsJsonMode, supportsDiffs, preferredToolMode, roles }

Added to `SmithConfig`:
- `api` — { enabled, host, port, token?, allowLan }
- `compatibility` — { mode: CompatibilityMode, toolMode: ToolMode, preferNativeToolsForLargeModels, preferDiffOnlyForLocalModels }

Updated `src/config/config.ts`: Zod schemas (both `.optional()`), DEFAULT_CONFIG, loadConfig defaults.

### Task 2: SmithRuntime Wrapper

Created `src/runtime/smithRuntime.ts`:
- `createSmithRuntime(deps)` → `{ dispatch(action), getStatus() }`
- `dispatch` routes `RuntimeAction` to `runAsk`, `runPatch`, `indexer.quickStartupScan()`, `indexer.reindexPaths()`
- Unimplemented kinds return `"not implemented yet"` error
- `getStatus()` returns root, defaultProvider, patcherModel

Created `src/runtime/actions.ts`: re-exports types + `actionLabel()` helper.

Updated `src/cli.ts`: `ask` and `patch` commands now call `runtime.dispatch()` instead of raw `runAsk`/`runPatch`.

### Task 3: Retrieve/Context Debug Actions

`smithRuntime.ts` — two new dispatch cases:
- **retrieve**: runs `evaluatePrompt` → `classifyTask` → `retrieve` (no model call), returns scored files + seed symbols in `data`
- **context**: adds `packContext`, returns assembled packet + `promptPreview` (first 4000 chars)

`cli.ts` — two new commands:
- `smith retrieve <task> [--json]` — prints scored files/symbols
- `smith context <task> [--json] [--print-prompt]` — prints token count, files, symbols, prompt preview

Created `src/context/contextPlanner.ts` — thin adapter: `buildContextPlan()`.

### Task 4: Structured Retrieval Audit Reasons

`types/index.ts`:
- `RetrievalSignal` (10 signals)
- `RetrievalReason` — { signal, weight, detail }
- `reasonDetails?: RetrievalReason[]` on `ScoredFile`

`context/retriever.ts`:
- `addReason()` helper replaces all manual `ensure() + score += + reasons.push()` patterns
- 8 scoring sections now produce structured details alongside string labels
- Zero change to ranking weights or file selection

### Task 5: Context Packet Diagnostics

`types/index.ts`:
- `ContextFileEntry` — path, reason, tokens?, includedLines? (line windows), truncated?
- `ContextSymbolEntry` — name, path, kind, startLine?, endLine?, tokens?
- `ContextOmittedEntry` — path, reason, estimatedTokens?
- `ContextPacket` extended with `omitted?`, `warnings?`

`context/contextPacker.ts`:
- `pickWindows` returns structured `{ text, label?, startLine, endLine, truncated? }`
- Tracks budget_exceeded omissions, failed_to_read files, truncated files
- Generates 4 diagnostic warnings (no files, no symbols, budget hit, missing tests)

### Task 6: API Server Skeleton

Created `src/api/server.ts` (188 lines):
- Node `http` module, zero framework dependencies
- Routes: `GET /` (endpoint list), `GET /api/status`, `POST /api/actions`, `GET /api/events` (SSE)
- Bearer token auth; no-token mode allows localhost only
- SSE streams 7 event types from the existing EventEmitter

`cli.ts` — `smith api [--host] [--port] [--token]` command with LAN safety warning.

### Task 7: TUI /api Toggle

`tui/App.tsx`:
- `apiRef` + `startApiServer` import
- `/api` in CMD_LIST with `stop`/`status` autocomplete
- Cleanup on unmount: `void apiRef.current?.stop()`

### Task 8: TUI Network Commands Polish

`tui/App.tsx`:
- **`/lan`**: extended with `stop`, `status`, port override. Restarts on port change.
- **`/api`**: handles host+port change (stops old, starts new if different)
- **`/dashboard`**: placeholder — prints "not implemented yet" message
- `dashboardRef` placeholder ref + cleanup
- Autocomplete for `/lan`, `/dashboard` subcommands
- Updated `/help` text for all three

### Task 9: Persistent Task List

`types/index.ts`:
- `WorkItemStatus` (7 states)
- `WorkItemSource` (4 sources)
- `WorkItem` — full struct with id, parentId, title, description, status, priority, source, assignedAgentId, timestamps

`db/db.ts`:
- `work_items` table (10 columns) + 2 indexes

Created `src/tasks/taskStore.ts` (128 lines):
- `createWorkItem()` — defaults: status=todo, priority=0, source=user. ID: `task_<ts>_<rand>`
- `listWorkItems(opts?)` — filter by status/source
- `getWorkItem(id)`
- `updateWorkItemStatus(id, status)`
- `deleteWorkItem(id)`

`cli.ts` — `smith task` command group:
```
smith task add <title>      [--json] [--priority n] [--source src]
smith task list              [--json] [--status s] [--source src]
smith task show <id>        [--json]
smith task start <id>
smith task done <id>
smith task cancel <id>
smith task delete <id>
```

---

## File Count Summary

| State | Count |
|-------|-------|
| Files deleted (moved) | 30 |
| Files modified in place | 4 (cli.ts, App.tsx, types/index.ts, IndexDashboard.tsx) |
| New files created | 12 (across agent/, api/, config/, context/, db/, events/, index/, lan/, providers/, runtime/, tasks/, utils/) |
| New docs | 3 (ARCHITECTURE.md, runtime-contracts.diff, all-changes.diff) |
| **Total commits worth** | ~7,800 lines of diff |
