import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Box, Text } from "ink";
import { theme } from "../theme.js";
const BG = "black";
export function StatusBar({ filesTotal, dirtyFiles, tokens, maxTokens, busy, mode, intent, }) {
    const intentText = intent ? `${intent.kind} ${Math.round(intent.confidence * 100)}%` : "-";
    const intentColor = intent?.kind === "task" ? theme.primary : intent?.kind === "chat" ? theme.accent : theme.warn;
    return (_jsx(Box, { paddingX: 1, paddingY: 0, children: _jsxs(Text, { backgroundColor: BG, children: [_jsx(Text, { color: busy ? theme.warn : theme.primary, children: busy ? "working" : "●" }), _jsxs(Text, { color: mode === "build" ? theme.warn : theme.accent, children: ["  ", mode] }), _jsxs(Text, { color: theme.text, children: ["  ", filesTotal, " files"] }), dirtyFiles > 0 && _jsxs(Text, { color: theme.warn, children: ["  ", dirtyFiles, " dirty"] }), _jsxs(Text, { color: theme.dim, children: ["  ctx ", tokens, "/", maxTokens] }), _jsx(Text, { color: theme.dim, children: "  intent " }), _jsx(Text, { color: intentColor, children: intentText })] }) }));
}
