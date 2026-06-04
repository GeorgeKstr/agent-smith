import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { Box, Text } from "ink";
export function ContextPane({ packet, active, answer }) {
    return (_jsxs(Box, { flexDirection: "column", width: "50%", borderStyle: "round", borderColor: active ? "greenBright" : "green", paddingX: 1, children: [_jsx(Text, { color: "greenBright", children: answer !== undefined ? "Answer" : "Context Packet" }), answer !== undefined ? (answer
                .split("\n")
                .slice(0, 8)
                .map((line, i) => (_jsx(Text, { color: "white", children: line.slice(0, 56) }, i)))) : !packet ? (_jsx(Text, { color: "gray", children: "selected files: pending" })) : (_jsxs(_Fragment, { children: [_jsxs(Text, { color: "cyan", children: ["~", packet.estimatedTokens, " tokens \u00B7 ", packet.files.length, " files"] }), packet.files.slice(0, 5).map((f, i) => (_jsxs(Text, { color: "green", children: ["\u00B7 ", f.path.slice(0, 48)] }, i))), packet.symbols.slice(0, 3).map((s, i) => (_jsxs(Text, { color: "gray", children: ["\u25C7 ", s.kind, " ", s.name.slice(0, 36)] }, `s-${i}`)))] }))] }));
}
