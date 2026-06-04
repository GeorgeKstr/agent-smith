import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
import { Box, Text } from "ink";
import { theme } from "../theme.js";
const BG = "black";
export function InputBar({ input, busy, mode, phase, }) {
    const isSlash = input.startsWith("/") && !busy;
    const promptGlyph = isSlash ? "λ" : "◈";
    const border = busy ? theme.accent : isSlash ? theme.accent : theme.border;
    return (_jsxs(Box, { borderStyle: "round", borderColor: border, paddingX: 1, paddingY: 0, minHeight: 3, children: [_jsxs(Box, { flexGrow: 1, children: [_jsxs(Text, { color: isSlash ? theme.accent : theme.dim, backgroundColor: BG, children: [promptGlyph, " "] }), _jsx(Text, { color: isSlash ? "cyan" : "white", backgroundColor: BG, children: input }), !busy && _jsx(Text, { color: theme.dim, backgroundColor: BG, children: "\u258A" })] }), _jsx(Box, { children: busy ? (_jsxs(Text, { color: theme.accent, backgroundColor: BG, children: ["\u27F3 ", phase, "\u2026"] })) : isSlash ? (_jsx(Text, { color: theme.accent, backgroundColor: BG, children: "[CMD]" })) : (_jsxs(Text, { color: mode === "build" ? theme.warn : theme.accent, backgroundColor: BG, children: ["[", mode.toUpperCase(), "]"] })) })] }));
}
