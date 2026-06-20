# AgentSmith — AI/LLM Harness: Context & Tooling Architecture

## Overview

AgentSmith is a CLI coding agent that uses LLMs (Ollama, OpenAI, Anthropic) to answer questions and apply patches to codebases. It operates via a **text-based tool-calling harness** where the LLM emits XML `<tool_call>` / `<final>` blocks that are parsed, validated, executed, and fed back into a multi-turn loop. The system layers a structured context retrieval pipeline _before_ the agent loop, and enforces multi-layered policy checks (progress, phase, edit pressure) _during_ the loop.

```
CLI (cli.ts)
  → SmithRuntime.dispatch() (smithRuntime.ts)
      → runAsk() / runPatch() (taskRunner.ts)
          → classifyRuntimeIntent()         — algorithmically decide chat/ask/patch
          → buildHeuristicTaskPacket()      — extract task from user prompt
          → classifyTask() + retrieve()     — SQLite-indexed context retrieval
          → retrieveLeads()                 — build structured retrieval leads
          → buildToolRegistry()             — register all tools for the mode
          → runFocusedAgentLoop()           — the core LLM tool-calling loop
              → provider.generate()         — call the LLM
              → parseLocalTextAction()      — parse XML <tool_call> / <final>
              → policy checks               — tool permissions, progress, phase, edit pressure
              → toolDef.handler()           — execute the tool
              → compactToolResult()         — update working memory
              → evidence/metric tracking    — run observability
```

---

## 1. Entry Points & Runtime Dispatch

### `src/cli.ts:92-211`
The CLI (Commander) registers commands (`ask`, `patch`, `retrieve`, `context`), bootstraps config/DB, creates the `SmithRuntime`, and dispatches the appropriate action kind.

### `src/runtime/smithRuntime.ts:27-169`
The central dispatch function. `createSmithRuntime()` builds a singleton that handles `ask`, `patch`, `index`, `retrieve`, and `context` action kinds. Each action kind wires through to `runAsk()` or `runPatch()` in `taskRunner.ts`.

```ts
// smithRuntime.ts:38-52 — core dispatch
async function dispatch(action: RuntimeAction): Promise<RuntimeTaskResult> {
  switch (action.kind) {
    case "ask": {
      const result = await runAsk({ db, root, config, events, indexer }, action.prompt ?? "", {
        modelOverride: action.model
      });
      return { taskId, ok: result.ok, status, answer: result.answer, message: result.message, packet: result.packet };
    }
    case "patch": {
      const outcome = await runPatch({ db, root, config, events, indexer }, action.prompt ?? "", { apply, review, modelOverride: action.model, taskId: action.taskId });
      return { taskId, ok: outcome.ok, status, answer: outcome.answer, diff: outcome.diff, files: outcome.files, checks: outcome.checks, message: outcome.message };
    }
    // ...
  }
}
```

---

## 2. Task Runner — High-Level Pipeline

### `src/agent/taskRunner.ts:38-468`
`runAsk()` and `runPatch()` are the top-level orchestrators. They perform the full pipeline:

1. **Parse explicit mode** (`/chat`, `/ask`, `/patch` prefixes) via `parseExplicitMode()`
2. **Classify runtime intent** via `classifyRuntimeIntent()` — algorithmically determines `chat`, `ask`, or `patch`
3. **Resolve provider/model** via `resolveFocusedProvider()`
4. **Distill task packet** via `buildHeuristicTaskPacket()` / optionally `distillTaskPacket()` (LLM-enhanced)
5. **Build retrieval leads** via `classifyTask()` + `retrieve()` + `retrieveLeads()` — SQLite-indexed context discovery
6. **Load project rules & file cards**
7. **Build tool registry** via `buildToolRegistry()` — registers tools for the mode
8. **Invoke the agent loop** via `runFocusedAgentLoop()`

### `src/agent/taskRunner.ts:417-424` — Tool Registry Construction

```ts
function buildToolRegistry(mode: "ask" | "patch"): ToolRegistry {
  const registry = new ToolRegistry();
  registry.registerAll([searchTool, readTool, askUserTool, finishTool]);
  if (mode === "patch") {
    registry.registerAll([proposeEditTool, createFileTool, editTool, replaceLinesTool, checkTool]);
  }
  return registry;
}
```

