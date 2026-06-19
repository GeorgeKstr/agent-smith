# Tooling & Context System — Architecture Review

> This document is a comprehensive review of how tooling and context work in Agent Smith, intended as reference material for planning a refactor.

---

## 1. Architecture Overview

Agent Smith is a **local-first coding agent** with a custom RAG pipeline. The core philosophy: **the app is the agent, the model is a constrained reasoning and patching engine**. No LangChain, no vector databases — everything is built on **SQLite + ripgrep + regex heuristics**.

### Directory Layout

```
src/
├── main.ts                    Entry point (shebang → createCli)
├── cli.ts                     CLI (Commander) — all commands (~1600+ lines)
├── types/index.ts             All shared TS types (801 lines, zero imports)
├── config/
│   ├── config.ts              Zod schema, defaults, load/ensureConfig
│   └── projectRoot.ts         Walks up to find .git or package.json
├── db/db.ts                   SQLite schema (~10+ tables, 8+ indexes)
├── events/events.ts           Node EventEmitter factory
├── providers/
│   ├── ollama.ts              Ollama HTTP API (generate/chat)
│   └── providers.ts           Multi-provider registry + convenience wrappers
├── index/                     Codebase intelligence
│   ├── scanner.ts             fast-glob + .gitignore/.agentignore
│   ├── hashing.ts             SHA-256 file hashing
│   ├── extractor.ts           Regex-based symbol/import extraction (TS/JS/Python/C)
│   ├── tags.ts                30-tag global taxonomy + heuristic keyword tagging
│   ├── tagger.ts              Thin async wrapper over heuristicTags
│   ├── graph.ts               Import graph (resolve, BFS expansion, ASCII render)
│   ├── indexer.ts             Index orchestrator (scan→hash→symbols→graph→tags→LLM summary)
│   ├── reindexer.ts           Re-index files touched by patches
│   └── watcher.ts             Chokidar-based file watcher
├── context/                   Context assembly (RAG pipeline)
│   ├── tokenEstimate.ts       Rough token counter (text.length / 4)
│   ├── intent.ts              Regex-based prompt intent classification (task/chat/meta)
│   ├── retriever.ts           Multi-signal file scoring (8 signals)
│   ├── contextPacker.ts       Token-budgeted context packet builder
│   └── contextPlanner.ts      Context plan adapter
├── agent/                     Agent execution pipeline
│   ├── taskRunner.ts          runAsk / runPatch orchestrator (~789 lines)
│   ├── summarizer.ts          LLM file summarization
│   ├── safety.ts              Patch safety enforcement
│   ├── checks.ts              Run typecheck/test/lint/build via execa
│   ├── patch.ts               Unified diff validation/parsing
│   ├── memory.ts              Task/edits/test-runs persistence
│   └── tools/
│       ├── qwenTools.ts       Qwen function-calling loop
│       └── localTools.ts      4 local project tools
├── runtime/
│   ├── smithRuntime.ts        High-level dispatch: action → runAsk/runPatch/index
│   └── actions.ts             Action type helpers
├── changes/                   Change set / diff review system
│   ├── changeSetStore.ts      CRUD for change sets + file/hunk reviews
│   ├── changeSetApply.ts      Apply accepted hunks/files
│   ├── hunkDiffBuilder.ts     Build diff from accepted hunks
│   └── diffParser.ts          Parse unified diffs → structured data
├── checkpoints/
│   ├── checkpointStore.ts     Checkpoint CRUD
│   └── gitCheckpoint.ts       Git-based checkpoint/revert
├── tasks/                     Task management system
│   ├── taskStore.ts           Work items CRUD
│   ├── taskPlanStore.ts       Task plan steps CRUD
│   ├── taskPlanGenerator.ts   LLM-based plan generation
│   ├── taskImport.ts / taskImportParser.ts
│   └── taskFlowTemplates.ts / taskFlowTemplateRenderer.ts
├── chat/                      Chat session system (shared DB tables)
├── organizer/                 Agent orchestration system
│   ├── server.ts              Organizer HTTP server (REST API)
│   ├── organizerDb.ts         Organizer SQLite DB
│   ├── taskDispatcher.ts      Task dispatch orchestration
│   ├── heartbeat.ts           Worker → organizer heartbeat
│   └── workerClient.ts / workerApiClient.ts
├── api/server.ts              Agent API (REST + SSE, used by organizer)
├── lan/server.ts              Web LAN interface (standalone SPA)
├── tui/                       Ink/React Terminal UI
│   ├── App.tsx                Root component
│   ├── theme.ts               Matrix green-on-black theme
│   └── screens/ & components/
├── web/                       Organizer dashboard SPA (vanilla JS inline)
└── utils/
    ├── json.ts                extractJson (balanced JSON extraction from prose)
    ├── language.ts            Extension → language name map
    └── network.ts             LAN address discovery
```

