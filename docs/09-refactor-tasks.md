# Agent Smith Refactor Plan — Small-Context Focused Agent

This document is a long, agent-ready task list for refactoring the current implementation from a mostly static RAG/patching flow into a small-context, task-focused coding agent.

The goal is **not** to add a huge tool ecosystem. The goal is to make the app reduce the reasoning burden on the model by:

- distilling messy prompts into precise task contracts
- retrieving compact evidence instead of dumping files
- maintaining compressed working memory
- limiting raw code windows
- using a minimal deterministic tool set
- editing through controlled operations rather than relying on perfect unified diffs
- verifying after small edits
- compacting context aggressively

The target architecture is:

```txt
User prompt
  ↓
Task distiller
  ↓
TaskPacket
  ↓
RetrievalLead generation
  ↓
Context briefing
  ↓
Minimal agent loop
  ↓
read/search/edit/check/finish
  ↓
WorkingMemory compaction
  ↓
final result
```

---

# Phase 0 — Ground rules for the refactor

## Task 0.1 — Preserve existing behavior while refactoring

### Goal

Refactor the internals without breaking the current CLI, TUI, API, LAN interface, organizer, or existing patch/checkpoint/change-set systems.

### Requirements

- Do not remove the current `ask`, `patch`, `retrieve`, `context`, `index`, or `reindex` runtime actions.
- Keep the current SQLite schema working.
- Keep existing safety checks.
- Keep existing change-set review support.
- Keep existing git checkpoint/revert behavior.
- Keep existing provider abstraction.
- Keep fallback behavior when no LLM is available.

### Acceptance criteria

- Existing commands still run.
- Current `runAsk()` and `runPatch()` still work, even if internally they use the new pipeline.
- If a new feature fails, the app can fall back to the previous retrieval/packing behavior.

---

## Task 0.2 — Add feature flags for the new focused-agent pipeline

### Goal

Allow the new pipeline to be enabled gradually.

### Suggested config

Update `.agent/config.json` schema with:

```json
{
  "agent": {
    "focusedPipeline": true,
    "taskDistillation": true,
    "workingMemory": true,
    "compactContext": true,
    "minimalToolLoop": true,
    "editToolMode": "search_replace"
  }
}
```

### Suggested TypeScript type

```ts
export type AgentConfig = {
  focusedPipeline: boolean;
  taskDistillation: boolean;
  workingMemory: boolean;
  compactContext: boolean;
  minimalToolLoop: boolean;
  editToolMode: "disabled" | "search_replace" | "replace_lines";
};
```

### Acceptance criteria

- The old behavior can be restored by disabling `focusedPipeline`.
- Each major new mechanism can be toggled independently.
- Config validation uses Zod and has safe defaults.

---

# Phase 1 — Add task contracts

## Task 1.1 — Add `TaskPacket` type

### Goal

Represent every user request as a precise, compact task contract before retrieval or patching.

### Create file

```txt
src/context/taskPacket.ts
```

### Implement

```ts
export type TaskPacket = {
  goal: string;
  successCriteria: string[];
  nonGoals: string[];
  keywords: string[];
  likelyAreas: string[];
  constraints: string[];
  suspectedFiles: Array<{
    path: string;
    reason: string;
    suggestedRanges?: Array<[number, number]>;
  }>;
  verificationPlan: string[];
  rawUserPrompt: string;
  confidence: "low" | "medium" | "high";
};
```

### Requirements

- `goal` must be one clear sentence.
- `successCriteria` must be testable.
- `nonGoals` must explicitly prevent unrelated rewrites.
- `keywords` should be usable by retrieval.
- `likelyAreas` should be broad areas such as `ui`, `api`, `database`, `auth`, `config`, `tests`, `build`, `tooling`.
- `suspectedFiles` starts empty unless file hints are explicit or retrieval has already run.
- `verificationPlan` should include the narrowest checks that make sense.

### Acceptance criteria

- There is a reusable `TaskPacket` type.
- The type does not include raw file contents.
- The task packet can be serialized and logged.

---

## Task 1.2 — Add heuristic task packet builder

### Goal

Create a no-LLM fallback that converts a prompt into a basic `TaskPacket`.

### Add to

```txt
src/context/taskPacket.ts
```

### Implement

```ts
export function buildHeuristicTaskPacket(userPrompt: string): TaskPacket
```

### Behavior

- Extract file paths matching patterns like:
  - `src/foo.ts`
  - `foo.tsx`
  - `package.json`
  - `.agent/config.json`
- Extract keywords from the prompt.
- Infer likely areas from keywords:
  - `button`, `screen`, `layout`, `css`, `theme`, `component` → `ui`
  - `sql`, `supabase`, `schema`, `rls`, `database` → `database`
  - `login`, `auth`, `password`, `invite` → `auth`
  - `test`, `spec`, `typecheck`, `lint` → `tests`
  - `config`, `settings`, `profile` → `config`
  - `ollama`, `model`, `provider`, `tool` → `agent`
- Generate generic non-goals:
  - `Do not rewrite unrelated code.`
  - `Do not change public APIs unless required.`
  - `Do not alter UI layout unless the request is specifically about layout.`
- Generate verification plan:
  - include `typecheck` by default for TypeScript projects
  - include `test` if prompt mentions bug, tests, regression, or behavior
  - include `lint` if configured

### Acceptance criteria

- Works without any model available.
- Produces a valid `TaskPacket` for every prompt.
- Does not throw on empty or strange prompts.

---

## Task 1.3 — Add model-based task distiller

### Goal

Use the model to convert messy user prompts into precise task contracts.

### Create file

```txt
src/context/taskDistiller.ts
```

### Implement

```ts
export async function distillTaskPacket(input: {
  userPrompt: string;
  projectRules?: string;
  recentMemory?: string;
  provider: Provider;
  model: string;
  fallback?: TaskPacket;
}): Promise<TaskPacket>
```