---

## 3. Intent Classification — Algorithmic, No LLM

### `src/agent/classifyRuntimeIntent.ts:15-118`
`classifyRuntimeIntent()` uses pure pattern matching to determine whether a user prompt should be handled as `chat`, `ask`, `patch`, or `command`. Supports explicit mode overrides (`/chat`, `/ask`, `/patch`).

```ts
// classifyRuntimeIntent.ts:47-59 — key classification logic
if (isAskOnlyUsage(text)) {
  return { intent: "ask", confidence: "high", reason: "question asking how/why/what, not requesting edits" };
}
if (isPatchRequest(text)) {
  const confidence = isVaguePatchRequest(text) ? "low" : "high";
  return { intent: "patch", confidence, reason: ... };
}
```

`isPatchRequest()` looks for action verbs: `create|make|add|fix|change|edit|implement|write|delete|remove|...`  
`isAskOnlyUsage()` detects patterns like `explain how to`, `tell me how to`, `what does`, `should i` etc.

### `src/agent/toolPermissions.ts:1-59`
Maps `RuntimeIntent` → `ToolPermissionLevel`:
- `chat` → `none` (no tools)
- `ask` → `readonly` (search, read, ask_user, finish)
- `patch` → `write` (all tools)
- `command` → `none`

```ts
// toolPermissions.ts:47-55
export const WRITE_TOOLS = [
  "create_file", "edit", "replace_lines", "delete_file", "move_file", "rename_file", "write_file"
];
export function isWriteTool(toolName: string): boolean {
  return WRITE_TOOLS.includes(toolName);
}
```

---

## 4. Core Agent Loop — The Harness Heart

### `src/agent/focusedAgentLoop.ts:32-503`
The focal point of the entire harness. Runs up to `MAX_STEPS = 12` turns of:

1. **Build compact prompt** — task, project rules, working memory, leads, file cards, latest tool result
2. **Call `provider.generate(model, prompt, { system, maxTokens, temperature, signal })`**
3. **Parse response** via `parseLocalTextAction()` — extracts `<tool_call>`, `<final>`, plain text, or invalid
4. **Route by action kind:**
   - `plain_text` → completion gate check, then break (ask) or gate check (patch)
   - `final` → completion gate check, then break or fail
   - `invalid` → count toward consecutive invalid limit (max 2), feed error back
   - `tool_call` → enforce allowed tools, runtime intent, then execute handler
5. **Policy enforcement** (in order):
   - Tool permissions (allowed tools + runtime intent) — lines 210-232
   - Progress policy (`checkLocalToolProgressPolicy`) — lines 252-270
   - Patch phase policy (`checkPatchPhasePolicy`) — lines 272-304
   - Edit pressure policy (`checkEditPressurePolicy`) — lines 306-328
6. **Execute tool handler** — `toolDef.handler(args, ctx)`
7. **Record results** — render result XML, update evidence, compact into working memory, update progress tracker
8. **Post-loop diagnostics** — detect no-progress, search-after-read loops, inspection-without-change patterns

```ts
// focusedAgentLoop.ts:110-191 — core loop structure
for (let step = 0; step < MAX_STEPS; step++) {
  if (Date.now() > deadline) return buildFinal(...);

  const prompt = buildCompactPrompt({ packet, projectRules, memory, leads, fileCards, latestToolResult, budget });
  const response = await provider.generate(model, prompt, { system: fullSystem, maxTokens: maxOut, temperature: 0, signal });
  const action = parseLocalTextAction(response.text);

  // Route by action kind: plain_text → final → invalid → tool_call
  if (action.kind === "plain_text") { /* completion gate logic */ }
  if (action.kind === "final") { /* completion gate logic */ }
  if (action.kind === "invalid") { consecutiveInvalid++; continue; }
  if (action.kind === "tool_call") {
    // permissions → progress → phase → edit pressure → execute → record
    const toolResult = await toolDef.handler(args, { root, db, config, events, memory, taskId });
    memory = await compactToolResult({ memory, toolName, toolArgs: args, rawResult: toolResult });
    progress = updateLocalToolProgress({ progress, toolName, args, ok: toolResult.ok });
  }
}
```

