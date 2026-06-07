import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { Box, Text, useStdout } from "ink";
import { theme } from "../theme.js";
import { Header } from "../components/Header.js";
import { ContentArea } from "../components/ContentArea.js";
import { MatrixRain } from "../components/MatrixRain.js";
import { InfoPanel } from "../components/InfoPanel.js";
function fitLine(text, width) {
    if (width <= 0)
        return "";
    if (text.length === width)
        return text;
    if (text.length < width)
        return text + " ".repeat(width - text.length);
    if (width <= 1)
        return "…";
    return text.slice(0, width - 1) + "…";
}
function BlackLine({ width }) {
    return _jsx(Text, { backgroundColor: "black", children: " ".repeat(Math.max(0, width)) });
}
function PromptBar({ input, busy, mode, width, setupPrompt, autocomplete, autocompleteIndex, }) {
    const gutter = 2;
    const barWidth = Math.max(8, width - gutter * 2);
    const contentWidth = Math.max(4, barWidth - 4);
    const modeTag = setupPrompt ? `[SETUP]` : `[${mode.toUpperCase()}]`;
    const modeColor = setupPrompt ? theme.accent : mode === "build" ? theme.warn : theme.accent;
    const segments = input ? input.split("\n") : [""];
    const lines = [];
    for (const seg of segments) {
        if (!seg) {
            lines.push("");
            continue;
        }
        let pos = 0;
        while (pos < seg.length) {
            lines.push(seg.slice(pos, pos + contentWidth));
            pos += contentWidth;
        }
    }
    const totalLines = Math.max(1, lines.length);
    const maxVisible = 8;
    const visible = lines.slice(-maxVisible);
    const boxHeight = Math.max(3, Math.min(visible.length, maxVisible) + 2);
    return (_jsxs(Box, { flexDirection: "row", width: width, height: boxHeight, overflow: "hidden", children: [_jsx(Box, { width: gutter, height: boxHeight, overflow: "hidden" }), _jsx(Box, { width: barWidth, height: boxHeight, borderStyle: "round", borderColor: modeColor, overflow: "hidden", children: _jsx(Box, { flexDirection: "column", width: contentWidth, paddingX: 1, children: visible.map((line, i) => {
                        const isLast = i === visible.length - 1;
                        const prefix = i === 0 ? (busy ? "⟳ " : "> ") : "  ";
                        return (_jsxs(Box, { width: contentWidth, flexDirection: "row", children: [_jsxs(Text, { backgroundColor: "#002200", children: [_jsx(Text, { color: theme.dim, backgroundColor: "#002200", children: prefix }), _jsx(Text, { color: theme.text, backgroundColor: "#002200", children: line })] }), isLast && (_jsxs(_Fragment, { children: [_jsx(Box, { flexGrow: 1, children: _jsx(Text, { backgroundColor: "#002200", children: " " }) }), _jsx(Text, { color: modeColor, bold: true, backgroundColor: "#002200", children: modeTag }), !busy && _jsx(Text, { color: theme.dim, backgroundColor: "#002200", children: "\u258A" })] }))] }, i));
                    }) }) }), _jsx(Box, { width: gutter, height: boxHeight, overflow: "hidden" })] }));
}
function intentLabel(intent) {
    if (!intent)
        return "intent:none";
    if (typeof intent === "string")
        return intent;
    const obj = intent;
    const raw = obj.type ?? obj.kind ?? obj.name ?? obj.intent;
    return typeof raw === "string" && raw ? raw : "intent";
}
function MainStatusLine({ filesTotal, dirtyFiles, tokens, maxTokens, busy, mode, intent, width, phase, scanPhase, scanProgress, scanScanned, scanTotal, }) {
    const gutter = 2;
    const iName = intentLabel(intent);
    const iColor = iName === "task" ? theme.primary : iName === "chat" ? theme.accent : theme.warn;
    const isScanning = scanPhase && scanPhase !== "idle" && scanPhase !== "ready";
    const modeColor = mode === "build" ? theme.warn : theme.accent;
    const ctxStr = tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : String(tokens);
    const maxCtxStr = maxTokens >= 1000 ? `${(maxTokens / 1000).toFixed(0)}k` : String(maxTokens);
    let statusIcon;
    let statusColor;
    let statusLabel;
    if (isScanning) {
        statusIcon = ">";
        statusColor = theme.accent;
        statusLabel = `${scanPhase} ${scanScanned ?? 0}/${scanTotal ?? "?"}`;
    }
    else if (busy) {
        statusIcon = "*";
        statusColor = theme.warn;
        statusLabel = phase || "processing";
    }
    else if (phase === "error") {
        statusIcon = "x";
        statusColor = "#ff4444";
        statusLabel = "error";
    }
    else {
        statusIcon = ">";
        statusColor = theme.primary;
        statusLabel = "ready";
    }
    return (_jsxs(Box, { flexDirection: "row", width: width, height: 2, overflow: "hidden", children: [_jsx(Box, { width: gutter, height: 2, overflow: "hidden" }), _jsxs(Text, { backgroundColor: "black", children: [_jsx(Text, { color: statusColor, backgroundColor: "black", children: statusLabel }), _jsx(Text, { color: theme.dim, backgroundColor: "black", children: " | " }), _jsx(Text, { color: modeColor, backgroundColor: "black", children: mode }), _jsx(Text, { color: theme.dim, backgroundColor: "black", children: " | " }), _jsxs(Text, { color: theme.text, backgroundColor: "black", children: [filesTotal, " files"] }), dirtyFiles > 0 && _jsxs(Text, { color: theme.warn, backgroundColor: "black", children: [" ", dirtyFiles, " dirty"] }), _jsx(Text, { color: theme.dim, backgroundColor: "black", children: " | " }), _jsxs(Text, { color: theme.dim, backgroundColor: "black", children: ["ctx ", ctxStr, "/", maxCtxStr] }), _jsx(Text, { color: theme.dim, backgroundColor: "black", children: " | " }), _jsx(Text, { color: iColor, backgroundColor: "black", children: iName })] }), _jsx(Box, { flexGrow: 1, height: 2, overflow: "hidden" }), _jsx(Text, { color: theme.dim, backgroundColor: "black", children: busy ? phase : "idle" }), _jsx(Box, { width: gutter, height: 2, overflow: "hidden" })] }));
}
function BlackCanvas({ width, height }) {
    return (_jsx(Box, { flexDirection: "column", width: width, height: height, overflow: "hidden", children: Array.from({ length: Math.max(0, height) }, (_, i) => (_jsx(BlackLine, { width: width }, `black-canvas-${i}`))) }));
}
export function MainScreen(props) {
    const { stdout } = useStdout();
    const termRows = stdout.rows ?? 24;
    const termCols = stdout.columns ?? 80;
    // The outer border consumes two columns and two rows. Keep all manual padding/fill
    // inside that interior width so Ink never wraps into an extra terminal line.
    const frameInnerWidth = Math.max(1, termCols - 2);
    // Keep ContentArea bounded so it cannot push the footer past the viewport.
    const sidebarWidth = Math.min(22, Math.floor(termCols * 0.22));
    const contentWidth = frameInnerWidth - sidebarWidth - 2;
    const contentMaxWidth = Math.max(20, contentWidth - 4);
    const contentLines = Math.max(3, termRows - 14);
    const rainHeight = Math.max(1, termRows - 6);
    const popupWidth = Math.min(frameInnerWidth - 4, Math.max(40, Math.floor(frameInnerWidth * 0.55)));
    const aq = props.activeQuestion;
    const footer = fitLine("/help · Enter submit · Esc clear · ↑/↓ scroll · Ctrl+↑/↓ prompt history · PgUp/PgDn fast scroll · Ctrl+C quit", frameInnerWidth);
    return (_jsxs(Box, { position: "relative", flexDirection: "column", width: termCols, height: termRows, overflow: "hidden", children: [_jsx(Box, { position: "absolute", width: termCols, height: termRows, overflow: "hidden", children: _jsx(BlackCanvas, { width: termCols, height: termRows }) }), props.animations && (_jsx(Box, { position: "absolute", width: termCols, height: termRows, overflow: "hidden", children: _jsx(MatrixRain, { enabled: props.animations, maxRows: rainHeight }) })), _jsxs(Box, { flexDirection: "column", width: termCols, height: termRows, borderStyle: "round", borderColor: theme.primary, overflow: "hidden", children: [_jsx(Box, { flexShrink: 0, flexDirection: "column", overflow: "hidden", children: _jsx(Header, { root: props.root, model: props.model, ollamaReady: props.ollamaReady }) }), _jsxs(Box, { flexGrow: 1, flexShrink: 1, position: "relative", overflow: "hidden", flexDirection: "row", children: [_jsxs(Box, { flexGrow: 1, flexShrink: 1, position: "relative", overflow: "hidden", children: [_jsx(ContentArea, { output: props.output, logs: props.logs, packet: props.packet, answer: props.answer, patchText: props.patchText, busy: props.busy, scrollOffset: props.scrollOffset, maxLines: contentLines, maxWidth: contentMaxWidth, pendingPrompt: props.pendingPrompt, streamText: props.streamText, streamTokens: props.streamTokens, streamStartMs: props.streamStartMs, phase: props.phase, model: props.model, activeQuestion: props.activeQuestion, answerMetrics: props.answerMetrics }), aq && !props.busy && (() => {
                                        const cw = popupWidth - 2;
                                        const MAX_VISIBLE = Math.min(12, termRows - 10);
                                        let startIdx = Math.max(0, aq.selectedIndex - Math.floor(MAX_VISIBLE / 2));
                                        let endIdx = Math.min(aq.options.length, startIdx + MAX_VISIBLE);
                                        if (endIdx - startIdx < MAX_VISIBLE && startIdx > 0) {
                                            startIdx = Math.max(0, endIdx - MAX_VISIBLE);
                                        }
                                        return (_jsx(Box, { position: "absolute", width: "100%", height: "100%", alignItems: "center", justifyContent: "center", children: _jsxs(Box, { flexDirection: "column", width: popupWidth, borderStyle: "round", borderColor: theme.accent, children: [_jsx(Text, { bold: true, color: theme.accent, backgroundColor: "black", children: "  " + aq.question.padEnd(cw) }), _jsx(BlackLine, { width: cw }), startIdx > 0 && (_jsx(Text, { color: theme.dim, backgroundColor: "black", children: "  ↑ " + startIdx + " more..." })), aq.options.slice(startIdx, endIdx).map((opt, i) => {
                                                        const realIdx = startIdx + i;
                                                        return (_jsx(Text, { color: realIdx === aq.selectedIndex ? theme.accent : theme.dim, bold: realIdx === aq.selectedIndex, backgroundColor: "black", children: (realIdx === aq.selectedIndex ? "  → " : "    ") + opt.padEnd(cw - 4) }, realIdx));
                                                    }), endIdx < aq.options.length && (_jsx(Text, { color: theme.dim, backgroundColor: "black", children: "  ↓ " + (aq.options.length - endIdx) + " more..." })), _jsx(BlackLine, { width: cw }), _jsx(Text, { color: theme.dim, backgroundColor: "black", children: "  ↑/↓ · Enter · Esc".padEnd(cw) })] }) }));
                                    })(), props.textInputModal && !props.busy && (() => {
                                        const cw = popupWidth - 2;
                                        const val = props.textInputModalValue;
                                        const displayVal = val ? val.slice(-(cw - 6)) : "";
                                        return (_jsx(Box, { position: "absolute", width: "100%", height: "100%", alignItems: "center", justifyContent: "center", children: _jsxs(Box, { flexDirection: "column", width: popupWidth, borderStyle: "round", borderColor: theme.accent, children: [_jsx(Text, { bold: true, color: theme.accent, backgroundColor: "black", children: "  " + props.textInputModal.prompt.padEnd(cw - 2) }), _jsx(BlackLine, { width: popupWidth - 2 }), _jsxs(Box, { flexDirection: "row", children: [_jsxs(Text, { color: theme.accent, backgroundColor: "black", children: ["  ", "> "] }), _jsx(Text, { backgroundColor: "black", children: displayVal }), _jsx(Text, { color: theme.accent, backgroundColor: "black", children: "\u258A" })] }), _jsx(BlackLine, { width: popupWidth - 2 }), _jsx(Text, { color: theme.dim, backgroundColor: "black", children: "  Enter · Esc to cancel".padEnd(cw - 2) })] }) }));
                                    })()] }), _jsx(Box, { width: sidebarWidth, flexDirection: "column", overflow: "hidden", borderStyle: "single", borderColor: theme.border, borderLeft: false, borderRight: false, borderTop: false, borderBottom: false, children: _jsx(InfoPanel, { root: props.root, model: props.model, packet: props.packet, maxTokens: props.maxTokens, ollamaReady: props.ollamaReady, filesTotal: props.filesTotal, maxLines: contentLines }) })] }), props.autocomplete && props.autocomplete.suggestions.length >= 1 && !props.busy && (_jsxs(Box, { flexShrink: 0, flexDirection: "row", width: frameInnerWidth, overflow: "hidden", children: [_jsx(Box, { width: 2 }), _jsx(Box, { flexDirection: "column", borderStyle: "single", borderColor: theme.border, children: props.autocomplete.suggestions.slice(0, Math.min(8, props.autocomplete.suggestions.length)).map((s, i) => {
                                    const isSel = i === props.autocompleteIndex;
                                    return (_jsx(Box, { flexDirection: "row", children: _jsx(Text, { backgroundColor: "black", children: _jsxs(Text, { color: isSel ? theme.accent : "#1a3a1a", bold: isSel, backgroundColor: "black", children: [isSel ? "▸ " : "  ", s] }) }) }, i));
                                }) }), _jsx(Box, { width: 2 })] })), _jsx(Box, { flexShrink: 0, flexDirection: "column", width: frameInnerWidth, overflow: "hidden", children: _jsx(PromptBar, { input: props.input, busy: props.busy, mode: props.mode, width: frameInnerWidth, setupPrompt: props.setupPrompt, autocomplete: props.autocomplete, autocompleteIndex: props.autocompleteIndex }) }), _jsx(Box, { flexShrink: 0, overflow: "hidden", children: _jsx(MainStatusLine, { filesTotal: props.filesTotal, dirtyFiles: props.dirtyFiles, tokens: props.packet?.estimatedTokens ?? 0, maxTokens: props.maxTokens, busy: props.busy, mode: props.mode, intent: props.intent, width: frameInnerWidth, phase: props.phase, scanPhase: props.scanPhase, scanProgress: props.scanProgress, scanScanned: props.scanScanned, scanTotal: props.scanTotal }) }), _jsx(Box, { flexShrink: 0, overflow: "hidden", children: _jsxs(Box, { flexDirection: "row", width: frameInnerWidth, height: 2, overflow: "hidden", children: [_jsx(Box, { width: 2, height: 2, overflow: "hidden" }), _jsx(Text, { color: theme.dim, backgroundColor: "black", children: footer }), _jsx(Box, { flexGrow: 1, height: 2, overflow: "hidden" }), _jsx(Box, { width: 2, height: 2, overflow: "hidden" })] }) })] })] }));
}
