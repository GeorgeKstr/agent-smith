import type { SmithConfig } from "../types/index.js";
import { generateWithProvider } from "../providers/providers.js";

export function fallbackTaskPlan(taskTitle: string): Array<{ title: string; notes?: string }> {
  return [
    { title: "Understand the relevant files and symbols" },
    { title: "Build focused context", notes: "Identify which files and symbols are needed" },
    { title: "Implement the smallest safe change", notes: "Make minimal, focused edits" },
    { title: "Run configured checks", notes: "Typecheck, tests, lint as configured" },
    { title: "Review proposed changes", notes: "Verify the patch is correct and complete" }
  ];
}

export async function generateTaskPlan(args: {
  config: SmithConfig;
  taskTitle: string;
  taskDescription?: string | null;
  model?: string;
}): Promise<{ ok: boolean; steps: Array<{ title: string; notes?: string }>; error?: string }> {
  const { config, taskTitle, taskDescription } = args;
  const model = args.model ?? config.models.summarizer;

  const prompt = [
    `Task: ${taskTitle}`,
    taskDescription ? `Description: ${taskDescription}` : "",
    "",
    `Break this task into 3-8 short, actionable steps. Each step should be a concrete action.`,
    `No code generation. No file editing. No shell commands.`,
    `Respond with JSON only: {"steps":[{"title":"...", "notes":"..."}]}`,
    `Notes are optional. Titles must be short and specific.`,
  ].filter(Boolean).join("\n");

  const result = await generateWithProvider(config, model, prompt, {
    maxTokens: 800,
    temperature: 0.1
  });

  if (!result.ok) {
    return { ok: false, steps: [], error: result.error ?? "Provider call failed" };
  }

  const text = result.text.trim();
  if (!text) {
    return { ok: false, steps: [], error: "Empty response from provider." };
  }

  let parsed: unknown;
  try {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      parsed = JSON.parse(text.slice(start, end + 1));
    } else {
      return { ok: false, steps: [], error: "No JSON object found in response." };
    }
  } catch {
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ok: false, steps: [], error: "Failed to parse plan JSON from provider response." };
    }
  }

  if (!parsed || typeof parsed !== "object") {
    return { ok: false, steps: [], error: "Invalid plan structure from provider." };
  }

  const stepsArr = (parsed as Record<string, unknown>).steps;
  if (!Array.isArray(stepsArr) || stepsArr.length === 0) {
    return { ok: false, steps: [], error: "Provider returned no steps." };
  }

  const steps: Array<{ title: string; notes?: string }> = [];
  for (const s of stepsArr.slice(0, 8)) {
    if (typeof s !== "object" || !s) continue;
    const title = typeof (s as Record<string, unknown>).title === "string"
      ? ((s as Record<string, unknown>).title as string).trim()
      : "";
    if (!title) continue;
    const notes = typeof (s as Record<string, unknown>).notes === "string"
      ? ((s as Record<string, unknown>).notes as string).trim() || undefined
      : undefined;
    steps.push({ title, notes });
  }

  if (steps.length === 0) {
    return { ok: false, steps: [], error: "No valid steps in provider response." };
  }

  return { ok: true, steps };
}