### Prompt

Use a strict JSON-only prompt:

```txt
You convert messy user requests into compact coding task contracts.

Return only JSON with this shape:
{
  "goal": "one clear sentence",
  "successCriteria": ["testable outcome"],
  "nonGoals": ["things not to change"],
  "keywords": ["retrieval keyword"],
  "likelyAreas": ["ui|api|database|auth|config|tests|build|agent|tooling|other"],
  "constraints": ["important constraint"],
  "verificationPlan": ["typecheck|test|lint|build or specific check"],
  "confidence": "low|medium|high"
}

Rules:
- Preserve the user's exact intent.
- Do not invent files or implementation details.
- Add non-goals to prevent unrelated rewrites.
- If the user complains about a regression, include the previous desired behavior.
- If the user says "whole file", include that as a constraint.
- Keep it compact.
```

### Requirements

- Use existing JSON extraction helper if available.
- Validate with Zod.
- Merge with heuristic fallback if model output is incomplete.
- Never pass raw source code into the distiller.
- Limit the distiller prompt to project rules and recent memory only.

### Acceptance criteria

- Distiller returns valid `TaskPacket`.
- Invalid JSON falls back to heuristic packet.
- The packet is visibly better than raw prompt for vague requests.

---

## Task 1.4 — Integrate task distillation into runtime

### Goal

Make every `ask` and `patch` action start from a `TaskPacket`.

### Modify

```txt
src/agent/taskRunner.ts
src/runtime/smithRuntime.ts
```

### Requirements

- At the beginning of `runAsk()` and `runPatch()`, build a `TaskPacket`.
- If `config.agent.taskDistillation` is true, use model-based distillation.
- Otherwise use heuristic packet.
- Store/log task packet in task memory if available.
- Emit event:

```ts
events.emit("task:phase", { phase: "distilling" });
```

### Acceptance criteria

- Debug output can show the generated task packet.
- Existing behavior still works if distillation is disabled.
- Retrieval uses task packet keywords instead of raw prompt alone.

---

# Phase 2 — Replace raw retrieval output with compact leads

## Task 2.1 — Add `RetrievalLead` type

### Goal

Return compact, evidence-based retrieval leads instead of immediately packing raw files.

### Create or update

```txt
src/context/retriever.ts
```

### Add type

```ts
export type RetrievalLead = {
  path: string;
  score: number;
  reason: string;
  evidence: Array<{
    type: "grep" | "symbol" | "summary" | "tag" | "graph" | "memory" | "file_hint" | "test";
    text: string;
    lines?: [number, number];
  }>;
  recommendedAction: "read_lines" | "read_symbol" | "search_more" | "ignore";
  suggestedRanges?: Array<[number, number]>;
};
```

### Acceptance criteria

- Existing `ScoredFile[]` can be converted to `RetrievalLead[]`.
- Each lead has a human-readable reason.
- Evidence is compact and does not include huge code chunks.

---

## Task 2.2 — Implement `retrieveLeads()`

### Goal

Build leads from the existing multi-signal retriever.

### Implement

```ts
export async function retrieveLeads(input: {
  db: SmithDatabase;
  root: string;
  packet: TaskPacket;
  maxLeads?: number;
}): Promise<RetrievalLead[]>
```

### Behavior

- Reuse existing retrieval signals:
  - grep
  - tag overlap
  - summary match
  - symbol match
  - direct file hints
  - task memory
  - graph proximity
  - related tests
- Convert each selected file into a compact lead.
- Include line ranges where available.
- Prefer line ranges around matching symbols or grep hits.
- Cap evidence items per file.

### Suggested limits

```ts
const MAX_LEADS = 12;
const MAX_EVIDENCE_PER_LEAD = 4;
const MAX_EVIDENCE_TEXT_CHARS = 240;
```

### Acceptance criteria

- Retrieval lead output is less than 1,500 tokens for normal tasks.
- No raw full files are included.
- Leads are understandable enough for the model to choose what to read.

---

## Task 2.3 — Add lead rendering

### Goal

Render retrieval leads into a compact prompt section.

### Create file

```txt
src/context/renderLeads.ts
```

### Implement

```ts
export function renderRetrievalLeads(leads: RetrievalLead[]): string
```

### Output format

```txt
Relevant leads:
1. src/configStore.ts
   Reason: direct match for config/profile switching behavior.
   Evidence:
   - grep lines 84-91: switchConfig handles active profile.
   - summary: persists monitor profile configs.
   Recommended: read_lines 70-130.

2. src/hotkeys.ts
   Reason: handles repeated switch command.
   Evidence:
   - symbol: rotateProfile()
   Recommended: read_lines 30-110.
```

### Acceptance criteria

- The output is readable in the TUI/debug logs.
- It is compact.
- It never dumps full source files.

---

## Task 2.4 — Change context packing to use leads first

### Goal

Stop packing raw code windows before the agent chooses what to inspect.

### Modify

```txt
src/context/contextPacker.ts
```

### Requirements

Add a new function:

```ts
export function packFocusedBriefing(input: {
  packet: TaskPacket;
  leads: RetrievalLead[];
  projectRules?: string;
  workingMemory?: WorkingMemory;
  tokenBudget: ContextBudget;
}): ContextPacket
```

### The focused briefing should contain

```txt
- Small system/task rules
- TaskPacket
- WorkingMemory summary if any
- Retrieval leads
- Very small recent context if needed
```

### It should not contain

```txt
- Full raw files by default
- More than 1 or 2 live code windows
- Huge tool outputs
```

### Acceptance criteria

- `packFocusedBriefing()` can produce a useful prompt under 4k tokens.
- Existing `packContext()` remains available as fallback.
- Focused pipeline uses `packFocusedBriefing()`.

