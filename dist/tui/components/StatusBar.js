import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Box, Text } from "ink";
import { theme } from "../theme.js";
const BG = "black";
export function StatusBar({ filesTotal, dirtyFiles, tokens, maxTokens, busy, mode, intent, width, }) {
    const intentText = intent ? `${intent.kind} ${Math.round(intent.confidence * 100)}%` : "-";
    const intentColor = intent?.kind === "task" ? theme.primary : intent?.kind === "chat" ? theme.accent : theme.warn;
    const sBusy = busy ? "working" : "●";
    const sMode = mode;
    const sFiles = `${filesTotal} files`;
    const sDirty = dirtyFiles > 0 ? `${dirtyFiles} dirty` : "";
    const sCtx = `ctx ${tokens}/${maxTokens}`;
    const sIntentLabel = "intent";
    const plain = [sBusy, sMode, sFiles, sDirty, sCtx, sIntentLabel, intentText].filter(Boolean).join("  ");
    const fill = " ".repeat(Math.max(0, width - 2 - plain.length));
    return (_jsx(Box, { paddingX: 1, paddingY: 0, children: _jsxs(Text, { backgroundColor: BG, children: [_jsx(Text, { color: busy ? theme.warn : theme.primary, children: sBusy }), _jsxs(Text, { color: mode === "build" ? theme.warn : theme.accent, children: ["  ", sMode] }), _jsxs(Text, { color: theme.text, children: ["  ", sFiles] }), dirtyFiles > 0 && _jsxs(Text, { color: theme.warn, children: ["  ", sDirty] }), _jsxs(Text, { color: theme.dim, children: ["  ", sCtx] }), _jsxs(Text, { color: theme.dim, children: ["  ", sIntentLabel, " "] }), _jsx(Text, { color: intentColor, children: intentText }), _jsx(Text, { children: fill })] }) }));
}
