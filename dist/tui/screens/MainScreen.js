import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Box, Text, useStdout } from "ink";
import { theme } from "../theme.js";
import { Header } from "../components/Header.js";
import { ContentArea } from "../components/ContentArea.js";
import { InputBar } from "../components/InputBar.js";
import { StatusBar } from "../components/StatusBar.js";
import { MatrixRain } from "../components/MatrixRain.js";
export function MainScreen(props) {
    const { stdout } = useStdout();
    const termRows = stdout.rows ?? 24;
    const termCols = stdout.columns ?? 80;
    const contentWidth = Math.max(1, termCols - 2);
    const contentLines = Math.max(6, termRows - 13);
    const rainHeight = Math.max(1, termRows - 6);
    return (_jsxs(Box, { position: "relative", flexDirection: "column", height: "100%", children: [_jsx(MatrixRain, { enabled: props.animations, maxRows: rainHeight }), _jsxs(Box, { flexDirection: "column", height: "100%", borderStyle: "round", borderColor: theme.primary, children: [_jsxs(Box, { flexGrow: 1, flexDirection: "column", children: [_jsx(Header, { root: props.root, model: props.model, ollamaReady: props.ollamaReady }), _jsx(Box, { flexGrow: 1, flexDirection: "column", paddingY: 1, children: _jsx(ContentArea, { output: props.output, logs: props.logs, packet: props.packet, answer: props.answer, patchText: props.patchText, busy: props.busy, scrollOffset: props.scrollOffset, maxLines: contentLines, maxWidth: Math.max(20, termCols - 8) }) })] }), _jsx(InputBar, { input: props.input, busy: props.busy, mode: props.mode, phase: props.phase }), _jsx(StatusBar, { filesTotal: props.filesTotal, dirtyFiles: props.dirtyFiles, tokens: props.packet?.estimatedTokens ?? 0, maxTokens: props.maxTokens, busy: props.busy, mode: props.mode, intent: props.intent }), _jsxs(Text, { color: theme.dim, backgroundColor: "black", children: ["/help \u00B7 Enter submit \u00B7 Esc clear \u00B7 \u2191/\u2193 scroll \u00B7 Ctrl+C quit", " ".repeat(Math.max(0, contentWidth - 65))] })] })] }));
}
