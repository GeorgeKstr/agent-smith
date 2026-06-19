import { z } from "zod";
import { buildHeuristicTaskPacket } from "./taskPacket.js";
import { extractJson } from "../utils/json.js";
const taskPacketOutputSchema = z.object({
    goal: z.string(),
    successCriteria: z.array(z.string()),
    nonGoals: z.array(z.string()),
    keywords: z.array(z.string()),
    likelyAreas: z.array(z.string()),
    constraints: z.array(z.string()).optional(),
    verificationPlan: z.array(z.string()),
    confidence: z.enum(["low", "medium", "high"]),
});
const DISTILL_PROMPT = `You convert messy user requests into compact coding task contracts.

Return only JSON with this shape:
{
  "goal": "one clear sentence",
  "successCriteria": ["testable outcome"],
  "nonGoals": ["things not to change"],
  "keywords": ["retrieval keyword"],
  "likelyAreas": ["ui|api|database|auth|config|tests|build|agent|tooling|other"],
  "constraints": ["important constraint"],
  "verificationPlan": ["typecheck|test|lint|build or specific check"],
  "confidence": "low|medium|high"
}

Rules:
- Preserve the user's exact intent.
- Do not invent files or implementation details.
- Add non-goals to prevent unrelated rewrites.
- If the user complains about a regression, include the previous desired behavior.
- If the user says "whole file", include that as a constraint.
- Keep it compact.`;
export async function distillTaskPacket(input) {
    const heuristic = input.fallback ?? buildHeuristicTaskPacket(input.userPrompt);
    try {
        const systemParts = [DISTILL_PROMPT];
        if (input.projectRules) {
            systemParts.push(`\n## PROJECT RULES\n${input.projectRules.slice(0, 800)}`);
        }
        if (input.recentMemory) {
            systemParts.push(`\n## RECENT MEMORY\n${input.recentMemory.slice(0, 600)}`);
        }
        const result = await input.provider.generate(input.model, `User request:\n${input.userPrompt}`, {
            system: systemParts.join("\n"),
            maxTokens: 400,
            temperature: 0,
        });
        if (!result.ok || !result.text)
            return heuristic;
        const parsed = extractJson(result.text.trim());
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
            return heuristic;
        const validation = taskPacketOutputSchema.safeParse(parsed);
        if (!validation.success)
            return heuristic;
        const data = validation.data;
        return {
            goal: data.goal || heuristic.goal,
            successCriteria: data.successCriteria.length > 0 ? data.successCriteria : heuristic.successCriteria,
            nonGoals: data.nonGoals.length > 0
                ? [...data.nonGoals, ...heuristic.nonGoals.filter((ng) => !data.nonGoals.includes(ng))].slice(0, 6)
                : heuristic.nonGoals,
            keywords: data.keywords.length > 0 ? data.keywords : heuristic.keywords,
            likelyAreas: data.likelyAreas.length > 0 ? data.likelyAreas : heuristic.likelyAreas,
            constraints: [
                ...(data.constraints ?? []),
                ...heuristic.constraints.filter((c) => !(data.constraints ?? []).includes(c)),
            ].slice(0, 6),
            suspectedFiles: heuristic.suspectedFiles,
            verificationPlan: data.verificationPlan.length > 0 ? data.verificationPlan : heuristic.verificationPlan,
            rawUserPrompt: input.userPrompt,
            confidence: data.confidence,
        };
    }
    catch {
        return heuristic;
    }
}
