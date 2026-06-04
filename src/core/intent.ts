import type { PromptIntent, PromptPlan, PromptToolRequest, SmithConfig } from "../types/index.js";
import { extractJson, generateWithOllama, optionsFromConfig } from "./ollama.js";

const INTENT_SYSTEM = `You classify a user prompt for a coding agent.
Reply ONLY JSON in this shape:
{"kind":"task|chat|meta","confidence":0..1,"reason":"short"}
Rules:
- task: user wants analysis, retrieval, implementation, fix, patch, test, refactor, code generation.
- chat: greeting, small talk, opinion, general non-action conversation.
- meta: asks about the agent itself, usage, commands, setup, capabilities.
No prose outside JSON.`;

const PLAN_SYSTEM = `You triage a coding-agent prompt and produce an actionable plan.
Reply ONLY JSON with this exact shape:
{
  "intent":{"kind":"task|chat|meta","confidence":0..1,"reason":"short"},
  "objective":"one-sentence objective",
  "tasks":["atomic step", "atomic step"],
  "keywords":["search terms"],
  "likelyFiles":["path hints"],
  "likelySymbols":["symbol hints"],
  "toolRequests":[{"tool":"find_files|find_symbols","query":"query text"}]
}
Rules:
- For non-task prompts, keep tasks minimal and toolRequests empty.
- For task prompts, create 2-5 concrete steps and focused keywords.
- Only request tools that help narrow file/symbol discovery.
- No prose outside JSON.`;

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

function clampConfidence(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : fallback;
}

function cleanList(values: unknown, max: number): string[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map((v) => String(v).trim()).filter(Boolean))].slice(0, max);
}

function cleanToolRequests(values: unknown): PromptToolRequest[] {
  if (!Array.isArray(values)) return [];
  const out: PromptToolRequest[] = [];
  for (const item of values) {
    if (!item || typeof item !== "object") continue;
    const tool = String((item as { tool?: unknown }).tool ?? "").trim();
    const query = String((item as { query?: unknown }).query ?? "").trim();
    if (!query) continue;
    if (tool === "find_files" || tool === "find_symbols") out.push({ tool, query });
    if (out.length >= 4) break;
  }
  return out;
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

  if (!args.ollamaReady) return fallback;

  const result = await generateWithOllama({
    baseUrl: args.config.ollama.baseUrl,
    model: args.model,
    system: PLAN_SYSTEM,
    prompt: `PROMPT: ${args.prompt}\n\nReturn JSON plan:`,
    options: optionsFromConfig(args.config, { num_predict: 320 })
  });
  if (!result.ok) return fallback;

  const parsed = extractJson<Partial<PromptPlan> & { intent?: Partial<PromptIntent> }>(result.text);
  if (!parsed?.intent?.kind || !["task", "chat", "meta"].includes(parsed.intent.kind)) return fallback;

  const intent: PromptIntent = {
    kind: parsed.intent.kind,
    confidence: clampConfidence(parsed.intent.confidence, fallback.intent.confidence),
    reason:
      typeof parsed.intent.reason === "string" && parsed.intent.reason.trim()
        ? parsed.intent.reason.trim()
        : fallback.intent.reason
  };

  return {
    intent,
    objective:
      typeof parsed.objective === "string" && parsed.objective.trim() ? parsed.objective.trim() : fallback.objective,
    tasks: cleanList(parsed.tasks, 6).length ? cleanList(parsed.tasks, 6) : fallback.tasks,
    keywords: cleanList(parsed.keywords, 12).length ? cleanList(parsed.keywords, 12) : fallback.keywords,
    likelyFiles: cleanList(parsed.likelyFiles, 8),
    likelySymbols: cleanList(parsed.likelySymbols, 8),
    toolRequests: cleanToolRequests(parsed.toolRequests)
  };
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