### `src/agent/focusedAgentLoop.ts:433-481` — Prompt Assembly

```ts
function buildCompactPrompt(input): string {
  // Assembles: PROJECT RULES → TASK (goal/success/non-goals) → FACTS →
  // FILES READ → EDITS → CHECKS → LATEST RESULT → RELEVANT FILES → FILE CARDS
  // All within token budget
}
```

### `src/agent/focusedAgentLoop.ts:68-69` — Tool Allowlists per Mode

```ts
const ASK_TOOLS = ["search", "read", "ask_user"];
const PATCH_TOOLS = ["search", "read", "propose_edit", "create_file", "edit", "replace_lines", "check", "ask_user"];
```

---

## 5. Tool Registry & Tool Definitions

### `src/agent/tools/toolRegistry.ts:1-59` — ToolRegistry Class

```ts
export class ToolRegistry {
  private tools = new Map<string, AgentTool>();

  register(tool: AgentTool): void { this.tools.set(tool.name, tool); }
  registerAll(tools: AgentTool[]): void { for (const tool of tools) this.register(tool); }
  list(mode?: ToolMode): AgentTool[] { /* filter by mode */ }
  get(name: string): AgentTool | undefined { return this.tools.get(name); }
  has(name: string): boolean { return this.tools.has(name); }
}
```

Each `AgentTool` has:
- `name` — string identifier
- `description` — for the LLM system prompt
- `parameters` — JSON Schema for the tool's arguments
- `mode` — `"readonly" | "patch" | "dangerous"`
- `handler: (args, ctx: ToolContext) => Promise<ToolResult>` — async execution function

`ToolContext` provides: `root`, `db`, `config`, `events`, `memory` (WorkingMemory), `taskId`

`ToolResult` returns: `ok`, `summary`, `content?`, `truncated?`, `metadata?`, `nextActions?`

### Individual Tools

**`searchTool`** (`src/agent/tools/searchTool.ts:8-219`) — Searches project via SQLite index (file paths, symbols, summaries) and ripgrep for text. Returns compact leads with suggested `<tool_call>` read snippets.

**`readTool`** (`src/agent/tools/readTool.ts:8-167`) — Reads a narrow window of a project file. Supports line ranges, symbol-based lookup, directory safety checks. Max 160 lines, 6000 chars. Returns numbered lines with edit guidance.

**`editTool`** (`src/agent/tools/editTool.ts:7-128`) — Search/replace edit on one file. Enforces: read-before-edit (checks working memory), single-occurrence search text, safety line limits, unified diff generation.

**`checkTool`** (`src/agent/tools/checkTool.ts:6-83`) — Runs configured project checks (`typecheck`, `test`, `lint`, `build`) via execa. Returns pass/fail with truncated output.

**`finishTool`** (`src/agent/tools/finishTool.ts:3-57`) — Declares task complete with summary, changed files list, checks run, remaining issues.

**`proposeEditTool`**, **`createFileTool`**, **`replaceLinesTool`**, **`askUserTool`** — Additional patch/readonly tools.

---

## 6. Prompt & Output Parsing (Text-Based Tool Calling)

### `src/agent/localTextToolPrompt.ts:7-149` — System Prompt Generator

Generates the system prompt telling the LLM how to use the tool calling protocol. Mode-specific rules:

- **Chat**: No tools allowed. Answer with `<final>...</final>`.
- **Ask**: Readonly tools. Progress rules: search at most twice before reading.
- **Patch**: Full tool set. Extensive rules for search → read → edit → check sequence, post-read restrictions, edit pressure, completion requirements.

```ts
// localTextToolPrompt.ts:3-7
export function renderLocalTextToolPrompt(input: {
  mode: "ask" | "patch";
  allowedTools: string[];
  runtimeIntent?: RuntimeIntent;
}): string { ... }
```

The prompt teaches the LLM to emit exactly one block per turn:

```
<tool_call>
{"tool":"search","args":{"query":"login handler","kind":"all","maxResults":5}}
</tool_call>
```

or:

```
<final>
Your answer here.
</final>
```

