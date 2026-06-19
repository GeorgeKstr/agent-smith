import type { InternalMessage, InternalAssistantResponse } from "../providerProtocol.js";
import { parseInternalAssistantResponse } from "../toolCallParser.js";
import type { ProviderKind } from "../toolCallParser.js";

export const anthropicAdapter = {
  kind: "anthropic" as ProviderKind,

  toProviderMessages(messages: InternalMessage[]): Array<Record<string, unknown>> {
    const out: Array<Record<string, unknown>> = [];

    for (const m of messages) {
      switch (m.role) {
        case "system":
        case "user":
          out.push({ role: "user", content: m.content });
          break;

        case "assistant": {
          const content: Array<Record<string, unknown>> = [];
          if (m.content) {
            content.push({ type: "text", text: m.content });
          }
          if (m.toolCalls && m.toolCalls.length > 0) {
            for (const tc of m.toolCalls) {
              let input: unknown;
              try { input = JSON.parse(tc.argumentsJson); } catch { input = {}; }
              content.push({
                type: "tool_use",
                id: tc.id,
                name: tc.name,
                input,
              });
            }
          }
          out.push({ role: "assistant", content });
          break;
        }

        case "tool":
          out.push({
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: m.toolCallId,
                content: m.content,
              },
            ],
          });
          break;

        default:
          out.push({ role: "user", content: (m as any).content ?? "" });
          break;
      }
    }

    return out;
  },

  toProviderTools(
    tools: Array<{ name: string; description: string; parameters: unknown }>
  ): Array<Record<string, unknown>> {
    return tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    }));
  },

  fromProviderResponse(input: {
    rawResponse: unknown;
    turnId: string;
  }): InternalAssistantResponse {
    return parseInternalAssistantResponse({
      provider: "anthropic",
      rawResponse: input.rawResponse,
      turnId: input.turnId,
    });
  },
};
