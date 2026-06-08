import type { SmithDatabase } from "../db/db.js";
import type { ChatSession, ChatSessionScope, ChatMessage, ChatMessageRole, ChatMessageStatus, UserQuestion, UserQuestionKind, UserQuestionStatus } from "../types/index.js";

function makeId(prefix: string): string { return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`; }

// Sessions
export function createChatSession(db: SmithDatabase, input: { title?: string; scope?: ChatSessionScope; taskId?: string; changeSetId?: string; remoteAgentId?: string; remoteSessionId?: string }): ChatSession {
  const now = Date.now();
  const s: ChatSession = { id: makeId("session"), title: input.title ?? "New chat", scope: input.scope ?? "local", taskId: input.taskId ?? null, changeSetId: input.changeSetId ?? null, remoteAgentId: input.remoteAgentId ?? null, remoteSessionId: input.remoteSessionId ?? null, createdAt: now, updatedAt: now };
  db.prepare("INSERT INTO chat_sessions (id,title,scope,task_id,change_set_id,remote_agent_id,remote_session_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)").run(s.id, s.title, s.scope, s.taskId, s.changeSetId, s.remoteAgentId, s.remoteSessionId, s.createdAt, s.updatedAt);
  return s;
}
export function listChatSessions(db: SmithDatabase, opts?: { scope?: ChatSessionScope; taskId?: string }): ChatSession[] {
  const clauses: string[] = []; const params: unknown[] = [];
  if (opts?.scope) { clauses.push("scope=?"); params.push(opts.scope); }
  if (opts?.taskId) { clauses.push("task_id=?"); params.push(opts.taskId); }
  const where = clauses.length ? " WHERE " + clauses.join(" AND ") : "";
  return db.prepare("SELECT * FROM chat_sessions" + where + " ORDER BY updated_at DESC").all(...params) as ChatSession[];
}
export function getChatSession(db: SmithDatabase, id: string): ChatSession | undefined { return db.prepare("SELECT * FROM chat_sessions WHERE id=?").get(id) as ChatSession | undefined; }
export function updateChatSessionTitle(db: SmithDatabase, id: string, title: string): ChatSession | undefined { db.prepare("UPDATE chat_sessions SET title=?, updated_at=? WHERE id=?").run(title, Date.now(), id); return getChatSession(db, id); }
export function deleteChatSession(db: SmithDatabase, id: string): boolean {
  db.prepare("DELETE FROM user_questions WHERE session_id=?").run(id);
  db.prepare("DELETE FROM chat_messages WHERE session_id=?").run(id);
  return db.prepare("DELETE FROM chat_sessions WHERE id=?").run(id).changes > 0;
}

// Messages
export function addChatMessage(db: SmithDatabase, input: { sessionId: string; role: ChatMessageRole; content: string; status?: ChatMessageStatus; model?: string; actionKind?: string; runtimeTaskId?: string; parentMessageId?: string; metadata?: unknown }): ChatMessage {
  const now = Date.now();
  const m: ChatMessage = { id: makeId("msg"), sessionId: input.sessionId, role: input.role, content: input.content, status: input.status ?? "complete", model: input.model ?? null, actionKind: (input.actionKind as string) ?? null, runtimeTaskId: input.runtimeTaskId ?? null, parentMessageId: input.parentMessageId ?? null, metadataJson: input.metadata ? JSON.stringify(input.metadata) : null, createdAt: now, updatedAt: now };
  db.prepare("INSERT INTO chat_messages (id,session_id,role,content,status,model,action_kind,runtime_task_id,parent_message_id,metadata_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run(m.id, m.sessionId, m.role, m.content, m.status, m.model, m.actionKind, m.runtimeTaskId, m.parentMessageId, m.metadataJson, m.createdAt, m.updatedAt);
  db.prepare("UPDATE chat_sessions SET updated_at=? WHERE id=?").run(now, input.sessionId);
  return m;
}
export function updateChatMessage(db: SmithDatabase, id: string, patch: { content?: string; status?: ChatMessageStatus; model?: string | null; actionKind?: string | null; runtimeTaskId?: string | null; metadata?: unknown }): ChatMessage | undefined {
  if (patch.content !== undefined) db.prepare("UPDATE chat_messages SET content=?, updated_at=? WHERE id=?").run(patch.content, Date.now(), id);
  if (patch.status) db.prepare("UPDATE chat_messages SET status=?, updated_at=? WHERE id=?").run(patch.status, Date.now(), id);
  if (patch.model !== undefined) db.prepare("UPDATE chat_messages SET model=?, updated_at=? WHERE id=?").run(patch.model, Date.now(), id);
  if (patch.actionKind !== undefined) db.prepare("UPDATE chat_messages SET action_kind=?, updated_at=? WHERE id=?").run(patch.actionKind, Date.now(), id);
  if (patch.runtimeTaskId !== undefined) db.prepare("UPDATE chat_messages SET runtime_task_id=?, updated_at=? WHERE id=?").run(patch.runtimeTaskId, Date.now(), id);
  if (patch.metadata !== undefined) db.prepare("UPDATE chat_messages SET metadata_json=?, updated_at=? WHERE id=?").run(JSON.stringify(patch.metadata), Date.now(), id);
  return db.prepare("SELECT * FROM chat_messages WHERE id=?").get(id) as ChatMessage | undefined;
}
export function listChatMessages(db: SmithDatabase, sessionId: string): ChatMessage[] { return db.prepare("SELECT * FROM chat_messages WHERE session_id=? ORDER BY created_at").all(sessionId) as ChatMessage[]; }
export function getChatMessage(db: SmithDatabase, id: string): ChatMessage | undefined { return db.prepare("SELECT * FROM chat_messages WHERE id=?").get(id) as ChatMessage | undefined; }

// Questions
export function createUserQuestion(db: SmithDatabase, input: { sessionId: string; messageId: string; kind: UserQuestionKind; prompt: string; options?: string[]; defaultValue?: unknown }): UserQuestion {
  const now = Date.now();
  const q: UserQuestion = { id: makeId("question"), sessionId: input.sessionId, messageId: input.messageId, kind: input.kind, prompt: input.prompt, optionsJson: input.options ? JSON.stringify(input.options) : null, defaultValueJson: input.defaultValue !== undefined ? JSON.stringify(input.defaultValue) : null, answerJson: null, status: "open", createdAt: now, answeredAt: null };
  db.prepare("INSERT INTO user_questions (id,session_id,message_id,kind,prompt,options_json,default_value_json,answer_json,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)").run(q.id, q.sessionId, q.messageId, q.kind, q.prompt, q.optionsJson, q.defaultValueJson, q.answerJson, q.status, q.createdAt);
  return q;
}
export function getOpenQuestions(db: SmithDatabase, sessionId?: string): UserQuestion[] {
  if (sessionId) return db.prepare("SELECT * FROM user_questions WHERE session_id=? AND status='open' ORDER BY created_at").all(sessionId) as UserQuestion[];
  return db.prepare("SELECT * FROM user_questions WHERE status='open' ORDER BY created_at").all() as UserQuestion[];
}
export function answerUserQuestion(db: SmithDatabase, id: string, answer: unknown): UserQuestion | undefined {
  const now = Date.now();
  const r = db.prepare("UPDATE user_questions SET answer_json=?, status='answered', answered_at=? WHERE id=?").run(JSON.stringify(answer), now, id);
  return r.changes > 0 ? (db.prepare("SELECT * FROM user_questions WHERE id=?").get(id) as UserQuestion) : undefined;
}
export function cancelUserQuestion(db: SmithDatabase, id: string): UserQuestion | undefined {
  const r = db.prepare("UPDATE user_questions SET status='cancelled' WHERE id=?").run(id);
  return r.changes > 0 ? (db.prepare("SELECT * FROM user_questions WHERE id=?").get(id) as UserQuestion) : undefined;
}
