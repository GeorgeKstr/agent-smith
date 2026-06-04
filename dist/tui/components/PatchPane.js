import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Box, Text } from "ink";
function lineColor(line) {
    if (line.startsWith("+") && !line.startsWith("+++"))
        return "green";
    if (line.startsWith("-") && !line.startsWith("---"))
        return "red";
    if (line.startsWith("@@"))
        return "cyan";
    if (line.startsWith("diff ") || line.startsWith("+++") || line.startsWith("---"))
        return "yellow";
    return "gray";
}
export function PatchPane({ patchText, active }) {
    const lines = patchText ? patchText.split("\n").slice(0, 12) : [];
    return (_jsxs(Box, { flexDirection: "column", width: "50%", borderStyle: "round", borderColor: active ? "greenBright" : "green", paddingX: 1, children: [_jsx(Text, { color: "greenBright", children: "Patch / Test Output" }), lines.length === 0 ? (_jsx(Text, { color: "gray", children: "unified diffs will appear here" })) : (lines.map((line, i) => (_jsx(Text, { color: lineColor(line), children: line.slice(0, 56) }, i))))] }));
}
