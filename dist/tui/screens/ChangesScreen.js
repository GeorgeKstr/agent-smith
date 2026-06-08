import { jsx as _jsx } from "react/jsx-runtime";
import { Box, useInput } from "ink";
import { theme } from "../theme.js";
import { ChangeSetView } from "../components/ChangeSetView.js";
export function ChangesScreen(props) {
    useInput((_char, key) => {
        if (key.escape || (key.ctrl && _char === "c")) {
            props.onBack();
            return;
        }
        // Focus switching
        if (key.tab) {
            props.onFocusChange(props.reviewFocus === "files" ? "hunks" : "files");
            return;
        }
        if (_char === "f" && !key.ctrl && !key.meta) {
            props.onFocusChange("files");
            return;
        }
        if (_char === "h" && !key.ctrl && !key.meta) {
            props.onFocusChange("hunks");
            return;
        }
        if (props.reviewFocus === "hunks") {
            if (key.upArrow) {
                const next = Math.max(0, props.selectedHunkIndex - 1);
                props.onSelectHunk(next);
                return;
            }
            if (key.downArrow) {
                const next = Math.min(props.hunks.length - 1, props.selectedHunkIndex + 1);
                props.onSelectHunk(next);
                return;
            }
            if (_char === "a" && !key.ctrl && !key.meta) {
                props.onAcceptHunk();
                return;
            }
            if (_char === "r" && !key.ctrl && !key.meta) {
                props.onRejectHunk();
                return;
            }
            if (_char === "A" && !key.ctrl && !key.meta) {
                props.onAcceptFileHunks();
                return;
            }
            if (_char === "R" && !key.ctrl && !key.meta) {
                props.onRejectFileHunks();
                return;
            }
            return;
        }
        // Files focus
        if (key.upArrow) {
            const idx = props.files.findIndex((f) => f.path === props.selectedPath);
            if (idx > 0)
                props.onSelectFile(props.files[idx - 1].path);
            return;
        }
        if (key.downArrow) {
            const idx = props.files.findIndex((f) => f.path === props.selectedPath);
            if (idx >= 0 && idx < props.files.length - 1)
                props.onSelectFile(props.files[idx + 1].path);
            return;
        }
        if (_char === "a" && !key.ctrl && !key.meta) {
            props.onAcceptFile();
            return;
        }
        if (_char === "r" && !key.ctrl && !key.meta) {
            props.onRejectFile();
            return;
        }
        if (_char === "A" && !key.ctrl && !key.meta) {
            props.onAcceptAll();
            return;
        }
        if (_char === "R" && !key.ctrl && !key.meta) {
            props.onRejectAll();
            return;
        }
        if (_char === "p" && !key.ctrl && !key.meta) {
            props.onApply();
            return;
        }
    });
    return (_jsx(Box, { flexDirection: "column", borderStyle: "round", borderColor: theme.border, paddingX: 1, children: _jsx(ChangeSetView, { ...props }) }));
}
