import type { PromptIntent, PromptPlan, PromptToolRequest, SmithConfig } from "../types/index.js";




const CHAT_PATTERNS = [
  /^(hi|hello|hey|yo|sup|howdy)\b/i,
  /\bhow are you\b/i,
  /\bwhat'?s up\b/i,
  /\bthank(s| you)\b/i,
  /\bwho are you\b/i,
  /\btell me a joke\b/i,
  /^(good (morning|afternoon|evening|night))\b/i,
  /^(lol|haha|ok|okay|cool|nice|great|awesome|alright|sure)\b/i
];

const TASK_PATTERNS = [
  /\b(fix|implement|add|remove|update|change|refactor|rename|debug|optimi[sz]e)\b/i,
  /\b(patch|diff|apply|compile|build|test|failing|error|bug|issue|broken)\b/i,
  /\b(where|how|why)\b.*\b(code|function|class|file|symbol|module)\b/i,
  /\b(write|generate|create)\b.*\b(code|function|class|test|component)\b/i,
  /\b(explain|show|find|list|search)\b.*\b(code|function|class|file|symbol)\b/i,
  /\bwhat (does|is|are)\b.*\b(function|class|module|file|variable)\b/i
];

const META_PATTERNS = [
  /^\/[a-z]/i,
  /\b(help|usage|command|shortcut|mode|config|setting|capabilit(y|ies))\b/i,
  /\bwhat can you do\b/i,
  /\bhow do i use\b/i,
  /\binstall\b/i
];

function heuristicIntent(prompt: string): PromptIntent {
  const text = prompt.trim();
  if (!text) return { kind: "chat", confidence: 0.9, reason: "empty prompt" };

  // Slash commands are always meta — skip Ollama entirely
  if (/^\/[a-z]/i.test(text)) {
    return { kind: "meta", confidence: 0.97, reason: "slash command" };
  }
  if (CHAT_PATTERNS.some((p) => p.test(text))) {
    return { kind: "chat", confidence: 0.92, reason: "small-talk cue" };
  }
  if (META_PATTERNS.some((p) => p.test(text))) {
    return { kind: "meta", confidence: 0.85, reason: "agent-usage cue" };
  }
  if (TASK_PATTERNS.some((p) => p.test(text))) {
    return { kind: "task", confidence: 0.82, reason: "code-task cue" };
  }

  // Default to task so normal coding questions still get retrieval/context.
  return { kind: "task", confidence: 0.6, reason: "default coding intent" };
}

function cleanList(values: unknown, max: number): string[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map((v) => String(v).trim()).filter(Boolean))].slice(0, max);
}

export async function evaluatePrompt(args: {
  config: SmithConfig;
  prompt: string;
  ollamaReady: boolean;
  model: string;
}): Promise<PromptPlan> {
  const fallbackIntent = heuristicIntent(args.prompt);
  const fallback: PromptPlan = {
    intent: fallbackIntent,
    objective: args.prompt.trim() || "Respond to user",
    tasks:
      fallbackIntent.kind === "task"
        ? ["Identify relevant files/symbols", "Implement or explain requested change", "Validate result"]
        : ["Respond concisely to the user"],
    keywords: cleanList(
      args.prompt
        .split(/[^A-Za-z0-9_$.]+/)
        .filter((w) => w.length >= 3),
      10
    ),
    likelyFiles: [],
    likelySymbols: [],
    toolRequests: []
  };

  return fallback;
}

export async function classifyPromptIntent(args: {
  config: SmithConfig;
  prompt: string;
  ollamaReady: boolean;
  model: string;
}): Promise<PromptIntent> {
  const plan = await evaluatePrompt(args);
  return plan.intent;
}
