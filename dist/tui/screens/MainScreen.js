import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Box, Text, useStdout } from "ink";
import { theme } from "../theme.js";
import { Header } from "../components/Header.js";
import { ContentArea } from "../components/ContentArea.js";
import { MatrixRain } from "../components/MatrixRain.js";
import { LiveOutputPane, LIVE_PANE_ROWS } from "../components/LiveOutputPane.js";
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
function PromptBar({ input, busy, mode, width, }) {
    const gutter = 2;
    const barWidth = Math.max(8, width - gutter * 2);
    const fieldInnerWidth = Math.max(1, barWidth - 2);
    const modeTag = `[${mode.toUpperCase()}]`;
    const modeColor = mode === "build" ? theme.warn : theme.accent;
    const leftRaw = `${busy ? "..." : ">"} ${input}`;
    const maxLeft = Math.max(1, fieldInnerWidth - modeTag.length - 1);
    const left = leftRaw.length > maxLeft ? leftRaw.slice(0, Math.max(0, maxLeft - 1)) + "..." : leftRaw;
    const gap = Math.max(0, fieldInnerWidth - left.length - modeTag.length);
    return (_jsxs(Box, { flexDirection: "row", width: width, height: 3, overflow: "hidden", children: [_jsx(Box, { width: gutter, height: 3, overflow: "hidden" }), _jsx(Box, { width: barWidth, height: 3, borderStyle: "round", borderColor: mode === "build" ? theme.warn : theme.accent, overflow: "hidden", children: _jsxs(Text, { backgroundColor: "#002200", children: [_jsx(Text, { color: theme.text, backgroundColor: "#002200", children: left }), gap > 0 && _jsx(Text, { backgroundColor: "#002200", children: " ".repeat(gap) }), _jsx(Text, { color: modeColor, bold: true, backgroundColor: "#002200", children: modeTag })] }) }), _jsx(Box, { width: gutter, height: 3, overflow: "hidden" })] }));
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
    const contentMaxWidth = Math.max(20, frameInnerWidth - 4);
    // Fixed chrome, roughly: border + header + input + status + footer.
    // When busy, reserve rows for the live output pane above history.
    // Keep ContentArea bounded so it cannot push the footer past the viewport.
    const livePaneRows = props.busy ? LIVE_PANE_ROWS : 0;
    const contentLines = Math.max(3, termRows - 14 - livePaneRows);
    const rainHeight = Math.max(1, termRows - 6);
    const footer = fitLine("/help · Enter submit · Esc clear · ↑/↓ scroll · Ctrl+↑/↓ prompt history · PgUp/PgDn fast scroll · Ctrl+C quit", frameInnerWidth);
    return (_jsxs(Box, { position: "relative", flexDirection: "column", width: termCols, height: termRows, overflow: "hidden", children: [_jsx(Box, { position: "absolute", width: termCols, height: termRows, overflow: "hidden", children: _jsx(BlackCanvas, { width: termCols, height: termRows }) }), props.animations && (_jsx(Box, { position: "absolute", width: termCols, height: termRows, overflow: "hidden", children: _jsx(MatrixRain, { enabled: props.animations, maxRows: rainHeight }) })), _jsxs(Box, { flexDirection: "column", width: termCols, height: termRows, borderStyle: "round", borderColor: theme.primary, overflow: "hidden", children: [_jsx(Box, { flexShrink: 0, flexDirection: "column", overflow: "hidden", children: _jsx(Header, { root: props.root, model: props.model, ollamaReady: props.ollamaReady }) }), _jsxs(Box, { flexGrow: 1, flexShrink: 1, flexDirection: "column", overflow: "hidden", children: [props.busy && (_jsx(Box, { flexShrink: 0, flexDirection: "column", height: LIVE_PANE_ROWS, width: frameInnerWidth, overflow: "hidden", children: _jsx(LiveOutputPane, { text: props.streamText, tokens: props.streamTokens, startMs: props.streamStartMs, model: props.model, phase: props.phase, width: frameInnerWidth }) })), _jsx(ContentArea, { output: props.output, logs: props.logs, packet: props.packet, answer: props.answer, patchText: props.patchText, busy: props.busy, scrollOffset: props.scrollOffset, maxLines: contentLines, maxWidth: contentMaxWidth, pendingPrompt: props.pendingPrompt })] }), _jsx(Box, { flexShrink: 0, flexDirection: "column", width: frameInnerWidth, overflow: "hidden", children: _jsx(PromptBar, { input: props.input, busy: props.busy, mode: props.mode, width: frameInnerWidth }) }), _jsx(Box, { flexShrink: 0, overflow: "hidden", children: _jsx(MainStatusLine, { filesTotal: props.filesTotal, dirtyFiles: props.dirtyFiles, tokens: props.packet?.estimatedTokens ?? 0, maxTokens: props.maxTokens, busy: props.busy, mode: props.mode, intent: props.intent, width: frameInnerWidth, phase: props.phase, scanPhase: props.scanPhase, scanProgress: props.scanProgress, scanScanned: props.scanScanned, scanTotal: props.scanTotal }) }), _jsx(Box, { flexShrink: 0, overflow: "hidden", children: _jsxs(Box, { flexDirection: "row", width: frameInnerWidth, height: 2, overflow: "hidden", children: [_jsx(Box, { width: 2, height: 2, overflow: "hidden" }), _jsx(Text, { color: theme.dim, backgroundColor: "black", children: footer }), _jsx(Box, { flexGrow: 1, height: 2, overflow: "hidden" }), _jsx(Box, { width: 2, height: 2, overflow: "hidden" })] }) })] })] }));
}
