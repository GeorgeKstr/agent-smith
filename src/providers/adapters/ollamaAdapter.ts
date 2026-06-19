import type { InternalMessage, InternalAssistantResponse } from "../providerProtocol.js";
import { parseInternalAssistantResponse } from "../toolCallParser.js";
import type { ProviderKind } from "../toolCallParser.js";

export const ollamaAdapter = {
  kind: "ollama" as ProviderKind,

  toProviderMessages(messages: InternalMessage[]): Array<Record<string, unknown>> {
    return messages.map((m) => {
      switch (m.role) {
        case "system":
          return { role: "system", content: m.content };

        case "user":
          return { role: "user", content: m.content };

        case "assistant": {
          const out: Record<string, unknown> = { role: "assistant", content: m.content || "" };
          if (m.toolCalls && m.toolCalls.length > 0) {
            if (m.toolCalls.length === 1) {
              out.function_call = {
                name: m.toolCalls[0].name,
                arguments: m.toolCalls[0].argumentsJson,
              };
            } else {
              out.tool_calls = m.toolCalls.map((tc) => ({
                id: tc.id,
                type: "function",
                function: {
                  name: tc.name,
                  arguments: tc.argumentsJson,
                },
              }));
            }
          }
          return out;
        }

        case "tool":
          return {
            role: "tool",
            name: m.toolName,
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
      provider: "ollama",
      rawResponse: input.rawResponse,
      turnId: input.turnId,
    });
  },
};