---

# Phase 3 — Add file cards for compressed project context

## Task 3.1 — Add `FileCard` type

### Goal

Store compact summaries of files so the model can reason about files without reading them.

### Create file

```txt
src/index/fileCards.ts
```

### Add type

```ts
export type FileCard = {
  path: string;
  purpose: string;
  exports: string[];
  imports: string[];
  importantFunctions: Array<{
    name: string;
    lines: [number, number];
    summary: string;
  }>;
  stateTouched: string[];
  sideEffects: string[];
  commonEditWarnings: string[];
  lastUpdatedHash: string;
};
```

### Acceptance criteria

- `FileCard` is serializable.
- File cards are compact enough to include several in a small context window.
- File cards can be invalidated by file hash.

---

## Task 3.2 — Add SQLite table for file cards

### Goal

Persist file cards in the existing database.

### Modify

```txt
src/db/db.ts
```

### Add table

```sql
create table if not exists file_cards (
  path text primary key,
  hash text not null,
  purpose text not null,
  exports_json text not null,
  imports_json text not null,
  important_functions_json text not null,
  state_touched_json text not null,
  side_effects_json text not null,
  common_edit_warnings_json text not null,
  updated_at text not null
);
```

### Add indexes

```sql
create index if not exists idx_file_cards_hash on file_cards(hash);
```

### Add DB methods

```ts
getFileCard(path: string): FileCard | undefined
upsertFileCard(card: FileCard): void
getFileCards(paths: string[]): FileCard[]
searchFileCards(query: string, limit: number): FileCard[]
```

### Acceptance criteria

- DB initializes cleanly on existing projects.
- Existing schema migrations do not break.
- File cards can be stored and retrieved.

---

## Task 3.3 — Generate heuristic file cards

### Goal

Create file cards without relying on an LLM.

### Add to

```txt
src/index/fileCards.ts
```

### Implement

```ts
export function buildHeuristicFileCard(input: {
  path: string;
  content: string;
  hash: string;
  symbols: IndexedSymbol[];
  imports: IndexedImport[];
  summary?: string;
}): FileCard
```

### Behavior

- Purpose comes from existing file summary if available.
- Exports come from symbol extraction/import extraction.
- Important functions are top-level exported or high-frequency symbols.
- State touched is inferred from keywords:
  - `useState`, `store`, `db`, `localStorage`, `sqlite`, `config`, `session`
- Side effects inferred from:
  - `fs.`, `execa`, `fetch`, `child_process`, `process.env`, `git`, `sqlite`
- Common edit warnings inferred from:
  - config files
  - DB files
  - safety files
  - UI layout/theme files

### Acceptance criteria

- Every indexed file can get a heuristic card.
- Cards remain useful even without LLM summaries.
- Cards are short.

---

## Task 3.4 — Generate model-compressed file cards

### Goal

Use the model to produce better file cards when available.

### Implement

```ts
export async function buildModelFileCard(input: {
  path: string;
  contentWindow: string;
  heuristicCard: FileCard;
  provider: Provider;
  model: string;
}): Promise<FileCard>
```

### Prompt requirements

Return JSON only:

```json
{
  "purpose": "one sentence",
  "exports": [],
  "imports": [],
  "importantFunctions": [
    {
      "name": "string",
      "lines": [1, 10],
      "summary": "one sentence"
    }
  ],
  "stateTouched": [],
  "sideEffects": [],
  "commonEditWarnings": []
}
```

### Limits

- Do not send huge files.
- Send:
  - file header
  - imports
  - symbol list
  - existing summary
  - selected snippets only

### Acceptance criteria

- Model-generated cards are validated.
- If generation fails, heuristic cards are used.
- File card generation does not block the whole index if one file fails.

---

## Task 3.5 — Integrate file cards into indexing

### Goal

Generate/update file cards during index and reindex.

### Modify

```txt
src/index/indexer.ts
src/index/reindexer.ts
```

### Requirements

- After symbols/imports/summaries are produced, generate file cards.
- Only regenerate when file hash changes.
- Respect config:

```json
{
  "index": {
    "fileCards": true,
    "fileCardModel": "",
    "fileCardConcurrency": 2
  }
}
```

### Acceptance criteria

- New index creates file cards.
- Reindex updates cards only for changed files.
- If model is unavailable, heuristic cards still work.

---

# Phase 4 — Add context budget manager

## Task 4.1 — Add real context budget type

### Goal

Track the prompt budget by section instead of one global `maxPromptTokens`.

### Create file

```txt
src/context/contextBudget.ts
```

### Add type

```ts
export type ContextBudget = {
  maxPromptTokens: number;
  systemTokens: number;
  projectRulesTokens: number;
  taskPacketTokens: number;
  fileCardsTokens: number;
  liveCodeTokens: number;
  toolHistoryTokens: number;
  outputReserveTokens: number;
};
```

### Add defaults

For 4k:

```ts
export const DEFAULT_4K_BUDGET: ContextBudget = {
  maxPromptTokens: 4096,
  systemTokens: 400,
  projectRulesTokens: 300,
  taskPacketTokens: 600,
  fileCardsTokens: 800,
  liveCodeTokens: 900,
  toolHistoryTokens: 400,
  outputReserveTokens: 600
};
```

For 8k:

```ts
export const DEFAULT_8K_BUDGET: ContextBudget = {
  maxPromptTokens: 8192,
  systemTokens: 700,
  projectRulesTokens: 600,
  taskPacketTokens: 900,
  fileCardsTokens: 1200,
  liveCodeTokens: 2500,
  toolHistoryTokens: 1000,
  outputReserveTokens: 1500
};
```

### Acceptance criteria

- Budget can be selected based on model/context config.
- Context sections are trimmed independently.
- Live code cannot consume the entire prompt.

---

## Task 4.2 — Improve token estimation interface

