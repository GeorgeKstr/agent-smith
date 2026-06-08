import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
import { useEffect, useState, useCallback } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import { theme } from "../theme.js";
import { openOrganizerDatabase, listOrganizerAgents, markStaleAgentsOffline, listOrganizerTasks } from "../../organizer/organizerDb.js";
function truncEnd(s, n) {
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
function pad(s, n) {
    const str = String(s);
    return str.length > n ? str.slice(0, n) : str + " ".repeat(n - str.length);
}
function ago(ts) {
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 0)
        return "now";
    if (s < 5)
        return "now";
    if (s < 60)
        return `${s}s`;
    if (s < 3600)
        return `${Math.round(s / 60)}m`;
    return `${Math.round(s / 3600)}h`;
}
function countMap(items, keys) {
    const out = {};
    for (const k of keys)
        out[k] = 0;
    for (const i of items) {
        if (out[i.status] !== undefined)
            out[i.status]++;
    }
    return out;
}
export function OrganizerScreen({ onBack }) {
    const { stdout } = useStdout();
    const [agents, setAgents] = useState([]);
    const [tasks, setTasks] = useState([]);
    const [tick, setTick] = useState(0);
    const [error, setError] = useState(null);
    const cols = stdout.columns ?? 80;
    const rows = stdout.rows ?? 24;
    const load = useCallback(() => {
        try {
            const db = openOrganizerDatabase();
            markStaleAgentsOffline(db, 15000);
            setAgents(listOrganizerAgents(db));
            setTasks(listOrganizerTasks(db));
            db.close();
            setError(null);
        }
        catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
    }, []);
    useEffect(() => { load(); }, [tick, load]);
    useEffect(() => {
        const interval = setInterval(() => setTick(t => t + 1), 2000);
        return () => clearInterval(interval);
    }, []);
    useInput((char, key) => {
        if (key.escape || char === "q") {
            onBack();
            return;
        }
        if (char === "r") {
            load();
            return;
        }
    });
    if (error) {
        return (_jsxs(Box, { flexDirection: "column", paddingX: 1, paddingY: 1, children: [_jsxs(Text, { color: theme.error, children: ["Organizer unavailable: ", error] }), _jsx(Text, { color: theme.dim, children: "Dashboard: http://127.0.0.1:8787/dashboard" }), _jsx(Text, { color: theme.dim, children: "Press q or Esc to exit" })] }));
    }
    const agentCounts = countMap(agents, ["online", "busy", "indexing", "idle", "offline", "error", "paused"]);
    const agentOnline = agentCounts.online + agentCounts.idle;
    const agentBusy = agentCounts.busy + agentCounts.indexing;
    const agentOff = agentCounts.offline + (agentCounts.error ?? 0);
    const taskCounts = countMap(tasks, [
        "queued", "assigned", "running", "reviewing", "iterating",
        "needs_review", "auto_approved", "completed", "failed", "skipped", "cancelled"
    ]);
    const taskActive = taskCounts.running + taskCounts.iterating + taskCounts.reviewing;
    const taskReview = taskCounts.needs_review + taskCounts.auto_approved;
    const taskDone = taskCounts.completed;
    const modelMap = new Map();
    for (const t of tasks) {
        if (t.implementModel) {
            const m = modelMap.get(t.implementModel) ?? { model: t.implementModel, impl: 0, review: 0 };
            m.impl++;
            modelMap.set(t.implementModel, m);
        }
        if (t.reviewModel) {
            const m = modelMap.get(t.reviewModel) ?? { model: t.reviewModel, impl: 0, review: 0 };
            m.review++;
            modelMap.set(t.reviewModel, m);
        }
    }
    const models = [...modelMap.values()].sort((a, b) => (b.impl + b.review) - (a.impl + b.review));
    // Recent activity from task updatedAt
    const recent = [...tasks]
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 12);
    const innerWidth = cols - 2;
    const maxModelLines = rows > 40 ? 6 : 4;
    const fixedRows = 11;
    const maxRecent = Math.max(2, Math.min(12, rows - fixedRows - maxModelLines));
    function line(label, value, color) {
        const labelLen = label.length;
        const valueLen = innerWidth - 2 - labelLen;
        const d = truncEnd(value, valueLen);
        const padLen = Math.max(0, innerWidth - labelLen - d.length);
        return label + d + " ".repeat(padLen);
    }
    function makeline(label, ...parts) {
        const labelStr = truncEnd(label, 14);
        let rest = "";
        for (const p of parts)
            rest += p.text + " ";
        rest = truncEnd(rest.trim(), innerWidth - labelStr.length);
        return (_jsxs(Text, { children: [_jsx(Text, { color: theme.dim, children: labelStr }), _jsx(Text, { children: rest })] }));
    }
    return (_jsxs(Box, { flexDirection: "column", width: cols, height: rows, paddingX: 1, children: [_jsx(Box, { flexDirection: "row", children: _jsxs(Text, { children: [_jsx(Text, { color: theme.primary, bold: true, children: "Agent Smith Organizer" }), _jsx(Text, { color: theme.dim, children: "  http://127.0.0.1:8787/dashboard" })] }) }), _jsxs(Box, { flexDirection: "column", marginTop: 0, children: [_jsxs(Text, { children: [_jsx(Text, { color: theme.accent, children: "Agents: " }), _jsxs(Text, { children: ["total ", agents.length, " \u00B7 "] }), _jsxs(Text, { color: theme.primary, children: ["online ", agentOnline, " "] }), _jsx(Text, { children: "\u00B7 " }), _jsxs(Text, { color: theme.warn, children: ["busy ", agentBusy, " "] }), _jsx(Text, { children: "\u00B7 " }), _jsxs(Text, { color: theme.dim, children: ["off ", agentOff] })] }), _jsxs(Text, { children: [_jsx(Text, { color: theme.accent, children: "Tasks:  " }), _jsxs(Text, { children: ["total ", tasks.length, " \u00B7 "] }), _jsxs(Text, { color: theme.warn, children: ["active ", taskActive, " "] }), _jsxs(Text, { children: ["\u00B7 review ", taskReview, " \u00B7 done ", taskDone] }), taskCounts.queued > 0 && _jsxs(Text, { color: theme.dim, children: [" \u00B7 queued ", taskCounts.queued] }), taskCounts.failed > 0 && _jsxs(Text, { color: theme.error, children: [" \u00B7 failed ", taskCounts.failed] })] })] }), models.length > 0 && (_jsxs(Box, { flexDirection: "column", marginTop: 0, children: [_jsx(Text, { color: theme.dim, children: "Models" }), models.slice(0, maxModelLines).map(m => (_jsxs(Text, { children: [_jsxs(Text, { color: theme.dim, children: ["  ", truncEnd(m.model, 30), " "] }), _jsxs(Text, { color: theme.primary, children: ["impl ", m.impl] }), _jsxs(Text, { color: m.review > 0 ? theme.accent : theme.dim, children: [" review ", m.review] })] }, m.model)))] })), recent.length > 0 && (_jsxs(Box, { flexDirection: "column", marginTop: 0, children: [_jsx(Text, { color: theme.dim, children: "Recent" }), recent.slice(0, maxRecent).map(t => {
                        const title = truncEnd(t.title, innerWidth - 28);
                        return (_jsxs(Text, { children: [_jsxs(Text, { color: theme.dim, children: [ago(t.updatedAt).padEnd(4), " "] }), _jsx(Text, { color: theme.dim, children: truncEnd(t.status, 14).padEnd(15) }), _jsx(Text, { children: title })] }, t.id));
                    })] })), agents.length === 0 && (_jsx(Box, { marginTop: 1, children: _jsx(Text, { color: theme.dim, children: "No agents connected. Full dashboard: http://127.0.0.1:8787/dashboard" }) })), _jsx(Box, { marginTop: 0, flexDirection: "row", children: _jsx(Text, { color: theme.dim, children: "q quit \u00B7 r refresh \u00B7 full controls at http://127.0.0.1:8787/dashboard" }) })] }));
}
