import { jsxs as _jsxs } from "react/jsx-runtime";
import { Text } from "ink";
export function ProgressBar({ progress, width = 32 }) {
    const clamped = Math.max(0, Math.min(1, progress));
    const filled = Math.round(clamped * width);
    const empty = width - filled;
    return (_jsxs(Text, { color: "green", children: ["[", "█".repeat(filled), "░".repeat(empty), "] ", Math.round(clamped * 100), "%"] }));
}