### Goal

Prepare the app to support better token counting while keeping the current fallback.

### Modify

```txt
src/context/tokenEstimate.ts
```

### Implement

```ts
export type TokenEstimator = {
  estimate(text: string): number;
  name: string;
};

export const charDiv4Estimator: TokenEstimator = {
  name: "char_div_4",
  estimate(text) {
    return Math.ceil(text.length / 4);
  }
};
```

### Add

```ts
export function trimToTokenBudget(
  text: string,
  maxTokens: number,
  estimator: TokenEstimator = charDiv4Estimator
): string
```

### Acceptance criteria

- Existing code using `estimateTokens()` still works.
- New code can accept a pluggable estimator.
- Long sections are safely trimmed.

---

## Task 4.3 — Add budgeted section renderer

### Goal

Render sections with hard token caps.

### Create file

```txt
src/context/budgetedRender.ts
```

### Implement

```ts
export function renderBudgetedSections(input: {
  sections: Array<{
    name: string;
    content: string;
    maxTokens: number;
  }>;
  estimator?: TokenEstimator;
}): {
  text: string;
  usedTokens: number;
  omitted: string[];
  warnings: string[];
}
```

### Behavior

- Trim sections that exceed their cap.
- Add warning comments when trimmed.
- Omit lowest-priority sections first if total exceeds max.
- Never trim in the middle of JSON if possible.
- Prefer line-based trimming.

### Acceptance criteria

- Context packet rendering is predictable.
- Logs show which sections were trimmed.
- Raw code cannot silently overflow prompt budget.

---

# Phase 5 — Add WorkingMemory

## Task 5.1 — Add `WorkingMemory` type

### Goal

Maintain compressed session state across tool calls.

### Create file

```txt
src/agent/workingMemory.ts
```

### Add type

```ts
export type WorkingMemory = {
  goal: string;
  successCriteria: string[];
  confirmedFacts: string[];
  filesRead: Array<{
    path: string;
    ranges: string[];
    summary: string;
  }>;
  currentHypothesis: string;
  editPlan: string[];
  editsApplied: string[];
  checkResults: string[];
  remainingUnknowns: string[];
  warnings: string[];
};
```

### Add functions

```ts
export function createWorkingMemory(packet: TaskPacket): WorkingMemory

export function renderWorkingMemory(memory: WorkingMemory): string

export function mergeWorkingMemory(
  oldMemory: WorkingMemory,
  update: Partial<WorkingMemory>
): WorkingMemory
```

### Acceptance criteria

- Working memory starts from the task packet.
- Working memory can be rendered under 800 tokens.
- Duplicate facts are deduplicated.

---

## Task 5.2 — Add tool-result compaction

### Goal

Replace old raw tool outputs with useful summaries.

### Create file

```txt
src/agent/compactToolResult.ts
```

### Implement

```ts
export async function compactToolResult(input: {
  memory: WorkingMemory;
  toolName: string;
  toolArgs: unknown;
  rawResult: unknown;
  provider?: Provider;
  model?: string;
}): Promise<WorkingMemory>
```

### Behavior

For `read` results:

- Add file/range to `filesRead`.
- Add 1–4 confirmed facts.
- Add likely edit target if obvious.

For `search` results:

- Add relevant leads.
- Add remaining unknowns if too many possible files.

For `edit` results:

- Add changed file.
- Add short edit summary.

For `check` results:

- Add pass/fail summary.
- Add key error lines only.
- Add next repair hint if failed.

### Requirements

- Heuristic compaction must work without model.
- Model compaction can improve facts but must output strict JSON.
- Raw tool output is not kept forever.

### Acceptance criteria

- After a read/check, memory becomes more informative.
- Long outputs are summarized.
- Tool history stays small.

---

## Task 5.3 — Integrate WorkingMemory into task runner

### Goal

Use working memory inside `runAsk()` and `runPatch()`.

### Modify

```txt
src/agent/taskRunner.ts
```

### Requirements

- Create memory after task packet.
- Render memory into focused briefing.
- Update memory after each tool call.
- Persist memory into task memory if available.
- Emit event:

```ts
events.emit("task:phase", { phase: "compacting" });
```

### Acceptance criteria

- Debug logs show memory evolving.
- Prompt size stays stable across tool calls.
- The model can continue after compaction without losing the task.

---

# Phase 6 — Minimal tool set

## Task 6.1 — Create generic tool registry

### Goal

Stop hardcoding tools inside `taskRunner.ts`.

### Create file

```txt
src/agent/tools/toolRegistry.ts
```

### Add types

```ts
export type ToolMode = "readonly" | "patch" | "dangerous";

export type AgentTool = {
  name: string;
  description: string;
  parameters: unknown;
  mode: ToolMode;
  handler: (args: unknown, ctx: ToolContext) => Promise<ToolResult>;
};

export type ToolResult = {
  ok: boolean;
  summary: string;
  content?: string;
  truncated?: boolean;
  metadata?: Record<string, unknown>;
  nextActions?: string[];
};

export type ToolContext = {
  root: string;
  db: SmithDatabase;
  config: SmithConfig;
  events?: EventEmitter;
};
```

### Implement

```ts
export class ToolRegistry {
  register(tool: AgentTool): void;
  list(mode: ToolMode): AgentTool[];
  get(name: string): AgentTool | undefined;
}
```

### Acceptance criteria

- Existing local tools can be registered through this registry.
- Tools can be filtered by mode.
- Adding a new tool does not require editing task runner logic.

---

## Task 6.2 — Add `search` tool

### Goal

Unify file, symbol, summary, and grep search behind one compact tool.

### Create file

```txt
src/agent/tools/searchTool.ts
```

### Tool schema

