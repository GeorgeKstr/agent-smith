import type { PromptIntent, SmithConfig } from "../types/index.js";
import { extractJson, generateWithOllama, optionsFromConfig } from "./ollama.js";

const INTENT_SYSTEM = `You classify a user prompt for a coding agent.
Reply ONLY JSON in this shape:
{"kind":"task|chat|meta","confidence":0..1,"reason":"short"}
Rules:
- task: user wants analysis, retrieval, implementation, fix, patch, test, refactor, code generation.
- chat: greeting, small talk, opinion, general non-action conversation.
- meta: asks about the agent itself, usage, commands, setup, capabilities.
No prose outside JSON.`;

const CHAT_PATTERNS = [
  /^(hi|hello|hey|yo)\b/i,
  /\bhow are you\b/i,
  /\bwhat'?s up\b/i,
  /\bthank(s| you)\b/i,
  /\bwho are you\b/i,
  /\btell me a joke\b/i
];

const TASK_PATTERNS = [
  /\b(fix|implement|add|remove|update|change|refactor|rename|debug|optimi[sz]e)\b/i,
  /\b(patch|diff|apply|compile|build|test|failing|error|bug)\b/i,
  /\b(where|how|why)\b.*\b(code|function|class|file|symbol|module)\b/i,
  /\b(write|generate)\b.*\b(code|function|class|test)\b/i
];

const META_PATTERNS = [
  /\b(help|usage|command|shortcut|mode|config|setting|capabilit(y|ies))\b/i,
  /\bwhat can you do\b/i,
  /\bhow do i use\b/i,
  /\binstall\b/i
];

function heuristicIntent(prompt: string): PromptIntent {
  const text = prompt.trim();
  if (!text) return { kind: "chat", confidence: 0.9, reason: "empty prompt" };

  if (CHAT_PATTERNS.some((p) => p.test(text))) {
    return { kind: "chat", confidence: 0.88, reason: "small-talk cue" };
  }
  if (META_PATTERNS.some((p) => p.test(text))) {
    return { kind: "meta", confidence: 0.78, reason: "agent-usage cue" };
  }
  if (TASK_PATTERNS.some((p) => p.test(text))) {
    return { kind: "task", confidence: 0.82, reason: "code-task cue" };
  }

  // Default to task so normal coding questions still get retrieval/context.
  return { kind: "task", confidence: 0.6, reason: "default coding intent" };
}

export async function classifyPromptIntent(args: {
  config: SmithConfig;
  prompt: string;
  ollamaReady: boolean;
  model: string;
}): Promise<PromptIntent> {
  const fallback = heuristicIntent(args.prompt);
  if (!args.ollamaReady) return fallback;

  const result = await generateWithOllama({
    baseUrl: args.config.ollama.baseUrl,
    model: args.model,
    system: INTENT_SYSTEM,
    prompt: `PROMPT: ${args.prompt}\n\nReturn JSON intent classification:`,
    options: optionsFromConfig(args.config, { num_predict: 120 })
  });
  if (!result.ok) return fallback;

  const parsed = extractJson<Partial<PromptIntent>>(result.text);
  if (!parsed?.kind || !["task", "chat", "meta"].includes(parsed.kind)) return fallback;

  return {
    kind: parsed.kind,
    confidence:
      typeof parsed.confidence === "number" && Number.isFinite(parsed.confidence)
        ? Math.max(0, Math.min(1, parsed.confidence))
        : fallback.confidence,
    reason: typeof parsed.reason === "string" && parsed.reason.trim() ? parsed.reason.trim() : fallback.reason
  };
}
