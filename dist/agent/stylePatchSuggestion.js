export function suggestBackgroundPatch(input) {
    const bodyMatch = input.css.match(/body\s*\{[^}]*\}/m);
    if (bodyMatch) {
        const oldBlock = bodyMatch[0];
        const hasBackground = /background(-color)?\s*:/.test(oldBlock);
        let newBlock;
        if (hasBackground) {
            newBlock = oldBlock.replace(/background(-color)?\s*:[^;]+;/, `background: ${input.desiredColor};`);
        }
        else {
            newBlock = oldBlock.replace("{", `{\n  background: ${input.desiredColor};`);
        }
        return {
            tool: "edit",
            args: {
                path: input.path,
                search: oldBlock,
                replace: newBlock,
                reason: `Set page background to ${input.desiredColor}.`,
            },
            explanation: `Found existing body selector. Use edit to add background: ${input.desiredColor}.`,
        };
    }
    return {
        tool: "append_to_file",
        args: {
            path: input.path,
            content: `\nbody {\n  background: ${input.desiredColor};\n}\n`,
            reason: `Add body background rule for ${input.desiredColor}.`,
        },
        explanation: `No body selector found. Use append_to_file to add: body { background: ${input.desiredColor}; }`,
    };
}
export function suggestColorPatch(input) {
    const escapedSelector = input.selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const selectorRegex = new RegExp(`${escapedSelector}\\s*\\{[^}]*\\}`, "im");
    const match = input.css.match(selectorRegex);
    if (match) {
        const oldBlock = match[0];
        const propRegex = new RegExp(`${input.property}\\s*:[^;]+;`, "i");
        const hasProp = propRegex.test(oldBlock);
        let newBlock;
        if (hasProp) {
            newBlock = oldBlock.replace(propRegex, `${input.property}: ${input.desiredValue};`);
        }
        else {
            newBlock = oldBlock.replace("{", `{\n  ${input.property}: ${input.desiredValue};`);
        }
        return {
            tool: "edit",
            args: {
                path: input.path,
                search: oldBlock,
                replace: newBlock,
                reason: `Set ${input.selector} ${input.property} to ${input.desiredValue}.`,
            },
            explanation: `Found existing ${input.selector} rule. Use edit to set ${input.property}: ${input.desiredValue}.`,
        };
    }
    return {
        tool: "append_to_file",
        args: {
            path: input.path,
            content: `\n${input.selector} {\n  ${input.property}: ${input.desiredValue};\n}\n`,
            reason: `Add ${input.selector} rule with ${input.property}: ${input.desiredValue}.`,
        },
        explanation: `No ${input.selector} selector found. Use append_to_file to add the rule.`,
    };
}
export function extractColorFromPrompt(task) {
    const t = task.toLowerCase();
    const colors = [
        { pattern: /\bred\b/, color: "red" },
        { pattern: /\bblue\b/, color: "blue" },
        { pattern: /\bgreen\b/, color: "green" },
        { pattern: /\byellow\b/, color: "yellow" },
        { pattern: /\borange\b/, color: "orange" },
        { pattern: /\bpurple\b/, color: "purple" },
        { pattern: /\bpink\b/, color: "pink" },
        { pattern: /\bwhite\b/, color: "white" },
        { pattern: /\bblack\b/, color: "black" },
        { pattern: /\bgray\b|\bgrey\b/, color: "gray" },
        { pattern: /\bdark\s*mode\b|\bdark\s*theme\b/, color: "var(--bg, #0d1117)" },
        { pattern: /#[0-9a-fA-F]{3,6}/, color: t.match(/#[0-9a-fA-F]{3,6}/)?.[0] ?? "" },
    ];
    for (const { pattern, color } of colors) {
        if (pattern.test(t) && color)
            return color;
    }
    return null;
}
export function renderStyleSuggestionAsToolCall(suggestion) {
    const jsonArgs = JSON.stringify(suggestion.args, null, 2);
    return `<tool_call>
{"tool":"${suggestion.tool}","args":${jsonArgs}}
</tool_call>

Explanation: ${suggestion.explanation}`;
}
