# Refactor Summary — Tooling & Context Overhaul

The old static RAG/patching flow was replaced with a small-context, task-focused coding agent that uses deterministic tools, compact evidence, and working memory instead of dumping raw files into the prompt.

## Pipeline Comparison

```
OLD:  evaluatePrompt → classify → retrieve → packContext (raw code windows) → generate diff → validate → git apply → repair loop

NEW:  buildTaskPacket → retrieveLeads → packFocusedBriefing → AgentLoop (search/read/edit/check/finish) → WorkingMemory compaction
```

## New Files (26)

| File | What |
|------|------|
| `src/context/taskPacket.ts` | `TaskPacket` type + `buildHeuristicTaskPacket()` |
| `src/context/taskDistiller.ts` | LLM-based prompt→contract distiller with Zod validation |
| `src/context/retrievalLead.ts` | `RetrievalLead` type + `retrieveLeads()` |
| `src/context/renderLeads.ts` | Compact lead output formatter |
| `src/context/focusedBriefing.ts` | Token-budgeted prompt without raw code dumps |
| `src/context/contextBudget.ts` | `ContextBudget` type + 4k/8k presets |
| `src/context/budgetedRender.ts` | Section-by-section capped rendering |
| `src/context/projectRules.ts` | Loads AGENTS.md / SYSTEM.md with layer merging |
| `src/agent/workingMemory.ts` | `WorkingMemory` type + create/render/merge |
| `src/agent/compactToolResult.ts` | Tool-specific result compaction into memory |
| `src/agent/focusedAgentLoop.ts` | Core loop — max 12 steps, auto-compacts |
| `src/agent/focusedSystemPrompt.ts` | 12-rule system prompt for small models |
| `src/agent/messageCompactor.ts` | Prune old raw tool outputs |
| `src/agent/tools/toolRegistry.ts` | Pluggable `ToolRegistry` + `AgentTool` types |
| `src/agent/tools/searchTool.ts` | Unified file/symbol/summary/text search |
| `src/agent/tools/readTool.ts` | Line-numbered reading, hard caps at 160 lines |
| `src/agent/tools/editTool.ts` | Search/replace with single-occurrence enforcement |
| `src/agent/tools/replaceLinesTool.ts` | Line-range replacement |
| `src/agent/tools/checkTool.ts` | Run typecheck/test/lint/build |
| `src/agent/tools/finishTool.ts` | Structured task completion |
| `src/agent/checkPlanner.ts` | Smart check selection |
| `src/agent/checkSummary.ts` | Parse TS/ESLint/test error output |
| `src/agent/editDiff.ts` | Generate unified diffs from edit operations |
| `src/agent/editTransaction.ts` | Safe edit with safety checks + diff |
| `src/index/fileCards.ts` | `FileCard` type + heuristic builder + SQLite CRUD |
| `docs/focused-agent.md` | User-facing documentation |

## Modified Files (7)

| File | Changes |
|------|---------|
| `src/types/index.ts` | Added 15 new context fields to `SmithConfig`; removed `AgentConfig` |
| `src/config/config.ts` | Added all new fields to Zod schema + defaults; removed agent section |
| `src/context/tokenEstimate.ts` | Added `TokenEstimator` interface + `trimToTokenBudget()` |
| `src/db/db.ts` | Added `file_cards` table + index |
| `src/agent/taskRunner.ts` | **1048→248 lines** — replaced entirely with focused pipeline |
| `src/cli.ts` | Added `init-rules`, `distill`, `leads`, `brief` debug commands |
| `docs/focused-agent.md` | User-facing documentation |

## Deleted

- `AgentConfig` type + all feature flags (`focusedPipeline`, `taskDistillation`, etc.)
- Classic `runAsk`/`runPatch` code paths (~450 lines of classify→retrieve→pack→diff repair loop)
- Functions removed: `evaluatePrompt`, `finalizeAnswer`, `repairPrompt`, `runQwenPlanningTools`, `runPlanningTools`, `mergeClassification`, `enrichClassificationWithImportantFiles`, `composeEffectiveTask`, `normalizeAnswer`, `buildAskFallback`, `isPlaceholderJunk`, `looksLikeJsonEnvelope`, `summarizeStructuredPayload`

## Key Numbers

- **TaskRunner**: 1048 → 248 lines (-76%)
- **New modules**: 26 files, ~2800 lines
- **Tools**: 6 deterministic tools (search, read, edit, replace_lines, check, finish)
- **Context budget**: Sections capped independently (system, rules, code, history, output)
- **Compaction**: Auto-triggers after 3 tool calls or at 65% token threshold
- **TypeScript**: Compiles clean with zero errors

## Tools

### Read-only (ask mode)

| Tool | Description |
|------|-------------|
| `search` | Search files, symbols, summaries, and text |
| `read` | Read a narrow line window from a file |
| `finish` | End the task with a summary |

### Patch tools (patch mode)

| Tool | Description |
|------|-------------|
| `edit` | Search/replace edit in one file |
| `replace_lines` | Replace an exact line range |
| `check` | Run typecheck, test, lint, or build |

## Context Budgets

Budget scales automatically based on `maxPromptTokens`:

### 4K Models

| Section | Tokens |
|---------|--------|
| System prompt | 400 |
| Project rules | 300 |
| Task packet | 600 |
| File cards | 800 |
| Live code | 900 |
| Tool history | 400 |
| Output reserve | 600 |

### 8K+ Models

| Section | Tokens |
|---------|--------|
| System prompt | 700 |
| Project rules | 600 |
| Task packet | 900 |
| File cards | 1200 |
| Live code | 2500 |
| Tool history | 1000 |
| Output reserve | 1500 |

## Debugging

```bash
# See how a prompt is distilled
smith distill "fix the switching bug"

# See what files the retriever would select
smith leads "fix the switching bug"

# Preview the compact context sent to the model
smith brief "fix the switching bug"

# Create a project rules template
smith init-rules
```