### `src/agent/localTextToolParser.ts:42-92` — Output Parser

`parseLocalTextAction()` parses the LLM's raw text output:

1. **Normalize tags** — fixes common model mistakes (`<tool_calls>` → `<tool_call>`, `<final_answer>` → `<final>`, etc.)
2. **Count XML blocks** — validates exactly one block per turn
3. **Parse JSON** inside `<tool_call>` blocks, extracting `tool` and `args`
4. **Return typed action**: `tool_call`, `final`, `plain_text`, or `invalid`

```ts
// localTextToolParser.ts:42-45
export function parseLocalTextAction(text: string): ParsedLocalTextAction {
  const norm = normalizeLocalToolTags(text);
  const trimmed = norm.text.trim();
  if (!trimmed) return { kind: "plain_text", content: "", raw: text };
  // ... extract and validate tool_call / final blocks
}
```

`ParsedLocalTextAction` is a discriminated union:
```ts
type ParsedLocalTextAction =
  | { kind: "tool_call"; tool: string; args: Record<string, unknown>; raw: string; repaired?: boolean; warnings?: string[] }
  | { kind: "final"; content: string; raw: string; repaired?: boolean; warnings?: string[] }
  | { kind: "plain_text"; content: string; raw: string }
  | { kind: "invalid"; error: string; raw: string };
```

### `src/agent/localTextToolResult.ts:3-32` — Result Renderer

Formats tool execution results back into `<tool_result>` XML for the next prompt iteration:

```ts
export function renderLocalTextToolResult(input: {
  tool: string; ok: boolean; summary: string;
  content?: string; nextActions?: string[]; truncated?: boolean;
}): string {
  // Returns: <tool_result tool="search" ok="true">\nSummary:\n...\n</tool_result>
}
```

---

## 7. Working Memory — State Tracking Across Tool Turns

### `src/agent/workingMemory.ts:3-140`

`WorkingMemory` is a mutable accumulator that tracks state across the entire agent loop:

```ts
type WorkingMemory = {
  goal: string;
  successCriteria: string[];
  confirmedFacts: string[];
  filesRead: Array<{ path: string; ranges: string[]; summary: string }>;
  currentHypothesis: string;
  editPlan: string[];
  editsApplied: string[];
  checkResults: string[];
  remainingUnknowns: string[];
  warnings: string[];
};
```

- `createWorkingMemory(packet)` — initializes from a `TaskPacket`, seeding unknowns from keywords
- `renderWorkingMemory(memory)` — serializes for prompt injection
- `mergeWorkingMemory(old, update)` — immutable merge with deduplication

### `src/agent/compactToolResult.ts:5-111` — Memory Compaction

After each tool execution, `compactToolResult()` distills the outcome into structured memory updates:

```ts
export async function compactToolResult(input: {
  memory: WorkingMemory; toolName: string; toolArgs: unknown; rawResult: ToolResult;
}): Promise<WorkingMemory> {
  switch (toolName) {
    case "read":    // → filesRead + confirmedFacts (first 4 lines) + remove path from unknowns
    case "search":  // → confirmedFacts (hit count) + maybe add unknowns
    case "edit":    // → editsApplied + hypothesis + remove path from unknowns
    case "check":   // → checkResults + remove check-related unknowns
    case "finish":  // → hypothesis = "Task completed."
    default:        // → confirmedFacts
  }
}
```

This ensures the agent always has a concise, evolving summary of what it has done.

---

## 8. Policy Enforcement Layers

The harness enforces **four layers** of policy on every tool call, in order:

### Layer 1: Tool Permissions (`src/agent/toolPermissions.ts`)
- `allowedTools` list per mode (ask: readonly, patch: all)
- `isWriteTool()` check against `runtimeIntent` — write tools blocked for `ask` and `chat` intents

### Layer 2: Progress Policy (`src/agent/localToolProgressPolicy.ts:13-49`)
Prevents infinite search/read loops:
- Max 2 consecutive searches without reading
- Max 4 consecutive reads without editing

```ts
export function checkLocalToolProgressPolicy(input: {
  toolName: string; args: Record<string, unknown>;
  progress: LocalToolProgress;
  maxConsecutiveSearches: number; maxConsecutiveReads: number;
}): ProgressPolicyDecision { ... }
```