```ts
{
  name: "search",
  description: "Search indexed files, symbols, summaries, and text. Returns compact leads, not full files.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string" },
      kind: { type: "string", enum: ["all", "text", "file", "symbol", "summary"] },
      maxResults: { type: "number" }
    },
    required: ["query"]
  }
}
```

### Behavior

- Use SQLite file/symbol search.
- Use ripgrep for text search.
- Return compact results:
  - path
  - reason
  - line range
  - preview
- Limit results and preview length.

### Acceptance criteria

- Search never returns huge raw output.
- Search can find files by path, function name, or content.
- Result format is consistent.

---

## Task 6.3 — Add `read` tool

### Goal

Read narrow, line-numbered code windows.

### Create file

```txt
src/agent/tools/readTool.ts
```

### Tool schema

```ts
{
  name: "read",
  description: "Read a narrow line window or symbol from a project file.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string" },
      startLine: { type: "number" },
      endLine: { type: "number" },
      symbol: { type: "string" }
    },
    required: ["path"]
  }
}
```

### Hard limits

```ts
const MAX_READ_LINES = 160;
const MAX_READ_CHARS = 6000;
```

### Requirements

- Enforce project-root confinement.
- Include line numbers.
- If symbol is provided, resolve symbol range from SQLite.
- If requested range is too large, trim and mark `truncated: true`.
- Return suggested next reads for omitted ranges when useful.

### Acceptance criteria

- Cannot read outside root.
- Cannot dump huge files.
- Result is compact and line-numbered.

---

## Task 6.4 — Add `edit` tool

### Goal

Let the model request controlled edits without generating full unified diffs.

### Create file

```txt
src/agent/tools/editTool.ts
```

### Tool schema

```ts
{
  name: "edit",
  description: "Apply a controlled search/replace edit to one file.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string" },
      search: { type: "string" },
      replace: { type: "string" },
      reason: { type: "string" }
    },
    required: ["path", "search", "replace", "reason"]
  }
}
```

### Requirements

- Enforce root confinement.
- Require exact match for `search`.
- If there are multiple matches, fail and ask for narrower search.
- Before writing:
  - run safety checks
  - create diff
  - optionally create checkpoint
- After writing:
  - return summary
  - return diff metadata
  - reindex affected file

### Acceptance criteria

- Model does not need to produce unified diff.
- Existing change-set/review system can still display generated diff.
- Edit fails safely if search text is ambiguous.

---

## Task 6.5 — Add `replace_lines` tool

### Goal

Support deterministic line-based edits when search/replace is awkward.

### Tool schema

```ts
{
  name: "replace_lines",
  description: "Replace an exact line range in one file.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string" },
      startLine: { type: "number" },
      endLine: { type: "number" },
      newContent: { type: "string" },
      reason: { type: "string" }
    },
    required: ["path", "startLine", "endLine", "newContent", "reason"]
  }
}
```

### Requirements

- Require the file to have been read first in the current task.
- Enforce maximum changed lines.
- Generate diff internally.
- Run safety checks.
- Reindex after edit.

### Acceptance criteria

- Useful for small targeted changes.
- Prevents blind edits to unread files.
- Produces reviewable diff.

---

## Task 6.6 — Add `check` tool

### Goal

Run configured checks during the agent loop.

### Create file

```txt
src/agent/tools/checkTool.ts
```

### Tool schema

```ts
{
  name: "check",
  description: "Run a configured project check and return a compact result.",
  parameters: {
    type: "object",
    properties: {
      name: {
        type: "string",
        enum: ["typecheck", "test", "lint", "build"]
      }
    },
    required: ["name"]
  }
}
```

### Requirements

- Use existing check runner if available.
- Return:
  - ok
  - summary
  - first relevant error
  - file/line hints
  - truncated output flag
- Do not dump full output by default.

### Acceptance criteria

- Model can verify after edits.
- Failed checks return enough info to repair.
- Huge outputs are compacted.

---

## Task 6.7 — Add `finish` tool

### Goal

Force the agent to stop with a structured summary.

### Create file

```txt
src/agent/tools/finishTool.ts
```

### Tool schema

```ts
{
  name: "finish",
  description: "Finish the task with a concise summary.",
  parameters: {
    type: "object",
    properties: {
      summary: { type: "string" },
      changedFiles: {
        type: "array",
        items: { type: "string" }
      },
      checksRun: {
        type: "array",
        items: { type: "string" }
      },
      remainingIssues: {
        type: "array",
        items: { type: "string" }
      }
    },
    required: ["summary", "changedFiles", "checksRun"]
  }
}
```

### Acceptance criteria

- Agent loop terminates cleanly.
- Final response can be generated from finish payload.
- If remaining issues exist, they are surfaced clearly.

---

# Phase 7 — Build the focused agent loop

## Task 7.1 — Add focused agent loop file

### Goal

Create a minimal loop that uses the new tools and working memory.

### Create file

```txt
src/agent/focusedAgentLoop.ts
```

### Implement

```ts
export async function runFocusedAgentLoop(input: {
  packet: TaskPacket;
  leads: RetrievalLead[];
  memory: WorkingMemory;
  tools: ToolRegistry;
  provider: Provider;
  model: string;
  mode: "ask" | "patch";
  config: SmithConfig;
  root: string;
  db: SmithDatabase;
  events?: EventEmitter;
}): Promise<FocusedAgentResult>
```

### Add result type

```ts
export type FocusedAgentResult = {
  ok: boolean;
  finalText: string;
  changedFiles: string[];
  checksRun: string[];
  memory: WorkingMemory;
  rawMessages?: unknown[];
};
```

### Loop

```txt
1. Render focused briefing.
2. Send model messages with minimal tools.
3. If model calls tool:
   - execute tool
   - compact tool result into WorkingMemory
   - replace old raw result with compact observation
   - continue
4. If model calls finish:
   - return result
5. If max steps reached:
   - return partial result with memory summary
```

