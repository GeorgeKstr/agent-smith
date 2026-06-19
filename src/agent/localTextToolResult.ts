const MAX_CONTENT_CHARS = 1200;

export function renderLocalTextToolResult(input: {
  tool: string;
  ok: boolean;
  summary: string;
  content?: string;
  nextActions?: string[];
  truncated?: boolean;
}): string {
  const okStr = input.ok ? "true" : "false";
  let out = `<tool_result tool="${input.tool}" ok="${okStr}">\n`;

  out += `Summary:\n${input.summary}\n`;

  if (input.content) {
    const limited = input.content.length > MAX_CONTENT_CHARS
      ? input.content.slice(0, MAX_CONTENT_CHARS) + "\n... [truncated]"
      : input.content;
    out += `\nContent:\n${limited}\n`;
  }

  if (input.nextActions && input.nextActions.length > 0) {
    out += `\nNext actions:\n`;
    for (const a of input.nextActions.slice(0, 4)) {
      out += `- ${a}\n`;
    }
  }

  out += `</tool_result>`;
  return out;
}
