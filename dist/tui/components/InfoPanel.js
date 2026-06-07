import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Box, Text } from "ink";
import { theme } from "../theme.js";
function label(text) {
    return text.length > 16 ? text.slice(0, 15) + "…" : text;
}
function progressBar(used, max, width) {
    if (max <= 0)
        return "";
    const pct = Math.min(1, used / max);
    const filled = Math.round(pct * width);
    const bar = "█".repeat(filled) + "░".repeat(width - filled);
    return bar;
}
export function InfoPanel(props) {
    const project = props.root.split("/").pop()?.slice(0, 16) ?? "?";
    const modelLabel = label(props.model);
    const online = props.ollamaReady === true ? "● online" : props.ollamaReady === false ? "○ offline" : "… checking";
    const onlineColor = props.ollamaReady === true ? theme.accent : props.ollamaReady === false ? theme.error : theme.dim;
    const tokens = props.packet?.estimatedTokens ?? 0;
    const pct = props.maxTokens > 0 ? Math.round((tokens / props.maxTokens) * 100) : 0;
    const bar = progressBar(tokens, props.maxTokens, 14);
    const providerColor = props.ollamaReady ? theme.accent : theme.dim;
    return (_jsxs(Box, { flexDirection: "column", paddingLeft: 1, overflow: "hidden", children: [_jsx(Box, { height: 1 }), _jsx(Text, { bold: true, color: theme.accent, backgroundColor: "black", children: "Project" }), _jsx(Text, { color: theme.text, backgroundColor: "black", children: project }), _jsx(Box, { height: 1 }), _jsx(Text, { color: theme.dim, backgroundColor: "black", children: "Model" }), _jsx(Text, { color: theme.text, backgroundColor: "black", children: modelLabel }), _jsx(Box, { height: 1 }), _jsx(Text, { color: theme.dim, backgroundColor: "black", children: "Provider" }), _jsx(Text, { color: onlineColor, backgroundColor: "black", children: online }), _jsx(Box, { height: 1 }), _jsx(Text, { color: theme.dim, backgroundColor: "black", children: "Files" }), _jsx(Text, { color: theme.text, backgroundColor: "black", children: String(props.filesTotal) }), _jsx(Box, { height: 1 }), _jsx(Text, { color: theme.dim, backgroundColor: "black", children: "Context" }), _jsxs(Text, { color: theme.text, backgroundColor: "black", children: [tokens >= 1000 ? (tokens / 1000).toFixed(1) + "k" : String(tokens), "/", props.maxTokens >= 1000 ? (props.maxTokens / 1000).toFixed(0) + "k" : String(props.maxTokens)] }), _jsxs(Text, { color: pct > 80 ? theme.warn : pct > 95 ? theme.error : theme.accent, backgroundColor: "black", children: [bar, " ", pct, "%"] })] }));
}