---

## 2. Tooling System

### 2.1 How Tools Are Defined

Tools are defined in two layers:

#### Layer 1: Local Project Tools (`src/agent/tools/localTools.ts`)

Four read-only tools, each a `RegisteredQwenTool`:

```typescript
type RegisteredQwenTool = {
  function: QwenFunctionDefinition;  // name, description, JSON Schema parameters
  handler: QwenToolHandler;           // (args) => unknown | Promise<unknown>
};
```

| Tool | Behavior |
|------|----------|
| `find_files` | SQLite query — search indexed files by path or summary text |
| `find_symbols` | SQLite query — search indexed symbols (functions, classes, etc.) by name or content |
| `read_file` | `fs.readFile` — return a window of lines from a project file (root-confinement safety) |
| `file_neighbors` | Return immediate import graph neighbors for a given file |

Tools are created via `createLocalProjectTools({ root, db })` which instantiates them with closures over the project root and `SmithDatabase`.

#### Layer 2: Model-Facing Tools (Aspirational)

From `docs/05-agent-tools.md`, conceptual tools for the agent:
- `request_context(query)` — request context for a concept
- `request_file(path)` — request a specific file
- `request_symbol(name)` — request a specific symbol
- `submit_patch(unified_diff)` — submit a patch
- `request_check(name)` — request typecheck/test/lint
- `finish(summary)` — mark task complete

These are **not implemented** as LLM-callable tools — the patch flow is handled procedurally in `taskRunner.ts`.

### 2.2 The Qwen Function-Calling Loop (`src/agent/tools/qwenTools.ts`)

The engine that lets the LLM call tools:

```
1. Send messages + functions to LLM via chatWithProvider()
2. LLM returns assistant messages with function_call or tool_calls
3. functionCalls() extracts all calls from the response
   (handles message.function_call, message.tool_calls,
    and raw <tool_call>...</tool_call> XML blocks)
4. For each call: look up handler by name → parse arguments JSON → invoke handler
5. Append { role: "function", name, content: stringifyToolResult(result) } to history
6. Loop back to step 1 (max 4 rounds by default)
7. Return final text when the model stops calling tools
```

### 2.3 Where Tools Are Used in the Pipeline

```
User Task
  │
  ├─ evaluatePrompt()           # Intent classification (regex)
  ├─ runQwenPlanningTools()     # LLM explores project with 4 local tools
  │   └─ runQwenFunctionLoop()  #   3 rounds max, navigation notes prepended
  │
  ├─ runPlanningTools()         # Non-LLM fallback for PromptToolRequest[]
  │   └─ Direct SQLite queries  #   (when no LLM is needed)
  │
  ├─ classifyTask()             # Task → keywords, file hints, tags
  ├─ retrieve()                 # 8-signal file scoring
  ├─ packContext()              # Token-budgeted prompt assembly
  │
  └─ generateWithProvider()     # Final LLM call for answer or diff
```

**Key detail**: Tools are only used in the **pre-retrieval exploration phase**. During patch generation, the LLM cannot call tools — it receives a static, packed context and produces a diff. There is no `grep`, `run_command`, or `write_file` tool.

### 2.4 Tool Execution — Declare to Invoke

```
User Task
  → evaluatePrompt()
  → runQwenPlanningTools()
      ├── createLocalProjectTools({ root, db })
      ├── runQwenFunctionLoop({
      │     config, modelSpec,
      │     messages: [system, user],
      │     tools: [find_files, find_symbols, read_file, file_neighbors],
      │     maxToolRounds: 3,
      │     onToolCall: emits "task:phase" events
      │   })
      ├── loop: LLM calls tools → handlers query SQLite / read files → results back
      └── returns navigation notes → prepended to effective task text
```

