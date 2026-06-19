# Strengthen Refactor — Closing Gaps in the Focused Pipeline

This document identifies concrete weaknesses in the current focused pipeline and proposes targeted fixes. Each section cites exact files and line numbers.

---

## CRITICAL: Read-Before-Edit Enforcement

### Gap

`WorkingMemory.filesRead` is populated when the model calls `read` (`focusedAgentLoop.ts:220-234`) but **never checked before allowing `edit` or `replace_lines`**. The edit tools (`editTool.ts:4`, `replaceLinesTool.ts`) don't even receive the WorkingMemory in their `ToolContext`. The only "enforcement" is a soft text rule in the system prompt.

### Fix

1. Extend `ToolContext` to include `memory: WorkingMemory`:

```ts
// src/agent/tools/toolRegistry.ts
export type ToolContext = {
  root: string;
  db: SmithDatabase;
  config: SmithConfig;
  events?: NodeJS.EventEmitter;
  memory?: WorkingMemory;       // NEW
};
```

2. In `focusedAgentLoop.ts`, pass memory into context before tool dispatch (around line 187):

```ts
const toolResult = await toolDef.handler(args, {
  root, db, config, events,
  memory,                        // NEW
});
```

3. In `editTool.ts` and `replaceLinesTool.ts`, add a guard before `fs.writeFile`:

```ts
// In handler, before writing:
const readBefore = ctx.memory?.filesRead?.some(
  (f) => f.path === rel || rel.endsWith(f.path)
);
if (!readBefore) {
  return {
    ok: false,
    summary: `Cannot edit ${relPath}: file must be read first. Call 'read' on it, then retry.`,
  };
}
```

4. Add a config escape hatch:

```json
// .agent/config.json
{
  "safety": {
    "requireReadBeforeEdit": true   // default: true
  }
}
```

**Files touched**: `toolRegistry.ts`, `focusedAgentLoop.ts`, `editTool.ts`, `replaceLinesTool.ts`, `types/index.ts`, `config/config.ts`

---

## CRITICAL: Wire compaction utilities

### Gap

Two modules are defined but **never called**:
- `compactToolResult.ts` — updates WorkingMemory from tool results (defined, zero callers)
- `messageCompactor.ts` — selectively prunes old tool outputs (defined, zero callers)

The focusedAgentLoop at lines 266-291 does a crude full-reset compaction (throws away ALL messages, keeps only system prompt + briefing). This loses the model's reasoning chain.

### Fix

1. Call `compactToolResult()` in `focusedAgentLoop.ts` after each tool execution (around line 200), replacing the inline memory updates:

```ts
// After toolResult is obtained (around L200):
const { compactToolResult } = await import("./compactToolResult.js");
memory = await compactToolResult({
  memory,
  toolName: call.name,
  toolArgs: args,
  rawResult: toolResult,
  provider,
  model,
});
```

2. Replace the crude reset at lines 266-291 with `compactMessages()`:

```ts
// Instead of lines 282-288:
if (shouldCompact) {
  events?.emit("task:phase", "compacting");
  const { compactMessages } = await import("./messageCompactor.js");
  const compacted = compactMessages({
    messages: [...messages],
    memory,
    maxToolHistoryTokens: config.context.maxToolHistoryTokens,
  });
  messages.length = 0;
  messages.push(...compacted);
  toolCallsSinceCompact = 0;
}
```

3. Remove the dead `leads: []` at line 275 — leads should be preserved in working memory, not discarded.

4. Fix the `compactAtTokenRatio` undefined bug at line 269:

```ts
const ratio = config.context.compactAtTokenRatio ?? 0.65;
const overBudget = estimateTokens(allContent) > config.context.maxPromptTokens * ratio;
```

**Files touched**: `focusedAgentLoop.ts`, `compactToolResult.ts` (remove unused provider/model params)

---

## CRITICAL: File card indexing integration

### Gap

`buildHeuristicFileCard()` and `upsertFileCard()` are fully defined in `src/index/fileCards.ts` but **zero callers exist**. The `file_cards` SQLite table is created but sits empty. Neither `indexer.ts` nor `reindexer.ts` imports `fileCards`.

### Fix

1. In `indexer.ts`, after symbol extraction and summarization succeeds for a file, generate and persist a file card:

```ts
// In the indexing pipeline, after symbols/imports/summaries are produced:
import { buildHeuristicFileCard, upsertFileCard } from "./fileCards.js";

const card = buildHeuristicFileCard({
  path: filePath,
  content,
  hash,
  symbols: extractedSymbols,
  imports: extractedImports,
  summary,
});
upsertFileCard(db, card);
```

2. In `reindexPaths()` in `indexer.ts`, regenerate file cards for changed files:

```ts
// After re-extracting symbols for a changed file:
const card = buildHeuristicFileCard({ path, content, hash, symbols, imports, summary });
upsertFileCard(db, card);
```

3. Wire file cards into `focusedBriefing.ts` as a budgeted section:

