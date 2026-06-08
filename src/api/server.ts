import http from "node:http";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { createSmithRuntime } from "../runtime/smithRuntime.js";
import type { SmithRuntimeDeps, RuntimeStatus } from "../runtime/smithRuntime.js";
import type { RuntimeAction, RuntimeTaskResult, WorkItemStatus } from "../types/index.js";
import { createWorkItem, listWorkItems, getWorkItem, updateWorkItemStatus, deleteWorkItem } from "../tasks/taskStore.js";
import { sendChatMessage, getSessionWithMessages } from "../chat/chatRuntime.js";
import { listProviderModels } from "../providers/providers.js";
import { createChatSession, listChatSessions, getChatSession, deleteChatSession, listChatMessages, addChatMessage } from "../chat/chatStore.js";
import { getOpenQuestions, answerUserQuestion, cancelUserQuestion, updateChatSessionTitle } from "../chat/chatStore.js";
import { createTaskPlanStep, listTaskPlanSteps, replaceTaskPlan, updateTaskPlanStepStatus, updateTaskPlanStepNotes, updateTaskPlanStepTitle, reorderTaskPlanStep, deleteTaskPlanStep } from "../tasks/taskPlanStore.js";
import { listChangeSets, getChangeSet, listChangedFiles, listChangedHunks, updateChangeSetStatus, updateChangedFileStatus, updateChangedHunkStatus } from "../changes/changeSetStore.js";
import { applyAcceptedChangeSet, applyAcceptedHunksChangeSet } from "../changes/changeSetApply.js";
import { revertCheckpoint } from "../checkpoints/gitCheckpoint.js";

export type SmithApiServer = {
  host: string;
  port: number;
  url: string;
  stop(): Promise<void>;
};

function readJson(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      try {
        resolve(raw ? JSON.parse(raw) : null);
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: http.ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(value));
}

function sendText(res: http.ServerResponse, status: number, text: string): void {
  res.writeHead(status, { "Content-Type": "text/plain" });
  res.end(text);
}

function notFound(res: http.ServerResponse): void {
  sendJson(res, 404, { ok: false, error: "Not found" });
}

function isLocal(req: http.IncomingMessage): boolean {
  const addr = req.socket?.remoteAddress ?? "";
  return addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1" || addr === "localhost";
}

function checkAuth(req: http.IncomingMessage, token?: string): boolean {
  if (!token) return isLocal(req);
  const auth = req.headers.authorization ?? "";
  return auth === `Bearer ${token}`;
}

function getQuery(url: string): Record<string, string> {
  const idx = url.indexOf("?");
  if (idx < 0) return {};
  const params: Record<string, string> = {};
  for (const pair of url.slice(idx + 1).split("&")) {
    const [k, v] = pair.split("=");
    if (k) params[decodeURIComponent(k)] = decodeURIComponent(v ?? "");
  }
  return params;
}

type RouteFn = (req: http.IncomingMessage, res: http.ServerResponse, deps: ServerDeps) => Promise<void>;
type ServerDeps = { root: string; config: SmithRuntimeDeps["config"]; db: SmithRuntimeDeps["db"]; events: SmithRuntimeDeps["events"]; indexer: SmithRuntimeDeps["indexer"]; runtime: ReturnType<typeof createSmithRuntime>; token?: string };

