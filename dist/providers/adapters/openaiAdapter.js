import { parseInternalAssistantResponse } from "../toolCallParser.js";
export const openaiAdapter = {
    kind: "openai",
    toProviderMessages(messages) {
        return messages.map((m) => {
            switch (m.role) {
                case "system":
                case "user":
                    return { role: m.role, content: m.content };
                case "assistant": {
                    const out = { role: "assistant" };
                    if (m.content)
                        out.content = m.content;
                    if (m.toolCalls && m.toolCalls.length > 0) {
                        out.tool_calls = m.toolCalls.map((tc) => ({
                            id: tc.id,
                            type: "function",
                            function: {
                                name: tc.name,
                                arguments: tc.argumentsJson,
                            },
                        }));
                        if (!m.content)
                            out.content = null;
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
                    return { role: "user", content: m.content ?? "" };
            }
        });
    },
    toProviderTools(tools) {
        return tools.map((t) => ({
            type: "function",
            function: {
                name: t.name,
                description: t.description,
                parameters: t.parameters,
            },
        }));
    },
    fromProviderResponse(input) {
        return parseInternalAssistantResponse({
            provider: "openai",
            rawResponse: input.rawResponse,
            turnId: input.turnId,
        });
    },
};
