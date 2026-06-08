import http from "node:http";
import { openOrganizerDatabase, upsertOrganizerAgent, listOrganizerAgents, getOrganizerAgent, markStaleAgentsOffline, createOrganizerProject, listOrganizerProjects, getOrganizerProject, updateOrganizerProject, deleteOrganizerProject, createOrganizerBucket, listOrganizerBuckets, getOrganizerBucket, updateOrganizerBucket, deleteOrganizerBucket, createOrganizerTask, listOrganizerTasks, getOrganizerTask, updateOrganizerTask, assignOrganizerTask, deleteOrganizerTask, recordOrganizerTaskEvent, listOrganizerTaskEvents, listOrganizerTaskIterations } from "./organizerDb.js";
import { dispatchOrganizerTask } from "./taskDispatcher.js";
import { buildOrganizerTaskTimeline } from "./taskTimeline.js";
import { createWorkerApiClient } from "./workerApiClient.js";
import { html } from "../web/html.js";
import { styles } from "../web/styles.js";
import { clientJs } from "../web/client.js";
import { importOrganizerTasks } from "../tasks/taskImport.js";
import { parseTaskImport } from "../tasks/taskImportParser.js";
import { TASK_FLOW_TEMPLATES } from "../tasks/taskFlowTemplates.js";
import { renderTaskFlowTemplate } from "../tasks/taskFlowTemplateRenderer.js";
function readJson(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", () => {
            try {
                resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
            }
            catch {
                reject(new Error("Invalid JSON"));
            }
        });
        req.on("error", reject);
    });
}
function sendJson(res, status, value) {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(value));
}
function sendText(res, status, text) {
    res.writeHead(status, { "Content-Type": "text/plain" });
    res.end(text);
}
function notFound(res) {
    sendJson(res, 404, { ok: false, error: "Not found" });
}
function badRequest(res, msg) {
    sendJson(res, 400, { ok: false, error: msg });
}
function checkAuth(req, token) {
    if (!token)
        return true;
    return (req.headers.authorization ?? "") === `Bearer ${token}`;
}
function agentRowToObj(row) {
    return {
        ...row,
        actions: JSON.parse(row.actions_json),
        models: JSON.parse(row.models_json),
        index: JSON.parse(row.index_json),
        capabilities: JSON.parse(row.capabilities_json),
    };
}
export async function startOrganizerServer(args) {
    const host = args.host ?? "127.0.0.1";
    const port = args.port ?? 8787;
    const token = args.token;
    const staleAfterMs = args.staleAfterMs ?? 15000;
    const db = openOrganizerDatabase(args.dbPath);
    const server = http.createServer(async (req, res) => {
        const method = req.method ?? "GET";
        const url = req.url ?? "/";
        const rawUrl = req.url ?? "/";
        try {
            res.setHeader("Access-Control-Allow-Origin", "*");
            res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
            res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
            if (method === "OPTIONS") {
                res.writeHead(204);
                res.end();
                return;
            }
            if (url === "/") {
                res.writeHead(302, { Location: "/dashboard" });
                res.end();
                return;
            }
            if (url === "/api") {
                sendText(res, 200, [
                    "Agent Smith Organizer online.",
                    "GET  /dashboard",
                    "GET  /api/organizer/status",
                    "GET  /api/agents",
                    "GET  /api/agents/:id",
                    "POST /api/agents/register",
                    "POST /api/agents/:id/heartbeat"
                ].join("\n"));
                return;
            }
            if (url === "/dashboard" || url === "/dashboard/") {
                res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
                res.end(html
                    .replace("_STYLE__URL_", "/dashboard/styles.css")
                    .replace("_SCRIPT__URL_", "/dashboard/client.js")
                    .replace("_API_BASE_", "/api")
                    .replace("_HAS_SIDEBAR_", "true"));
                return;
            }
            if (url === "/dashboard/styles.css") {
                res.writeHead(200, { "Content-Type": "text/css; charset=utf-8" });
                res.end(styles);
                return;
            }
            if (url === "/dashboard/client.js") {
                res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8" });
                res.end(clientJs);
                return;
            }
            if (url === "/api/organizer/status") {
                markStaleAgentsOffline(db, staleAfterMs);
                const agents = listOrganizerAgents(db);
                const counts = { total: agents.length, online: 0, busy: 0, idle: 0, offline: 0 };
                for (const a of agents) {
                    const s = a.status;
                    if (s === "offline")
                        counts.offline++;
                    else if (s === "busy" || s === "indexing")
                        counts.busy++;
                    else if (s === "idle")
                        counts.idle++;
                    else
                        counts.online++;
                }
                const tasks = listOrganizerTasks(db);
                const taskCounts = { total: tasks.length, queued: 0, assigned: 0, running: 0, reviewing: 0, needs_review: 0, auto_approved: 0, completed: 0, skipped: 0, failed: 0 };
                for (const t of tasks) {
                    const s = t.status;
                    if (s in taskCounts)
                        taskCounts[s]++;
                }
                sendJson(res, 200, { ok: true, agents: counts, tasks: taskCounts, projects: listOrganizerProjects(db).length, buckets: listOrganizerBuckets(db).length, url: `http://${host}:${port}` });
                return;
            }
            // Auth for write endpoints
            const needsAuth = method === "POST";
            if (needsAuth && !checkAuth(req, token)) {
                sendJson(res, 401, { ok: false, error: "Unauthorized" });
                return;
            }
            const parts = url.split("/").filter(Boolean);
            // GET /api/agents
            if (url === "/api/agents" && method === "GET") {
                markStaleAgentsOffline(db, staleAfterMs);
                const agents = listOrganizerAgents(db).map(agentRowToObj);
                sendJson(res, 200, { ok: true, agents });
                return;
            }
            // GET /api/agents/:id
            if (parts.length === 3 && parts[0] === "api" && parts[1] === "agents" && method === "GET") {
                markStaleAgentsOffline(db, staleAfterMs);
                const agent = getOrganizerAgent(db, parts[2]);
                if (!agent) {
                    notFound(res);
                    return;
                }
                sendJson(res, 200, { ok: true, agent: agentRowToObj(agent) });
                return;
            }
            // GET /api/agents/:id/tasks
            if (parts.length === 4 && parts[0] === "api" && parts[1] === "agents" && parts[3] === "tasks" && method === "GET") {
                const tasks = listOrganizerTasks(db, { agentId: parts[2] });
                sendJson(res, 200, { ok: true, tasks });
                return;
            }
            // POST /api/agents/register
            if (url === "/api/agents/register" && method === "POST") {
                let body;
                try {
                    body = await readJson(req);
                }
                catch {
                    badRequest(res, "Invalid JSON");
                    return;
                }
                if (!body.agentId) {
                    badRequest(res, "agentId required");
                    return;
                }
                if (!body.name) {
                    badRequest(res, "name required");
                    return;
                }
                if (!body.api?.baseUrl) {
                    badRequest(res, "api.baseUrl required");
                    return;
                }
                const existing = getOrganizerAgent(db, body.agentId);
                const row = upsertOrganizerAgent(db, body);
                if (!existing) {
                    args.onLog?.(`Agent registered: ${body.name} (${body.agentId})`);
                }
                sendJson(res, 200, { ok: true, agent: agentRowToObj(row) });
                return;
            }
            // POST /api/agents/:id/heartbeat
            if (parts.length === 4 && parts[0] === "api" && parts[1] === "agents" && parts[3] === "heartbeat" && method === "POST") {
                const id = parts[2];
                let body;
                try {
                    body = await readJson(req);
                }
                catch {
                    badRequest(res, "Invalid JSON");
                    return;
                }
                if (body.agentId !== id) {
                    badRequest(res, "agentId in URL must match body.agentId");
                    return;
                }
                const row = upsertOrganizerAgent(db, body);
                sendJson(res, 200, { ok: true, agent: agentRowToObj(row) });
                return;
            }
            // ── Projects ──
            if (url === "/api/projects" && method === "GET") {
                sendJson(res, 200, { ok: true, projects: listOrganizerProjects(db) });
                return;
            }
            if (url === "/api/projects" && method === "POST") {
                const b = await readJson(req);
                if (!b || typeof b.name !== "string") {
                    badRequest(res, "name required");
                    return;
                }
                const p = createOrganizerProject(db, { name: b.name, description: typeof b.description === "string" ? b.description : undefined });
                sendJson(res, 200, { ok: true, project: p });
                return;
            }
            if (parts.length === 3 && parts[0] === "api" && parts[1] === "projects") {
                const id = parts[2];
                if (method === "GET") {
                    const p = getOrganizerProject(db, id);
                    if (!p) {
                        notFound(res);
                        return;
                    }
                    sendJson(res, 200, { ok: true, project: p });
                    return;
                }
                if (method === "PATCH") {
                    const b = await readJson(req);
                    const p = updateOrganizerProject(db, id, { name: typeof b?.name === "string" ? b.name : undefined, description: b && "description" in b ? b.description : undefined });
                    if (!p) {
                        notFound(res);
                        return;
                    }
                    sendJson(res, 200, { ok: true, project: p });
                    return;
                }
                if (method === "DELETE") {
                    deleteOrganizerProject(db, id);
                    sendJson(res, 200, { ok: true });
                    return;
                }
            }
            // ── Buckets ──
            if (url === "/api/buckets" && method === "GET") {
                const q = rawUrl.includes("?") ? Object.fromEntries(new URLSearchParams(rawUrl.split("?")[1])) : {};
                sendJson(res, 200, { ok: true, buckets: listOrganizerBuckets(db, q.projectId || undefined) });
                return;
            }
            if (url === "/api/buckets" && method === "POST") {
                const b = await readJson(req);
                if (!b || typeof b.projectId !== "string" || typeof b.name !== "string") {
                    badRequest(res, "projectId and name required");
                    return;
                }
                const bucket = createOrganizerBucket(db, { projectId: b.projectId, name: b.name, description: typeof b.description === "string" ? b.description : undefined, sortOrder: typeof b.sortOrder === "number" ? b.sortOrder : undefined });
                sendJson(res, 200, { ok: true, bucket });
                return;
            }
            if (parts.length === 3 && parts[0] === "api" && parts[1] === "buckets") {
                const id = parts[2];
                if (method === "GET") {
                    const b = getOrganizerBucket(db, id);
                    if (!b) {
                        notFound(res);
                        return;
                    }
                    sendJson(res, 200, { ok: true, bucket: b });
                    return;
                }
                if (method === "PATCH") {
                    const body = await readJson(req);
                    const b = updateOrganizerBucket(db, id, { name: typeof body?.name === "string" ? body.name : undefined, description: body && "description" in body ? body.description : undefined, sortOrder: typeof body?.sortOrder === "number" ? body.sortOrder : undefined });
                    if (!b) {
                        notFound(res);
                        return;
                    }
                    sendJson(res, 200, { ok: true, bucket: b });
                    return;
                }
                if (method === "DELETE") {
                    deleteOrganizerBucket(db, id);
                    sendJson(res, 200, { ok: true });
                    return;
                }
            }
            // ── Tasks ──
            if (url === "/api/tasks" && method === "GET") {
                const q = rawUrl.includes("?") ? Object.fromEntries(new URLSearchParams(rawUrl.split("?")[1])) : {};
                sendJson(res, 200, { ok: true, tasks: listOrganizerTasks(db, { projectId: q.projectId, bucketId: q.bucketId, status: q.status, agentId: q.agentId }) });
                return;
            }
            if (url === "/api/tasks" && method === "POST") {
                const b = await readJson(req);
                if (!b || typeof b.projectId !== "string" || typeof b.title !== "string" || typeof b.prompt !== "string") {
                    badRequest(res, "projectId, title, and prompt required");
                    return;
                }
                const checks = Array.isArray(b.checks) ? b.checks.filter((c) => typeof c === "string") : undefined;
                const t = createOrganizerTask(db, {
                    projectId: b.projectId,
                    bucketId: typeof b.bucketId === "string" ? b.bucketId : undefined,
                    title: b.title,
                    prompt: b.prompt,
                    mode: typeof b.mode === "string" ? b.mode : undefined,
                    priority: typeof b.priority === "number" ? b.priority : undefined,
                    implementModel: typeof b.implementModel === "string" ? b.implementModel : undefined,
                    reviewModel: typeof b.reviewModel === "string" ? b.reviewModel : undefined,
                    maxIterations: typeof b.maxIterations === "number" ? b.maxIterations : undefined,
                    autoApprove: typeof b.autoApprove === "boolean" ? b.autoApprove : undefined,
                    autoApply: typeof b.autoApply === "boolean" ? b.autoApply : undefined,
                    requireChecks: typeof b.requireChecks === "boolean" ? b.requireChecks : undefined,
                    checks
                });
                sendJson(res, 200, { ok: true, task: t });
                return;
            }
            if (parts.length === 3 && parts[0] === "api" && parts[1] === "tasks") {
                const id = parts[2];
                if (method === "GET") {
                    const t = getOrganizerTask(db, id);
                    if (!t) {
                        notFound(res);
                        return;
                    }
                    sendJson(res, 200, { ok: true, task: t });
                    return;
                }
                if (method === "PATCH") {
                    const b = await readJson(req);
                    const checks = Array.isArray(b?.checks) ? b.checks.filter((c) => typeof c === "string") : undefined;
                    const t = updateOrganizerTask(db, id, {
                        title: typeof b?.title === "string" ? b.title : undefined,
                        prompt: typeof b?.prompt === "string" ? b.prompt : undefined,
                        mode: typeof b?.mode === "string" ? b.mode : undefined,
                        priority: typeof b?.priority === "number" ? b.priority : undefined,
                        status: typeof b?.status === "string" ? b.status : undefined,
                        bucketId: b && "bucketId" in b ? b.bucketId : undefined,
                        implementModel: b && "implementModel" in b ? b.implementModel : undefined,
                        reviewModel: b && "reviewModel" in b ? b.reviewModel : undefined,
                        maxIterations: typeof b?.maxIterations === "number" ? b.maxIterations : undefined,
                        currentIteration: typeof b?.currentIteration === "number" ? b.currentIteration : undefined,
                        autoApprove: typeof b?.autoApprove === "boolean" ? b.autoApprove : undefined,
                        autoApply: typeof b?.autoApply === "boolean" ? b.autoApply : undefined,
                        requireChecks: typeof b?.requireChecks === "boolean" ? b.requireChecks : undefined,
                        checksJson: checks ? JSON.stringify(checks) : undefined,
                        assignedAgentId: typeof b?.assignedAgentId === "string" ? b.assignedAgentId : undefined
                    });
                    if (!t) {
                        notFound(res);
                        return;
                    }
                    sendJson(res, 200, { ok: true, task: t });
                    return;
                }
                if (method === "DELETE") {
                    deleteOrganizerTask(db, id);
                    sendJson(res, 200, { ok: true });
                    return;
                }
            }
            if (parts.length === 4 && parts[0] === "api" && parts[1] === "tasks" && parts[3] === "assign" && method === "POST") {
                const b = await readJson(req);
                if (!b || typeof b.agentId !== "string") {
                    badRequest(res, "agentId required");
                    return;
                }
                const t = assignOrganizerTask(db, parts[2], b.agentId);
                if (!t) {
                    notFound(res);
                    return;
                }
                recordOrganizerTaskEvent(db, { taskId: t.id, agentId: b.agentId, eventType: "assigned", message: `Assigned to ${b.agentId}` });
                sendJson(res, 200, { ok: true, task: t });
                return;
            }
            if (parts.length === 4 && parts[0] === "api" && parts[1] === "tasks" && parts[3] === "events" && method === "GET") {
                const t = getOrganizerTask(db, parts[2]);
                if (!t) {
                    notFound(res);
                    return;
                }
                sendJson(res, 200, { ok: true, events: listOrganizerTaskEvents(db, parts[2]) });
                return;
            }
            // Dispatch
            if (parts.length === 4 && parts[0] === "api" && parts[1] === "tasks" && parts[3] === "dispatch" && method === "POST") {
                const b = await readJson(req);
                const result = await dispatchOrganizerTask({ db, taskId: parts[2], workerToken: typeof b?.workerToken === "string" ? b.workerToken : undefined });
                sendJson(res, result.ok ? 200 : 400, result);
                return;
            }
            if (url === "/api/tasks/dispatch-next" && method === "POST") {
                const b = await readJson(req);
                const agentId = typeof b?.agentId === "string" ? b.agentId : undefined;
                const workerToken = typeof b?.workerToken === "string" ? b.workerToken : undefined;
                let tasks = listOrganizerTasks(db, { status: "assigned" });
                if (agentId)
                    tasks = tasks.filter((t) => t.assignedAgentId === agentId);
                if (tasks.length === 0) {
                    tasks = listOrganizerTasks(db, { status: "queued" });
                    if (agentId && tasks.length > 0) {
                        const t = assignOrganizerTask(db, tasks[0].id, agentId);
                        if (t) {
                            recordOrganizerTaskEvent(db, { taskId: t.id, agentId, eventType: "assigned", message: `Auto-assigned to ${agentId}` });
                        }
                        tasks = listOrganizerTasks(db, { status: "assigned" });
                        if (agentId)
                            tasks = tasks.filter((t) => t.assignedAgentId === agentId);
                    }
                }
                if (tasks.length === 0) {
                    sendJson(res, 200, { ok: false, error: "No dispatchable task found." });
                    return;
                }
                const result = await dispatchOrganizerTask({ db, taskId: tasks[0].id, workerToken });
                sendJson(res, result.ok ? 200 : 400, result);
                return;
            }
            // Iterations
            if (parts.length === 4 && parts[0] === "api" && parts[1] === "tasks" && parts[3] === "iterations" && method === "GET") {
                const t = getOrganizerTask(db, parts[2]);
                const iterations = listOrganizerTaskIterations(db, parts[2]);
                sendJson(res, 200, { ok: true, task: t, iterations });
                return;
            }
            // Timeline
            if (parts.length === 4 && parts[0] === "api" && parts[1] === "tasks" && parts[3] === "timeline" && method === "GET") {
                const timeline = buildOrganizerTaskTimeline(db, parts[2]);
                if (!timeline.task) {
                    notFound(res);
                    return;
                }
                sendJson(res, 200, { ok: true, timeline });
                return;
            }
            // Agent task flow
            if (parts.length === 4 && parts[0] === "api" && parts[1] === "agents" && parts[3] === "tasks" && method === "GET") {
                markStaleAgentsOffline(db, staleAfterMs);
                const agent = getOrganizerAgent(db, parts[2]);
                if (!agent) {
                    notFound(res);
                    return;
                }
                const tasks = listOrganizerTasks(db, { agentId: parts[2] });
                const groups = { active: [], waiting: [], review: [], done: [] };
                for (const t of tasks) {
                    const s = t.status;
                    if (s === "running" || s === "reviewing" || s === "iterating")
                        groups.active.push(t);
                    else if (s === "queued" || s === "assigned")
                        groups.waiting.push(t);
                    else if (s === "needs_review" || s === "auto_approved")
                        groups.review.push(t);
                    else
                        groups.done.push(t);
                }
                sendJson(res, 200, { ok: true, agent: agentRowToObj(agent), tasks, groups });
                return;
            }
            // Restart
            if (parts.length === 4 && parts[0] === "api" && parts[1] === "tasks" && parts[3] === "restart" && method === "POST") {
                const t = getOrganizerTask(db, parts[2]);
                if (!t) {
                    notFound(res);
                    return;
                }
                updateOrganizerTask(db, parts[2], { status: t.assignedAgentId ? "assigned" : "queued", currentIteration: 0, resultJson: null, remoteTaskId: null, remoteChangeSetId: null });
                recordOrganizerTaskEvent(db, { taskId: parts[2], eventType: "restarted", message: "Task restarted" });
                sendJson(res, 200, { ok: true, message: "Task restarted" });
                return;
            }
            // Skip
            if (parts.length === 4 && parts[0] === "api" && parts[1] === "tasks" && parts[3] === "skip" && method === "POST") {
                const t = getOrganizerTask(db, parts[2]);
                if (!t) {
                    notFound(res);
                    return;
                }
                updateOrganizerTask(db, parts[2], { status: "skipped" });
                recordOrganizerTaskEvent(db, { taskId: parts[2], eventType: "skipped", message: "Task skipped" });
                sendJson(res, 200, { ok: true, message: "Task skipped" });
                return;
            }
            // Approve
            if (parts.length === 4 && parts[0] === "api" && parts[1] === "tasks" && parts[3] === "approve" && method === "POST") {
                const t = getOrganizerTask(db, parts[2]);
                if (!t) {
                    notFound(res);
                    return;
                }
                const b = await readJson(req);
                const status = b?.apply === true ? "auto_approved" : "completed";
                updateOrganizerTask(db, parts[2], { status });
                recordOrganizerTaskEvent(db, { taskId: parts[2], eventType: "approved", message: `Task ${status}` });
                sendJson(res, 200, { ok: true, message: `Task ${status}` });
                return;
            }
            // Task import
            if (url === "/api/tasks/import-preview" && method === "POST") {
                const b = await readJson(req);
                const text = typeof b?.text === "string" ? b.text : "";
                const fmt = typeof b?.format === "string" ? b.format : undefined;
                const preview = parseTaskImport(text, fmt);
                sendJson(res, 200, { ok: true, preview });
                return;
            }
            if (url === "/api/tasks/import" && method === "POST") {
                const b = await readJson(req);
                const text = typeof b?.text === "string" ? b.text : "";
                const fmt = typeof b?.format === "string" ? b.format : undefined;
                const defaults = (b?.defaults ?? {});
                if (typeof defaults.projectId !== "string") {
                    badRequest(res, "defaults.projectId required");
                    return;
                }
                const options = (b?.options ?? {});
                const result = importOrganizerTasks({
                    db, text, format: fmt,
                    defaults: {
                        projectId: defaults.projectId,
                        bucketId: typeof defaults.bucketId === "string" ? defaults.bucketId : undefined,
                        bucketName: typeof defaults.bucketName === "string" ? defaults.bucketName : undefined,
                        assignedAgentId: typeof defaults.assignedAgentId === "string" ? defaults.assignedAgentId : undefined,
                        implementModel: typeof defaults.implementModel === "string" ? defaults.implementModel : undefined,
                        reviewModel: typeof defaults.reviewModel === "string" ? defaults.reviewModel : undefined,
                        maxIterations: typeof defaults.maxIterations === "number" ? defaults.maxIterations : 1,
                        autoApprove: typeof defaults.autoApprove === "boolean" ? defaults.autoApprove : false,
                        autoApply: typeof defaults.autoApply === "boolean" ? defaults.autoApply : false,
                        requireChecks: typeof defaults.requireChecks === "boolean" ? defaults.requireChecks : false,
                        checks: Array.isArray(defaults.checks) ? defaults.checks : undefined,
                        priority: typeof defaults.priority === "number" ? defaults.priority : undefined
                    },
                    options: {
                        createMissingBuckets: !!options.createMissingBuckets,
                        skipDuplicates: !!options.skipDuplicates,
                        dispatchImmediately: false
                    }
                });
                sendJson(res, 200, { ok: true, result });
                return;
            }
            // Agent chat proxy — /api/agents/:agentId/chats
            if (parts.length >= 3 && parts[0] === "api" && parts[1] === "agents") {
                const agentId = parts[2];
                const agent = getOrganizerAgent(db, agentId);
                if (!agent) {
                    notFound(res);
                    return;
                }
                const client = createWorkerApiClient({ baseUrl: agent.api_base_url, token: token });
                if (parts.length === 4 && parts[3] === "chats") {
                    if (method === "GET") {
                        const r = await client.listChatSessions?.();
                        sendJson(res, r?.ok ? 200 : 502, r?.ok ? { ok: true, sessions: r.sessions } : { ok: false, error: r?.error ?? "Agent API unreachable" });
                        return;
                    }
                    if (method === "POST") {
                        const b = await readJson(req);
                        const r = await client.createChatSession?.(b ?? {});
                        sendJson(res, r?.ok ? 200 : 502, r?.ok ? { ok: true, session: r.session } : { ok: false, error: r?.error ?? "Agent API unreachable" });
                        return;
                    }
                }
                // Alias: /api/agents/:id/chat/sessions → same as /api/agents/:id/chats
                if (parts.length === 5 && parts[3] === "chat" && parts[4] === "sessions") {
                    if (method === "GET") {
                        const r = await client.listChatSessions?.();
                        sendJson(res, r?.ok ? 200 : 502, r?.ok ? { ok: true, sessions: r.sessions } : { ok: false, error: r?.error ?? "Agent API unreachable" });
                        return;
                    }
                    if (method === "POST") {
                        const b = await readJson(req);
                        const r = await client.createChatSession?.(b ?? {});
                        sendJson(res, r?.ok ? 200 : 502, r?.ok ? { ok: true, session: r.session } : { ok: false, error: r?.error ?? "Agent API unreachable" });
                        return;
                    }
                }
                if (parts.length === 5 && parts[3] === "chats") {
                    const sessionId = parts[4];
                    if (method === "GET") {
                        const r = await client.getChatSession?.(sessionId);
                        sendJson(res, r?.ok ? 200 : 502, r?.ok ? { ok: true, session: r.session, messages: r.messages, openQuestions: r.openQuestions } : { ok: false, error: r?.error ?? "Agent API unreachable" });
                        return;
                    }
                    if (method === "POST") {
                        const b = await readJson(req);
                        if (!b || typeof b.prompt !== "string") {
                            badRequest(res, "prompt required");
                            return;
                        }
                        const r = await client.sendChatMessage?.(sessionId, { prompt: b.prompt, actionKind: typeof b.actionKind === "string" ? b.actionKind : undefined, model: typeof b.model === "string" ? b.model : undefined });
                        sendJson(res, r?.ok ? 200 : 502, r?.ok ? { ok: true, session: r.session, messages: r.messages } : { ok: false, error: r?.error ?? "Agent API unreachable" });
                        return;
                    }
                }
                // Alias: /api/agents/:id/chat/sessions/:sid → same as /api/agents/:id/chats/:sid
                if (parts.length === 6 && parts[3] === "chat" && parts[4] === "sessions") {
                    const sessionId = parts[5];
                    if (method === "GET") {
                        const r = await client.getChatSession?.(sessionId);
                        sendJson(res, r?.ok ? 200 : 502, r?.ok ? { ok: true, session: r.session, messages: r.messages, openQuestions: r.openQuestions } : { ok: false, error: r?.error ?? "Agent API unreachable" });
                        return;
                    }
                    if (method === "POST") {
                        const b = await readJson(req);
                        if (!b || typeof b.prompt !== "string") {
                            badRequest(res, "prompt required");
                            return;
                        }
                        const r = await client.sendChatMessage?.(sessionId, { prompt: b.prompt, actionKind: typeof b.actionKind === "string" ? b.actionKind : undefined, model: typeof b.model === "string" ? b.model : undefined });
                        sendJson(res, r?.ok ? 200 : 502, r?.ok ? { ok: true, session: r.session, messages: r.messages } : { ok: false, error: r?.error ?? "Agent API unreachable" });
                        return;
                    }
                }
                if (parts.length === 4 && parts[3] === "questions") {
                    const agentClient = createWorkerApiClient({ baseUrl: agent.api_base_url, token: token });
                    if (method === "GET") {
                        const r = await agentClient.getOpenQuestions?.();
                        sendJson(res, r?.ok ? 200 : 502, r?.ok ? { ok: true, questions: r.questions } : { ok: false, error: r?.error ?? "Agent API unreachable" });
                        return;
                    }
                }
                if (parts.length === 4 && parts[3] === "models" && method === "GET") {
                    const agentClient = createWorkerApiClient({ baseUrl: agent.api_base_url, token: token });
                    const r = await agentClient.listModels?.();
                    sendJson(res, r?.ok ? 200 : 502, r?.ok ? { ok: true, models: r.models } : { ok: false, error: r?.error ?? "Agent API unreachable" });
                    return;
                }
                if (parts.length === 4 && parts[3] === "filetree" && method === "GET") {
                    const agentClient = createWorkerApiClient({ baseUrl: agent.api_base_url, token: token });
                    const r = await agentClient.getFileTree?.();
                    sendJson(res, r?.ok ? 200 : 502, r?.ok ? { ok: true, files: r.files } : { ok: false, error: r?.error ?? "Agent API unreachable" });
                    return;
                }
                if (parts.length === 4 && parts[3] === "file" && method === "GET") {
                    const rawUrl = req.url ?? "/";
                    const filePath = new URLSearchParams(rawUrl.includes("?") ? rawUrl.slice(rawUrl.indexOf("?")) : "").get("path") ?? "";
                    if (!filePath) {
                        sendJson(res, 400, { ok: false, error: "?path= required" });
                        return;
                    }
                    const agentClient = createWorkerApiClient({ baseUrl: agent.api_base_url, token: token });
                    const r = await agentClient.getFile?.(filePath);
                    sendJson(res, r?.ok ? 200 : 502, r?.ok ? { ok: true, content: r.content, summary: r.summary } : { ok: false, error: r?.error ?? "Agent API unreachable" });
                    return;
                }
                if (parts.length === 4 && parts[3] === "dashboard" && method === "GET") {
                    const agentClient = createWorkerApiClient({ baseUrl: agent.api_base_url, token: token });
                    const r = await agentClient.getDashboard?.();
                    sendJson(res, r?.ok ? 200 : 502, r?.ok ? { ok: true, ...r.data } : { ok: false, error: r?.error ?? "Agent API unreachable" });
                    return;
                }
                if (parts.length === 5 && parts[3] === "questions") {
                    const questionId = parts[4];
                    if (method === "POST") {
                        const b = await readJson(req);
                        const r = await client.answerQuestion?.(questionId, b?.answer);
                        sendJson(res, r?.ok ? 200 : 502, r?.ok ? { ok: true, question: r.question } : { ok: false, error: r?.error ?? "Agent API unreachable" });
                        return;
                    }
                }
            }
            // Templates
            if (url === "/api/task-flow-templates" && method === "GET") {
                sendJson(res, 200, { ok: true, templates: TASK_FLOW_TEMPLATES });
                return;
            }
            if (url === "/api/task-flow-templates/render" && method === "POST") {
                const b = await readJson(req);
                const templateId = typeof b?.templateId === "string" ? b.templateId : "";
                const format = (typeof b?.format === "string" ? b.format : "markdown");
                const options = (b?.options ?? {});
                try {
                    const result = renderTaskFlowTemplate({
                        templateId,
                        format,
                        options: {
                            projectName: typeof options.projectName === "string" ? options.projectName : undefined,
                            bucketName: typeof options.bucketName === "string" ? options.bucketName : undefined,
                            assignedAgentId: typeof options.assignedAgentId === "string" ? options.assignedAgentId : undefined,
                            implementModel: typeof options.implementModel === "string" ? options.implementModel : undefined,
                            reviewModel: typeof options.reviewModel === "string" ? options.reviewModel : undefined,
                            maxIterations: typeof options.maxIterations === "number" ? options.maxIterations : undefined,
                            autoApprove: typeof options.autoApprove === "boolean" ? options.autoApprove : undefined,
                            autoApply: typeof options.autoApply === "boolean" ? options.autoApply : undefined,
                            requireChecks: typeof options.requireChecks === "boolean" ? options.requireChecks : undefined,
                            checks: Array.isArray(options.checks) ? options.checks : undefined
                        }
                    });
                    sendJson(res, 200, { ok: true, filename: result.filename, mimeType: result.mimeType, content: result.content });
                }
                catch (err) {
                    sendJson(res, 400, { ok: false, error: err instanceof Error ? err.message : "Unknown error" });
                }
                return;
            }
            notFound(res);
        }
        catch (err) {
            sendJson(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err) });
        }
    });
    return new Promise((resolve, reject) => {
        server.on("error", reject);
        server.listen(port, host, () => {
            resolve({
                host, port,
                url: `http://${host}:${port}`,
                stop: () => new Promise((res) => server.close(() => res()))
            });
        });
    });
}
