export type ParsedLocalTextAction =
  | { kind: "tool_call"; tool: string; args: Record<string, unknown>; raw: string; repaired?: boolean; warnings?: string[] }
  | { kind: "final"; content: string; raw: string; repaired?: boolean; warnings?: string[] }
  | { kind: "plain_text"; content: string; raw: string }
  | { kind: "invalid"; error: string; raw: string };

export type ToolTagNormalizationResult = {
  text: string;
  changed: boolean;
  warnings: string[];
};

const OPEN_TAG = "<tool_call>";
const CLOSE_TAG = "</tool_call>";
const FINAL_OPEN = "<final>";
const FINAL_CLOSE = "</final>";

export function normalizeLocalToolTags(text: string): ToolTagNormalizationResult {
  let normalized = text;
  const warnings: string[] = [];

  const replacements: Array<[RegExp, string, string]> = [
    [/<tool_calls>/gi, OPEN_TAG, "Normalized <tool_calls> to " + OPEN_TAG + "."],
    [/<\/tool_calls>/gi, CLOSE_TAG, "Normalized </tool_calls> to " + CLOSE_TAG + "."],
    [/<final_answer>/gi, FINAL_OPEN, "Normalized <final_answer> to <final>."],
    [/<\/final_answer>/gi, FINAL_CLOSE, "Normalized </final_answer> to </final>."],
    [/<toolcall>/gi, OPEN_TAG, "Normalized <toolcall> to " + OPEN_TAG + "."],
    [/<\/toolcall>/gi, CLOSE_TAG, "Normalized </toolcall> to " + CLOSE_TAG + "."],
    [/<finalanswer>/gi, FINAL_OPEN, "Normalized <finalanswer> to <final>."],
    [/<\/finalanswer>/gi, FINAL_CLOSE, "Normalized </finalanswer> to </final>."],
  ];

  for (const [pattern, replacement, warning] of replacements) {
    if (pattern.test(normalized)) {
      normalized = normalized.replace(pattern, replacement);
      warnings.push(warning);
    }
  }

  return {
    text: normalized,
    changed: normalized !== text,
    warnings,
  };
}

function stripCodeFences(text: string): { text: string; changed: boolean } {
  const fence = /```[a-zA-Z0-9_+-]*\n?([\s\S]*?)\n?```/g;
  let changed = false;
  let out = text.replace(fence, (_m, body: string) => {
    const trimmed = body.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      changed = true;
      return OPEN_TAG + "\n" + trimmed + "\n" + CLOSE_TAG;
    }
    if (/<final>[\s\S]*<\/final>/i.test(trimmed)) {
      changed = true;
      return trimmed;
    }
    return _m;
  });
  return { text: out, changed };
}

function extractBalancedJson(text: string, start: number): { json: string; end: number } | null {
  let i = start;
  if (text[i] !== "{") return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (ch === "\\") { esc = true; continue; }
      if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return { json: text.slice(start, i + 1), end: i + 1 };
    }
  }
  return null;
}

function coerceToolObject(obj: Record<string, unknown>): { tool: string; args: Record<string, unknown> } | null {
  let tool = "";
  if (typeof obj.tool === "string") tool = obj.tool.trim();
  else if (typeof obj.name === "string") tool = obj.name.trim();
  else if (typeof obj.function === "string") tool = obj.function.trim();

  let args: Record<string, unknown> | null = null;
  if (obj.args && typeof obj.args === "object" && !Array.isArray(obj.args)) {
    args = obj.args as Record<string, unknown>;
  } else if (obj.arguments && typeof obj.arguments === "object" && !Array.isArray(obj.arguments)) {
    args = obj.arguments as Record<string, unknown>;
  } else if (obj.parameters && typeof obj.parameters === "object" && !Array.isArray(obj.parameters)) {
    args = obj.parameters as Record<string, unknown>;
  } else if (typeof obj.arguments === "string") {
    try { args = JSON.parse(obj.arguments) as Record<string, unknown>; } catch { args = null; }
  } else if (typeof obj.input === "object" && obj.input !== null && !Array.isArray(obj.input)) {
    args = obj.input as Record<string, unknown>;
  }

  if (!args) {
    const top: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (k === "tool" || k === "name" || k === "function" || k === "args" || k === "arguments" || k === "input" || k === "type") continue;
      top[k] = v;
    }
    args = top;
  }

  if (!tool) return null;
  return { tool, args };
}

