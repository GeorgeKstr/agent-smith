import { mergeWorkingMemory } from "./workingMemory.js";
export async function compactToolResult(input) {
    const { memory, toolName, toolArgs, rawResult } = input;
    const args = (toolArgs ?? {});
    if (!rawResult.ok) {
        return mergeWorkingMemory(memory, {
            warnings: [`Tool '${toolName}' failed: ${rawResult.summary}`],
        });
    }
    switch (toolName) {
        case "read": {
            const path = typeof args.path === "string" ? args.path : "unknown";
            const startLine = typeof args.startLine === "number" ? args.startLine : undefined;
            const endLine = typeof args.endLine === "number" ? args.endLine : undefined;
            const rangeStr = startLine !== undefined && endLine !== undefined
                ? `${startLine}-${endLine}`
                : "unknown range";
            const facts = [];
            if (rawResult.content) {
                const lines = rawResult.content.split("\n").filter(Boolean).slice(0, 6);
                for (const line of lines) {
                    const clean = line.replace(/^\s*\d+\|\s*/, "").trim();
                    if (clean && clean.length < 200) {
                        facts.push(`Read ${path}: ${clean}`);
                    }
                }
                if (facts.length === 0) {
                    facts.push(`Inspected ${path}:${rangeStr}`);
                }
            }
            const remainingUnknowns = memory.remainingUnknowns.filter((u) => !u.toLowerCase().includes(path.toLowerCase()));
            return mergeWorkingMemory(memory, {
                filesRead: [
                    {
                        path,
                        ranges: [rangeStr],
                        summary: rawResult.summary,
                    },
                ],
                confirmedFacts: facts.slice(0, 4),
                remainingUnknowns,
            });
        }
        case "search": {
            const query = typeof args.query === "string" ? args.query : "unknown query";
            const hits = rawResult.content
                ? rawResult.content.split("\n").filter(Boolean).length
                : 0;
            return mergeWorkingMemory(memory, {
                confirmedFacts: [`Search for "${query}" returned ${hits} hit(s).`],
                remainingUnknowns: hits === 0
                    ? [...memory.remainingUnknowns, `No results for "${query}"`]
                    : memory.remainingUnknowns,
            });
        }
        case "edit":
        case "replace_lines": {
            const path = typeof args.path === "string" ? args.path : "unknown";
            return mergeWorkingMemory(memory, {
                editsApplied: [`${path}: ${rawResult.summary}`],
                currentHypothesis: `Edited ${path} as planned. Need to verify.`,
                remainingUnknowns: memory.remainingUnknowns.filter((u) => !u.toLowerCase().includes(path.toLowerCase())),
            });
        }
        case "check": {
            return mergeWorkingMemory(memory, {
                checkResults: [rawResult.summary],
                remainingUnknowns: rawResult.ok
                    ? memory.remainingUnknowns.filter((u) => !u.toLowerCase().includes("check") && !u.toLowerCase().includes("verify"))
                    : [...memory.remainingUnknowns, `Check failed: ${rawResult.summary}`],
            });
        }
        case "finish": {
            return mergeWorkingMemory(memory, {
                currentHypothesis: "Task completed.",
            });
        }
        default: {
            return mergeWorkingMemory(memory, {
                confirmedFacts: [`Tool '${toolName}' executed successfully.`],
            });
        }
    }
}
