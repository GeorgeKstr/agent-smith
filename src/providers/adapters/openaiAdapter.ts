import type { InternalMessage, InternalAssistantResponse } from "../providerProtocol.js";
import { parseInternalAssistantResponse } from "../toolCallParser.js";
import type { ProviderKind } from "../toolCallParser.js";

export const openaiAdapter = {
  kind: "openai" as ProviderKind,

  toProviderMessages(messages: InternalMessage[]): Array<Record<string, unknown>> {
    return messages.map((m) => {
      switch (m.role) {
        case "system":
        case "user":
          return { role: m.role, content: m.content };

        case "assistant": {
          const out: Record<string, unknown> = { role: "assistant" };
          if (m.content) out.content = m.content;
          if (m.toolCalls && m.toolCalls.length > 0) {
            out.tool_calls = m.toolCalls.map((tc) => ({
              id: tc.id,
              type: "function",
              function: {
                name: tc.name,
                arguments: tc.argumentsJson,
              },
            }));
            if (!m.content) out.content = null;
          }
          return out;
        }

        case "tool":
          return {
            role: "tool",
            tool_call_id: m.toolCallId,
            content: m.content,
          };

        default:
          return { role: "user", content: (m as any).content ?? "" };
      }
    });
  },

  toProviderTools(
    tools: Array<{ name: string; description: string; parameters: unknown }>
  ): Array<Record<string, unknown>> {
    return tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
  },

  fromProviderResponse(input: {
    rawResponse: unknown;
    turnId: string;
  }): InternalAssistantResponse {
    return parseInternalAssistantResponse({
      provider: "openai",
      rawResponse: input.rawResponse,
      turnId: input.turnId,
    });
  },
};
