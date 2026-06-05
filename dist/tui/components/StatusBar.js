import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React from "react";
import { Box, Text } from "ink";
import { theme } from "../theme.js";
const BG = "black";
export const StatusBar = React.memo(function StatusBar({ filesTotal, dirtyFiles, tokens, maxTokens, busy, mode, intent, width, scanPhase, scanProgress, scanScanned, scanTotal, }) {
    const intentText = intent ? `${intent.kind} ${Math.round(intent.confidence * 100)}%` : "-";
    const intentColor = intent?.kind === "task" ? theme.primary : intent?.kind === "chat" ? theme.accent : theme.warn;
    const sBusy = busy ? "working" : "●";
    const sMode = mode;
    const sFiles = `${filesTotal} files`;
    const sDirty = dirtyFiles > 0 ? `${dirtyFiles} dirty` : "";
    const sCtx = `ctx ${tokens}/${maxTokens}`;
    const sIntentLabel = "intent";
    const left = [sBusy, sMode, sFiles, sDirty, sCtx, sIntentLabel, intentText].filter(Boolean).join("  ");
    return (_jsxs(Box, { paddingX: 1, paddingY: 0, flexDirection: "column", children: [_jsx(Box, { children: _jsxs(Text, { backgroundColor: BG, children: [_jsx(Text, { color: busy ? theme.warn : theme.primary, children: sBusy }), _jsxs(Text, { color: mode === "build" ? theme.warn : theme.accent, children: ["  ", sMode] }), _jsxs(Text, { color: theme.text, children: ["  ", sFiles] }), dirtyFiles > 0 && _jsxs(Text, { color: theme.warn, children: ["  ", sDirty] }), _jsxs(Text, { color: theme.dim, children: ["  ", sCtx] }), _jsxs(Text, { color: theme.dim, children: ["  ", sIntentLabel, " "] }), _jsx(Text, { color: intentColor, children: intentText }), _jsx(Text, { children: " ".repeat(Math.max(0, width - 2 - left.length)) })] }) }), scanPhase && scanPhase !== "idle" && scanPhase !== "ready" && scanTotal && scanTotal > 0 && (_jsx(Box, { children: _jsxs(Text, { backgroundColor: BG, children: [_jsxs(Text, { color: theme.accent, children: ["  indexing ", scanPhase, " "] }), _jsxs(Text, { color: theme.primary, children: [scanScanned ?? 0, "/", scanTotal] }), _jsxs(Text, { color: theme.dim, children: ["  ", "█".repeat(Math.round((scanProgress ?? 0) * 20)), "░".repeat(20 - Math.round((scanProgress ?? 0) * 20))] })] }) }))] }));
});
