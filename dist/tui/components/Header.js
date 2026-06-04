import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Box, Text } from "ink";
export function Header({ root, model, ollamaReady }) {
    const led = ollamaReady === null ? "yellow" : ollamaReady ? "green" : "red";
    const ledText = ollamaReady === null ? "checking" : ollamaReady ? "online" : "offline";
    return (_jsxs(Box, { borderStyle: "round", borderColor: "green", paddingX: 1, justifyContent: "space-between", children: [_jsx(Text, { color: "greenBright", children: "\u2593\u2592\u2591 AGENT SMITH \u2591\u2592\u2593" }), _jsx(Text, { color: "gray", children: root }), _jsx(Text, { color: "cyan", children: model }), _jsxs(Text, { color: led, children: ["\u25CF ollama:", ledText] })] }));
}
