import { parseInternalAssistantResponse } from "../toolCallParser.js";
export const anthropicAdapter = {
    kind: "anthropic",
    toProviderMessages(messages) {
        const out = [];
        for (const m of messages) {
            switch (m.role) {
                case "system":
                case "user":
                    out.push({ role: "user", content: m.content });
                    break;
                case "assistant": {
                    const content = [];
                    if (m.content) {
                        content.push({ type: "text", text: m.content });
                    }
                    if (m.toolCalls && m.toolCalls.length > 0) {
                        for (const tc of m.toolCalls) {
                            let input;
                            try {
                                input = JSON.parse(tc.argumentsJson);
                            }
                            catch {
                                input = {};
                            }
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
                    out.push({ role: "user", content: m.content ?? "" });
                    break;
            }
        }
        return out;
    },
    toProviderTools(tools) {
        return tools.map((t) => ({
            name: t.name,
            description: t.description,
            input_schema: t.parameters,
        }));
    },
    fromProviderResponse(input) {
        return parseInternalAssistantResponse({
            provider: "anthropic",
            rawResponse: input.rawResponse,
            turnId: input.turnId,
        });
    },
};
