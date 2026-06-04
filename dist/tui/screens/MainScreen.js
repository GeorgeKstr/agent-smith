import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Box, Text } from "ink";
import { Header } from "../components/Header.js";
import { ProjectIntelPane } from "../components/ProjectIntelPane.js";
import { TaskConsolePane } from "../components/TaskConsolePane.js";
import { ContextPane } from "../components/ContextPane.js";
import { PatchPane } from "../components/PatchPane.js";
import { StatusBar } from "../components/StatusBar.js";
export function MainScreen(props) {
    return (_jsxs(Box, { flexDirection: "column", children: [_jsx(Header, { root: props.root, model: props.model, ollamaReady: props.ollamaReady }), _jsxs(Box, { children: [_jsx(ProjectIntelPane, { filesTotal: props.filesTotal, dirtyFiles: props.dirtyFiles, symbolsIndexed: props.symbolsIndexed, tagsRefreshed: props.tagsRefreshed }), _jsx(TaskConsolePane, { logs: props.logs, output: props.output, mode: props.mode, input: props.input, busy: props.busy, phase: props.phase })] }), _jsxs(Box, { children: [_jsx(ContextPane, { packet: props.packet, active: props.view === "context", answer: props.view === "answer" ? props.answer : undefined }), _jsx(PatchPane, { patchText: props.patchText, active: props.view === "patch" })] }), _jsx(Text, { color: "gray", children: "Ctrl+A ask \u00B7 Ctrl+P patch \u00B7 Ctrl+I context \u00B7 Ctrl+T patch view \u00B7 Ctrl+R reindex \u00B7 Enter run \u00B7 Ctrl+C quit" }), _jsx(StatusBar, { filesTotal: props.filesTotal, dirtyFiles: props.dirtyFiles, tokens: props.packet?.estimatedTokens ?? 0, maxTokens: props.maxTokens, mode: props.mode, busy: props.busy })] }));
}
