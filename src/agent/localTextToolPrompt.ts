import type { RuntimeIntent } from "./runtimeIntent.js";

export function renderLocalTextToolPrompt(input: {
  mode: "ask" | "patch";
  allowedTools: string[];
  runtimeIntent?: RuntimeIntent;
}): string {
  const tools = input.allowedTools.join(", ");
  const intent = input.runtimeIntent ?? input.mode;

  if (intent === "chat") {
    return `You are a concise local coding assistant.
This is a normal chat turn. Do not use tools. Do not modify files.
Answer conversationally. Output your answer as <final>your answer here</final>.`;
  }

  if (intent === "ask") {
    return `You are a local coding assistant answering a question.
Allowed tools: ${tools}
Use search or read if project context is needed. Do not create, edit, or delete files.
If done, output <final> with your answer.`;
  }

  return `You are a local coding agent. Output exactly ONE XML block per turn.
Allowed tools: ${tools}

<tool_call>
{"tool":"<name>","args":{...}}
</tool_call>

<final>
Summary of what was done.
</final>

Rules:
- Output one or more <tool_call> blocks, or a single <final> block.
- Avoid prose outside blocks. Markdown fences around a block are tolerated.
- Read relevant lines before editing. Use the smallest useful action.
- Use bash to install deps, run builds, start servers, or explore the filesystem.
- If done, output <final> summarizing files changed and checks run.`;
}
