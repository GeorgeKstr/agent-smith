import type { Provider } from "../providers/providers.js";
import type { SmithConfig } from "../types/index.js";
import type { FocusedAgentResult } from "./focusedAgentLoop.js";
import { createEmptyRunMetrics } from "./runMetrics.js";
import { createEmptyRunEvidence } from "./runEvidence.js";
import { createWorkingMemory } from "./workingMemory.js";
import type { TaskPacket } from "../context/taskPacket.js";

function makeEmptyPacket(prompt: string): TaskPacket {
  return {
    goal: prompt.slice(0, 200),
    successCriteria: [],
    nonGoals: [],
    keywords: [],
    likelyAreas: [],
    constraints: [],
    suspectedFiles: [],
    verificationPlan: [],
    rawUserPrompt: prompt,
    confidence: "low",
  };
}

export async function runChatTurn(input: {
  prompt: string;
  provider: Provider;
  model: string;
  config: SmithConfig;
  signal?: AbortSignal;
}): Promise<FocusedAgentResult> {
  const text = input.prompt.trim();
  const emptyMemory = createWorkingMemory(makeEmptyPacket(text));

  if (/^(hi|hello|hey|yo|sup|thanks|thank you|bye|goodbye|see you)\b[!.?\s]*$/i.test(text)) {
    return {
      ok: true,
      status: "completed",
      finalText: "Hey — what would you like to work on?",
      changedFiles: [],
      checksRun: [],
      metrics: { ...createEmptyRunMetrics(), modelTurns: 0 },
      evidence: createEmptyRunEvidence(),
      stopReason: "final_block",
      memory: emptyMemory,
    };
  }

  const response = await input.provider.chat(
    input.model,
    [
      {
        role: "system",
        content: "You are a concise local coding assistant. Answer conversationally. Do not request tools or modify files."
      },
      {
        role: "user",
        content: input.prompt
      }
    ],
    undefined,
    input.signal ? { signal: input.signal } : undefined
  );

  if (!response.ok) {
    return {
      ok: false,
      status: "failed",
      finalText: "Sorry, I couldn't process that.",
      changedFiles: [],
      checksRun: [],
      metrics: { ...createEmptyRunMetrics(), modelTurns: 1 },
      evidence: createEmptyRunEvidence(),
      stopReason: "provider_error",
      memory: emptyMemory,
    };
  }

  return {
    ok: true,
    status: "completed",
    finalText: response.text,
    changedFiles: [],
    checksRun: [],
    metrics: { ...createEmptyRunMetrics(), modelTurns: 1 },
    evidence: createEmptyRunEvidence(),
    stopReason: "final_block",
    memory: emptyMemory,
  };
}