function parseToolInner(inner: string, raw: string, repaired: boolean, warnings: string[] | undefined): ParsedLocalTextAction {
  const trimmed = inner.trim();
  const firstBrace = trimmed.indexOf("{");
  const jsonText = firstBrace >= 0
    ? (extractBalancedJson(trimmed, firstBrace)?.json ?? trimmed)
    : trimmed;
  try {
    const parsed = JSON.parse(jsonText) as Record<string, unknown>;
    const coerced = coerceToolObject(parsed);
    if (!coerced) return { kind: "invalid", error: "Tool call missing 'tool' field.", raw };
    return { kind: "tool_call", tool: coerced.tool, args: coerced.args, raw, repaired: repaired || undefined, warnings };
  } catch (e) {
    return { kind: "invalid", error: `Invalid JSON in tool_call: ${e instanceof Error ? e.message : String(e)}`, raw };
  }
}

export function parseLocalTextActions(text: string): ParsedLocalTextAction[] {
  if (!text || !text.trim()) return [];
  const norm = normalizeLocalToolTags(text);
  const fence = stripCodeFences(norm.text);
  const repaired = norm.changed || fence.changed;
  const warnings = norm.warnings.length > 0 ? norm.warnings : undefined;
  const source = fence.text;

  const actions: ParsedLocalTextAction[] = [];

  const tagRe = new RegExp(OPEN_TAG.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*([\\s\\S]*?)\\s*" + CLOSE_TAG.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "|<final>\\s*([\\s\\S]*?)\\s*</final>", "gi");
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(source)) !== null) {
    if (m[1] !== undefined) {
      actions.push(parseToolInner(m[1], text, repaired, warnings));
    } else if (m[2] !== undefined) {
      actions.push({ kind: "final", content: m[2].trim(), raw: text, repaired: repaired || undefined, warnings });
    }
    if (m.index === tagRe.lastIndex) tagRe.lastIndex++;
  }

  if (actions.length > 0) return actions;

  // Unclosed <tool_call> (truncated output): take from open tag to end / next tag.
  const openIdx = source.indexOf(OPEN_TAG);
  if (openIdx >= 0) {
    const after = source.slice(openIdx + OPEN_TAG.length);
    const stopIdx = after.search(/<\/tool_call>|<final>|<\/final>/i);
    const body = stopIdx >= 0 ? after.slice(0, stopIdx) : after;
    return [parseToolInner(body, text, true, warnings)];
  }

  // Bare JSON object (model omitted tags entirely).
  const braceIdx = source.search(/\S/);
  const firstBrace = source.indexOf("{", braceIdx >= 0 ? braceIdx : 0);
  if (firstBrace >= 0) {
    const balanced = extractBalancedJson(source, firstBrace);
    if (balanced) {
      const before = source.slice(0, firstBrace).trim();
      if (before.length <= 40) {
        try {
          const parsed = JSON.parse(balanced.json) as Record<string, unknown>;
          const coerced = coerceToolObject(parsed);
          if (coerced) return [{ kind: "tool_call", tool: coerced.tool, args: coerced.args, raw: text, repaired: true, warnings }];
        } catch { /* not a tool object */ }
      }
    }
  }

  const trimmed = source.trim();
  if (!trimmed) return [];
  return [{ kind: "plain_text", content: trimmed, raw: text }];
}

export function parseLocalTextAction(text: string): ParsedLocalTextAction {
  const actions = parseLocalTextActions(text);
  if (actions.length === 0) return { kind: "plain_text", content: "", raw: text };
  return actions[0];
}