```ts
// In packFocusedBriefing, between project rules and working memory:
import { getFileCards } from "../index/fileCards.js";

const relevantPaths = leads.slice(0, config.context.maxFileCards).map((l) => l.path);
const cards = getFileCards(db, relevantPaths);
if (cards.length > 0) {
  const cardText = cards.map((c) =>
    `${c.path}: ${c.purpose} | Exports: ${c.exports.slice(0,4).join(", ")}`
  ).join("\n");
  segments.push(`## FILE CARDS\n${cardText}`);
}
```

**Files touched**: `indexer.ts`, `reindexer.ts`, `focusedBriefing.ts`, `taskRunner.ts` (pass db to packBriefing)

---

## HIGH: Read-before-edit enforcement (see CRITICAL above)

---

## HIGH: Checkpoint/change-set integration for edits

### Gap

`editTool.ts` and `replaceLinesTool.ts` write directly to disk (`fs.writeFile`) without creating git checkpoints or change-set records. The existing checkpoint system (`src/checkpoints/gitCheckpoint.ts`) and change-set system (`src/changes/changeSetStore.ts`) are completely bypassed.

### Fix

1. Create an `editTransaction.ts` wrapper that both tools call (the file already exists but isn't used):

```ts
// src/agent/editTransaction.ts — already defined, just wire it in
import { applyEditTransaction } from "../editTransaction.js";
import { createGitCheckpoint } from "../../checkpoints/gitCheckpoint.js";
import { createChangeSet } from "../../changes/changeSetStore.js";

// In editTool.ts handler, replace fs.writeFile with:
const tx = await applyEditTransaction({
  root: ctx.root,
  path: rel,
  before,
  after,
  reason,
  config: ctx.config,
  db: ctx.db,
});
if (!tx.ok) return { ok: false, summary: tx.summary };

// Then optionally create a change set for review:
if (tx.diff) {
  createChangeSet(ctx.db, {
    taskId: /* pass taskId through ToolContext */,
    diff: tx.diff,
    summary: reason,
    status: "proposed",
  });
}
```

2. Extend `ToolContext` again with optional `taskId`:

```ts
export type ToolContext = {
  root: string;
  db: SmithDatabase;
  config: SmithConfig;
  events?: NodeJS.EventEmitter;
  memory?: WorkingMemory;
  taskId?: string;              // NEW
};
```

**Files touched**: `editTool.ts`, `replaceLinesTool.ts`, `editTransaction.ts`, `toolRegistry.ts`, `focusedAgentLoop.ts`

---

## MEDIUM: Real token estimation

### Gap

`tokenEstimate.ts` uses `text.length / 4` — a crude heuristic that significantly miscounts code tokens. This affects compaction timing, budget enforcement, and context window utilization.

### Fix

1. Add a `tiktoken`-compatible estimator behind the `TokenEstimator` interface:

```ts
// src/context/tokenEstimate.ts
export const cl100kEstimator: TokenEstimator = {
  name: "cl100k_base",
  estimate(text) {
    // Fall back to char/4 if tiktoken unavailable
    try {
      const { encoding_for_model } = require("tiktoken");
      const enc = encoding_for_model("gpt-4");
      const tokens = enc.encode(text).length;
      enc.free();
      return tokens;
    } catch {
      return Math.ceil(text.length / 4);
    }
  }
};
```

2. Select estimator based on model/provider:

```ts
export function estimatorForModel(model: string): TokenEstimator {
  if (/gpt|openai/i.test(model)) return cl100kEstimator;
  // For Ollama models, use char/4 or a local tokenizer
  return charDiv4Estimator;
}
```

3. Wire into `focusedAgentLoop.ts`:

```ts
import { estimatorForModel } from "../context/tokenEstimate.js";

const estimator = estimatorForModel(model);
// Use estimator for compaction checks
```

**Files touched**: `tokenEstimate.ts`, `focusedAgentLoop.ts`

---

## MEDIUM: Task distillation triviality guard

### Gap

`taskDistiller.ts:distillTaskPacket()` **always** calls the model to distill the prompt, even for trivial inputs like "hi" or "rename foo to bar in line 3". This wastes model calls and latency.

### Fix

Add a pre-distillation guard in `taskDistiller.ts` or `buildTaskPacket` in `taskRunner.ts`:

```ts
// In buildTaskPacket, before calling distillTaskPacket:
function shouldDistill(prompt: string): boolean {
  if (prompt.length < 20) return false;
  const lower = prompt.toLowerCase();
  const codeWords = /(fix|implement|refactor|change|update|remove|add|debug|bug|error|broken|patch|diff|function|class|file|code|type|schema|build|test|deploy)/i;
  if (!codeWords.test(lower)) return false;
  if (/^(hi|hello|hey|thanks|ok|help|what is|who are)/i.test(lower)) return false;
  return true;
}

