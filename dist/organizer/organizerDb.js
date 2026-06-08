import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
function makeId(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
export function openOrganizerDatabase(dbPath) {
    const p = dbPath ?? path.join(os.homedir(), ".agent-smith");
    fs.mkdirSync(p, { recursive: true });
    const db = new Database(path.join(p, "organizer.sqlite"));
    db.pragma("journal_mode = WAL");
    db.exec(`
    CREATE TABLE IF NOT EXISTS organizer_agents (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, hostname TEXT NOT NULL,
      project_name TEXT NOT NULL, project_root TEXT NOT NULL, status TEXT NOT NULL,
      api_base_url TEXT NOT NULL, api_enabled INTEGER NOT NULL,
      actions_json TEXT NOT NULL, models_json TEXT NOT NULL, index_json TEXT NOT NULL,
      capabilities_json TEXT NOT NULL, current_task_id TEXT,
      last_heartbeat_at INTEGER NOT NULL, registered_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_oa_status ON organizer_agents(status);
    CREATE INDEX IF NOT EXISTS idx_oa_project ON organizer_agents(project_name);
    CREATE INDEX IF NOT EXISTS idx_oa_heartbeat ON organizer_agents(last_heartbeat_at);

    CREATE TABLE IF NOT EXISTS organizer_projects (
      id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS organizer_buckets (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL,
      description TEXT, sort_order INTEGER NOT NULL,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ob_project ON organizer_buckets(project_id);

    CREATE TABLE IF NOT EXISTS organizer_tasks (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, bucket_id TEXT,
      title TEXT NOT NULL, prompt TEXT NOT NULL, mode TEXT NOT NULL,
      priority INTEGER DEFAULT 0, status TEXT NOT NULL,
      assigned_agent_id TEXT,
      implement_model TEXT, review_model TEXT,
      max_iterations INTEGER NOT NULL DEFAULT 1,
      current_iteration INTEGER NOT NULL DEFAULT 0,
      auto_approve INTEGER NOT NULL DEFAULT 0,
      auto_apply INTEGER NOT NULL DEFAULT 0,
      require_checks INTEGER NOT NULL DEFAULT 0,
      checks_json TEXT,
      remote_task_id TEXT, remote_change_set_id TEXT, result_json TEXT,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      started_at INTEGER, finished_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_ot_project ON organizer_tasks(project_id);
    CREATE INDEX IF NOT EXISTS idx_ot_bucket ON organizer_tasks(bucket_id);
    CREATE INDEX IF NOT EXISTS idx_ot_status ON organizer_tasks(status);
    CREATE INDEX IF NOT EXISTS idx_ot_agent ON organizer_tasks(assigned_agent_id);

    CREATE TABLE IF NOT EXISTS organizer_task_events (
      id TEXT PRIMARY KEY, task_id TEXT NOT NULL, agent_id TEXT,
      event_type TEXT NOT NULL, message TEXT NOT NULL, payload_json TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ote_task ON organizer_task_events(task_id);

    CREATE TABLE IF NOT EXISTS organizer_task_iterations (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      iteration_index INTEGER NOT NULL,
      implement_model TEXT,
      review_model TEXT,
      prompt TEXT NOT NULL,
      review_prompt TEXT,
      worker_task_id TEXT,
      worker_change_set_id TEXT,
      result_json TEXT,
      review_json TEXT,
      review_decision TEXT,
      review_feedback TEXT,
      review_next_prompt TEXT,
      implementation_summary TEXT,
      changed_files_json TEXT,
      diff_preview TEXT,
      diff_stat_json TEXT,
      check_results_json TEXT,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      started_at INTEGER,
      finished_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_oti_task ON organizer_task_iterations(task_id);
    CREATE INDEX IF NOT EXISTS idx_oti_agent ON organizer_task_iterations(agent_id);
    CREATE INDEX IF NOT EXISTS idx_oti_status ON organizer_task_iterations(status);
  `);
    return db;
}
// Agents
export function upsertOrganizerAgent(db, hb) {
    const now = Date.now();
    const existing = db.prepare("SELECT id, registered_at FROM organizer_agents WHERE id = ?").get(hb.agentId);
    const registeredAt = existing?.registered_at ?? now;
    db.prepare(`
    INSERT INTO organizer_agents (id, name, hostname, project_name, project_root, status, api_base_url, api_enabled, actions_json, models_json, index_json, capabilities_json, current_task_id, last_heartbeat_at, registered_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name, hostname=excluded.hostname, project_name=excluded.project_name,
      project_root=excluded.project_root, status=excluded.status, api_base_url=excluded.api_base_url,
      api_enabled=excluded.api_enabled, actions_json=excluded.actions_json, models_json=excluded.models_json,
      index_json=excluded.index_json, capabilities_json=excluded.capabilities_json,
      current_task_id=excluded.current_task_id, last_heartbeat_at=excluded.last_heartbeat_at,
      updated_at=excluded.updated_at
  `).run(hb.agentId, hb.name, hb.hostname, hb.projectName, hb.projectRoot, hb.status, hb.api.baseUrl, hb.api.enabled ? 1 : 0, JSON.stringify(hb.api.actions), JSON.stringify(hb.models), JSON.stringify(hb.index), JSON.stringify(hb.capabilities), hb.currentTaskId ?? null, hb.timestamp, registeredAt, now);
    return db.prepare("SELECT * FROM organizer_agents WHERE id = ?").get(hb.agentId);
}
export function listOrganizerAgents(db) { return db.prepare("SELECT * FROM organizer_agents ORDER BY updated_at DESC").all(); }
export function getOrganizerAgent(db, id) { return db.prepare("SELECT * FROM organizer_agents WHERE id = ?").get(id); }
export function markStaleAgentsOffline(db, staleAfterMs) {
    const r = db.prepare("UPDATE organizer_agents SET status='offline', updated_at=? WHERE last_heartbeat_at<? AND status!='offline'").run(Date.now(), Date.now() - staleAfterMs);
    return r.changes;
}
// Projects
export function createOrganizerProject(db, input) {
    const now = Date.now();
    const p = { id: makeId("project"), name: input.name, description: input.description ?? null, createdAt: now, updatedAt: now };
    db.prepare("INSERT INTO organizer_projects (id,name,description,created_at,updated_at) VALUES (?,?,?,?,?)").run(p.id, p.name, p.description, p.createdAt, p.updatedAt);
    return p;
}
export function listOrganizerProjects(db) { return db.prepare("SELECT * FROM organizer_projects ORDER BY name").all(); }
export function getOrganizerProject(db, id) { return db.prepare("SELECT * FROM organizer_projects WHERE id=?").get(id); }
export function getOrganizerProjectByName(db, name) { return db.prepare("SELECT * FROM organizer_projects WHERE name=?").get(name); }
export function updateOrganizerProject(db, id, patch) {
    if (patch.name)
        db.prepare("UPDATE organizer_projects SET name=?, updated_at=? WHERE id=?").run(patch.name, Date.now(), id);
    if (patch.description !== undefined)
        db.prepare("UPDATE organizer_projects SET description=?, updated_at=? WHERE id=?").run(patch.description, Date.now(), id);
    return getOrganizerProject(db, id);
}
export function deleteOrganizerProject(db, id) {
    db.prepare("DELETE FROM organizer_buckets WHERE project_id=?").run(id);
    db.prepare("DELETE FROM organizer_task_events WHERE task_id IN (SELECT id FROM organizer_tasks WHERE project_id=?)").run(id);
    db.prepare("DELETE FROM organizer_tasks WHERE project_id=?").run(id);
    return db.prepare("DELETE FROM organizer_projects WHERE id=?").run(id).changes > 0;
}
// Buckets
export function createOrganizerBucket(db, input) {
    const now = Date.now();
    const sort = input.sortOrder ?? (db.prepare("SELECT MAX(sort_order) AS m FROM organizer_buckets WHERE project_id=?").get(input.projectId)?.m ?? -1) + 1;
    const b = { id: makeId("bucket"), projectId: input.projectId, name: input.name, description: input.description ?? null, sortOrder: sort, createdAt: now, updatedAt: now };
    db.prepare("INSERT INTO organizer_buckets (id,project_id,name,description,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?)").run(b.id, b.projectId, b.name, b.description, b.sortOrder, b.createdAt, b.updatedAt);
    return b;
}
export function listOrganizerBuckets(db, projectId) {
    const sql = projectId ? "SELECT * FROM organizer_buckets WHERE project_id=? ORDER BY sort_order" : "SELECT * FROM organizer_buckets ORDER BY project_id, sort_order";
    return (projectId ? db.prepare(sql).all(projectId) : db.prepare(sql).all());
}
export function getOrganizerBucket(db, id) { return db.prepare("SELECT * FROM organizer_buckets WHERE id=?").get(id); }
export function updateOrganizerBucket(db, id, patch) {
    if (patch.name)
        db.prepare("UPDATE organizer_buckets SET name=?, updated_at=? WHERE id=?").run(patch.name, Date.now(), id);
    if (patch.description !== undefined)
        db.prepare("UPDATE organizer_buckets SET description=?, updated_at=? WHERE id=?").run(patch.description, Date.now(), id);
    if (patch.sortOrder !== undefined)
        db.prepare("UPDATE organizer_buckets SET sort_order=?, updated_at=? WHERE id=?").run(patch.sortOrder, Date.now(), id);
    return getOrganizerBucket(db, id);
}
export function deleteOrganizerBucket(db, id) { return db.prepare("DELETE FROM organizer_buckets WHERE id=?").run(id).changes > 0; }
// Tasks
export function createOrganizerTask(db, input) {
    const now = Date.now();
    const checks = input.checks ?? [];
    const t = {
        id: makeId("orgtask"), projectId: input.projectId, bucketId: input.bucketId ?? null,
        title: input.title, prompt: input.prompt, mode: input.mode ?? "patch",
        priority: input.priority ?? 0, status: input.status ?? "queued",
        assignedAgentId: null,
        implementModel: input.implementModel ?? null, reviewModel: input.reviewModel ?? null,
        maxIterations: input.maxIterations ?? 1, currentIteration: 0,
        autoApprove: input.autoApprove ?? false, autoApply: input.autoApply ?? false,
        requireChecks: input.requireChecks ?? false, checksJson: checks.length > 0 ? JSON.stringify(checks) : null,
        remoteTaskId: null, remoteChangeSetId: null, resultJson: null,
        createdAt: now, updatedAt: now, startedAt: null, finishedAt: null
    };
    db.prepare("INSERT INTO organizer_tasks (id,project_id,bucket_id,title,prompt,mode,priority,status,assigned_agent_id,implement_model,review_model,max_iterations,current_iteration,auto_approve,auto_apply,require_checks,checks_json,remote_task_id,remote_change_set_id,result_json,created_at,updated_at,started_at,finished_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(t.id, t.projectId, t.bucketId, t.title, t.prompt, t.mode, t.priority, t.status, t.assignedAgentId, t.implementModel, t.reviewModel, t.maxIterations, t.currentIteration, t.autoApprove ? 1 : 0, t.autoApply ? 1 : 0, t.requireChecks ? 1 : 0, t.checksJson, t.remoteTaskId, t.remoteChangeSetId, t.resultJson, t.createdAt, t.updatedAt, t.startedAt, t.finishedAt);
    return t;
}
export function listOrganizerTasks(db, opts) {
    const clauses = [];
    const params = [];
    if (opts?.projectId) {
        clauses.push("project_id=?");
        params.push(opts.projectId);
    }
    if (opts?.bucketId) {
        clauses.push("bucket_id=?");
        params.push(opts.bucketId);
    }
    if (opts?.status) {
        clauses.push("status=?");
        params.push(opts.status);
    }
    if (opts?.agentId) {
        clauses.push("assigned_agent_id=?");
        params.push(opts.agentId);
    }
    const where = clauses.length > 0 ? " WHERE " + clauses.join(" AND ") : "";
    return db.prepare("SELECT * FROM organizer_tasks" + where + " ORDER BY priority DESC, created_at DESC").all(...params);
}
export function getOrganizerTask(db, id) { return db.prepare("SELECT * FROM organizer_tasks WHERE id=?").get(id); }
export function updateOrganizerTask(db, id, patch) {
    if (patch.title)
        db.prepare("UPDATE organizer_tasks SET title=?, updated_at=? WHERE id=?").run(patch.title, Date.now(), id);
    if (patch.prompt)
        db.prepare("UPDATE organizer_tasks SET prompt=?, updated_at=? WHERE id=?").run(patch.prompt, Date.now(), id);
    if (patch.mode)
        db.prepare("UPDATE organizer_tasks SET mode=?, updated_at=? WHERE id=?").run(patch.mode, Date.now(), id);
    if (patch.priority !== undefined)
        db.prepare("UPDATE organizer_tasks SET priority=?, updated_at=? WHERE id=?").run(patch.priority, Date.now(), id);
    if (patch.status)
        db.prepare("UPDATE organizer_tasks SET status=?, updated_at=? WHERE id=?").run(patch.status, Date.now(), id);
    if (patch.bucketId !== undefined)
        db.prepare("UPDATE organizer_tasks SET bucket_id=?, updated_at=? WHERE id=?").run(patch.bucketId, Date.now(), id);
    if (patch.assignedAgentId !== undefined)
        db.prepare("UPDATE organizer_tasks SET assigned_agent_id=?, updated_at=? WHERE id=?").run(patch.assignedAgentId, Date.now(), id);
    if (patch.implementModel !== undefined)
        db.prepare("UPDATE organizer_tasks SET implement_model=?, updated_at=? WHERE id=?").run(patch.implementModel, Date.now(), id);
    if (patch.reviewModel !== undefined)
        db.prepare("UPDATE organizer_tasks SET review_model=?, updated_at=? WHERE id=?").run(patch.reviewModel, Date.now(), id);
    if (patch.maxIterations !== undefined)
        db.prepare("UPDATE organizer_tasks SET max_iterations=?, updated_at=? WHERE id=?").run(patch.maxIterations, Date.now(), id);
    if (patch.currentIteration !== undefined)
        db.prepare("UPDATE organizer_tasks SET current_iteration=?, updated_at=? WHERE id=?").run(patch.currentIteration, Date.now(), id);
    if (patch.autoApprove !== undefined)
        db.prepare("UPDATE organizer_tasks SET auto_approve=?, updated_at=? WHERE id=?").run(patch.autoApprove ? 1 : 0, Date.now(), id);
    if (patch.autoApply !== undefined)
        db.prepare("UPDATE organizer_tasks SET auto_apply=?, updated_at=? WHERE id=?").run(patch.autoApply ? 1 : 0, Date.now(), id);
    if (patch.requireChecks !== undefined)
        db.prepare("UPDATE organizer_tasks SET require_checks=?, updated_at=? WHERE id=?").run(patch.requireChecks ? 1 : 0, Date.now(), id);
    if (patch.checksJson !== undefined)
        db.prepare("UPDATE organizer_tasks SET checks_json=?, updated_at=? WHERE id=?").run(patch.checksJson, Date.now(), id);
    if (patch.remoteTaskId !== undefined)
        db.prepare("UPDATE organizer_tasks SET remote_task_id=?, updated_at=? WHERE id=?").run(patch.remoteTaskId, Date.now(), id);
    if (patch.remoteChangeSetId !== undefined)
        db.prepare("UPDATE organizer_tasks SET remote_change_set_id=?, updated_at=? WHERE id=?").run(patch.remoteChangeSetId, Date.now(), id);
    if (patch.resultJson !== undefined)
        db.prepare("UPDATE organizer_tasks SET result_json=?, updated_at=? WHERE id=?").run(patch.resultJson, Date.now(), id);
    return getOrganizerTask(db, id);
}
export function assignOrganizerTask(db, id, agentId) {
    db.prepare("UPDATE organizer_tasks SET assigned_agent_id=?, status='assigned', updated_at=?, started_at=? WHERE id=?").run(agentId, Date.now(), Date.now(), id);
    return getOrganizerTask(db, id);
}
export function deleteOrganizerTask(db, id) {
    db.prepare("DELETE FROM organizer_task_iterations WHERE task_id=?").run(id);
    db.prepare("DELETE FROM organizer_task_events WHERE task_id=?").run(id);
    return db.prepare("DELETE FROM organizer_tasks WHERE id=?").run(id).changes > 0;
}
export function recordOrganizerTaskEvent(db, input) {
    const e = { id: makeId("orgevent"), taskId: input.taskId, agentId: input.agentId ?? null, eventType: input.eventType, message: input.message, payloadJson: input.payloadJson ?? null, createdAt: Date.now() };
    db.prepare("INSERT INTO organizer_task_events (id,task_id,agent_id,event_type,message,payload_json,created_at) VALUES (?,?,?,?,?,?,?)").run(e.id, e.taskId, e.agentId, e.eventType, e.message, e.payloadJson, e.createdAt);
    return e;
}
export function listOrganizerTaskEvents(db, taskId) {
    return db.prepare("SELECT * FROM organizer_task_events WHERE task_id=? ORDER BY created_at").all(taskId);
}
// Iterations
export function createOrganizerTaskIteration(db, input) {
    const now = Date.now();
    const i = {
        id: makeId("orgiter"), taskId: input.taskId, agentId: input.agentId,
        iterationIndex: input.iterationIndex,
        implementModel: input.implementModel ?? null, reviewModel: input.reviewModel ?? null,
        prompt: input.prompt, reviewPrompt: input.reviewPrompt ?? null,
        workerTaskId: input.workerTaskId ?? null, workerChangeSetId: input.workerChangeSetId ?? null,
        resultJson: null, reviewJson: null, reviewDecision: null, reviewFeedback: null,
        reviewNextPrompt: input.reviewNextPrompt ?? null,
        implementationSummary: input.implementationSummary ?? null,
        changedFilesJson: input.changedFilesJson ?? null,
        diffPreview: input.diffPreview ?? null,
        diffStatJson: input.diffStatJson ?? null,
        checkResultsJson: input.checkResultsJson ?? null,
        status: input.status ?? "running", createdAt: now, startedAt: now, finishedAt: null
    };
    db.prepare("INSERT INTO organizer_task_iterations (id,task_id,agent_id,iteration_index,implement_model,review_model,prompt,review_prompt,worker_task_id,worker_change_set_id,result_json,review_json,review_decision,review_feedback,review_next_prompt,implementation_summary,changed_files_json,diff_preview,diff_stat_json,check_results_json,status,created_at,started_at,finished_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(i.id, i.taskId, i.agentId, i.iterationIndex, i.implementModel, i.reviewModel, i.prompt, i.reviewPrompt, i.workerTaskId, i.workerChangeSetId, i.resultJson, i.reviewJson, i.reviewDecision, i.reviewFeedback, i.reviewNextPrompt, i.implementationSummary, i.changedFilesJson, i.diffPreview, i.diffStatJson, i.checkResultsJson, i.status, i.createdAt, i.startedAt, i.finishedAt);
    return i;
}
export function updateOrganizerTaskIteration(db, id, patch) {
    if (patch.status)
        db.prepare("UPDATE organizer_task_iterations SET status=?, finished_at=CASE WHEN ? IN ('approved','rejected','failed','changes_requested') THEN ? ELSE finished_at END WHERE id=?").run(patch.status, patch.status, Date.now(), id);
    if (patch.workerTaskId !== undefined)
        db.prepare("UPDATE organizer_task_iterations SET worker_task_id=? WHERE id=?").run(patch.workerTaskId, id);
    if (patch.workerChangeSetId !== undefined)
        db.prepare("UPDATE organizer_task_iterations SET worker_change_set_id=? WHERE id=?").run(patch.workerChangeSetId, id);
    if (patch.resultJson !== undefined)
        db.prepare("UPDATE organizer_task_iterations SET result_json=? WHERE id=?").run(patch.resultJson, id);
    if (patch.reviewJson !== undefined)
        db.prepare("UPDATE organizer_task_iterations SET review_json=? WHERE id=?").run(patch.reviewJson, id);
    if (patch.reviewDecision !== undefined)
        db.prepare("UPDATE organizer_task_iterations SET review_decision=? WHERE id=?").run(patch.reviewDecision, id);
    if (patch.reviewFeedback !== undefined)
        db.prepare("UPDATE organizer_task_iterations SET review_feedback=? WHERE id=?").run(patch.reviewFeedback, id);
    if (patch.reviewPrompt !== undefined)
        db.prepare("UPDATE organizer_task_iterations SET review_prompt=? WHERE id=?").run(patch.reviewPrompt, id);
    if (patch.reviewNextPrompt !== undefined)
        db.prepare("UPDATE organizer_task_iterations SET review_next_prompt=? WHERE id=?").run(patch.reviewNextPrompt, id);
    if (patch.implementationSummary !== undefined)
        db.prepare("UPDATE organizer_task_iterations SET implementation_summary=? WHERE id=?").run(patch.implementationSummary, id);
    if (patch.changedFilesJson !== undefined)
        db.prepare("UPDATE organizer_task_iterations SET changed_files_json=? WHERE id=?").run(patch.changedFilesJson, id);
    if (patch.diffPreview !== undefined)
        db.prepare("UPDATE organizer_task_iterations SET diff_preview=? WHERE id=?").run(patch.diffPreview, id);
    if (patch.diffStatJson !== undefined)
        db.prepare("UPDATE organizer_task_iterations SET diff_stat_json=? WHERE id=?").run(patch.diffStatJson, id);
    if (patch.checkResultsJson !== undefined)
        db.prepare("UPDATE organizer_task_iterations SET check_results_json=? WHERE id=?").run(patch.checkResultsJson, id);
    return db.prepare("SELECT * FROM organizer_task_iterations WHERE id=?").get(id);
}
export function listOrganizerTaskIterations(db, taskId) {
    return db.prepare("SELECT * FROM organizer_task_iterations WHERE task_id=? ORDER BY iteration_index").all(taskId);
}
export function getLatestOrganizerTaskIteration(db, taskId) {
    return db.prepare("SELECT * FROM organizer_task_iterations WHERE task_id=? ORDER BY iteration_index DESC LIMIT 1").get(taskId);
}