### Limits

```ts
const MAX_STEPS = 12;
const MAX_TOOL_CALLS_PER_STEP = 3;
const COMPACT_AFTER_TOOL_CALLS = 3;
```

### Acceptance criteria

- Model can search/read/edit/check/finish.
- The loop does not grow context unbounded.
- The loop works with small context settings.

---

## Task 7.2 — Add focused system prompt

### Goal

Give the small model strict behavior rules.

### Create file

```txt
src/agent/focusedSystemPrompt.ts
```

### Prompt

```txt
You are a small-context coding agent.

Rules:
1. Work only on the stated goal.
2. Do not improve unrelated code.
3. Do not edit a file before reading the relevant lines.
4. Prefer search/read over guessing.
5. Prefer one small edit at a time.
6. After editing, run the narrowest relevant check.
7. Stop with finish when the success criteria are met.
8. If context is insufficient, call search or read.
9. Never output broad explanations during tool mode.
10. Never rewrite architecture unless the task requires it.
11. Use the retrieval leads as hints, not absolute truth.
12. Keep tool arguments precise and minimal.
```

### Acceptance criteria

- The prompt is reused by focused agent loop.
- Prompt remains under 500 tokens.
- It discourages broad rewrites.

---

## Task 7.3 — Integrate focused loop into `runPatch`

### Goal

Use focused loop for patch tasks when enabled.

### Modify

```txt
src/agent/taskRunner.ts
```

### Behavior

If `config.agent.focusedPipeline` and mode is patch:

```txt
build TaskPacket
retrieve leads
create WorkingMemory
run FocusedAgentLoop with patch tools
return result
```

Fallback:

```txt
old runPatch behavior
```

### Acceptance criteria

- Patch tasks can be completed through edit/check/finish tools.
- Old diff-generation path still exists.
- If focused loop fails, return useful partial info instead of crashing.

---

## Task 7.4 — Integrate focused loop into `runAsk`

### Goal

Allow ask tasks to use search/read without patch tools.

### Modify

```txt
src/agent/taskRunner.ts
```

### Behavior

If ask mode:

- tool mode is readonly
- available tools:
  - search
  - read
  - finish
- no edit/check unless specifically allowed

### Acceptance criteria

- Ask mode can inspect files.
- Ask mode cannot edit files.
- Ask responses are grounded in compact inspected context.

---

# Phase 8 — Project rules and context files

## Task 8.1 — Add project rules loader

### Goal

Load stable project instructions from files.

### Create file

```txt
src/context/projectRules.ts
```

### Search order

```txt
~/.agent/AGENTS.md
<repo root>/AGENTS.md
<current working directory>/AGENTS.md
.agent/SYSTEM.md
```

### Implement

```ts
export async function loadProjectRules(input: {
  root: string;
  cwd?: string;
  home?: string;
}): Promise<ProjectRules>
```

### Type

```ts
export type ProjectRules = {
  agentsFiles: Array<{ path: string; content: string }>;
  systemOverride?: string;
  rendered: string;
};
```

### Requirements

- Keep total rendered rules under a configured token budget.
- Later files can override earlier files only if explicitly marked.
- Otherwise combine them as layered rules.
- Missing files are fine.

### Acceptance criteria

- Project rules can be loaded without failing.
- Rules are included in focused briefing.
- Rules are trimmed safely.

---

## Task 8.2 — Add default `AGENTS.md` template command

### Goal

Let the user create a project rules file easily.

### Modify CLI

```txt
src/cli.ts
```

### Add command

```bash
agent init-rules
```

### It creates

```txt
AGENTS.md
```

### Template

```md
# Agent Project Rules

## General

- Work only on the requested task.
- Prefer small, focused patches.
- Do not rewrite unrelated code.
- Do not change UI layout unless explicitly requested.
- Read relevant files before editing them.
- Run the narrowest relevant check after edits.

## Project-specific notes

- Add notes here.
```

### Acceptance criteria

- Command does not overwrite existing file unless `--force`.
- User gets a simple starter file.

---

# Phase 9 — Context compaction and pruning

## Task 9.1 — Add message pruning strategy

### Goal

Prevent the agent loop from carrying old raw messages forever.

### Create file

```txt
src/agent/messageCompactor.ts
```

### Implement

```ts
export function compactMessages(input: {
  messages: AgentMessage[];
  memory: WorkingMemory;
  maxToolHistoryTokens: number;
  estimator: TokenEstimator;
}): AgentMessage[]
```

### Behavior

- Keep:
  - system prompt
  - task packet
  - rendered working memory
  - latest model turn
  - latest tool result if immediately relevant
- Drop:
  - old raw `read` contents
  - old raw `check` output
  - repeated search results
- Replace dropped content with memory summary.

### Acceptance criteria

- Message list size stabilizes.
- Model retains useful facts after raw output is removed.
- No important task facts vanish.

---

## Task 9.2 — Compact after every N tool calls

### Goal

Aggressively compact for small context models.

### Modify

```txt
src/agent/focusedAgentLoop.ts
```

### Config

```json
{
  "context": {
    "compactAfterToolCalls": 3,
    "compactAtTokenRatio": 0.65
  }
}
```

### Behavior

Compact when:

```txt
- tool calls since last compaction >= compactAfterToolCalls
or
- estimated prompt tokens >= compactAtTokenRatio * maxPromptTokens
```

### Acceptance criteria

- 4k models stay within context.
- Long tasks do not explode prompt size.
- Compaction event appears in UI.

---

# Phase 10 — Safer edit flow

## Task 10.1 — Require read-before-edit

### Goal

Prevent blind edits.

### Modify

```txt
src/agent/tools/editTool.ts
src/agent/tools/replaceLinesTool.ts
src/agent/workingMemory.ts
```

### Rule

An edit is allowed only if:

