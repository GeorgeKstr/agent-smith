import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
import { Box, Text } from "ink";
export function StatusBar({ filesTotal, dirtyFiles, tokens, maxTokens, mode, busy }) {
    return (_jsxs(Box, { borderStyle: "single", borderColor: "green", paddingX: 1, justifyContent: "space-between", children: [_jsxs(Text, { color: busy ? "yellow" : "green", children: ["\u25CF ", busy ? "working" : "watch mode engaged"] }), _jsxs(Text, { color: "green", children: [filesTotal, " files"] }), _jsx(Text, { color: dirtyFiles > 0 ? "yellow" : "green", children: dirtyFiles > 0 ? `${dirtyFiles} dirty` : "fresh" }), _jsx(Text, { color: mode === "patch" ? "yellow" : "cyan", children: mode }), _jsxs(Text, { color: "cyan", children: ["ctx ", tokens, " / ", maxTokens] })] }));
}
