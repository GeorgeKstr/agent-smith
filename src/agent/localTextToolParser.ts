export type ParsedLocalTextAction =
  | { kind: "tool_call"; tool: string; args: Record<string, unknown>; raw: string }
  | { kind: "final"; content: string; raw: string }
  | { kind: "plain_text"; content: string; raw: string }
  | { kind: "invalid"; error: string; raw: string };

export function parseLocalTextAction(text: string): ParsedLocalTextAction {
  const trimmed = text.trim();
  if (!trimmed) return { kind: "plain_text", content: "", raw: text };

  // Count blocks
  const toolCalls = [...trimmed.matchAll(/<tool_call>\s*\n?([\s\S]*?)\n?\s*<\/tool_call>/g)];
  const finals = [...trimmed.matchAll(/<final>\s*\n?([\s\S]*?)\n?\s*<\/final>/g)];

  if (toolCalls.length === 0 && finals.length === 0) {
    return { kind: "plain_text", content: trimmed, raw: text };
  }

  if (toolCalls.length + finals.length > 1) {
    return { kind: "invalid", error: "Multiple blocks found. Output exactly one <tool_call> or <final>.", raw: text };
  }

  if (toolCalls.length === 1) {
    const inner = toolCalls[0][1].trim();
    try {
      const parsed = JSON.parse(inner) as Record<string, unknown>;
      const tool = typeof parsed.tool === "string" ? parsed.tool.trim() : "";
      if (!tool) return { kind: "invalid", error: "Tool call missing 'tool' field.", raw: text };
      // Accept nested args OR top-level fields as args (forgiving)
      const nestedArgs = parsed.args && typeof parsed.args === "object" && !Array.isArray(parsed.args)
        ? parsed.args as Record<string, unknown>
        : null;
      const topLevelArgs: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(parsed)) {
        if (key !== "tool" && key !== "args" && value !== undefined) {
          topLevelArgs[key] = value;
        }
      }
      const args = nestedArgs && Object.keys(nestedArgs).length > 0
        ? nestedArgs
        : topLevelArgs;
      return { kind: "tool_call", tool, args, raw: text };
    } catch (e) {
      return { kind: "invalid", error: `Invalid JSON in tool_call: ${e instanceof Error ? e.message : String(e)}`, raw: text };
    }
  }

  if (finals.length === 1) {
    const content = finals[0][1].trim();
    return { kind: "final", content, raw: text };
  }

  return { kind: "plain_text", content: trimmed, raw: text };
}
