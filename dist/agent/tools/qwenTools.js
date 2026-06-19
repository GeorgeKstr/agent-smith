import { parseFunctionArguments } from "../../providers/ollama.js";
import { chatWithProvider } from "../../providers/providers.js";
function stringifyToolResult(value) {
    if (typeof value === "string")
        return value;
    try {
        return JSON.stringify(value ?? null);
    }
    catch {
        return JSON.stringify({ error: "Tool returned a non-serializable value" });
    }
}
function functionCalls(messages) {
    const calls = [];
    for (const message of messages) {
        if (message.function_call)
            calls.push(message.function_call);
        for (const tc of message.tool_calls ?? []) {
            calls.push({ name: tc.function.name, arguments: stringifyToolResult(tc.function.arguments), callId: tc.id });
        }
    }
    return calls;
}
/**
 * Runs the canonical Qwen-Agent loop:
 * assistant function_call -> local function execution -> role:function result -> final assistant answer.
 */
export async function runQwenFunctionLoop(args) {
    const messages = [...args.messages];
    const functions = args.tools.map((tool) => tool.function);
    const handlers = new Map(args.tools.map((tool) => [tool.function.name, tool.handler]));
    const maxToolRounds = args.maxToolRounds ?? 4;
    let toolCallCount = 0;
    for (let round = 0; round <= maxToolRounds; round++) {
        const result = await chatWithProvider(args.config, args.modelSpec, messages, functions);
        if (!result.ok)
            return { ok: false, messages, finalText: "", toolCallCount, error: result.error };
        messages.push(...result.messages);
        const calls = functionCalls(result.messages);
        if (calls.length === 0) {
            return { ok: true, messages, finalText: result.text, toolCallCount };
        }
        for (const call of calls) {
            toolCallCount++;
            const handler = handlers.get(call.name);
            if (!handler) {
                messages.push({
                    role: "user",
                    content: `[System] Unknown function: ${call.name}`,
                });
                continue;
            }
            const fnArgs = parseFunctionArguments(call);
            args.onToolCall?.({ name: call.name, args: fnArgs });
            try {
                const fnResult = await handler(fnArgs);
                messages.push({ role: "tool", name: call.name, tool_call_id: `call_${call.name}`, content: stringifyToolResult(fnResult) });
            }
            catch (error) {
                messages.push({
                    role: "user",
                    content: `[System] Tool error: ${error instanceof Error ? error.message : String(error)}`,
                });
            }
        }
    }
    return {
        ok: false,
        messages,
        finalText: "",
        toolCallCount,
        error: `Stopped after ${maxToolRounds} tool rounds; the model kept requesting tools.`
    };
}
