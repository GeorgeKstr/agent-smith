import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { Box, Text } from "ink";
import { theme } from "../theme.js";
const BG = "black";
export function ChangeSetView({ changeSet, files, selectedPath, diffPreview, hunks, selectedHunkIndex, reviewFocus }) {
    if (!changeSet) {
        return (_jsx(Box, { flexDirection: "column", paddingX: 1, children: _jsx(Text, { color: theme.dim, children: "No change set selected." }) }));
    }
    const diffLines = diffPreview.split("\n");
    const selFileHunks = hunks;
    return (_jsxs(Box, { flexDirection: "column", paddingX: 1, children: [_jsxs(Text, { color: theme.primary, backgroundColor: BG, children: ["\u2500\u2500 CHANGE SET ", changeSet.id, " \u2500\u2500"] }), _jsxs(Box, { marginTop: 1, children: [_jsx(Text, { color: theme.accent, children: "status: " }), _jsx(Text, { color: theme.text, children: changeSet.status })] }), _jsxs(Box, { children: [_jsx(Text, { color: theme.accent, children: "summary: " }), _jsx(Text, { color: theme.text, children: changeSet.summary ?? "(none)" })] }), _jsx(Box, { marginTop: 1, children: _jsxs(Text, { color: reviewFocus === "files" ? theme.primary : theme.dim, children: ["\u2500\u2500 Files (", files.length, ") \u2500\u2500"] }) }), files.map((f, i) => {
                const sel = f.path === selectedPath && reviewFocus === "files";
                const statusColor = f.status === "accepted" ? theme.primary : f.status === "rejected" ? theme.error : theme.dim;
                return (_jsxs(Box, { children: [_jsx(Text, { color: sel ? "yellow" : undefined, children: sel ? "> " : "  " }), _jsxs(Text, { color: statusColor, children: ["[", f.status.padEnd(8), "]"] }), _jsxs(Text, { color: theme.text, children: [" +", String(f.additions).padStart(3), " -", String(f.deletions).padStart(3), "  "] }), _jsx(Text, { color: theme.dim, children: f.path })] }, i));
            }), selectedPath && (_jsxs(_Fragment, { children: [_jsx(Box, { marginTop: 1, children: _jsxs(Text, { color: reviewFocus === "hunks" ? theme.primary : theme.dim, children: ["\u2500\u2500 Hunks (", selFileHunks.length, ") \u2500\u2500"] }) }), selFileHunks.length === 0 ? (_jsx(Text, { color: theme.dim, children: "  No hunks stored for selected file." })) : (selFileHunks.map((h, i) => {
                        const sel = i === selectedHunkIndex && reviewFocus === "hunks";
                        const statusColor = h.status === "accepted" ? theme.primary : h.status === "rejected" ? theme.error : theme.dim;
                        return (_jsxs(Box, { children: [_jsx(Text, { color: sel ? "yellow" : undefined, children: sel ? "> " : "  " }), _jsxs(Text, { color: statusColor, children: ["[", h.status.padEnd(8), "]"] }), _jsxs(Text, { color: theme.dim, children: [" #", h.hunkIndex, " ", h.header, " +", h.additions, " -", h.deletions] })] }, i));
                    }))] })), diffPreview && (_jsxs(Box, { flexDirection: "column", marginTop: 1, children: [_jsx(Text, { color: theme.accent, children: "\u2500\u2500 Diff Preview \u2500\u2500" }), diffLines.slice(0, 40).map((line, i) => (_jsx(Text, { color: line.startsWith("+") ? theme.primary : line.startsWith("-") ? theme.error : theme.dim, children: line.length > 240 ? line.slice(0, 240) + "…" : line }, i))), diffLines.length > 40 && _jsx(Text, { color: theme.dim, children: "... more lines ..." })] })), _jsx(Box, { marginTop: 1, children: _jsx(Text, { color: theme.dim, children: "files: \u2191/\u2193 select \u00B7 a/r accept/reject  |  hunks: Tab/f/h switch \u00B7 \u2191/\u2193 select \u00B7 a/r accept/reject" }) }), _jsx(Box, { children: _jsx(Text, { color: theme.dim, children: "A accept all \u00B7 R reject all \u00B7 p apply accepted files \u00B7 Esc back" }) }), _jsx(Box, { marginTop: 1, children: _jsx(Text, { color: theme.warn, children: "Hunk review is stored for planning/review only. Apply still uses accepted files." }) })] }));
}
