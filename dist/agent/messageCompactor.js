import { charDiv4Estimator } from "../context/tokenEstimate.js";
import { renderWorkingMemory } from "./workingMemory.js";
export function compactMessages(input) {
    const estimator = input.estimator ?? charDiv4Estimator;
    const memoryText = renderWorkingMemory(input.memory);
    const maxHistoryTokens = input.maxToolHistoryTokens;
    const output = [];
    let toolHistoryTokens = 0;
    for (const msg of input.messages) {
        if (msg.role === "system") {
            output.push(msg);
            continue;
        }
        if (msg.role === "user") {
            output.push(msg);
            continue;
        }
        if (msg.role === "tool" || msg.role === "function") {
            const tokens = estimator.estimate(msg.content);
            if (toolHistoryTokens + tokens > maxHistoryTokens) {
                continue;
            }
            toolHistoryTokens += tokens;
            // Truncate large function results
            if (tokens > maxHistoryTokens * 0.4) {
                const truncated = msg.content.slice(0, maxHistoryTokens * 2);
                output.push({ ...msg, content: truncated + "\n... [truncated]" });
            }
            else {
                output.push(msg);
            }
            continue;
        }
        // assistant messages
        if (msg.role === "assistant") {
            output.push(msg);
            continue;
        }
    }
    // Ensure memory summary is in the output after system but before user content
    if (memoryText && output.length > 0) {
        const memTokens = estimator.estimate(memoryText);
        if (memTokens < maxHistoryTokens * 0.5) {
            const userIdx = output.findIndex((m) => m.role === "user");
            if (userIdx >= 0) {
                const memMsg = {
                    role: "system",
                    content: memoryText,
                };
                output.splice(userIdx, 0, memMsg);
            }
        }
    }
    return output;
}
