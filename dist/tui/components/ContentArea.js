import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import React from "react";
import { Box, Text } from "ink";
import { theme } from "../theme.js";
function lineColor(line) {
    if (line.startsWith("+") && !line.startsWith("+++"))
        return "green";
    if (line.startsWith("-") && !line.startsWith("---"))
        return "red";
    if (line.startsWith("@@"))
        return "cyan";
    if (line.startsWith("diff ") || line.startsWith("+++") || line.startsWith("---"))
        return "yellow";
    return theme.dim;
}
function outputLineColor(line, busy, isLastPrompt) {
    if (line.startsWith("error:"))
        return "red";
    if (line.startsWith("✓") || line.includes(" PASS "))
        return "green";
    if (line.includes(" FAIL "))
        return "red";
    if (line.startsWith("⌘ "))
        return "cyan";
    if (line.startsWith("▶ ")) {
        if (busy && isLastPrompt)
            return "yellow";
        return theme.accent;
    }
    if (line.startsWith("AI:"))
        return theme.primary;
    if (line.startsWith("↻") || line.startsWith("↶"))
        return "yellow";
    if (line.startsWith("Active model:") || line.startsWith("* "))
        return "magenta";
    return "white";
}
const BG = "black";
function normalizeInlineMd(line) {
    return line
        .replace(/`([^`]+)`/g, "$1")
        .replace(/\*\*([^*]+)\*\*/g, "$1")
        .replace(/__([^_]+)__/g, "$1")
        .replace(/\*([^*]+)\*/g, "$1")
        .replace(/_([^_]+)_/g, "$1")
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)");
}
function markdownLines(markdown) {
    const lines = markdown.split("\n");
    const out = [];
    let inFence = false;
    for (const raw of lines) {
        const line = raw ?? "";
        if (/^\s*```/.test(line)) {
            inFence = !inFence;
            out.push({ text: inFence ? "┌ code" : "└ end", color: theme.dim, dimColor: true });
            continue;
        }
        if (inFence) {
            out.push({ text: `  ${line}`, color: "yellow" });
            continue;
        }
        if (/^\s*#{1,6}\s+/.test(line)) {
            const text = normalizeInlineMd(line.replace(/^\s*#{1,6}\s+/, ""));
            out.push({ text, color: theme.accent, bold: true });
            continue;
        }
        if (/^\s*>\s?/.test(line)) {
            out.push({ text: `│ ${normalizeInlineMd(line.replace(/^\s*>\s?/, ""))}`, color: theme.dim, dimColor: true });
            continue;
        }
        if (/^\s*([-*+]\s+|\d+\.\s+)/.test(line)) {
            const text = normalizeInlineMd(line.replace(/^\s*([-*+]\s+|\d+\.\s+)/, "• "));
            out.push({ text, color: theme.text });
            continue;
        }
        if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
            out.push({ text: "─".repeat(28), color: theme.dim, dimColor: true });
            continue;
        }
        out.push({ text: normalizeInlineMd(line), color: "white" });
    }
    return out;
}
function wrapLine(text, width) {
    const max = Math.max(12, width);
    if (!text)
        return [""];
    if (text.length <= max)
        return [text];
    const out = [];
    let rest = text;
    while (rest.length > max) {
        const chunk = rest.slice(0, max + 1);
        let cut = chunk.lastIndexOf(" ");
        if (cut < Math.floor(max * 0.45)) {
            const nextSpace = rest.indexOf(" ", max);
            if (nextSpace > 0) {
                cut = nextSpace;
            }
            else {
                out.push(rest);
                rest = "";
                break;
            }
        }
        out.push(rest.slice(0, cut).trimEnd());
        rest = rest.slice(cut).trimStart();
    }
    if (rest.length)
        out.push(rest);
    return out;
}
function wrapDisplayLines(lines, width) {
    const out = [];
    for (const line of lines) {
        for (const wrapped of wrapLine(line.text, width)) {
            out.push({ ...line, text: wrapped });
        }
    }
    return out;
}
function wrapPlainLines(lines, width) {
    const out = [];
    for (const line of lines)
        out.push(...wrapLine(line, width));
    return out;
}
export const ContentArea = React.memo(function ContentArea({ output, logs, packet, answer, patchText, busy, scrollOffset, maxLines, maxWidth, pendingPrompt, }) {
    const windowLines = (lines, overrideMax) => {
        const safeMax = Math.max(3, overrideMax ?? maxLines);
        const maxOffset = Math.max(0, lines.length - safeMax);
        const offset = Math.min(scrollOffset, maxOffset);
        const end = Math.max(0, lines.length - offset);
        const start = Math.max(0, end - safeMax);
        return {
            visible: lines.slice(start, end),
            hasOlder: start > 0,
            hasNewer: end < lines.length
        };
    };
    const truncate = (line) => {
        const width = Math.max(20, maxWidth);
        return line.length > width ? `${line.slice(0, width - 1)}…` : line;
    };
    const answerDisplay = wrapDisplayLines(markdownLines(answer), maxWidth);
    const patchLines = wrapPlainLines(patchText.split("\n"), maxWidth);
    // Reserve 2 rows for the pinned pending-prompt row when it is active
    const pendingRows = pendingPrompt ? 2 : 0;
    const historyMaxLines = Math.max(2, maxLines - pendingRows);
    const parseBubbles = (lines) => {
        const bubbles = [];
        let cur = null;
        const push = () => {
            if (!cur || cur.lines.length === 0)
                return;
            bubbles.push(cur);
            cur = null;
        };
        for (const raw of lines) {
            if (raw.startsWith("▶ ")) {
                push();
                cur = { role: "user", lines: [raw.slice(2)] };
                continue;
            }
            if (raw.startsWith("AI: ")) {
                push();
                cur = { role: "assistant", lines: [raw.slice(4)] };
                continue;
            }
            if (raw.startsWith("PATCH: ")) {
                push();
                cur = { role: "patch", lines: [raw.slice(7)] };
                continue;
            }
            if (raw.startsWith("⌘ ")) {
                push();
                cur = { role: "system", lines: [raw.slice(2)] };
                continue;
            }
            if (raw.startsWith("error:")) {
                push();
                cur = { role: "info", lines: [raw] };
                continue;
            }
            if (raw.startsWith("  ") && cur) {
                cur.lines.push(raw.trimStart());
                continue;
            }
            if (!cur) {
                cur = { role: "info", lines: [raw] };
            }
            else {
                cur.lines.push(raw);
            }
        }
        push();
        return bubbles;
    };
    const bubbleStyle = (role) => {
        if (role === "user")
            return { label: "You", labelColor: theme.accent, text: "#c8ffd8", bg: "#0b3d23", border: theme.accent };
        if (role === "assistant")
            return { label: "Smith", labelColor: theme.primary, text: "white", bg: "#1a1a1a", border: theme.primary };
        if (role === "patch")
            return { label: "Patch", labelColor: "magenta", text: "#f3d1ff", bg: "#2a1038", border: "magenta" };
        if (role === "system")
            return { label: "System", labelColor: "cyan", text: theme.dim, bg: "#111827", border: "cyan" };
        return { label: "Info", labelColor: "yellow", text: "white", bg: "#2a220f", border: "yellow" };
    };
    const buildBubbleRows = (bubbles) => {
        return bubbles.flatMap((b, i) => {
            const style = bubbleStyle(b.role);
            const head = ` ${style.label} `;
            const content = b.lines.flatMap((ln) => wrapLine(ln, Math.max(20, maxWidth - 6)));
            const bodyWidth = Math.max(head.length, ...content.map((ln) => ln.length));
            const paddedHead = head.padEnd(bodyWidth, " ");
            const paddedContent = content.map((ln) => ln.padEnd(bodyWidth, " "));
            return [
                {
                    id: `b-${i}-h`,
                    kind: "HEAD",
                    text: paddedHead,
                    labelColor: style.labelColor,
                    bodyColor: style.text,
                    bg: style.bg,
                    border: style.border,
                },
                ...paddedContent.map((ln, lineIndex) => ({
                    id: `b-${i}-l-${lineIndex}`,
                    kind: "BODY",
                    text: ln,
                    labelColor: style.labelColor,
                    bodyColor: style.text,
                    bg: style.bg,
                    border: style.border,
                })),
            ];
        });
    };
    const historyRows = React.useMemo(() => buildBubbleRows(parseBubbles(output)), [output, maxWidth]);
    if (output.length > 0 || pendingPrompt) {
        const win = windowLines(historyRows, historyMaxLines);
        return (_jsxs(Box, { flexDirection: "column", paddingX: 1, children: [_jsx(Text, { color: theme.primary, backgroundColor: BG, children: "History" }), _jsx(Text, { color: theme.dim, backgroundColor: BG, children: "─".repeat(40) }), win.hasOlder && _jsx(Text, { color: theme.dim, backgroundColor: BG, children: "\u2191 older messages" }), win.visible.map((row) => {
                    if (row.kind === "HEAD") {
                        return (_jsxs(Text, { backgroundColor: row.bg, color: row.labelColor, bold: true, children: [_jsx(Text, { color: row.border, backgroundColor: row.bg, children: "\u250C " }), row.text, _jsx(Text, { color: row.border, backgroundColor: row.bg, children: " \u2510" })] }, row.id));
                    }
                    return (_jsxs(Text, { backgroundColor: row.bg, color: row.bodyColor, children: [_jsx(Text, { color: row.border, backgroundColor: row.bg, children: "\u2502 " }), row.text, _jsx(Text, { color: row.border, backgroundColor: row.bg, children: " \u2502" })] }, row.id));
                }), win.hasNewer && _jsx(Text, { color: theme.dim, backgroundColor: BG, children: "\u2193 newer messages" }), pendingPrompt && (_jsxs(_Fragment, { children: [_jsx(Text, { color: theme.dim, backgroundColor: BG, children: "─".repeat(40) }), _jsxs(Text, { backgroundColor: "#002800", children: [_jsx(Text, { color: "#00ff44", bold: true, backgroundColor: "#002800", children: "┃ ▶ " }), _jsx(Text, { color: "#00ff44", bold: true, backgroundColor: "#002800", children: pendingPrompt }), _jsx(Text, { color: "#00ff44", backgroundColor: "#002800", children: " ⟳" })] })] }))] }));
    }
    if (patchText) {
        const win = windowLines(patchLines);
        return (_jsxs(Box, { flexDirection: "column", paddingX: 1, children: [_jsx(Text, { color: theme.primary, backgroundColor: BG, children: "Patch" }), _jsx(Text, { color: theme.dim, backgroundColor: BG, children: "─".repeat(40) }), win.hasOlder && _jsx(Text, { color: theme.dim, backgroundColor: BG, children: "\u2191 older lines" }), win.visible.map((line, i) => (_jsx(Text, { color: lineColor(line), backgroundColor: BG, children: truncate(line) }, i))), win.hasNewer && _jsx(Text, { color: theme.dim, backgroundColor: BG, children: "\u2193 newer lines" })] }));
    }
    if (answer) {
        const win = windowLines(answerDisplay.map((l) => l.text));
        const safeMax = Math.max(3, maxLines);
        const maxOffset = Math.max(0, answerDisplay.length - safeMax);
        const offset = Math.min(scrollOffset, maxOffset);
        const end = Math.max(0, answerDisplay.length - offset);
        const start = Math.max(0, end - safeMax);
        const visible = answerDisplay.slice(start, end);
        return (_jsxs(Box, { flexDirection: "column", paddingX: 1, children: [_jsx(Text, { color: theme.primary, backgroundColor: BG, children: "Answer" }), _jsx(Text, { color: theme.dim, backgroundColor: BG, children: "─".repeat(40) }), win.hasOlder && _jsx(Text, { color: theme.dim, backgroundColor: BG, children: "\u2191 older lines" }), visible.map((line, i) => (_jsx(Text, { color: line.color ?? "white", bold: line.bold, dimColor: line.dimColor, backgroundColor: BG, children: line.text }, i))), win.hasNewer && _jsx(Text, { color: theme.dim, backgroundColor: BG, children: "\u2193 newer lines" })] }));
    }
    if (packet) {
        return (_jsxs(Box, { flexDirection: "column", paddingX: 1, children: [_jsxs(Text, { color: theme.accent, backgroundColor: BG, children: ["Context \u00B7 ~", packet.estimatedTokens, " tokens \u00B7 ", packet.files.length, " files"] }), _jsx(Text, { color: theme.dim, backgroundColor: BG, children: "─".repeat(40) }), packet.files.slice(0, Math.max(3, maxLines - 6)).map((f, i) => (_jsxs(Text, { color: theme.text, backgroundColor: BG, children: ["\u00B7 ", truncate(f.path)] }, i))), packet.symbols.slice(0, 5).map((s, i) => (_jsxs(Text, { color: theme.dim, backgroundColor: BG, children: ["\u25C7 ", s.kind, " ", s.name] }, `s-${i}`)))] }));
    }
    if (logs.length > 0) {
        return (_jsx(Box, { flexDirection: "column", paddingX: 1, children: wrapPlainLines(logs.slice(0, 4), maxWidth).map((line, i) => (_jsx(Text, { color: theme.dim, backgroundColor: BG, children: line }, i))) }));
    }
    return (_jsx(Box, { flexGrow: 1, alignItems: "center", justifyContent: "center", flexDirection: "column", children: _jsxs(Box, { flexDirection: "column", alignItems: "center", children: [_jsx(Text, { color: theme.primary, backgroundColor: "#001a00", children: "\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557" }), _jsx(Text, { color: theme.primary, backgroundColor: "#001a00", children: "\u2551                        \u2551" }), _jsx(Text, { color: theme.primary, backgroundColor: "#001a00", bold: true, children: "\u2551      Agent Smith       \u2551" }), _jsx(Text, { color: theme.primary, backgroundColor: "#001a00", children: "\u2551                        \u2551" }), _jsx(Text, { color: theme.primary, backgroundColor: "#001a00", children: "\u255A\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255D" })] }) }));
});
