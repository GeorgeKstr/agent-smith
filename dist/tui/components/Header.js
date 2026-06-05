import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React from "react";
import { Box, Text } from "ink";
import { theme } from "../theme.js";
export const Header = React.memo(function Header({ root, model, ollamaReady, }) {
    const modelName = model.includes("/") ? model.split("/").pop() : model;
    const led = ollamaReady === null ? theme.warn : ollamaReady ? theme.primary : theme.error;
    const ledText = ollamaReady === null ? "?" : ollamaReady ? "●" : "○";
    return (_jsxs(Box, { justifyContent: "space-between", paddingX: 1, children: [_jsxs(Text, { children: [_jsx(Text, { color: "greenBright", bold: true, backgroundColor: "black", children: root.split("/").pop() }), _jsx(Text, { color: theme.dim, backgroundColor: "black", children: " \u00B7 " }), _jsx(Text, { color: theme.dim, backgroundColor: "black", children: modelName })] }), _jsxs(Text, { color: led, backgroundColor: "black", children: [ledText, " ollama"] })] }));
});