// Then:
if (shouldDistill(task)) {
  return distillTaskPacket({ ... });
}
return heuristic;
```

**Files touched**: `taskRunner.ts`

---

## MEDIUM: Streaming in chat/tool calls

### Gap

All provider `chat()` methods use `stream: false`. The agent loop blocks on full responses with no progress feedback. The TUI shows phase changes but not token-by-token streaming.

### Fix

1. Add `onToken` to `ChatOptions`:

```ts
// providers.ts
export type ChatOptions = {
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  onToken?: (token: string) => void;      // NEW
};
```

2. For Ollama chat, pass `stream: true` when `onToken` is present:

```ts
// ollama.ts chatWithQwenFunctions
if (options?.onToken) {
  // Use streaming mode
  body.stream = true;
  // Parse SSE chunks, call onToken per token
}
```

3. Pass `onToken` from focusedAgentLoop:

```ts
const result = await provider.chat(model, messages, functions, {
  temperature: 0,
  maxTokens: config.ollama.numPredict,
  onToken: (token) => events?.emit("task:stream", { text: token }),
});
```

**Files touched**: `providers.ts`, `ollama.ts`, `focusedAgentLoop.ts`

---

## MEDIUM: Loop timeout

### Gap

The focused agent loop (`focusedAgentLoop.ts:121`) is bounded to 12 steps but has **no wall-clock timeout**. If a provider hangs or a tool stalls, the loop runs forever.

### Fix

1. Add a timeout parameter to `runFocusedAgentLoop`:

```ts
const MAX_LOOP_MS = 300_000; // 5 minutes

export async function runFocusedAgentLoop(input: {
  ...
  timeoutMs?: number;
}): Promise<FocusedAgentResult> {
  const deadline = Date.now() + (input.timeoutMs ?? MAX_LOOP_MS);

  for (let step = 0; step < MAX_STEPS; step++) {
    if (Date.now() > deadline) {
      return {
        ok: false,
        finalText: `Task timed out after ${step} steps.`,
        changedFiles, checksRun, memory, rawMessages: messages,
      };
    }
    // ...
  }
}
```

2. Pass AbortSignal to provider.chat:

```ts
const signal = AbortSignal.timeout(Math.max(0, deadline - Date.now()));
const result = await provider.chat(model, messages, functions, {
  temperature: 0,
  maxTokens: config.ollama.numPredict,
  signal,
});
```

**Files touched**: `focusedAgentLoop.ts`

---

## LOW: Fix editTool diff alignment bug

### Gap

`editTool.ts:108-124` `buildCompactDiff()` aligns before/after lines by index, which produces misleading diffs when insertions or deletions shift line alignment.

### Fix

Replace the homegrown diff with a call to the existing `buildUnifiedDiffFromEdit` from `editDiff.ts`:

```ts
// In editTool.ts handler, instead of buildCompactDiff():
import { buildUnifiedDiffFromEdit } from "../editDiff.js";

const diff = buildUnifiedDiffFromEdit({
  path: rel,
  before,
  after,
});
```

Or remove `buildCompactDiff` entirely and use `editDiff.ts` which already handles proper hunk-based diff generation.

**Files touched**: `editTool.ts`

---

## LOW: Remove COMPACT_AFTER_TOOL_CALLS = 3

### Gap

`COMPACT_AFTER_TOOL_CALLS = 3` at `focusedAgentLoop.ts:19` is too aggressive. After just 3 tool calls, the entire conversation history is wiped. This means the model can use at most 3 tools before losing context — breaking multi-step reasoning.

### Fix

Raise to 6 and make it configurable:

```ts
// focusedAgentLoop.ts
const COMPACT_AFTER_TOOL_CALLS = config.context.compactAfterToolCalls ?? 6;

// config.json default:
{
  "context": {
    "compactAfterToolCalls": 6   // was 3
  }
}
```

**Files touched**: `focusedAgentLoop.ts`, `config/config.ts`

---

## Implementation Priority

| Priority | Task | Effort |
|----------|------|--------|
| **P0** | Read-before-edit enforcement | Small (~50 lines) |
| **P0** | Wire `compactToolResult` + `compactMessages` into loop | Medium (~80 lines) |
| **P0** | File card indexing integration | Medium (~100 lines) |
| **P1** | Checkpoint/change-set integration for edits | Medium (~120 lines) |
| **P1** | Task distillation triviality guard | Small (~20 lines) |
| **P1** | Fix compaction aggressiveness (3 → 6) | Small (~5 lines) |
| **P1** | Fix `compactAtTokenRatio` undefined bug | Small (~5 lines) |
| **P2** | Real token estimator (tiktoken fallback) | Medium (~60 lines) |
| **P2** | Streaming in chat tool calls | Large (~150 lines) |
| **P2** | Loop timeout + AbortSignal | Small (~30 lines) |
| **P3** | Fix editTool diff alignment bug | Small (~10 lines) |
| **P3** | Remove dead `provider`/`model` params from `compactToolResult` | Small (~5 lines) |

## Design Principle

Every fix should answer one question:
- P0: Does this prevent data loss, unsafe writes, or broken context?
- P1: Does this improve correctness or prevent wasted resources?
- P2: Does this make the pipeline faster or more debuggable?
- P3: Is this code cleanliness or correctness of a non-critical path?
