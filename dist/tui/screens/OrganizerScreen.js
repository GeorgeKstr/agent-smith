import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import { theme } from "../theme.js";
import { openOrganizerDatabase, listOrganizerAgents, markStaleAgentsOffline, listOrganizerTasks } from "../../organizer/organizerDb.js";
function ago(ts) {
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 0)
        return "now";
    if (s < 5)
        return "now";
    if (s < 60)
        return `${s}s ago`;
    if (s < 3600)
        return `${Math.round(s / 60)}m ago`;
    return `${Math.round(s / 3600)}h ago`;
}
function statusColor(s) {
    switch (s) {
        case "offline": return theme.dim;
        case "error": return theme.error;
        case "busy":
        case "indexing": return theme.warn;
        default: return theme.primary;
    }
}
function dot(s) {
    switch (s) {
        case "offline":
        case "error": return "○";
        case "busy":
        case "indexing": return "◉";
        default: return "●";
    }
}
function parseModels(json) {
    try {
        const m = JSON.parse(json);
        return Object.values(m).find(Boolean) ?? "?";
    }
    catch {
        return "?";
    }
}
function parseModelsAll(json) {
    try {
        return JSON.parse(json);
    }
    catch {
        return {};
    }
}
function parseIndex(json) {
    try {
        return JSON.parse(json);
    }
    catch {
        return { files: 0, symbols: 0, dirty: 0, freshness: 1 };
    }
}
function parseCapabilities(json) {
    try {
        return JSON.parse(json);
    }
    catch {
        return [];
    }
}
function taskStatusColor(s) {
    switch (s) {
        case "running":
        case "iterating": return theme.warn;
        case "needs_review": return theme.accent;
        case "failed": return theme.error;
        case "completed":
        case "auto_approved": return theme.primary;
        case "skipped":
        case "cancelled": return theme.dim;
        default: return theme.dim;
    }
}
function taskStatusTag(s) {
    return s.replace(/_/g, " ");
}
function pad(s, n) {
    return String(s).padEnd(n, " ").slice(0, n);
}
function trunc(s, n) {
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
export function OrganizerScreen({ onBack }) {
    const [agents, setAgents] = useState([]);
    const [tasks, setTasks] = useState([]);
    const [tick, setTick] = useState(0);
    const [selectedIdx, setSelectedIdx] = useState(0);
    const [detailTab, setDetailTab] = useState("overview");
    useEffect(() => {
        const db = openOrganizerDatabase();
        markStaleAgentsOffline(db, 15000);
        const agentList = listOrganizerAgents(db);
        const taskList = listOrganizerTasks(db);
        setAgents(agentList);
        setTasks(taskList);
        db.close();
    }, [tick]);
    useEffect(() => {
        const interval = setInterval(() => setTick(t => t + 1), 2000);
        return () => clearInterval(interval);
    }, []);
    useInput((char, key) => {
        if (key.escape) {
            onBack();
            return;
        }
        if (key.downArrow || (char === "j" && !key.ctrl)) {
            setSelectedIdx((v) => Math.min(v + 1, agents.length - 1));
            return;
        }
        if (key.upArrow || (char === "k" && !key.ctrl)) {
            setSelectedIdx((v) => Math.max(0, v - 1));
            return;
        }
        if (key.tab) {
            setDetailTab((t) => {
                const tabs = ["overview", "tasks", "capabilities"];
                const idx = tabs.indexOf(t);
                return tabs[(idx + 1) % tabs.length];
            });
            return;
        }
        if (char === "1") {
            setDetailTab("overview");
            return;
        }
        if (char === "2") {
            setDetailTab("tasks");
            return;
        }
        if (char === "3") {
            setDetailTab("capabilities");
            return;
        }
    });
    const online = agents.filter(a => a.status !== "offline");
    const offline = agents.filter(a => a.status === "offline");
    const selected = agents[selectedIdx];
    const taskCounts = { total: tasks.length, running: 0, needs_review: 0, completed: 0, failed: 0, queued: 0, assigned: 0 };
    for (const t of tasks) {
        if (t.status in taskCounts)
            taskCounts[t.status]++;
    }
    const agentTasks = selected ? tasks.filter(t => t.assignedAgentId === selected.id) : [];
    const LIST_WIDTH = 36;
    return (_jsxs(Box, { flexDirection: "column", width: "100%", height: "100%", paddingX: 0, children: [_jsxs(Box, { flexDirection: "column", borderStyle: "single", borderColor: theme.border, paddingX: 1, children: [_jsx(Box, { children: _jsxs(Text, { children: [_jsx(Text, { color: theme.primary, bold: true, children: "Agent Smith Organizer" }), _jsx(Text, { color: theme.dim, children: "  port 8787  " }), _jsx(Text, { color: theme.accent, children: "http://127.0.0.1:8787/dashboard" })] }) }), _jsx(Box, { children: _jsxs(Text, { color: theme.dim, children: [agents.length, " agents \u00B7 ", online.length, " online \u00B7 ", offline.length, " offline", " · ", taskCounts.running, " running \u00B7 ", taskCounts.needs_review, " needs review \u00B7 ", taskCounts.completed, " done", "  ", _jsx(Text, { color: theme.dim, children: "[\u2191\u2193:nav] [Tab:switch tab] [1/2/3:tabs] [Esc:exit]" })] }) })] }), _jsxs(Box, { flexDirection: "row", flexGrow: 1, children: [_jsxs(Box, { flexDirection: "column", width: LIST_WIDTH, borderStyle: "single", borderColor: theme.border, borderTop: false, paddingX: 1, flexShrink: 0, children: [_jsxs(Text, { color: theme.accent, bold: true, children: ["AGENTS (", agents.length, ")"] }), _jsxs(Box, { flexDirection: "column", marginTop: 0, children: [agents.length === 0 && (_jsxs(Box, { marginY: 1, children: [_jsx(Text, { color: theme.dim, children: "No agents connected." }), _jsx(Text, { color: theme.dim, children: "Workers auto-register via" }), _jsx(Text, { color: theme.dim, children: "smith api or /api" })] })), agents.map((a, i) => {
                                        const active = i === selectedIdx;
                                        const agentTaskCount = tasks.filter(t => t.assignedAgentId === a.id && (t.status === "running" || t.status === "iterating" || t.status === "assigned" || t.status === "reviewing" || t.status === "needs_review")).length;
                                        const bgColor = active ? theme.accent : undefined;
                                        const fgColor = active ? "black" : statusColor(a.status);
                                        const nameColor = active ? "black" : theme.primary;
                                        return (_jsxs(Box, { flexDirection: "column", children: [_jsxs(Text, { children: [active ? _jsx(Text, { color: bgColor, inverse: true, children: ">" }) : _jsx(Text, { children: " " }), _jsxs(Text, { color: active ? "black" : undefined, inverse: active, children: [_jsx(Text, { color: statusColor(a.status), children: dot(a.status) }), _jsxs(Text, { color: active ? "black" : theme.primary, bold: !active, children: [" ", trunc(a.name, 20)] })] })] }), _jsxs(Text, { color: active ? "black" : theme.dim, inverse: active, children: ["  ", trunc(a.status, 8), " \u00B7 ", trunc(a.project_name || a.hostname, 16)] }), agentTaskCount > 0 && (_jsxs(Text, { color: active ? "black" : theme.warn, inverse: active, children: ["  ", agentTaskCount, " active task", agentTaskCount > 1 ? "s" : ""] })), _jsxs(Text, { color: active ? "black" : theme.dim, inverse: active, children: ["  ", "seen ", ago(a.last_heartbeat_at)] })] }, a.id));
                                    })] })] }), _jsx(Box, { flexDirection: "column", flexGrow: 1, borderStyle: "single", borderColor: theme.border, borderTop: false, borderLeft: false, paddingX: 1, children: !selected ? (_jsx(Box, { flexDirection: "column", alignItems: "center", marginTop: 2, children: _jsx(Text, { color: theme.dim, children: "\u2190 Select an agent to view details" }) })) : (_jsxs(Box, { flexDirection: "column", children: [_jsxs(Box, { flexDirection: "row", marginBottom: 1, gap: 2, children: [_jsx(Text, { color: detailTab === "overview" ? theme.accent : theme.dim, inverse: detailTab === "overview", bold: detailTab === "overview", children: "[1] Overview" }), _jsxs(Text, { color: detailTab === "tasks" ? theme.accent : theme.dim, inverse: detailTab === "tasks", bold: detailTab === "tasks", children: ["[2] Tasks (", agentTasks.length, ")"] }), _jsx(Text, { color: detailTab === "capabilities" ? theme.accent : theme.dim, inverse: detailTab === "capabilities", bold: detailTab === "capabilities", children: "[3] Capabilities" })] }), detailTab === "overview" && (_jsxs(Box, { flexDirection: "column", children: [_jsx(Text, { children: _jsx(Text, { color: theme.primary, bold: true, children: selected.name }) }), _jsx(Text, { color: theme.dim, children: selected.id }), _jsxs(Box, { marginTop: 1, flexDirection: "column", children: [_jsxs(Text, { children: [_jsx(Text, { color: theme.dim, children: "Status:     " }), _jsx(Text, { color: statusColor(selected.status), children: selected.status })] }), _jsxs(Text, { children: [_jsx(Text, { color: theme.dim, children: "Host:       " }), _jsx(Text, { children: selected.hostname })] }), _jsxs(Text, { children: [_jsx(Text, { color: theme.dim, children: "Project:    " }), _jsx(Text, { children: selected.project_name })] }), _jsxs(Text, { children: [_jsx(Text, { color: theme.dim, children: "Root:       " }), _jsx(Text, { children: trunc(selected.project_root, 50) })] }), _jsxs(Text, { children: [_jsx(Text, { color: theme.dim, children: "API URL:    " }), _jsx(Text, { children: selected.api_base_url || "—" })] }), _jsxs(Text, { children: [_jsx(Text, { color: theme.dim, children: "API Enabled:" }), _jsx(Text, { children: selected.api_enabled ? "Yes" : "No" })] }), _jsxs(Text, { children: [_jsx(Text, { color: theme.dim, children: "Model:      " }), _jsx(Text, { children: parseModels(selected.models_json) })] }), _jsxs(Text, { children: [_jsx(Text, { color: theme.dim, children: "Last seen:  " }), _jsx(Text, { color: selected.status === "offline" ? theme.error : theme.dim, children: ago(selected.last_heartbeat_at) })] })] }), (() => {
                                            const ix = parseIndex(selected.index_json);
                                            return ix.files > 0 ? (_jsxs(Box, { flexDirection: "column", marginTop: 1, children: [_jsx(Text, { color: theme.accent, bold: true, children: "Index" }), _jsxs(Text, { color: theme.dim, children: ["  Files: ", ix.files, "  Symbols: ", ix.symbols, "  Dirty: ", ix.dirty] }), _jsxs(Text, { color: theme.dim, children: ["  Freshness: ", Math.round(ix.freshness * 100), "%"] })] })) : null;
                                        })(), (() => {
                                            const allModels = parseModelsAll(selected.models_json);
                                            const entries = Object.entries(allModels).filter(([, v]) => v);
                                            if (entries.length === 0)
                                                return null;
                                            return (_jsxs(Box, { flexDirection: "column", marginTop: 1, children: [_jsx(Text, { color: theme.accent, bold: true, children: "Models" }), entries.map(([k, v]) => (_jsxs(Text, { color: theme.dim, children: ["  ", k, ": ", v] }, k)))] }));
                                        })(), selected.current_task_id && (_jsxs(Box, { flexDirection: "column", marginTop: 1, children: [_jsx(Text, { color: theme.warn, bold: true, children: "Current Task" }), _jsxs(Text, { color: theme.dim, children: ["  ID: ", selected.current_task_id] }), (() => {
                                                    const ct = tasks.find(t => t.id === selected.current_task_id);
                                                    if (!ct)
                                                        return null;
                                                    return (_jsxs(Box, { flexDirection: "column", children: [_jsxs(Text, { color: theme.primary, children: ["  ", ct.title] }), _jsxs(Text, { color: taskStatusColor(ct.status), children: ["  Status: ", taskStatusTag(ct.status)] }), _jsxs(Text, { color: theme.dim, children: ["  Iteration: ", ct.currentIteration, "/", ct.maxIterations] }), _jsxs(Text, { color: theme.dim, children: ["  Mode: ", ct.mode || "—"] })] }));
                                                })()] }))] })), detailTab === "tasks" && (_jsxs(Box, { flexDirection: "column", children: [_jsxs(Text, { color: theme.dim, bold: true, children: ["Tasks for ", selected.name] }), agentTasks.length === 0 ? (_jsx(Box, { marginY: 1, children: _jsx(Text, { color: theme.dim, children: "No tasks assigned to this agent." }) })) : (agentTasks.map(t => (_jsxs(Box, { flexDirection: "column", marginBottom: 0, children: [_jsxs(Text, { children: [_jsx(Text, { color: taskStatusColor(t.status), children: "\u25CF " }), _jsx(Text, { color: theme.primary, children: trunc(t.title, 50) })] }), _jsxs(Text, { color: theme.dim, children: ["  ", "Status: ", taskStatusTag(t.status), " \u00B7 Iter: ", t.currentIteration, "/", t.maxIterations, " \u00B7 Mode: ", t.mode || "—", " · Priority: ", t.priority, t.autoApprove ? _jsx(Text, { color: theme.primary, children: " AUTO" }) : null, t.autoApply ? _jsx(Text, { color: theme.accent, children: " APPLY" }) : null] })] }, t.id))))] })), detailTab === "capabilities" && (_jsxs(Box, { flexDirection: "column", children: [_jsx(Text, { color: theme.dim, bold: true, children: "Capabilities" }), (() => {
                                            const caps = parseCapabilities(selected.capabilities_json);
                                            if (caps.length === 0)
                                                return _jsx(Text, { color: theme.dim, children: "No capabilities listed" });
                                            return (_jsx(Box, { flexDirection: "column", marginTop: 1, children: caps.map(c => (_jsxs(Text, { color: theme.primary, children: ["  \u2713 ", c] }, c))) }));
                                        })(), _jsx(Box, { marginTop: 1, children: _jsx(Text, { color: theme.dim, bold: true, children: "Actions" }) }), (() => {
                                            try {
                                                const actions = JSON.parse(selected.actions_json);
                                                if (!Array.isArray(actions) || actions.length === 0)
                                                    return _jsx(Text, { color: theme.dim, children: "No actions listed" });
                                                return (_jsx(Box, { flexDirection: "column", marginTop: 0, children: actions.map((a, i) => (_jsxs(Text, { color: theme.dim, children: ["  ", a.name, ": ", a.description] }, i))) }));
                                            }
                                            catch {
                                                return _jsx(Text, { color: theme.dim, children: "\u2014" });
                                            }
                                        })()] })), _jsx(Box, { flexDirection: "column", marginTop: 1, borderStyle: "single", borderColor: theme.border, paddingX: 1, children: _jsxs(Text, { color: theme.dim, children: ["API: ", selected.api_base_url, " (use ", _jsxs(Text, { color: theme.accent, children: ["/agent ", selected.name] }), " in web dashboard or agent chat proxy)"] }) })] })) })] }), _jsx(Box, { borderStyle: "single", borderColor: theme.border, paddingX: 1, children: _jsxs(Text, { color: theme.dim, children: ["Port 8787 \u00B7 Tasks: ", taskCounts.total, " total (", taskCounts.running, " running, ", taskCounts.needs_review, " needs review, ", taskCounts.completed, " done)", " · Agents: ", online.length, " online / ", agents.length, " total"] }) })] }));
}