### `src/agent/localToolProgress.ts:15-70` — Progress State

```ts
type LocalToolProgress = {
  consecutiveSearches: number; consecutiveReads: number;
  totalSearches: number; searchesAfterFirstRead: number;
  firstReadHappened: boolean; searchedSinceLastRead: boolean; ...
};
```

`updateLocalToolProgress()` resets consecutive counters on tool switches and tracks search/read sequencing.

### Layer 3: Patch Phase Policy (`src/agent/patchPhasePolicy.ts:14-94`)
Controls the search → read → edit transition in patch mode:
- Max total searches per run (default 4)
- Max searches after first read (default 1)
- Requires `reason` field for searches after reading
- Blocks broad search queries (single generic words like "mode", "config", "src", etc.)

```ts
export function checkPatchPhasePolicy(input: {
  phase: PatchPhase; toolName: string; args; progress: LocalToolProgress;
  maxTotalSearchesPerRun: number; maxSearchesAfterFirstRead: number;
  requireReasonForSearchAfterRead: boolean;
}): PatchPhasePolicyDecision { ... }
```

### Layer 4: Edit Pressure Policy (`src/agent/editPressurePolicy.ts:12-73`)
Forces the agent to stop gathering context and start editing:
- Activated after 2+ files read OR 3+ searches
- Blocks `search` — only allows: `propose_edit`, `edit`, `replace_lines`, `create_file`, `ask_user`, `finish`, `check`, and optionally `read`

```ts
export function checkEditPressurePolicy(input: {
  runtimeIntent: RuntimeIntent; toolName: string; evidence: RunEvidence;
  totalSearches: number; maxReadsBeforeEditPressure: number;
  maxSearchesBeforeEditPressure: number; allowReadAfterEditPressure: boolean;
}): EditPressureDecision { ... }
```

---

## 9. Completion Gate — Verifying Task Completion

### `src/agent/completionGate.ts:11-74`
`canCompleteRun()` enforces patch mode completion requirements:
- **Ask mode**: any non-empty final text → `completed`
- **Patch mode**:
  - Changed files + at least one passing check → `completed`
  - `allowNoEditCompletion` (e.g., tasks like "explain this code") → `completed` with warning
  - `allowInspectedNoEditFinal` (inspected files, explained no edit needed) → `completed` with warning
  - Plain non-code file creation (no code checks needed) → `completed`
  - Otherwise → `failed` or `partial` with detailed evidence report

### `src/agent/runEvidence.ts:7-17`
```ts
type RunEvidence = {
  filesRead: string[]; filesEdited: string[]; filesCreated: string[];
  checksRun: CheckEvidence[]; toolResults: Array<{ tool: string; ok: boolean; summary: string }>;
};
```

### `src/agent/runMetrics.ts:1-27`
Tracks 25+ metrics per run: model turns, tool call counts (total/succeeded/failed), per-tool counters, policy rejections, edit pressure stats, propose/edit acceptance rates.

---

## 10. Context Retrieval Pipeline

### `src/context/retriever.ts:127-358`

**`classifyTask()`** (`retriever.ts:127-156`) — Fully algorithmic (no LLM). Extracts keywords, file hints (by extension pattern), symbol hints (CamelCase pattern), and tags (16 domain-tag patterns like auth, api, ui, database, etc.) from the user prompt.

**`retrieve()`** (`retriever.ts:194-358`) — Scores and ranks files using 8 signal sources:

| # | Signal | Weight | Description |
|---|--------|--------|-------------|
| 1 | ripgrep hits | min(count,8) × 3 | Exact keyword matches in file contents |
| 2 | tag overlap | overlap × 2 | File tags matching task tags |
| 3 | summary match | matches × 2 | File summaries containing keywords |
| 4 | symbol match | 4 | Symbol names matching keywords/hints |
| 5 | file hints | 7–12 | Exact/basename/partial path matches |
| 6 | task memory | 2 | Files edited in past successful similar tasks |
| 7 | graph proximity | 1.5 | Import graph neighbors of top seeds |
| 8 | related tests | 1.5 | Test files related to top-scored files |