export async function startApiServer(args: {
  root: string;
  config: SmithRuntimeDeps["config"];
  db: SmithRuntimeDeps["db"];
  events: SmithRuntimeDeps["events"];
  indexer: SmithRuntimeDeps["indexer"];
  host?: string;
  port?: number;
  token?: string;
}): Promise<SmithApiServer> {
  const { root, config, db, events, indexer } = args;
  const host = args.host ?? "127.0.0.1";
  const port = args.port ?? 31337;
  const token = args.token;

  const runtime = createSmithRuntime({ root, config, db, events, indexer });
  const deps: ServerDeps = { root, config, db, events, indexer, runtime, token };

  const server = http.createServer(async (req, res) => {
    const method = req.method ?? "GET";
    const rawUrl = req.url ?? "/";
    const url = rawUrl.split("?")[0];

    try {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

      if (method === "OPTIONS") {
        res.writeHead(204); res.end(); return;
      }

      // Public routes
      if (url === "/" || url === "/api") {
        sendText(res, 200, ["Agent Smith API online.", "GET  /api/status", "GET  /api/tasks", "POST /api/tasks", "GET  /api/tasks/:id", "PATCH /api/tasks/:id", "DELETE /api/tasks/:id", "GET  /api/tasks/:id/plan", "PUT  /api/tasks/:id/plan", "POST /api/tasks/:id/plan/steps", "POST /api/tasks/:id/patch", "PATCH /api/plan-steps/:stepId", "DELETE /api/plan-steps/:stepId", "GET  /api/changes", "GET  /api/changes/:id", "POST /api/changes/:id/accept", "POST /api/changes/:id/reject", "POST /api/changes/:id/apply", "POST /api/changes/:id/revert", "PATCH /api/changes/:id/file-status", "PATCH /api/hunks/:hunkId", "POST /api/actions", "GET  /api/events"].join("\n"));
        return;
      }

      if (url === "/api/status") {
        sendJson(res, 200, { ok: true, status: runtime.getStatus() });
        return;
      }

      // Auth required beyond this point
      if (!checkAuth(req, token)) {
        sendJson(res, 401, { ok: false, error: "Unauthorized" });
        return;
      }

      const parts = url.split("/").filter(Boolean);

      // POST /api/actions
      if (method === "POST" && url === "/api/actions") {
        let body: unknown;
        try { body = await readJson(req); } catch { sendJson(res, 400, { ok: false, error: "Invalid JSON" }); return; }
        if (!body || typeof body !== "object" || typeof (body as Record<string, unknown>).kind !== "string") {
          sendJson(res, 400, { ok: false, error: "body.kind must be a string" }); return;
        }
        const result = await runtime.dispatch(body as RuntimeAction);
        sendJson(res, 200, { ok: result.ok, result });
        return;
      }

      // GET /api/events
      if (url === "/api/events") {
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
        res.write(":ok\n\n");
        const eventNames = ["task:phase", "task:context", "task:answer", "task:patch", "task:stream", "index:progress", "watcher:fileChanged"];
        const handlers: Array<[string, (...args: unknown[]) => void]> = [];
        for (const name of eventNames) {
          const handler = (data: unknown) => { try { res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`); } catch {} };
          events.on(name, handler);
          handlers.push([name, handler]);
        }
        req.on("close", () => { for (const [n, h] of handlers) events.off(n, h); });
        return;
      }

      // Task endpoints
      const taskId = parts.length >= 3 && parts[0] === "api" && parts[1] === "tasks" && parts.length >= 3 ? parts[2] : null;
      const subAction = parts.length >= 4 ? parts[3] : null;
      const subSub = parts.length >= 5 ? parts[4] : null;

      if (taskId && url === `/api/tasks/${taskId}`) {
        if (method === "GET") {
          const item = getWorkItem(db, taskId);
          if (!item) { sendJson(res, 404, { ok: false, error: "Task not found" }); return; }
          const plan = listTaskPlanSteps(db, taskId);
          const changeSets = db.prepare("SELECT id, status, summary, created_at, updated_at FROM change_sets WHERE task_id = ? ORDER BY created_at DESC").all(taskId);
          sendJson(res, 200, { ok: true, task: item, plan, changeSets });
          return;
        }
        if (method === "PATCH") {
          const body = await readJson(req) as Record<string, unknown> | null;
          if (!body) { sendJson(res, 400, { ok: false, error: "Invalid JSON" }); return; }
          if (typeof body.status === "string") updateWorkItemStatus(db, taskId, body.status as WorkItemStatus);
          if (typeof body.description === "string") {
            db.prepare("UPDATE work_items SET description = ?, updated_at = ? WHERE id = ?").run(body.description, Date.now(), taskId);
          }
          if (typeof body.assignedAgentId === "string") {
            db.prepare("UPDATE work_items SET assigned_agent_id = ?, updated_at = ? WHERE id = ?").run(body.assignedAgentId, Date.now(), taskId);
          }
          const updated = getWorkItem(db, taskId);
          sendJson(res, 200, { ok: true, task: updated });
          return;
        }
        if (method === "DELETE") {
          deleteWorkItem(db, taskId);
          sendJson(res, 200, { ok: true });
          return;
        }
      }

      // GET /api/tasks
      if (url === "/api/tasks" && method === "GET") {
        const q = getQuery(rawUrl);
        const items = listWorkItems(db, { status: q.status as WorkItemStatus, source: q.source as "user" | "agent" | "organizer" | "api" });
        sendJson(res, 200, { ok: true, tasks: items });
        return;
      }

      // POST /api/tasks
      if (url === "/api/tasks" && method === "POST") {
        const body = await readJson(req) as Record<string, unknown> | null;
        if (!body || typeof body.title !== "string") { sendJson(res, 400, { ok: false, error: "body.title is required" }); return; }
        const item = createWorkItem(db, {
          title: body.title as string,
          description: typeof body.description === "string" ? body.description as string : undefined,
          priority: typeof body.priority === "number" ? body.priority as number : undefined,
          source: (typeof body.source === "string" ? body.source : "api") as "user" | "agent" | "organizer" | "api",
          parentId: typeof body.parentId === "string" ? body.parentId as string : undefined,
          assignedAgentId: typeof body.assignedAgentId === "string" ? body.assignedAgentId as string : undefined,
        });
        sendJson(res, 200, { ok: true, task: item });
        return;
      }

      // GET /api/tasks/:id/plan
      if (taskId && subAction === "plan" && !subSub && method === "GET") {
        const steps = listTaskPlanSteps(db, taskId);
        sendJson(res, 200, { ok: true, taskId, steps });
        return;
      }

      // PUT /api/tasks/:id/plan
      if (taskId && subAction === "plan" && !subSub && method === "PUT") {
        const body = await readJson(req) as Record<string, unknown> | null;
        if (!body || !Array.isArray(body.steps)) { sendJson(res, 400, { ok: false, error: "body.steps must be an array" }); return; }
        const normSteps = (body.steps as Array<unknown>).map((s: unknown) => {
          if (typeof s === "string") return s;
          if (typeof s === "object" && s) return s as { title: string; status?: string; notes?: string };
          return { title: "" };
        });
        const steps = replaceTaskPlan(db, taskId, normSteps as Array<{ title: string; status?: "todo" | "doing" | "done" | "skipped" | "failed"; notes?: string }>);
        sendJson(res, 200, { ok: true, steps });
        return;
      }

      // POST /api/tasks/:id/plan/steps
      if (taskId && subAction === "plan" && subSub === "steps" && method === "POST") {
        const body = await readJson(req) as Record<string, unknown> | null;
        if (!body || typeof body.title !== "string") { sendJson(res, 400, { ok: false, error: "body.title is required" }); return; }
        const step = createTaskPlanStep(db, {
          taskId,
          title: body.title as string,
          status: typeof body.status === "string" ? body.status as "todo" | "doing" | "done" | "skipped" | "failed" : undefined,
          notes: typeof body.notes === "string" ? body.notes as string : undefined,
          sortOrder: typeof body.sortOrder === "number" ? body.sortOrder as number : undefined,
        });
        sendJson(res, 200, { ok: true, step });
        return;
      }

      // POST /api/tasks/:id/patch
      if (taskId && subAction === "patch" && !subSub && method === "POST") {
        const body = await readJson(req) as Record<string, unknown> | null;
        const apply = body?.apply === true;
        const dryRun = body?.dryRun === true;
        const task = getWorkItem(db, taskId);
        if (!task) { sendJson(res, 404, { ok: false, error: "Task not found" }); return; }
        let prompt = task.title;
        if (task.description) prompt += "\n\n" + task.description;
        const steps = listTaskPlanSteps(db, taskId);
        if (steps.length > 0) {
          const chars: Record<string, string> = { todo: "[ ]", doing: "[~]", done: "[x]", skipped: "[-]", failed: "[!]" };
          prompt += "\n\nTask plan:\n" + steps.map((s) => `${chars[s.status] ?? "[?]"} ${s.title}`).join("\n");
        }
        updateWorkItemStatus(db, taskId, "in_progress");
        const result = await runtime.dispatch({ kind: "patch", prompt, taskId, apply, dryRun });
        if (result.ok) {
          const data = result.data as Record<string, unknown> | undefined;
          if (apply) updateWorkItemStatus(db, taskId, "done");
          else if (data?.changeSetId) updateWorkItemStatus(db, taskId, "needs_review");
        } else {
          updateWorkItemStatus(db, taskId, "failed");
        }
        sendJson(res, 200, { ok: result.ok, result });
        return;
      }

      // PATCH /api/plan-steps/:stepId
      if (parts.length === 3 && parts[0] === "api" && parts[1] === "plan-steps" && method === "PATCH") {
        const stepId = parts[2];
        const body = await readJson(req) as Record<string, unknown> | null;
        if (!body) { sendJson(res, 400, { ok: false, error: "Invalid JSON" }); return; }
        if (typeof body.status === "string") updateTaskPlanStepStatus(db, stepId, body.status as "todo" | "doing" | "done" | "skipped" | "failed");
        if (typeof body.notes === "string") updateTaskPlanStepNotes(db, stepId, body.notes as string);
        if (typeof body.title === "string") updateTaskPlanStepTitle(db, stepId, body.title as string);
        if (typeof body.sortOrder === "number") reorderTaskPlanStep(db, stepId, body.sortOrder as number);
        const step = db.prepare("SELECT * FROM task_plan_steps WHERE id = ?").get(stepId);
        sendJson(res, 200, { ok: true, step });
        return;
      }

      // DELETE /api/plan-steps/:stepId
      if (parts.length === 3 && parts[0] === "api" && parts[1] === "plan-steps" && method === "DELETE") {
        deleteTaskPlanStep(db, parts[2]);
        sendJson(res, 200, { ok: true });
        return;
      }

      // Template routes
      if (url === "/api/task-flow-templates" && method === "GET") {
        const { TASK_FLOW_TEMPLATES } = await import("../tasks/taskFlowTemplates.js");
        sendJson(res, 200, { ok: true, templates: TASK_FLOW_TEMPLATES });
        return;
      }
      if (url === "/api/task-flow-templates/render" && method === "POST") {
        const { renderTaskFlowTemplate } = await import("../tasks/taskFlowTemplateRenderer.js");
        const b = await readJson(req) as Record<string, unknown> | null;
        const templateId = typeof b?.templateId === "string" ? b.templateId : "";
        const format = (typeof b?.format === "string" ? b.format : "markdown") as "markdown" | "json" | "csv" | "plain";
        const options = (b?.options ?? {}) as Record<string, unknown>;
        try {
          const result = renderTaskFlowTemplate({
            templateId, format,
            options: {
              projectName: typeof options.projectName === "string" ? options.projectName : undefined,
              assignedAgentId: typeof options.assignedAgentId === "string" ? options.assignedAgentId : undefined,
              implementModel: typeof options.implementModel === "string" ? options.implementModel : undefined,
              reviewModel: typeof options.reviewModel === "string" ? options.reviewModel : undefined,
              maxIterations: typeof options.maxIterations === "number" ? options.maxIterations : undefined,
              autoApprove: typeof options.autoApprove === "boolean" ? options.autoApprove : undefined,
              autoApply: typeof options.autoApply === "boolean" ? options.autoApply : undefined,
              checks: Array.isArray(options.checks) ? options.checks as string[] : undefined
            }
          });
          sendJson(res, 200, { ok: true, filename: result.filename, mimeType: result.mimeType, content: result.content });
        } catch (err) {
          sendJson(res, 400, { ok: false, error: err instanceof Error ? err.message : "Unknown error" });
        }
        return;
      }

      // Chat routes
      if (url === "/api/chat/sessions" && method === "GET") {
        sendJson(res, 200, { ok: true, sessions: listChatSessions(db) });
        return;
      }
      if (url === "/api/chat/sessions" && method === "POST") {
        const b = await readJson(req) as Record<string, unknown> | null;
        const s = createChatSession(db, { title: typeof b?.title === "string" ? b.title : undefined, scope: typeof b?.scope === "string" ? b.scope as "local" | "task" : undefined, taskId: typeof b?.taskId === "string" ? b.taskId : undefined, changeSetId: typeof b?.changeSetId === "string" ? b.changeSetId : undefined });
        sendJson(res, 200, { ok: true, session: s });
        return;
      }
      if (parts.length === 4 && parts[0] === "api" && parts[1] === "chat" && parts[2] === "sessions") {
        const id = parts[3];
        if (method === "GET") {
          const data = await getSessionWithMessages(db, id);
          if (!data) { notFound(res); return; }
          sendJson(res, 200, { ok: true, session: data.session, messages: data.messages, openQuestions: data.openQuestions });
          return;
        }
        if (method === "POST") {
          const b = await readJson(req) as Record<string, unknown> | null;
          if (!b || typeof b.prompt !== "string") { sendJson(res, 400, { ok: false, error: "prompt required" }); return; }
          const result = await sendChatMessage({ root, config, db, events, indexer, sessionId: id, prompt: b.prompt as string, actionKind: typeof b.actionKind === "string" ? b.actionKind : undefined, model: typeof b.model === "string" ? b.model : undefined });
          sendJson(res, 200, { ok: result.ok, session: result.session, userMessage: result.userMessage, assistantMessage: result.assistantMessage, result: result.result });
          return;
        }
        if (method === "DELETE") {
          const deleted = deleteChatSession(db, id);
          sendJson(res, deleted ? 200 : 404, { ok: deleted, sessionId: id });
          return;
        }
        if (method === "PATCH") {
          const b = await readJson(req) as Record<string, unknown> | null;
          if (!b || typeof b.title !== "string") { sendJson(res, 400, { ok: false, error: "title required" }); return; }
          const updated = updateChatSessionTitle(db, id, b.title as string);
          if (!updated) { notFound(res); return; }
          sendJson(res, 200, { ok: true, session: updated });
          return;
        }
      }
      if (url === "/api/chat/messages" && method === "POST") {
        const b = await readJson(req) as Record<string, unknown> | null;
        if (!b || typeof b.prompt !== "string") { sendJson(res, 400, { ok: false, error: "prompt required" }); return; }
        const result = await sendChatMessage({ root, config, db, events, indexer, sessionId: typeof b.sessionId === "string" ? b.sessionId : undefined, prompt: b.prompt as string, actionKind: typeof b.actionKind === "string" ? b.actionKind : undefined, model: typeof b.model === "string" ? b.model : undefined });
        sendJson(res, 200, { ok: result.ok, session: result.session, userMessage: result.userMessage, assistantMessage: result.assistantMessage, result: result.result });
        return;
      }
      if (url === "/api/questions/open" && method === "GET") {
        sendJson(res, 200, { ok: true, questions: getOpenQuestions(db) });
        return;
      }
      if (parts.length === 4 && parts[0] === "api" && parts[1] === "questions") {
        const id = parts[2];
        if (parts[3] === "answer" && method === "POST") {
          const b = await readJson(req) as Record<string, unknown> | null;
          const r = answerUserQuestion(db, id, b?.answer);
          sendJson(res, 200, { ok: !!r, question: r });
          return;
        }
        if (parts[3] === "cancel" && method === "POST") {
          const r = cancelUserQuestion(db, id);
          sendJson(res, 200, { ok: !!r, question: r });
          return;
        }
      }

      // GET /api/changes
      if (url === "/api/changes" && method === "GET") {
        const q = getQuery(rawUrl);
        const items = listChangeSets(db, { status: q.status as "proposed" | "partially_accepted" | "accepted" | "rejected" | "applied" | "reverted" | undefined, taskId: q.taskId });
        sendJson(res, 200, { ok: true, changeSets: items });
        return;
      }

      // GET /api/changes/:id
      const changeId = parts.length >= 3 && parts[0] === "api" && parts[1] === "changes" && parts.length >= 3 ? parts[2] : null;
      const changeSub = parts.length >= 4 ? parts[3] : null;

      if (changeId && !changeSub && method === "GET") {
        const cs = getChangeSet(db, changeId);
        if (!cs) { sendJson(res, 404, { ok: false, error: "Change set not found" }); return; }
        const files = listChangedFiles(db, changeId);
        const hunks = listChangedHunks(db, changeId);
        sendJson(res, 200, { ok: true, changeSet: cs, files, hunks });
        return;
      }

      // POST /api/changes/:id/accept
      if (changeId && changeSub === "accept" && method === "POST") {
        const cs = updateChangeSetStatus(db, changeId, "accepted");
        if (!cs) { sendJson(res, 404, { ok: false, error: "Change set not found" }); return; }
        sendJson(res, 200, { ok: true, changeSet: cs });
        return;
      }

      // POST /api/changes/:id/reject
      if (changeId && changeSub === "reject" && method === "POST") {
        const cs = updateChangeSetStatus(db, changeId, "rejected");
        if (!cs) { sendJson(res, 404, { ok: false, error: "Change set not found" }); return; }
        sendJson(res, 200, { ok: true, changeSet: cs });
        return;
      }

      // POST /api/changes/:id/apply
      if (changeId && changeSub === "apply" && method === "POST") {
        const body = await readJson(req) as Record<string, unknown> | null;
        const hunks = body?.hunks === true;
        const result = hunks
          ? await applyAcceptedHunksChangeSet({ root, db, indexer, changeSetId: changeId })
          : await applyAcceptedChangeSet({ root, db, indexer, changeSetId: changeId });
        sendJson(res, result.ok ? 200 : 400, result);
        return;
      }

      // POST /api/changes/:id/revert
      if (changeId && changeSub === "revert" && method === "POST") {
        const cs = getChangeSet(db, changeId);
        if (!cs) { sendJson(res, 404, { ok: false, error: "Change set not found" }); return; }
        if (!cs.checkpointId) {
          sendJson(res, 400, { ok: false, error: "Change set has no checkpoint to revert." });
          return;
        }
        const result = await revertCheckpoint({ root, db, id: cs.checkpointId });
        if (result.ok) updateChangeSetStatus(db, changeId, "reverted");
        sendJson(res, result.ok ? 200 : 400, result);
        return;
      }

      // PATCH /api/changes/:id/file-status
      if (changeId && changeSub === "file-status" && method === "PATCH") {
        const body = await readJson(req) as Record<string, unknown> | null;
        if (!body || typeof body.path !== "string" || typeof body.status !== "string") {
          sendJson(res, 400, { ok: false, error: "body.path and body.status are required" });
          return;
        }
        const review = updateChangedFileStatus(db, changeId, body.path as string, body.status as "pending" | "accepted" | "rejected");
        if (!review) { sendJson(res, 404, { ok: false, error: "File not found in change set" }); return; }
        sendJson(res, 200, { ok: true, review });
        return;
      }

      // PATCH /api/hunks/:hunkId
      if (parts.length === 3 && parts[0] === "api" && parts[1] === "hunks" && method === "PATCH") {
        const body = await readJson(req) as Record<string, unknown> | null;
        if (!body || typeof body.status !== "string") { sendJson(res, 400, { ok: false, error: "body.status is required" }); return; }
        const hunk = updateChangedHunkStatus(db, parts[2], body.status as "pending" | "accepted" | "rejected");
        if (!hunk) { sendJson(res, 404, { ok: false, error: "Hunk not found" }); return; }
        sendJson(res, 200, { ok: true, hunk });
        return;
      }

      // GET /api/models — returns all available models from all providers
      if (url === "/api/models" && method === "GET") {
        const models = await listProviderModels(deps.config);
        sendJson(res, 200, { ok: true, models });
        return;
      }

      // GET /api/dashboard — project overview stats
      if (url === "/api/dashboard" && method === "GET") {
        const totalFiles = (db.prepare("SELECT COUNT(*) AS c FROM files").get() as { c: number }).c;
        const totalSymbols = (db.prepare("SELECT COUNT(*) AS c FROM symbols").get() as { c: number }).c;
        const totalImports = (db.prepare("SELECT COUNT(*) AS c FROM imports").get() as { c: number }).c;
        const totalWithSummary = (db.prepare("SELECT COUNT(*) AS c FROM files WHERE summary IS NOT NULL AND summary != ''").get() as { c: number }).c;
        const fileRows = db.prepare("SELECT id, path, language, summary, is_test AS isTest FROM files ORDER BY CASE WHEN summary IS NULL OR summary='' THEN 1 ELSE 0 END, path").all() as Array<{ id: number; path: string; language: string; summary: string | null; isTest: number }>;
        const impRows = db.prepare("SELECT f.id, IFNULL(inb.c,0) AS inbound, IFNULL(outb.c,0) AS outbound, IFNULL(sym.c,0) AS symbols FROM files f LEFT JOIN (SELECT to_file_id AS fid, COUNT(*) AS c FROM imports GROUP BY to_file_id) inb ON inb.fid=f.id LEFT JOIN (SELECT from_file_id AS fid, COUNT(*) AS c FROM imports GROUP BY from_file_id) outb ON outb.fid=f.id LEFT JOIN (SELECT file_id AS fid, COUNT(*) AS c FROM symbols GROUP BY file_id) sym ON sym.fid=f.id").all() as Array<{ id: number; inbound: number; outbound: number; symbols: number }>;
        const impMap = new Map<number, number>();
        for (const r of impRows) impMap.set(r.id, Math.round(r.inbound * 3 + r.outbound * 1 + r.symbols * 0.5));
        const allTags = db.prepare("SELECT ft.file_id, t.name FROM file_tags ft JOIN tags t ON t.id=ft.tag_id").all() as Array<{ file_id: number; name: string }>;
        const tagMap = new Map<number, string[]>();
        for (const r of allTags) { const arr = tagMap.get(r.file_id) ?? []; arr.push(r.name); tagMap.set(r.file_id, arr); }
        const files = fileRows.map((r) => ({ path: r.path, language: r.language, summary: r.summary, isTest: !!r.isTest, tags: tagMap.get(r.id) ?? [], importance: impMap.get(r.id) ?? 0 }));
        const topTags = db.prepare("SELECT t.name, COUNT(ft.file_id) AS count FROM file_tags ft JOIN tags t ON t.id=ft.tag_id GROUP BY ft.tag_id ORDER BY count DESC LIMIT 10").all() as Array<{ name: string; count: number }>;
        const langCounts = db.prepare("SELECT language, COUNT(*) AS count FROM files WHERE language IS NOT NULL AND language!='' GROUP BY language ORDER BY count DESC").all() as Array<{ language: string; count: number }>;
        const projectSummary = (db.prepare("SELECT value FROM meta WHERE key='project_summary'").get() as { value: string } | undefined)?.value ?? "";
        sendJson(res, 200, { ok: true, totalFiles, totalSymbols, totalImports, totalWithSummary, files, topTags, langCounts, projectSummary });
        return;
      }

      // GET /api/filetree — list indexed files
      if (url === "/api/filetree" && method === "GET") {
        const files = db.prepare("SELECT path, language FROM files ORDER BY path").all() as Array<{ path: string; language: string }>;
        sendJson(res, 200, { ok: true, files });
        return;
      }

      // GET /api/file — read file content + summary
      if (url === "/api/file" && method === "GET") {
        const filePath = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`).searchParams.get("path");
        if (!filePath) { sendJson(res, 400, { ok: false, error: "missing path" }); return; }
        const resolvedRoot = path.resolve(deps.root);
        const absPath = path.resolve(deps.root, filePath);
        const rel = path.relative(resolvedRoot, absPath);
        if (rel.startsWith("..") || path.isAbsolute(rel)) {
          sendJson(res, 403, { ok: false, error: "access denied" });
          return;
        }
        const ext = path.extname(rel).toLowerCase();
        const imageExts = new Set([".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".bmp", ".ico"]);
        const isImage = imageExts.has(ext);
        try {
          if (isImage) {
            const extMap: Record<string, string> = { ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".jpeg": "image/jpeg" };
            const mime = extMap[ext] ?? `image/${ext.slice(1)}`;
            const buf = await readFile(absPath);
            const content = buf.toString("base64");
            const fileRow = db.prepare("SELECT summary FROM files WHERE path=?").get(rel) as { summary: string | null } | undefined;
            sendJson(res, 200, { ok: true, content, mimeType: mime, isImage: true, summary: fileRow?.summary ?? null });
          } else {
            const content = await readFile(absPath, "utf-8");
            const fileRow = db.prepare("SELECT summary FROM files WHERE path=?").get(rel) as { summary: string | null } | undefined;
            sendJson(res, 200, { ok: true, content, summary: fileRow?.summary ?? null });
          }
        } catch {
          sendJson(res, 404, { ok: false, error: "file not found" });
        }
        return;
      }

      notFound(res);
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(port, host, () => {
      resolve({
        host,
        port,
        url: `http://${host}:${port}`,
        stop: () => new Promise<void>((res) => server.close(() => res()))
      });
    });
  });
}
