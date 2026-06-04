import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
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
const BG = "black";
export function ContentArea({ output, logs, packet, answer, patchText, busy, scrollOffset, maxLines, maxWidth, }) {
    const windowLines = (lines) => {
        const safeMax = Math.max(3, maxLines);
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
    const answerLines = answer.split("\n");
    const patchLines = patchText.split("\n");
    if (patchText) {
        const win = windowLines(patchLines);
        return (_jsxs(Box, { flexDirection: "column", paddingX: 1, children: [_jsx(Text, { color: theme.primary, backgroundColor: BG, children: "Patch" }), _jsx(Text, { color: theme.dim, backgroundColor: BG, children: "─".repeat(40) }), win.hasOlder && _jsx(Text, { color: theme.dim, backgroundColor: BG, children: "\u2191 older lines" }), win.visible.map((line, i) => (_jsx(Text, { color: lineColor(line), backgroundColor: BG, children: truncate(line) }, i))), win.hasNewer && _jsx(Text, { color: theme.dim, backgroundColor: BG, children: "\u2193 newer lines" })] }));
    }
    if (answer) {
        const win = windowLines(answerLines);
        return (_jsxs(Box, { flexDirection: "column", paddingX: 1, children: [_jsx(Text, { color: theme.primary, backgroundColor: BG, children: "Answer" }), _jsx(Text, { color: theme.dim, backgroundColor: BG, children: "─".repeat(40) }), win.hasOlder && _jsx(Text, { color: theme.dim, backgroundColor: BG, children: "\u2191 older lines" }), win.visible.map((line, i) => (_jsx(Text, { color: "white", backgroundColor: BG, children: truncate(line) }, i))), win.hasNewer && _jsx(Text, { color: theme.dim, backgroundColor: BG, children: "\u2193 newer lines" })] }));
    }
    if (packet) {
        return (_jsxs(Box, { flexDirection: "column", paddingX: 1, children: [_jsxs(Text, { color: theme.accent, backgroundColor: BG, children: ["Context \u00B7 ~", packet.estimatedTokens, " tokens \u00B7 ", packet.files.length, " files"] }), _jsx(Text, { color: theme.dim, backgroundColor: BG, children: "─".repeat(40) }), packet.files.slice(0, Math.max(3, maxLines - 6)).map((f, i) => (_jsxs(Text, { color: theme.text, backgroundColor: BG, children: ["\u00B7 ", truncate(f.path)] }, i))), packet.symbols.slice(0, 5).map((s, i) => (_jsxs(Text, { color: theme.dim, backgroundColor: BG, children: ["\u25C7 ", s.kind, " ", s.name] }, `s-${i}`)))] }));
    }
    if (output.length > 0) {
        const win = windowLines(output);
        return (_jsxs(Box, { flexDirection: "column", paddingX: 1, children: [win.hasOlder && _jsx(Text, { color: theme.dim, backgroundColor: BG, children: "\u2191 older messages" }), win.visible.map((line, i) => (_jsx(Text, { color: "white", backgroundColor: BG, children: truncate(line) }, i))), win.hasNewer && _jsx(Text, { color: theme.dim, backgroundColor: BG, children: "\u2193 newer messages" })] }));
    }
    if (logs.length > 0) {
        return (_jsx(Box, { flexDirection: "column", paddingX: 1, children: logs.slice(0, 4).map((line, i) => (_jsx(Text, { color: theme.dim, backgroundColor: BG, children: truncate(line) }, i))) }));
    }
    return (_jsx(Box, { flexGrow: 1, alignItems: "center", justifyContent: "center", flexDirection: "column", children: _jsxs(Box, { flexDirection: "column", alignItems: "center", children: [_jsx(Text, { color: theme.primary, backgroundColor: "#001a00", children: "\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557" }), _jsx(Text, { color: theme.primary, backgroundColor: "#001a00", children: "\u2551                        \u2551" }), _jsx(Text, { color: theme.primary, backgroundColor: "#001a00", bold: true, children: "\u2551      Agent Smith       \u2551" }), _jsx(Text, { color: theme.primary, backgroundColor: "#001a00", children: "\u2551                        \u2551" }), _jsx(Text, { color: theme.primary, backgroundColor: "#001a00", children: "\u255A\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255D" })] }) }));
}