### `src/context/taskPacket.ts:38-95`
`buildHeuristicTaskPacket()` extracts structured task information from the user prompt without any LLM call:
- **Goal**: first 200 chars of prompt
- **Success criteria**: based on trivial vs. detailed prompts
- **Keywords**: tokenized and deduplicated
- **Likely areas**: pattern-matched against 10 domain areas (ui, database, auth, tests, config, agent, api, build, tooling)
- **Suspected files**: matched by file extension pattern
- **Constraints**: whole-file rewrite detection
- **Verification plan**: inferred from TS project detection, bug patterns, lint patterns

### `src/context/contextPacker.ts:24-118`
`packContext()` assembles a token-budgeted context packet: header (task + tags + rules) → selected files with symbol-focused code windows → footer. Stays under `maxPromptTokens`, omits files when budget is exceeded.

### `src/context/focusedBriefing.ts:10-94`
`packFocusedBriefing()` assembles the prompt for the focused agent loop: rules, task details, project rules, file cards, working memory, retrieval leads — all within token budget.

---

## 11. Multi-Provider Tool Call Parsing

### `src/providers/toolCallParser.ts:6-137`
Handles three provider-specific tool call formats plus XML fallback:

```ts
export function parseInternalToolCalls(input: {
  provider: ProviderKind; message: unknown; turnId: string;
}): InternalToolCall[] {
  // 1. OpenAI-compatible: message.tool_calls[] with { function: { name, arguments } }
  // 2. Ollama/Qwen: message.function_call with { name, arguments }
  // 3. Anthropic: message.content[] blocks with type === "tool_use"
  // 4. XML fallback: parse <tool_call>{...}</tool_call> from text content
}
```

`parseInternalAssistantResponse()` combines text extraction + tool call parsing for any provider.

### Provider protocol types (`src/providers/providerProtocol.ts`):
```ts
type InternalRole = "user" | "assistant" | "tool" | "system";
type InternalMessage = { role: InternalRole; content: string; toolCalls?: InternalToolCall[]; toolCallId?: string; name?: string };
type InternalToolCall = { id: string; name: string; argumentsJson: string; providerCallId?: string; provider: string; raw: unknown };
```
`.opencode.json` (the project workspace config) is **not present**, meaning the harness files exist only under the `src/` tree — there is no separate harness configuration beyond `src/agent/tools/toolRegistry.ts` and the per-tool parameter schemas.

---

## 12. Loop Exit Diagnostics

After exhausting MAX_STEPS (or after the last tool turn), the harness checks for known failure patterns:

1. **No progress** (`retriever.ts:399-401`): searches > 0, reads === 0, no changes/checks
2. **Search-after-read loop** (`retriever.ts:404-408`): ≥4 searches, ≥1 read, no edits, no checks
3. **Inspection without change** (`retriever.ts:410-413`): ≥2 reads, no edits, no file creation, no checks

These diagnostics feed back actionable next-fix suggestions for the user.

---

## 13. File Index