### 2.5 Tool System Strengths

- Functions as a **schema** so the LLM declares intent declaratively rather than guessing file paths
- Simple, synchronous handler pattern — easy to add new tools
- Handles multiple tool call formats (Qwen function_call, OpenAI tool_calls, XML blocks)
- Emits events for TUI status display

### 2.6 Tool System Pain Points

1. **Limited set** — only 4 tools, all read-only
2. **Planning-only** — LLM can't call tools during patch generation (no `grep`, no `run_command`, no `write_file`)
3. **No streaming** — tool-calling Ollama calls use `stream: false`, blocking on full responses
4. **Registration is hardcoded** — tools are created inline in `taskRunner.ts`, not pluggable
5. **No tool result truncation** — if `read_file` returns a huge file, it's stuffed into the message history verbatim

---

## 3. Context System

### 3.1 The RAG Pipeline (5 Stages)

```
STAGE 1            STAGE 2           STAGE 3           STAGE 4           STAGE 5
Intent             Classify          Retrieve          Pack              Generate
───────            ────────          ────────          ────              ────────
evaluatePrompt()   classifyTask()    retrieve()        packContext()     generateWithProvider()
     │                  │                │                  │                  │
     ▼                  ▼                ▼                  ▼                  ▼
 PromptPlan        TaskClassification  ScoredFile[]     ContextPacket     Answer / Diff
 (intent,          (tagIds, keywords,  (ranked by       (task, prompt,    (LLM response)
  keywords)         file hints,        8 signals)        files, omitted,
                    symbol hints)                        warnings)
```

### 3.2 Stage 1 — Intent Classification (`context/intent.ts`)

**Pure regex-based**, no LLM:

| Pattern Set | Matches | Default |
|-------------|---------|---------|
| `CHAT_PATTERNS` | Greetings, small talk, "how are you" | → `"chat"` |
| `TASK_PATTERNS` | fix/implement/refactor/add/create/change/debug | → `"task"` |
| `META_PATTERNS` | help/config/slash commands | → `"meta"` |
| Fallback | Anything that looks like coding | → `"task"` |

Keyword extraction: split on non-alpha, deduplicate, filter stop words.

**Pain point**: `evaluatePrompt()` is effectively a stub — the function signature suggests it was meant to optionally use LLM classification, but the comment says "skip Ollama entirely." No deep semantic understanding of complex tasks.

### 3.3 Stage 2 — Task Classification (`context/retriever.ts:classifyTask()`)

**Fully algorithmic** (no LLM):

1. **File hints** — regex for `*.ext` patterns, `path/to/file.ts` references
2. **Symbol hints** — `PascalCase.Things` references
3. **Keyword extraction** — non-alpha token splitting + stop word filtering
4. **SQLite queries** — find matching files and symbols in the index
5. **Tag inference** — keyword-pattern matching against the 30-tag taxonomy
6. **Heuristic checks** — determines if tests or types are likely needed

Returns `TaskClassification`:
```typescript
{
  tagIds,           // e.g. [1, 5, 12] → "api", "database", "auth"
  keywords,         // ["login", "password", "hash"]
  likelyFiles,      // files matching keywords/patterns
  likelySymbols,    // symbols matching keywords
  needsTests,       // boolean
  needsTypes,       // boolean
}
```

### 3.4 Stage 3 — Multi-Signal Retrieval (`context/retriever.ts:retrieve()`)

Scores **every indexed file** against the classification using **8 orthogonal signals**:

| # | Signal | Method | Max Weight |
|---|--------|--------|-----------|
| 1 | **grep** | `ripgrep` subprocess; weighted by match count × 3 | 8 matches × 3 = 24 |
| 2 | **tag overlap** | File tags ∩ classification tagIds; overlap count × 2 | variable × 2 |
| 3 | **summary match** | Keyword matching against LLM-generated or heuristic file summaries; ×2 | variable × 2 |
| 4 | **symbol match** | Symbol name contains keyword | 4 |
| 5 | **file hint** | Direct path match: exact=12, basename=10, partial=7 | 12 |
| 6 | **task memory** | Files from past successful similar tasks | 2 |
| 7 | **graph proximity** | BFS expand from top seeds using import graph | 1.5 |
| 8 | **related tests** | Files matching `*.test.*` / `*.spec.*` with shared stem | 1.5 |

