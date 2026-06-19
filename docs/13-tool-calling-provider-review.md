# Tool Calling Across Providers — Review

## The Problem

Different LLM providers use different conventions for tool/function calling. The agent internally used Qwen's `role: "function"` convention, but OpenAI-compatible APIs (DeepSeek, opencode-zen, etc.) reject that format.

### Provider Role Conventions

| Provider | Tool result role | Requires `tool_call_id` | Tool call format |
|----------|-----------------|------------------------|-------------------|
| **Ollama** (Qwen) | `"tool"` or `"function"` | No | `function_call` or `tool_calls` |
| **OpenAI** | `"tool"` | **Yes** | `tool_calls` with `id` |
| **Anthropic** | `"user"` (converted) | No (uses `tool_use_id` internally) | `tool_use` blocks |

### What Was Happening

1. The agent emitted tool results with `role: "function"` (Qwen convention)
2. When sent to OpenAI-compatible APIs, they rejected `"function"` as an unknown role variant
3. When switched to `role: "tool"`, they rejected it for missing `tool_call_id`
4. Error/permission messages were also sent as `role: "tool"` without IDs, causing further rejections
5. Anthropic silently dropped all `role: "function"` messages

## Current State After Fixes

### Internal Convention

The agent now uses `role: "tool"` with `tool_call_id` natively — the OpenAI standard.

### Message Emission Points

| File | Line(s) | What | Role | Has `tool_call_id` |
|------|---------|------|------|---------------------|
| `focusedAgentLoop.ts` | ~168,177 | Unknown tool / mode denied | `"user"` | N/A |
| `focusedAgentLoop.ts` | ~213 | Actual tool result | `"tool"` | Yes (`call.callId \|\| "call_<name>"`) |
| `qwenTools.ts` | ~80-84 | Unknown function error | `"user"` | N/A |
| `qwenTools.ts` | ~93 | Actual tool result | `"tool"` | Yes (`"call_<name>"`) |
| `qwenTools.ts` | ~95-99 | Tool execution error | `"user"` | N/A |

### Provider Conversions

| Provider | Conversion | File:Line |
|----------|-----------|-----------|
| **Ollama** | `role: "function"` → `"tool"` (legacy safety net), passes `tool_call_id` through | `ollama.ts:186-194` |
| **OpenAI** | `role: "function"` → `"tool"` (legacy safety net), preserves all fields via spread | `providers.ts:191-193` |
| **Anthropic** | `role: "function"` or `"tool"` → `"user"` with `[Tool result from ...]` prefix | `providers.ts:360-367` |

### `tool_call_id` Flow

```
Model response (OpenAI):
  { role: "assistant", tool_calls: [{ id: "call_abc123", function: { name: "search", arguments: "..." } }] }
                                         ↓
functionCalls() captures:
  { name: "search", arguments: "...", callId: "call_abc123" }
                                         ↓
Tool executes, result pushed:
  { role: "tool", name: "search", tool_call_id: "call_abc123", content: "..." }

Model response (Qwen/Ollama):
  { role: "assistant", function_call: { name: "search", arguments: "..." } }
                                         ↓
functionCalls() captures:
  { name: "search", arguments: "...", callId: undefined }
                                         ↓
Tool executes, result pushed:
  { role: "tool", name: "search", tool_call_id: "call_search", content: "..." }
                                      ↑ synthetic fallback
```

## Known Gaps

1. **Synthetic `tool_call_id` for Qwen models** — When the model uses `function_call` (no `id` field), we generate `"call_<name>"` as a fallback. This works for Ollama (which doesn't require IDs) but would be rejected by strict OpenAI APIs that expect matching IDs between the tool_call and tool result.

2. **Anthropic tool result fidelity** — Tool results are flattened to `role: "user"` text. Anthropic's native format expects `tool_use_id` matching and structured `tool_result` content blocks. The current conversion loses the structured association.

3. **The focusedAgentLoop uses `role: "tool"` natively**, but the Anthropic provider converts these to `"user"`. This means Anthropic models see tool results as user messages, which works for basic tool use but may confuse models that expect the native `tool_result` format.

4. **No end-to-end test with OpenAI/DeepSeek tool calling** — The fixes are based on API documentation and error messages, not verified against actual multi-turn tool-calling sessions with these providers.

## What Would Fix It Properly

A single normalization layer at the provider boundary:

```
Internal format (always "tool" + tool_call_id)
        ↓
  normalizeForProvider()
        ↓
Ollama:     pass through (or function→tool)
OpenAI:     pass through
Anthropic:  convert to tool_result blocks with tool_use_id mapping
```

This would require:
1. Tracking `tool_use_id` from Anthropic's `tool_use` blocks → mapping to internal `tool_call_id`
2. Converting internal tool results back to Anthropic's `tool_result` content blocks
3. Handling the `function_call` vs `tool_calls` response formats uniformly

## Files Involved

| File | Role |
|------|------|
| `src/agent/focusedAgentLoop.ts` | Emits tool results as `role: "tool"` + `tool_call_id` |
| `src/agent/tools/qwenTools.ts` | Legacy Qwen loop, same convention |
| `src/providers/ollama.ts` | `toOllamaMessages()` converts `function`→`tool` |
| `src/providers/providers.ts` | OpenAI/Anthropic providers handle role conversion |
| `src/providers/ollama.ts:35-52` | `QwenChatMessage` type definition |
| `src/agent/messageCompactor.ts` | Recognizes both `"tool"` and `"function"` for pruning |
