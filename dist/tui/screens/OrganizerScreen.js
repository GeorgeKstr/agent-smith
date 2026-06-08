import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import { theme } from "../theme.js";
import { openOrganizerDatabase, listOrganizerAgents, markStaleAgentsOffline } from "../../organizer/organizerDb.js";
function ago(ts) {
    const s = Math.round((Date.now() - ts) / 1000);
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
function parseIndex(json) {
    try {
        return JSON.parse(json);
    }
    catch {
        return { files: 0, symbols: 0, dirty: 0, freshness: 1 };
    }
}
export function OrganizerScreen({ onBack }) {
    const [agents, setAgents] = useState([]);
    const [tick, setTick] = useState(0);
    useEffect(() => {
        const db = openOrganizerDatabase();
        markStaleAgentsOffline(db, 15000);
        const list = listOrganizerAgents(db);
        setAgents(list);
        db.close();
    }, [tick]);
    useEffect(() => {
        const interval = setInterval(() => setTick(t => t + 1), 2000);
        return () => clearInterval(interval);
    }, []);
    useInput((_char, key) => {
        if (key.escape) {
            onBack();
            return;
        }
    });
    const online = agents.filter(a => a.status !== "offline");
    const offline = agents.filter(a => a.status === "offline");
    return (_jsxs(Box, { flexDirection: "column", width: "100%", height: "100%", paddingX: 1, children: [_jsxs(Box, { flexDirection: "column", marginBottom: 1, children: [_jsxs(Text, { children: [_jsx(Text, { color: theme.primary, bold: true, children: "Agent Smith Organizer" }), _jsx(Text, { color: theme.dim, children: "  port 8787  " }), _jsx(Text, { color: theme.accent, children: "http://127.0.0.1:8787/dashboard" })] }), _jsxs(Text, { color: theme.dim, children: [agents.length, " agent", agents.length !== 1 ? "s" : "", online.length > 0 && _jsxs(Text, { color: theme.primary, children: [", ", online.length, " online"] }), offline.length > 0 && _jsxs(Text, { color: theme.dim, children: [", ", offline.length, " offline"] }), "  ", "Esc to exit"] })] }), _jsxs(Box, { flexDirection: "column", children: [agents.length === 0 && (_jsx(Box, { marginY: 1, children: _jsx(Text, { color: theme.dim, children: "No agents connected. Workers auto-register via smith api or /api" }) })), online.map(a => (_jsxs(Box, { flexDirection: "column", marginBottom: 1, children: [_jsxs(Text, { children: [_jsxs(Text, { color: statusColor(a.status), children: [dot(a.status), " "] }), _jsx(Text, { color: theme.primary, bold: true, children: a.name }), a.current_task_id && _jsxs(Text, { color: theme.warn, children: ["  [", a.status, "]"] })] }), _jsxs(Text, { color: theme.dim, children: ["  ", a.hostname, " \u00B7 ", a.project_name, " · model: ", parseModels(a.models_json), a.api_enabled ? ` · API: ${a.api_base_url}` : ""] }), (() => {
                                const ix = parseIndex(a.index_json);
                                return ix.files > 0 ? (_jsxs(Text, { color: theme.dim, children: ["  ", "index: ", ix.files, " files, ", ix.symbols, " symbols", ix.dirty > 0 ? `, ${ix.dirty} dirty` : "", " (", Math.round(ix.freshness * 100), "% fresh", ")"] })) : null;
                            })(), _jsxs(Text, { color: theme.dim, children: ["  ", "seen ", ago(a.last_heartbeat_at)] })] }, a.id))), offline.length > 0 && (_jsxs(Box, { flexDirection: "column", marginTop: 1, children: [_jsx(Text, { color: theme.dim, children: "Offline" }), offline.slice(0, 8).map(a => (_jsx(Box, { children: _jsxs(Text, { children: [_jsxs(Text, { color: theme.dim, children: [dot(a.status), " "] }), _jsx(Text, { color: theme.dim, children: a.name }), _jsxs(Text, { color: theme.dim, children: ["  last seen ", ago(a.last_heartbeat_at)] })] }) }, a.id)))] }))] })] }));
}