Returns ranked `ScoredFile[]` with deduplicated `seedSymbols[]`.

**No embeddings, no vectors** — all signals come from deterministic queries against SQLite + ripgrep.

### 3.5 Stage 4 — Context Packing (`context/contextPacker.ts`)

Assembles the final prompt within a **token budget**:

```
Config limits:
  maxPromptTokens: 8000
  maxFiles:        6
  maxSymbols:      20
  graphDepth:      2
  includeTests:    true
  includeTypes:    true
  includeSummaries: true
```

**Prompt structure**:
```
[Header]
  Task: <user task>
  Rules: <rules context>
  Task Tags: <inferred tags>
  Project Tags: <project-level tags>
  Selected Files: <file count>

[File Windows]
  For each selected file (up to maxFiles):
    - If file ≤ 220 lines → include up to 600 lines from top
    - If file > 220 lines → extract symbol-focused windows
      (up to 4 symbols, ±3 lines of context each)
    - Check token budget before adding each window
    - Omit files that exceed budget

[Footer]
  Patch mode: "Return the unified diff now:"
  Ask mode:  "Answer now:"
```

**Returned metadata**:
```typescript
ContextPacket {
  task: string;
  prompt: string;            // The assembled prompt
  estimatedTokens: number;   // text.length / 4
  files: ContextFileEntry[]; // Files included with line windows
  symbols: string[];         // Seed symbols
  omitted: string[];         // Files omitted due to budget
  warnings: string[];        // Truncation warnings
}
```

### 3.6 Token Estimation (`context/tokenEstimate.ts`)

```typescript
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
```

**Crude** — 4 characters per token is a rough heuristic. Different models (Qwen, Llama, DeepSeek, Claude, GPT) have wildly different tokenizers. This can lead to under- or over-utilizing the context window.

### 3.7 Context Usage in the Agent Loop

**Ask mode** (`runAsk`):
```
evaluatePrompt → classify → retrieve → pack → generateWithProvider → finalizeAnswer
```

**Patch mode** (`runPatch`):
```
evaluatePrompt → classify → retrieve → pack → generateWithProvider
  → validateUnifiedDiff → checkPatchSafety → git apply --check
  → [optional: ChangeSet review] → git apply → runChecks
  → [on failure: git revert → repairPrompt → retry (up to 3 attempts)]
```

**Repair prompt**: original prompt + previous failed diff + failure message + correction instructions. Switches from patcher model to debugger model on subsequent attempts.

### 3.8 Context System Strengths

1. **Multi-signal scoring** — 8 orthogonal signals provide robust relevance ranking without embeddings
2. **Token-budget awareness** — careful tracking prevents context overflow
3. **Smart windowing** — full small files, symbol-focused windows for large files (not blind truncation)
4. **Import graph proximity** — graph-aware expansion catches related-but-unmentioned files
5. **Task memory** — learns from past successes by reusing file selections
6. **No embeddings needed** — works offline, deterministic, debuggable

### 3.9 Context System Pain Points

1. **No embedding/semantic retrieval** — keyword-only matching misses conceptual relationships ("make login faster" might miss rate-limiting code unless "rate" or "limit" appears)
2. **No summarization/compression** — raw code windows, no semantic compression of large files. An 8000-token budget can be exhausted by just 1-2 large files
3. **Crude token estimation** — `text.length / 4` doesn't match any real tokenizer
4. **Regex-only symbol extraction** — no tree-sitter means C, Rust, Go, etc. get zero symbols. Symbol-based windows break for those languages
5. **`evaluatePrompt()` is a stub** — always regex, never LLM, limits understanding of complex/nuanced tasks
6. **`maxFiles: 6` is tight** — complex multi-file tasks may need context from more files
7. **Single-threaded LLM summarization** — the `summaryConcurrency` field exists in config but is ignored; background summarization is serial