```txt
- The file appears in WorkingMemory.filesRead
or
- The tool is called with an explicit override allowed by config
```

### Acceptance criteria

- The model must inspect a file before editing.
- Attempting blind edit returns a clear error.
- This behavior can be disabled only by explicit config.

---

## Task 10.2 — Generate internal diffs from edits

### Goal

Keep existing review/checkpoint system while avoiding model-generated diffs.

### Create file

```txt
src/agent/editDiff.ts
```

### Implement

```ts
export function buildUnifiedDiffFromEdit(input: {
  path: string;
  before: string;
  after: string;
}): string
```

### Requirements

- Use existing diff builder if available.
- Generated diff must be compatible with current change-set review.
- Include path headers.

### Acceptance criteria

- Search/replace edit produces a unified diff.
- Existing safety and review systems can consume it.
- Diff is shown in UI/API where old patch diffs were shown.

---

## Task 10.3 — Add edit transaction wrapper

### Goal

Make each edit safe and reversible.

### Create file

```txt
src/agent/editTransaction.ts
```

### Implement

```ts
export async function applyEditTransaction(input: {
  root: string;
  path: string;
  before: string;
  after: string;
  reason: string;
  config: SmithConfig;
  db: SmithDatabase;
}): Promise<{
  ok: boolean;
  diff?: string;
  summary: string;
}>
```

### Steps

```txt
1. Validate path inside root.
2. Build diff.
3. Run patch safety checks.
4. Optionally create checkpoint.
5. Write file.
6. Reindex affected file.
7. Store edit memory.
8. Return compact summary.
```

### Acceptance criteria

- Edit tool uses transaction wrapper.
- Failed safety check prevents write.
- Reindex occurs after successful edit.

---

# Phase 11 — Verification strategy

## Task 11.1 — Add check selection helper

### Goal

Choose the narrowest useful check from the task packet and changed files.

### Create file

```txt
src/agent/checkPlanner.ts
```

### Implement

```ts
export function planChecks(input: {
  packet: TaskPacket;
  changedFiles: string[];
  config: SmithConfig;
}): Array<"typecheck" | "test" | "lint" | "build">
```

### Behavior

- Always include `typecheck` for TypeScript files if configured.
- Include `test` if:
  - task mentions bug/regression
  - changed file has related test
  - packet verification plan includes test
- Include `lint` if configured and changed files are source files.
- Include `build` only for broader changes.

### Acceptance criteria

- Check tool can suggest next checks.
- Focused loop does not run expensive checks unnecessarily.
- User can override checks.

---

## Task 11.2 — Summarize check output

### Goal

Make check failures useful but compact.

### Create file

```txt
src/agent/checkSummary.ts
```

### Implement

```ts
export function summarizeCheckOutput(input: {
  name: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  maxChars?: number;
}): {
  ok: boolean;
  summary: string;
  relevantErrors: Array<{
    file?: string;
    line?: number;
    message: string;
  }>;
  truncated: boolean;
}
```

### Requirements

- Parse common TypeScript error format.
- Parse common ESLint format.
- Parse common Vitest/Jest failure snippets.
- Fall back to first meaningful lines.

### Acceptance criteria

- Failed check output is under 1,500 chars.
- Contains enough info for repair.
- Full output can still be saved to logs, but not prompt.

---

# Phase 12 — Update CLI/debug commands

## Task 12.1 — Add `agent distill` command

### Goal

Debug task distillation.

### CLI

```bash
agent distill "fix the switching bug"
```

### Output

Pretty-print `TaskPacket`.

### Acceptance criteria

- User can inspect how prompts are interpreted.
- Useful for debugging prompt misunderstanding.

---

## Task 12.2 — Add `agent leads` command

### Goal

Debug retrieval leads.

### CLI

```bash
agent leads "fix the switching bug"
```

### Output

```txt
TaskPacket
RetrievalLeads
```

### Acceptance criteria

- User can see why files were selected.
- Helps tune retrieval.

---

## Task 12.3 — Add `agent brief` command

### Goal

Preview the compact context sent to the model.

### CLI

```bash
agent brief "fix the switching bug"
```

### Output

Focused briefing with estimated token count.

### Acceptance criteria

- User can inspect context before model call.
- Makes context budget issues visible.

---

# Phase 13 — TUI/API status updates

## Task 13.1 — Add new task phases

### Goal

Reflect the new focused pipeline in UI.

### Modify event type definitions

Add phases:

```ts
"distilling"
"leading"
"briefing"
"tooling"
"reading"
"editing"
"checking"
"compacting"
"finishing"
```

### Acceptance criteria

- TUI shows meaningful phase names.
- Existing phases still work.
- No UI crash if unknown phase appears.

---

## Task 13.2 — Show compact task goal in TUI

### Goal

Make the user see what the agent thinks the task is.

### Modify TUI status panel

Show:

```txt
Goal: <TaskPacket.goal>
Current: reading src/foo.ts lines 80-130
Context: 2.8k / 4k
```

### Acceptance criteria

- User can catch misunderstandings early.
- Does not clutter UI.
- Works in non-interactive CLI logs too.

---

# Phase 14 — Configuration defaults

## Task 14.1 — Add small-context defaults

### Goal

Make the new behavior usable with 4k/8k local models.

### Modify config defaults

```json
{
  "context": {
    "maxPromptTokens": 4096,
    "maxLiveCodeTokens": 1200,
    "maxToolHistoryTokens": 600,
    "maxFileCards": 8,
    "maxReadLines": 120,
    "maxSearchResults": 8,
    "compactAfterToolCalls": 3,
    "compactAtTokenRatio": 0.65
  }
}
```

### Acceptance criteria

- Defaults favor small context windows.
- User can increase limits for larger models.
- Config docs explain the tradeoff.

---

## Task 14.2 — Add focused-agent config docs

