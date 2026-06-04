import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Box, Text } from "ink";
import { theme } from "../theme.js";
export function Header({ root, model, ollamaReady, }) {
    const modelName = model.includes("/") ? model.split("/").pop() : model;
    const led = ollamaReady === null ? theme.warn : ollamaReady ? theme.primary : theme.error;
    const ledText = ollamaReady === null ? "?" : ollamaReady ? "●" : "○";
    return (_jsxs(Box, { justifyContent: "space-between", paddingX: 1, children: [_jsxs(Text, { children: [_jsx(Text, { color: theme.primary, backgroundColor: "black", children: modelName }), _jsx(Text, { color: theme.dim, backgroundColor: "black", children: "@" }), _jsx(Text, { color: theme.text, backgroundColor: "black", children: root.split("/").pop() })] }), _jsxs(Text, { color: led, backgroundColor: "black", children: [ledText, " ollama"] })] }));
}