---

## 4. The Agent Loop

### 4.1 Runtime Dispatch

`src/runtime/smithRuntime.ts` is the high-level dispatcher. It receives a `RuntimeAction` with `kind: "ask" | "patch" | "retrieve" | "context" | "index" | "reindex"` and delegates:

```
ask      → runAsk(task, ...)
patch    → runPatch(task, ...)
index    → createIndex(...)
reindex  → reindex(...)
retrieve → retrieve(task, ...)
context  → buildContextPacket(task, ...)
```

### 4.2 State Machine / Events

The TUI tracks task phases via events emitted on the shared `EventEmitter`:

| Event | Phase Values |
|-------|-------------|
| `task:phase` | `"triaging"`, `"classifying"`, `"retrieving"`, `"packing"`, `"patching"`, `"repairing"`, `"reindexing"`, `"checking"`, `"tooling"`, `"thinking"` |

These drive the TUI status display in `src/tui/`.

### 4.3 Patch Repair Loop (Full Detail)

```
Attempt 1..3:
  ┌─ generateWithProvider() → raw response
  ├─ stripFences() → extract diff from markdown fences
  ├─ validateUnifiedDiff() → check git headers, hunk markers, file references
  ├─ checkPatchSafety() → no forbidden paths, inside root, within limits
  ├─ git apply --check → dry-run validation
  ├─ [if --review]: create Git checkpoint + ChangeSet (stored in DB)
  ├─ [if --apply]:
  │    ├─ git apply
  │    ├─ reindexAffected()
  │    ├─ runChecks() → typecheck + test
  │    ├─ [if pass]: finishTask(success=true), return
  │    └─ [if fail]: git apply --reverse, feed failure into repairPrompt()
  └─ repairPrompt = original prompt + previous diff + failure + "Corrected diff:"
```

**Limits**:
- `maxPatchFiles`: 6
- `maxPatchLines`: 500
- Repair attempts: 3 (patcher model first, then debugger model)

---

## 5. Configuration System

### 5.1 Location

`.agent/config.json` in the project root. Auto-created with defaults if absent. Validated with **Zod**.

### 5.2 Key Sections

| Section | Key Fields | Default |
|---------|-----------|---------|
| `models` | `tagger`, `summarizer`, `patcher`, `debugger` | `""` (empty → auto-resolve) |
| `providers` | `Record<string, ProviderEntry>` | Ollama default |
| `defaultProvider` | Provider ID | `"ollama"` |
| `ollama` | `baseUrl`, `temperature`, `numPredict` | `http://localhost:11434` |
| `index` | `watch`, `debounceMs`, `workerCount`, `summaryConcurrency`, `ignore[]` | — |
| `context` | `maxPromptTokens` (8000), `maxFiles` (6), `maxSymbols` (20), `graphDepth` (2), `includeTests`, `includeTypes`, `includeSummaries` | — |
| `commands` | `test`, `typecheck`, `lint`, `build` | — |
| `safety` | `forbiddenPaths[]`, `maxPatchFiles` (6), `maxPatchLines` (500) | — |
| `lan` | `port` | 3000 |
| `api` | `enabled`, `host`, `port` (31337), `token`, `allowLan` | — |
| `compatibility` | `mode`, `toolMode` | `"auto"` |
| `theme` | `mode` (`"matrix"`), `showBootAnimation`, `animations` | — |
| `organizer` | `enabled` (true), `url`, `token`, `heartbeatMs` | — |

---

## 6. Dependencies

| Library | Version | Role |
|---------|---------|------|
| **better-sqlite3** | ^11.7.2 | Synchronous SQLite — core data store |
| **execa** | ^9.5.2 | Shell command execution (ripgrep, git, typecheck, test) |
| **fast-glob** | ^3.3.3 | File scanning/discovery |
| **ignore** | ^7.0.5 | .gitignore / .agentignore pattern matching |
| **chokidar** | ^4.0.3 | File system watching |
| **zod** | ^3.24.2 | Configuration schema validation |
| **commander** | ^13.1.0 | CLI framework |
| **nanoid** | ^5.1.5 | Unique ID generation |
| **ink** | ^5.1.0 | Terminal UI (React-based) |
| **react** | ^18.3.1 | UI component model (used by Ink) |
| **pino** | ^9.7.0 | Structured logging |
| **TypeScript** | ^5.8.2 | Dev dependency |
| **tsx** | ^4.19.3 | TypeScript execution (dev mode) |

