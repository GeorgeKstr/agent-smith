import type { AgentTool } from "./toolRegistry.js";

export const proposeEditTool: AgentTool = {
  name: "propose_edit",
  description:
    "Propose a concrete edit after inspecting files. Use this when you know what should change but want validation before calling edit. Does NOT modify files.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Project-relative file path to edit."
      },
      target: {
        type: "string",
        description: "Function, block, command, handler, or nearby text that should change."
      },
      intent: {
        type: "string",
        description: "What behavior the edit should implement."
      },
      proposedChange: {
        type: "string",
        description: "Plain-English description of the exact change."
      },
      reason: {
        type: "string",
        description: "Why this edit is needed."
      }
    },
    required: ["path", "target", "intent", "proposedChange", "reason"]
  },
  mode: "patch",

  async handler(rawArgs, ctx): Promise<any> {
    const args = rawArgs as Record<string, unknown>;
    const relPath = typeof args.path === "string" ? args.path.trim() : "";
    if (!relPath) return { ok: false, summary: "No path provided." };

    const wasRead = ctx.memory?.filesRead?.some((f: { path: string }) => f.path === relPath);
    if (!wasRead) {
      return {
        ok: false,
        summary: `File "${relPath}" has not been read yet. Read the file first before proposing an edit.`,
        nextActions: [
          `Read ${relPath} first to understand the current code.`,
          "Then call propose_edit with the exact change description."
        ]
      };
    }

    const target = typeof args.target === "string" ? args.target.trim() : "";
    const intent = typeof args.intent === "string" ? args.intent.trim() : "";
    const proposedChange = typeof args.proposedChange === "string" ? args.proposedChange.trim() : "";
    const reason = typeof args.reason === "string" ? args.reason.trim() : "";

    return {
      ok: true,
      summary: `Accepted edit proposal for ${relPath}.`,
      content: [
        `Target: ${target}`,
        `Intent: ${intent}`,
        `Change: ${proposedChange}`,
        `Reason: ${reason}`,
      ].join("\n"),
      nextActions: [
        `Call edit or replace_lines on ${relPath} with exact old text from the previously read content.`,
        "Use exact search/replace: the 'search' field in edit must match the old text exactly.",
        "If the exact old text is unclear, re-read the file around the target."
      ],
      metadata: {
        path: relPath,
        target,
        intent,
        proposedChange,
        reason
      }
    };
  },
};
