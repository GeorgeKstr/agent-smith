import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Box, Text, useInput } from "ink";
import { theme } from "../theme.js";
function blackBg(width, c) {
    return _jsx(Text, { backgroundColor: "black", children: " ".repeat(Math.max(0, width)) });
}
export function ContextPreview(props) {
    useInput((_char, key) => {
        if (key.escape || (key.ctrl && _char === "c")) {
            props.onBack();
        }
    });
    const pkt = props.packet;
    if (!pkt) {
        return (_jsxs(Box, { flexDirection: "column", padding: 1, children: [_jsxs(Box, { flexDirection: "row", justifyContent: "space-between", children: [_jsx(Text, { bold: true, color: theme.accent, backgroundColor: "black", children: "Context Preview" }), _jsx(Text, { color: theme.dim, backgroundColor: "black", children: "Esc/^C to go back" })] }), _jsx(Box, { height: 1 }), _jsx(Text, { color: theme.dim, backgroundColor: "black", children: "No context packet available. Run a task first." })] }));
    }
    const files = pkt.files ?? [];
    const symbols = pkt.symbols ?? [];
    const pct = props.maxTokens > 0 ? Math.round((pkt.estimatedTokens / props.maxTokens) * 100) : 0;
    return (_jsxs(Box, { flexDirection: "column", padding: 1, children: [_jsxs(Box, { flexDirection: "row", justifyContent: "space-between", children: [_jsx(Text, { bold: true, color: theme.accent, backgroundColor: "black", children: "Context Preview" }), _jsx(Text, { color: theme.dim, backgroundColor: "black", children: "Esc/^C to go back" })] }), _jsx(Box, { height: 1 }), _jsx(Text, { color: theme.dim, backgroundColor: "black", children: "Task" }), _jsx(Text, { color: theme.text, backgroundColor: "black", children: (pkt.task || "(none)").slice(0, 200) }), _jsx(Box, { height: 1 }), _jsxs(Box, { flexDirection: "row", children: [_jsx(Text, { color: theme.dim, backgroundColor: "black", children: "Tokens: " }), _jsx(Text, { color: pct > 80 ? theme.warn : theme.accent, backgroundColor: "black", children: pkt.estimatedTokens >= 1000 ? (pkt.estimatedTokens / 1000).toFixed(1) + "k" : String(pkt.estimatedTokens) }), _jsxs(Text, { color: theme.dim, backgroundColor: "black", children: [" / ", props.maxTokens >= 1000 ? (props.maxTokens / 1000).toFixed(0) + "k" : String(props.maxTokens), " (", pct, "%)"] })] }), _jsx(Box, { height: 1 }), _jsxs(Text, { color: theme.dim, backgroundColor: "black", children: ["Files (", files.length, ")"] }), files.length === 0 ? (_jsx(Text, { color: theme.dim, backgroundColor: "black", children: "  (none)" })) : (files.slice(0, 20).map((f, i) => (_jsxs(Box, { flexDirection: "row", children: [_jsxs(Text, { color: theme.dim, backgroundColor: "black", children: [String(i + 1).padStart(2), ". "] }), _jsx(Text, { color: theme.accent, backgroundColor: "black", children: f.path }), _jsxs(Text, { color: theme.dim, backgroundColor: "black", children: [" (", f.reason, ")"] })] }, i)))), _jsx(Box, { height: 1 }), _jsxs(Text, { color: theme.dim, backgroundColor: "black", children: ["Symbols (", symbols.length, ")"] }), symbols.length === 0 ? (_jsx(Text, { color: theme.dim, backgroundColor: "black", children: "  (none)" })) : (symbols.slice(0, 20).map((s, i) => (_jsxs(Box, { flexDirection: "row", children: [_jsxs(Text, { color: theme.dim, backgroundColor: "black", children: [String(i + 1).padStart(2), ". "] }), _jsx(Text, { color: theme.accent, backgroundColor: "black", children: s.name }), _jsxs(Text, { color: theme.dim, backgroundColor: "black", children: [" @ ", s.path, " (", s.kind, ")"] })] }, i)))), _jsx(Box, { height: 1 }), _jsx(Text, { color: theme.dim, backgroundColor: "black", children: "Prompt (first 2000 chars)" }), _jsx(Text, { color: theme.text, backgroundColor: "black", children: (pkt.prompt || "").slice(0, 2000) })] }));
}
