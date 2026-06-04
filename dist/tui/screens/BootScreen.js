import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { Box, Text } from "ink";
import { smithTheme } from "../theme.js";
import { ProgressBar } from "../components/ProgressBar.js";
export function BootScreen({ state, animate = true }) {
    const [tick, setTick] = useState(0);
    useEffect(() => {
        if (!animate)
            return;
        const timer = setInterval(() => setTick((value) => value + 1), 120);
        return () => clearInterval(timer);
    }, [animate]);
    const spinner = animate ? smithTheme.spinnerFrames[tick % smithTheme.spinnerFrames.length] : "●";
    const rain = smithTheme.rain.map((row, i) => animate ? rotate(row, (tick + i * 7) % Math.max(1, row.length)) : row);
    return (_jsxs(Box, { flexDirection: "column", borderStyle: "double", borderColor: "green", paddingX: 2, paddingY: 1, children: [_jsx(Text, { color: "greenBright", children: "\u2591\u2592\u2593 AGENT SMITH \u2593\u2592\u2591" }), _jsx(Text, { color: "green", children: "SYSTEM BOOT // MATRIX INDEX CORE" }), _jsx(Text, { color: "gray", children: rain[0] }), _jsx(Text, { color: "gray", children: rain[1] }), _jsxs(Box, { marginTop: 1, children: [_jsx(Text, { color: "greenBright", children: "///`.::::.`\\\\\\  " }), _jsx(Text, { color: "green", children: " sunglasses protocol loaded" })] }), _jsx(Text, { color: "greenBright", children: "||| ::/  \\:: ;|||" }), _jsx(Text, { color: "greenBright", children: "||| ::\\__/:: ;|||" }), _jsx(Text, { color: "greenBright", children: "\\\\\\ '::::' ///" }), _jsx(Box, { marginTop: 1, children: _jsxs(Text, { color: "green", children: [spinner, " Phase: ", state.phase.toUpperCase()] }) }), _jsx(ProgressBar, { progress: state.progress }), _jsxs(Text, { color: "green", children: ["Files scanned: ", state.filesScanned, " / ", state.filesTotal] }), _jsxs(Text, { color: "yellow", children: ["Dirty files: ", state.dirtyFiles] }), _jsxs(Text, { color: "green", children: ["Symbols indexed: ", state.symbolsIndexed] }), _jsxs(Text, { color: "cyan", children: ["Tags refreshed: ", state.tagsRefreshed] }), _jsxs(Text, { color: "gray", children: ["Current file: ", state.currentFile ?? "-"] }), _jsx(Box, { marginTop: 1, children: _jsxs(Text, { color: "cyan", children: ["Tip: ", state.tip] }) }), _jsx(Text, { color: "gray", children: rain[2] }), _jsx(Text, { color: "greenBright", children: "AGENT SMITH ONLINE" })] }));
}
function rotate(input, amount) {
    return input.slice(amount) + input.slice(0, amount);
}
