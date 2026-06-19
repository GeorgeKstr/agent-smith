import { createInternalToolCallId } from "./toolCallIds.js";
export function parseInternalToolCalls(input) {
    const msg = (input.message ?? {});
    const calls = [];
    let index = 0;
    // OpenAI-compatible tool_calls
    if (Array.isArray(msg.tool_calls)) {
        for (const tc of msg.tool_calls) {
            const fn = (tc.function ?? {});
            calls.push({
                id: createInternalToolCallId({
                    provider: input.provider,
                    providerCallId: typeof tc.id === "string" ? tc.id : undefined,
                    toolName: String(fn.name ?? ""),
                    index: index++,
                    turnId: input.turnId,
                }),
                name: String(fn.name ?? ""),
                argumentsJson: typeof fn.arguments === "string" ? fn.arguments : JSON.stringify(fn.arguments ?? {}),
                providerCallId: typeof tc.id === "string" ? tc.id : undefined,
                provider: input.provider,
                raw: tc,
            });
        }
        return calls;
    }
    // Qwen/Ollama single function_call
    if (msg.function_call && typeof msg.function_call === "object") {
        const fc = msg.function_call;
        calls.push({
            id: createInternalToolCallId({
                provider: input.provider,
                toolName: String(fc.name ?? ""),
                index: 0,
                turnId: input.turnId,
            }),
            name: String(fc.name ?? ""),
            argumentsJson: typeof fc.arguments === "string" ? fc.arguments : JSON.stringify(fc.arguments ?? {}),
            provider: input.provider,
            raw: fc,
        });
        return calls;
    }
    // Anthropic content blocks with tool_use
    if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
            if (block.type === "tool_use") {
                calls.push({
                    id: createInternalToolCallId({
                        provider: input.provider,
                        providerCallId: typeof block.id === "string" ? block.id : undefined,
                        toolName: String(block.name ?? ""),
                        index: index++,
                        turnId: input.turnId,
                    }),
                    name: String(block.name ?? ""),
                    argumentsJson: typeof block.input === "string" ? block.input : JSON.stringify(block.input ?? {}),
                    providerCallId: typeof block.id === "string" ? block.id : undefined,
                    provider: input.provider,
                    raw: block,
                });
            }
        }
        return calls;
    }
    // Fallback: try parsing XML <tool_call> blocks from text content
    const textContent = typeof msg.content === "string" ? msg.content : "";
    if (textContent) {
        const xmlRegex = /<tool_call>\s*(\{[\s\S]*?\})\s*<\/tool_call>/g;
        let m;
        while ((m = xmlRegex.exec(textContent)) !== null) {
            try {
                const parsed = JSON.parse(m[1]);
                calls.push({
                    id: createInternalToolCallId({
                        provider: input.provider,
                        toolName: String(parsed.name ?? ""),
                        index: index++,
                        turnId: input.turnId,
                    }),
                    name: String(parsed.name ?? ""),
                    argumentsJson: JSON.stringify(parsed.arguments ?? parsed.parameters ?? {}),
                    provider: input.provider,
                    raw: parsed,
                });
            }
            catch {
                // skip unparseable XML
            }
        }
    }
    return calls;
}
export function parseInternalAssistantResponse(input) {
    const msg = (input.rawResponse ?? {});
    // Anthropic has content as array
    let textContent = "";
    if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
            if (block.type === "text" && typeof block.text === "string") {
                textContent += block.text;
            }
        }
    }
    else if (typeof msg.content === "string") {
        textContent = msg.content;
    }
    const toolCalls = parseInternalToolCalls({
        provider: input.provider,
        message: input.rawResponse,
        turnId: input.turnId,
    });
    return {
        content: textContent,
        toolCalls,
        raw: input.rawResponse,
    };
}
