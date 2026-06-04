import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Box, Text } from "ink";
export function ProjectIntelPane({ filesTotal, dirtyFiles, symbolsIndexed, tagsRefreshed }) {
    return (_jsxs(Box, { flexDirection: "column", width: "34%", borderStyle: "round", borderColor: "green", paddingX: 1, children: [_jsx(Text, { color: "greenBright", children: "Project Intel" }), _jsxs(Text, { color: "green", children: ["files indexed: ", filesTotal] }), _jsxs(Text, { color: dirtyFiles > 0 ? "yellow" : "green", children: ["dirty files: ", dirtyFiles] }), _jsxs(Text, { color: "green", children: ["symbols: ", symbolsIndexed] }), _jsxs(Text, { color: "cyan", children: ["tagged files: ", tagsRefreshed] }), _jsx(Text, { color: "gray", children: "graph: import edges live" })] }));
}
