import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Box, Text } from "ink";
import { theme } from "../theme.js";
const ART = [
    '   ▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄   ',
    '  █  ███     ███  █  ',
    '  █  ███     ███  █  ',
    '  █   █████████   █  ',
    '  █              █  ',
    '   ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀   ',
];
export function AgentSmithArt() {
    return (_jsxs(Box, { flexDirection: "column", alignItems: "center", paddingY: 1, children: [ART.map((line, i) => (_jsx(Text, { color: theme.primary, backgroundColor: "black", children: line }, i))), _jsx(Text, { color: theme.primary, backgroundColor: "black", bold: true, children: "Agent Smith" })] }));
}
