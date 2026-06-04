import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from "react";
import { Box, Text } from "ink";
import { theme } from "../theme.js";
const spinner = ["▖", "▘", "▝", "▗"];
export function BootScreen({ state, animate = true }) {
    const [tick, setTick] = useState(0);
    const [startAt] = useState(() => Date.now());
    useEffect(() => {
        if (!animate)
            return;
        const id = setInterval(() => setTick((v) => v + 1), 80);
        return () => clearInterval(id);
    }, [animate]);
    const frame = spinner[tick % spinner.length];
    const elapsed = Date.now() - startAt;
    const introFrames = [
        "wake up, smith",
        "loading matrix kernel",
        "stabilizing context channels",
    ];
    const intro = introFrames[Math.min(introFrames.length - 1, Math.floor(elapsed / 350))];
    const pulseWidth = 18;
    const pulseCount = (tick % (pulseWidth + 1));
    const pulseBar = useMemo(() => "█".repeat(pulseCount).padEnd(pulseWidth, "░"), [pulseCount]);
    return (_jsxs(Box, { flexDirection: "column", paddingX: 2, paddingY: 1, minHeight: 10, children: [_jsx(Text, { color: theme.primary, children: "smith \u2014 indexing project" }), _jsx(Text, { color: theme.dim, children: "─".repeat(30) }), _jsx(Text, { color: theme.accent, children: intro }), _jsx(Text, { color: theme.dim, children: pulseBar }), _jsxs(Text, { color: theme.text, children: [frame, " ", state.phase.toUpperCase(), " \u00B7 ", state.filesScanned, " files", state.filesTotal > 0 && ` / ${state.filesTotal}`] }), state.dirtyFiles > 0 && (_jsxs(Text, { color: theme.warn, children: [state.dirtyFiles, " dirty files"] })), _jsxs(Text, { color: theme.dim, children: ["symbols: ", state.symbolsIndexed] }), _jsxs(Text, { color: theme.dim, children: ["tags: ", state.tagsRefreshed] }), state.currentFile && (_jsx(Text, { color: theme.dim, children: state.currentFile }))] }));
}
