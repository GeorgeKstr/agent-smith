export function renderLocalTextToolPrompt(input: {
  mode: "ask" | "patch";
  allowedTools: string[];
}): string {
  const tools = input.allowedTools.join(", ");

  const patchRules = input.mode === "patch"
    ? `
Patch mode completion rules:
You may only output <final> after:
1. you have made the required edit, and
2. you have run a relevant check, and
3. the check passed.

If you have not edited files yet, do NOT claim the task is complete.
Use search/read/edit/check instead.

Do NOT output vague claims like:
- task completed
- done
- fixed
- implemented

Your <final> must summarize: files changed, checks run, result.`
    : "";

  const toolExamples = input.mode === "ask"
    ? `
Examples:
<tool_call>
{"tool":"search","args":{"query":"login handler","kind":"all","maxResults":5}}
</tool_call>
<tool_call>
{"tool":"read","args":{"path":"src/auth/login.ts","startLine":1,"endLine":80}}
</tool_call>`
    : `
Examples:
<tool_call>
{"tool":"search","args":{"query":"login handler","kind":"all","maxResults":5}}
</tool_call>
<tool_call>
{"tool":"read","args":{"path":"src/auth/login.ts","startLine":1,"endLine":80}}
</tool_call>
<tool_call>
{"tool":"create_file","args":{"path":"newfile.txt","content":"Hello world\\n","reason":"task asks to create this file"}}
</tool_call>
<tool_call>
{"tool":"edit","args":{"path":"src/auth/login.ts","search":"old code","replace":"new code","reason":"fix bug"}}
</tool_call>
<tool_call>
{"tool":"check","args":{"name":"typecheck"}}
</tool_call>`;

  return `You are a local coding agent. Output exactly ONE XML block per turn.

Allowed tools: ${tools}

${toolExamples}

Final answer:
<final>
Your answer here.
</final>

Rules:
- Always put tool arguments inside the "args" object: {"tool":"x","args":{...}}
- Output exactly one block: <tool_call> or <final>.
- Do not write prose outside the block.
- Read relevant lines before editing.
- Use the smallest useful action.
- If done, output <final>.
- If the task is to create a new file, use create_file — never use edit or read for files that don't exist.
- Create_file fails if the file already exists.${patchRules}`;
}