No vector databases, no embedding models, no LangChain. The entire RAG system is custom-built on SQLite + ripgrep + regex heuristics.

---

## 7. Summary: Strengths & Pain Points

### Strengths

1. **Local-first, model-constrained** — the app does the heavy lifting; the model is a reasoning/patching engine
2. **Multi-signal retrieval** — 8 orthogonal signals for relevance scoring, no embeddings needed
3. **Token-budgeted context packing** — smart windowing, budget tracking, file omission
4. **Repair loop** — auto-retry with debugger model + git revert on failure
5. **Deterministic where possible** — regex heuristics, fixed 30-tag taxonomy, no vector uncertainty
6. **Hunk-level review** — fine-grained accept/reject of individual diff hunks
7. **Multi-provider abstraction** — clean `Provider` interface with Ollama, OpenAI, Anthropic
8. **Zero native compilation** — regex extraction avoids tree-sitter's native build pain
9. **Graceful degradation** — everything works without LLM availability (heuristic tags, regex classification)
10. **Comprehensive SQLite schema** — files, symbols, imports, tags, tasks, edits, checkpoints, change sets, hunks, chats

### Pain Points (Prioritized for Refactoring)

| Priority | Issue | Location | Impact |
|----------|-------|----------|--------|
| **High** | Regex-only symbol extraction — no C/Rust/Go/Kotlin/Swift symbols | `src/index/extractor.ts` | Breaks symbol-based retrieval and windowing for non-TS projects |
| **High** | Crude token estimation (`text.length / 4`) | `src/context/tokenEstimate.ts` | Under/over-utilizes context window; risk of silent truncation or wasted budget |
| **High** | No embedding/semantic retrieval | `src/context/retriever.ts` | Misses conceptually related files not sharing keywords |
| **High** | Tools limited to planning phase | `src/agent/taskRunner.ts` | LLM can't explore during patch generation |
| **Medium** | No context summarization — raw code windows only | `src/context/contextPacker.ts` | 8000-token budget exhausted by 1-2 large files |
| **Medium** | `evaluatePrompt()` stub — always regex, never LLM | `src/context/intent.ts` | Limited understanding of complex/nuanced tasks |
| **Medium** | Single-threaded LLM summarization | `src/agent/summarizer.ts` | `summaryConcurrency` config exists but is ignored |
| **Medium** | No streaming in tool use | `src/agent/tools/qwenTools.ts` | Tool loops block on full responses; poor UX for long tool chains |
| **Low** | Organizer coupling in single-agent runtime | `src/runtime/smithRuntime.ts` | Organizer config always active; adds complexity for single-agent use |
| **Low** | Inline HTML/CSS/JS for web UIs | `src/lan/server.ts`, `src/web/` | Hard to maintain; zero-build is clever but fragile |
| **Low** | Tools hardcoded in taskRunner | `src/agent/taskRunner.ts` | Not pluggable; adding a tool requires touching the execution pipeline |
| **Low** | No tool result truncation | `src/agent/tools/qwenTools.ts` | Large `read_file` results pollute message history |

---

## 8. Suggested Refactor Directions

Based on the pain points above, potential high-impact refactors:

1. **Add tree-sitter or alternative parser** for broader language symbol extraction
2. **Replace `text.length / 4`** with a real tokenizer (e.g. `tiktoken` or model-specific token counts)
3. **Add embedding-based retrieval** as an optional signal alongside keyword signals
4. **Allow tools during patch generation** — give the LLM `grep`, `read_file`, and `run_command` during the patch phase
5. **Add context summarization** — LLM-based compression of large files before packing
6. **Decouple the organizer** from the single-agent runtime via a plugin or flag
7. **Make tools pluggable** — a tool registry pattern rather than inline creation
8. **Stream tool call results** — use streaming chat for better UX during tool loops
