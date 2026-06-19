import type { TaskPacket } from "./taskPacket.js";
import type { RetrievalLead } from "./retrievalLead.js";
import type { WorkingMemory } from "../agent/workingMemory.js";
import { renderWorkingMemory } from "../agent/workingMemory.js";
import { renderRetrievalLeads } from "./renderLeads.js";
import type { ContextBudget } from "./contextBudget.js";
import type { ContextPacket } from "../types/index.js";
import { estimateTokens } from "./tokenEstimate.js";

export function packFocusedBriefing(input: {
  packet: TaskPacket;
  leads: RetrievalLead[];
  projectRules?: string;
  workingMemory?: WorkingMemory;
  fileCards?: Array<{ path: string; purpose: string; exports: string[] }>;
  tokenBudget: ContextBudget;
  mode?: "ask" | "patch";
}): ContextPacket {
  const { packet: tp, leads, projectRules, workingMemory, tokenBudget, mode } = input;
  const modeLabel = mode ?? "ask";
  const segments: string[] = [];

  const rules = modeLabel === "patch"
    ? `## RULES
- Work only on the stated goal.
- Do not improve unrelated code.
- Do not edit a file before reading the relevant lines.
- Prefer search/read over guessing.
- Prefer one small edit at a time.
- After editing, run the narrowest relevant check.
- Stop with finish when the success criteria are met.
- Never output broad explanations during tool mode.
- Keep tool arguments precise and minimal.`
    : `## RULES
- Answer the question using ONLY inspected code.
- Reference concrete file paths and symbols.
- Be concise and specific.`;

  segments.push(rules);

  segments.push(`## TASK
Goal: ${tp.goal}
Success: ${tp.successCriteria.join(" | ")}
Non-goals: ${tp.nonGoals.join("; ")}
Keywords: ${tp.keywords.join(", ")}
Areas: ${tp.likelyAreas.join(", ")}
Confidence: ${tp.confidence}`);

  if (tp.constraints.length > 0) {
    segments.push(`Constraints: ${tp.constraints.join("; ")}`);
  }

  if (tp.verificationPlan.length > 0) {
    segments.push(`Verification: ${tp.verificationPlan.join(", ")}`);
  }

  if (projectRules) {
    const trimmedRules = projectRules.slice(0, tokenBudget.projectRulesTokens * 4);
    segments.push(`## PROJECT RULES\n${trimmedRules}`);
  }

  if (input.fileCards && input.fileCards.length > 0) {
    const cardText = input.fileCards.slice(0, 8).map((c) =>
      `${c.path}: ${c.purpose} | Exports: ${c.exports.slice(0, 4).join(", ") || "none"}`
    ).join("\n");
    const trimmedCards = cardText.slice(0, tokenBudget.fileCardsTokens * 4);
    segments.push(`## FILE CARDS\n${trimmedCards}`);
  }

  if (workingMemory) {
    const memText = renderWorkingMemory(workingMemory);
    segments.push(memText);
  }

  const leadsText = renderRetrievalLeads(
    leads,
    tokenBudget.maxPromptTokens <= 4096 ? 160 : 240
  );
  segments.push(leadsText);

  const prompt = segments.join("\n\n");
  const estimated = estimateTokens(prompt);

  return {
    task: tp.goal,
    prompt,
    estimatedTokens: estimated,
    files: [],
    symbols: [],
    warnings: estimated > tokenBudget.maxPromptTokens
      ? [`Focused briefing at ${estimated} tokens exceeds budget of ${tokenBudget.maxPromptTokens}.`]
      : undefined,
  };
}
