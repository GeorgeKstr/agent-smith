import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Box, Text } from "ink";
import { theme } from "../theme.js";
const BG = "black";
const PANE_CONTENT_ROWS = 3; // lines of streaming text shown
export const LIVE_PANE_ROWS = PANE_CONTENT_ROWS + 2; // +1 header +1 divider
function fmtElapsed(startMs) {
    const s = Math.max(0, (Date.now() - startMs) / 1000);
    if (s < 60)
        return `${s.toFixed(1)}s`;
    return `${Math.floor(s / 60)}m${Math.floor(s % 60)}s`;
}
function fmtTps(tokens, startMs) {
    const s = Math.max(0.1, (Date.now() - startMs) / 1000);
    const tps = tokens / s;
    return `${tps.toFixed(1)} t/s`;
}
function lastLines(text, n, width) {
    if (!text)
        return [];
    // Split to raw lines, hard-wrap long lines, take last n
    const maxW = Math.max(20, width - 4);
    const raw = text.split("\n");
    const wrapped = [];
    for (const line of raw) {
        if (!line) {
            wrapped.push("");
            continue;
        }
        let rest = line;
        while (rest.length > maxW) {
            wrapped.push(rest.slice(0, maxW));
            rest = rest.slice(maxW);
        }
        wrapped.push(rest);
    }
    return wrapped.slice(-n);
}
export function LiveOutputPane({ text, tokens, startMs, model, phase, width, }) {
    const contentWidth = Math.max(20, width - 4);
    const displayLines = lastLines(text, PANE_CONTENT_ROWS, width);
    const modelShort = model.length > 22 ? model.slice(0, 21) + "…" : model;
    const metricsParts = [
        phase ? `⟳ ${phase}` : "⟳",
        modelShort,
        tokens > 0 ? `${tokens} tok` : "",
        tokens > 0 && startMs > 0 ? fmtTps(tokens, startMs) : "",
        startMs > 0 ? fmtElapsed(startMs) : "",
    ].filter(Boolean);
    const metricsStr = metricsParts.join("  ·  ");
    const metricsDisplay = metricsStr.length > contentWidth
        ? metricsStr.slice(0, contentWidth - 1) + "…"
        : metricsStr;
    const divider = "─".repeat(Math.max(0, width - 4));
    return (_jsxs(Box, { flexDirection: "column", width: width, overflow: "hidden", children: [_jsx(Box, { flexDirection: "row", paddingX: 2, children: _jsx(Text, { color: theme.accent, bold: true, backgroundColor: BG, children: metricsDisplay }) }), _jsx(Box, { paddingX: 2, children: _jsx(Text, { color: theme.dim, backgroundColor: BG, children: divider }) }), Array.from({ length: PANE_CONTENT_ROWS }, (_, i) => {
                const line = displayLines[displayLines.length - PANE_CONTENT_ROWS + i] ?? "";
                const isCursor = i === PANE_CONTENT_ROWS - 1;
                return (_jsx(Box, { paddingX: 2, width: width, overflow: "hidden", children: _jsxs(Text, { color: "white", backgroundColor: BG, children: [line, isCursor && text ? _jsx(Text, { color: theme.accent, backgroundColor: BG, children: "\u258A" }) : null] }) }, i));
            })] }));
}