### Create file

```txt
docs/focused-agent.md
```

### Include

```md
# Focused Agent Mode

Explains:
- TaskPacket
- RetrievalLead
- FileCard
- WorkingMemory
- Minimal tools
- Context budgets
- Compaction
- Safety model
- How to debug with distill/leads/brief commands
```

### Acceptance criteria

- User can understand and tune the system.
- Docs include examples for 4k and 8k models.

---

# Phase 15 — Testing

## Task 15.1 — Add unit tests for task distillation fallback

### Test file

```txt
src/context/taskPacket.test.ts
```

### Cases

- Empty prompt
- Prompt with file path
- UI bug prompt
- Database/auth prompt
- “whole file” prompt
- Prompt with explicit non-goal

### Acceptance criteria

- Heuristic builder always returns valid packet.
- Keywords and likely areas are reasonable.
- Non-goals are included.

---

## Task 15.2 — Add tests for retrieval lead rendering

### Test file

```txt
src/context/renderLeads.test.ts
```

### Cases

- Lead with grep evidence
- Lead with symbol evidence
- Long evidence text is trimmed
- Empty leads

### Acceptance criteria

- Render output is compact.
- No huge content leaks into leads.

---

## Task 15.3 — Add tests for budgeted rendering

### Test file

```txt
src/context/budgetedRender.test.ts
```

### Cases

- Section under budget
- Section over budget
- Multiple sections exceed total
- Trimming preserves line boundaries

### Acceptance criteria

- Token caps are respected.
- Warnings are produced when trimming.

---

## Task 15.4 — Add tests for read-before-edit

### Test file

```txt
src/agent/tools/editTool.test.ts
```

### Cases

- Edit unread file fails
- Edit read file succeeds
- Ambiguous search fails
- Missing search fails
- Outside-root path fails

### Acceptance criteria

- Edits are safe by default.
- Failures are clear and actionable.

---

## Task 15.5 — Add tests for check summary

### Test file

```txt
src/agent/checkSummary.test.ts
```

### Cases

- TypeScript error
- ESLint error
- Jest/Vitest failure
- Huge output truncation

### Acceptance criteria

- Summary is compact.
- File/line hints are extracted when possible.

---

# Phase 16 — Migration path

## Task 16.1 — Keep old patch flow as fallback

### Goal

Avoid breaking the app during the refactor.

### Requirements

- If focused loop errors before editing, fall back to old patch flow.
- If focused loop partially edits files, do not silently fall back and make more changes.
- If focused loop edits then fails, return partial result and suggest manual review.

### Acceptance criteria

- Safe fallback behavior.
- No double-editing.
- Clear final status.

---

## Task 16.2 — Add telemetry/debug logs

### Goal

Make the pipeline inspectable.

### Log these objects in debug mode

```txt
TaskPacket
RetrievalLeads
FocusedBriefing token count
WorkingMemory after each compaction
Tool calls
Check summaries
Final result
```

### Acceptance criteria

- Debugging does not require reading raw prompts manually.
- Logs do not include giant file dumps by default.

---

# Phase 17 — Final integration checklist

## Task 17.1 — End-to-end focused patch test

### Scenario

User prompt:

```txt
The switching still does not cycle as I spam the command. It should show a graphic of config selection change every time and debounce the apply until I stop rotating. It must not create unnamed configs.
```

### Expected pipeline

```txt
1. Distill task.
2. Retrieve leads for hotkeys/config/profile/apply code.
3. Read only relevant windows.
4. Edit one or two files.
5. Run typecheck.
6. Finish with changed files and checks.
```

### Acceptance criteria

- Does not read more than 3 files unless necessary.
- Does not include full raw files in context.
- Does not create unrelated changes.
- Produces a small patch.
- Runs at least typecheck if configured.

---

## Task 17.2 — End-to-end focused ask test

### Scenario

User prompt:

```txt
Why does the agent fail to apply tools during patching?
```

### Expected pipeline

```txt
1. Distill ask task.
2. Retrieve taskRunner/tool loop/context files.
3. Read relevant windows.
4. Explain the issue.
5. No edits.
```

### Acceptance criteria

- Ask mode does not edit.
- Answer cites inspected files/lines in plain text.
- Context remains compact.

---

# Recommended implementation order

Use this exact order:

```txt
1. TaskPacket + heuristic builder
2. Task distiller
3. RetrievalLead type + retrieveLeads
4. Focused briefing packer
5. ContextBudget + budgeted renderer
6. WorkingMemory
7. ToolRegistry
8. search/read tools
9. focused agent loop readonly mode
10. ask mode integration
11. edit/replace_lines/check/finish tools
12. patch mode integration
13. compaction/pruning
14. project rules loader
15. file cards
16. CLI debug commands
17. tests
18. docs
```

This order gives useful results early and avoids rewriting the whole app at once.

---

# Minimal first milestone

If you want the smallest valuable milestone, implement only this:

```txt
- TaskPacket
- RetrievalLead
- Focused briefing
- WorkingMemory
- search tool
- read tool
- finish tool
- ask-mode focused loop
```

This lets the agent answer questions about the codebase with much smaller context before you risk write/edit tools.

---

# Minimal second milestone

Then add:

```txt
- edit tool
- check tool
- read-before-edit enforcement
- patch-mode focused loop
- generated diffs from edits
```

This is the point where it starts replacing the current patch flow.

---

# Minimal third milestone

Then add:

```txt
- file cards
- model compaction
- project rules
- better CLI debugging
```

This is where small-context performance should become noticeably better.

---

# Design principle to preserve

Every model call should answer only one of these questions:

```txt
1. What exactly is the task?
2. Which compact evidence matters?
3. What do the inspected lines mean?
4. What is the next smallest safe action?
5. Did verification pass?
```

Do not ask a small local model to solve all five at once.