| File | Lines | Role |
|------|-------|------|
| `src/cli.ts` | 92-211 | CLI command registration and runtime wiring |
| `src/runtime/smithRuntime.ts` | 27-169 | Central dispatch for all action kinds |
| `src/agent/taskRunner.ts` | 38-468 | High-level pipeline: intent → leads → registry → loop |
| `src/agent/focusedAgentLoop.ts` | 68-503 | Core LLM tool-calling loop (the harness heart) |
| `src/agent/tools/toolRegistry.ts` | 1-59 | `ToolRegistry` class, `AgentTool`/`ToolResult` types |
| `src/agent/tools/searchTool.ts` | 8-219 | File/text/symbol search via SQLite + ripgrep |
| `src/agent/tools/readTool.ts` | 8-167 | Narrow file reading with symbol support |
| `src/agent/tools/editTool.ts` | 7-128 | Search/replace edit with safety enforcement |
| `src/agent/tools/checkTool.ts` | 6-83 | Project check execution (typecheck/test/lint/build) |
| `src/agent/tools/finishTool.ts` | 3-57 | Task completion summary |
| `src/agent/localTextToolPrompt.ts` | 7-149 | System prompt generator (teaches LLM tool syntax) |
| `src/agent/localTextToolParser.ts` | 13-92 | XML `<tool_call>` / `<final>` parser |
| `src/agent/localTextToolResult.ts` | 3-32 | `<tool_result>` XML renderer |
| `src/agent/workingMemory.ts` | 3-140 | State accumulator across tool turns |
| `src/agent/compactToolResult.ts` | 5-111 | Tool result → memory compaction |
| `src/agent/classifyRuntimeIntent.ts` | 15-118 | Algorithmic chat/ask/patch intent classification |
| `src/agent/toolPermissions.ts` | 1-59 | Runtime intent → tool permission mapping |
| `src/agent/localToolProgress.ts` | 1-70 | Tool call sequencing tracker |
| `src/agent/localToolProgressPolicy.ts` | 13-49 | Max consecutive search/read enforcement |
| `src/agent/patchPhasePolicy.ts` | 14-94 | Search → read → edit sequencing in patch mode |
| `src/agent/editPressurePolicy.ts` | 12-73 | Forces editing after enough context gathering |
| `src/agent/completionGate.ts` | 11-124 | Task completion verification + evidence reporting |
| `src/agent/runMetrics.ts` | 1-27 | 25+ per-run observability metrics |
| `src/agent/runEvidence.ts` | 1-17 | Per-run evidence accumulator (files, checks, tool results) |
| `src/context/retriever.ts` | 127-358 | Algorithmic task classification + 8-signal file scoring |
| `src/context/contextPacker.ts` | 24-118 | Token-budgeted context packet assembly |
| `src/context/focusedBriefing.ts` | 10-94 | Agent loop prompt assembly with budget enforcement |
| `src/context/taskPacket.ts` | 38-95 | Heuristic task extraction from user prompt |
| `src/providers/toolCallParser.ts` | 6-137 | Multi-provider tool call response parser |

---

## 14. Tool Calling Flow Diagram

```
User Prompt
    │
    ▼
[classifyRuntimeIntent] ──→ chat / ask / patch
    │
    ▼
[buildHeuristicTaskPacket] ──→ TaskPacket { goal, criteria, keywords, areas, files, verification }
    │
    ▼
[classifyTask + retrieve] ──→ ScoredFile[] (8 signal sources: grep, tags, summary, symbols, hints, memory, graph, tests)
    │
    ▼
[retrieveLeads] ──→ RetrievalLead[] { path, reason, evidence, suggestedRead }
    │
    ▼
[buildToolRegistry(mode)] ──→ ToolRegistry (search, read, +/- edit, check, ...)
    │
    ▼
╔══════════════════════════════════════════════════╗
║  runFocusedAgentLoop (up to 12 turns)            ║
║                                                   ║
║  for each turn:                                   ║
║    ┌─ buildCompactPrompt()                        ║
║    │   (task + rules + memory + leads + results)  ║
║    ├─ provider.generate(model, prompt, system)    ║
║    ├─ parseLocalTextAction(response.text)         ║
║    │   → tool_call / final / plain_text / invalid ║
║    ├─ [if tool_call] Policy Checks:               ║
║    │   1. allowedTools + runtimeIntent             ║
║    │   2. checkLocalToolProgressPolicy             ║
║    │   3. checkPatchPhasePolicy (patch only)       ║
║    │   4. checkEditPressurePolicy (patch only)     ║
║    ├─ toolDef.handler(args, ctx)                  ║
║    ├─ renderLocalTextToolResult()                  ║
║    ├─ compactToolResult() → update memory          ║
║    └─ update progress/evidence/metrics            ║
║                                                   ║
║  exit conditions:                                 ║
║    - <final> block with passing completion gate   ║
║    - plain_text (ask: finish; patch: gate check)  ║
║    - max_steps / deadline / invalid / provider_err ║
║    - no_progress / search_after_read_loop          ║
║    - inspection_without_change                     ║
║    - waiting_for_user (ask_user tool)              ║
╚══════════════════════════════════════════════════╝
    │
    ▼
[canCompleteRun] ──→ completed / partial / failed
    │
    ▼
FocusedAgentResult { ok, status, finalText, changedFiles, checksRun, metrics, evidence, memory }
```
