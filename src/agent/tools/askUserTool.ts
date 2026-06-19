import type { AgentTool } from "./toolRegistry.js";
import { createUserQuestion } from "../../chat/chatStore.js";

const askUserTool: AgentTool = {
  name: "ask_user",
  description: "Ask the user a question when the task cannot safely continue without input.",
  parameters: {
    type: "object",
    properties: {
      kind: {
        type: "string",
        enum: ["confirm", "select", "text"],
        description: "Type: confirm (yes/no), select (from options), or text (freeform).",
      },
      prompt: {
        type: "string",
        description: "The question to ask the user.",
      },
      options: {
        type: "array",
        items: { type: "string" },
        description: "Choices for 'select' kind. 2-12 items.",
      },
      defaultValue: {
        type: "string",
        description: "Default answer if user skips.",
      },
      reason: {
        type: "string",
        description: "Why this input is needed.",
      },
    },
    required: ["kind", "prompt", "reason"],
  },
  mode: "readonly",

  async handler(rawArgs, ctx): Promise<any> {
    const args = rawArgs as Record<string, unknown>;
    const kind = (typeof args.kind === "string" ? args.kind : "text") as "confirm" | "select" | "text";
    // Accept prompt from various field names
    const prompt = (
      typeof args.prompt === "string" ? args.prompt :
      typeof args.question === "string" ? args.question :
      typeof args.message === "string" ? args.message :
      typeof args.text === "string" ? args.text :
      ""
    ).trim();
    const reason = (typeof args.reason === "string" ? args.reason : "").trim();
    const options = Array.isArray(args.options) ? args.options.map(String) : [];

    if (!prompt) return { ok: false, summary: "No question prompt provided. Include a 'prompt' field with your question." };

    const effectiveOptions =
      kind === "confirm" ? ["yes", "no"] :
      kind === "select" && options.length >= 2 ? options.slice(0, 12) :
      [];

    if (kind === "select" && effectiveOptions.length < 2) {
      return { ok: false, summary: "Select questions require at least 2 options." };
    }

    try {
      const sessionId = ctx.taskId ?? `agent_${Date.now()}`;
      const question = createUserQuestion(ctx.db, {
        sessionId,
        messageId: `msg_${Date.now()}`,
        kind,
        prompt,
        options: effectiveOptions.length > 0 ? effectiveOptions : undefined,
        taskId: ctx.taskId,
        runId: ctx.taskId ? `run_${ctx.taskId}` : undefined,
      });

      return {
        ok: true,
        summary: `Question asked: ${prompt}`,
        content: prompt,
        metadata: {
          questionId: question.id,
          kind,
          status: question.status,
          options: effectiveOptions,
        },
        nextActions: ["Wait for user answer before continuing."],
      };
    } catch (err) {
      return {
        ok: false,
        summary: `Failed to create question: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
};

export { askUserTool };
