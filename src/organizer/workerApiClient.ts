import type { RuntimeAction, RuntimeTaskResult, WorkItem } from "../types/index.js";

export type WorkerApiClient = {
  getStatus(): Promise<{ ok: boolean; data?: unknown; error?: string }>;
  dispatchAction(action: RuntimeAction): Promise<{ ok: boolean; result?: RuntimeTaskResult; error?: string }>;
  createTask(input: {
    title: string;
    description?: string;
    priority?: number;
    source?: "organizer";
  }): Promise<{ ok: boolean; task?: WorkItem; error?: string }>;
  patchTask(taskId: string, opts?: {
    apply?: boolean;
    dryRun?: boolean;
    model?: string;
  }): Promise<{ ok: boolean; result?: RuntimeTaskResult; error?: string }>;
  listTaskChanges(taskId: string): Promise<{ ok: boolean; changeSets?: unknown[]; error?: string }>;
  getChangeSet?(changeSetId: string): Promise<{ ok: boolean; data?: unknown; error?: string }>;
  applyChange?(changeSetId: string, opts?: { hunks?: boolean }): Promise<{ ok: boolean; result?: unknown; error?: string }>;
  listChatSessions?(): Promise<{ ok: boolean; sessions?: unknown[]; error?: string }>;
  createChatSession?(input: { title?: string; scope?: string }): Promise<{ ok: boolean; session?: unknown; error?: string }>;
  getChatSession?(sessionId: string): Promise<{ ok: boolean; session?: unknown; messages?: unknown[]; openQuestions?: unknown[]; error?: string }>;
  sendChatMessage?(sessionId: string, input: { prompt: string; actionKind?: string; model?: string }): Promise<{ ok: boolean; session?: unknown; messages?: unknown[]; error?: string }>;
  listModels?(): Promise<{ ok: boolean; models?: string[]; error?: string }>;
  getFileTree?(): Promise<{ ok: boolean; files?: unknown[]; error?: string }>;
  getFile?(filePath: string): Promise<{ ok: boolean; content?: string; summary?: string; importance?: number; error?: string }>;
  getDashboard?(): Promise<{ ok: boolean; data?: unknown; error?: string }>;
  getOpenQuestions?(): Promise<{ ok: boolean; questions?: unknown[]; error?: string }>;
  answerQuestion?(questionId: string, answer: unknown): Promise<{ ok: boolean; question?: unknown; error?: string }>;
};

export function createWorkerApiClient(args: {
  baseUrl: string;
  token?: string;
  timeoutMs?: number;
}): WorkerApiClient {
  const baseUrl = args.baseUrl.replace(/\/+$/, "");
  const token = args.token;
  const timeoutMs = args.timeoutMs ?? 15000;

  async function post(path: string, body?: unknown): Promise<{ ok: boolean; data?: unknown; error?: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers: Record<string, string> = body ? { "Content-Type": "application/json" } : {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}: ${JSON.stringify(data).slice(0, 200)}` };
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    } finally {
      clearTimeout(timer);
    }
  }

  async function get(path: string): Promise<{ ok: boolean; data?: unknown; error?: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`${baseUrl}${path}`, { headers, signal: controller.signal });
      const data = await res.json().catch(() => null);
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    getStatus: () => get("/api/status"),
    dispatchAction: async (action) => {
      const r = await post("/api/actions", action);
      return r.ok ? { ok: true, result: (r.data as { result?: RuntimeTaskResult })?.result } : r;
    },
    createTask: async (input) => {
      const r = await post("/api/tasks", {
        title: input.title,
        description: input.description,
        priority: input.priority,
        source: input.source ?? "organizer"
      });
      return r.ok ? { ok: true, task: (r.data as { task?: WorkItem })?.task } : r;
    },
    patchTask: async (taskId, opts) => {
      const r = await post(`/api/tasks/${taskId}/patch`, {
        apply: opts?.apply ?? false,
        dryRun: opts?.dryRun ?? false,
        model: opts?.model
      });
      return r.ok ? { ok: true, result: (r.data as { result?: RuntimeTaskResult })?.result } : r;
    },
    listTaskChanges: async (taskId) => {
      const r = await get(`/api/changes?taskId=${encodeURIComponent(taskId)}`);
      return r.ok ? { ok: true, changeSets: (r.data as { changeSets?: unknown[] })?.changeSets } : r;
    },
    getChangeSet: async (changeSetId) => {
      const r = await get(`/api/changes/${changeSetId}`);
      return r.ok ? r : { ok: false, error: r.error };
    },
    applyChange: async (changeSetId, opts) => {
      const path = opts?.hunks ? `/api/changes/${changeSetId}/apply-hunks` : `/api/changes/${changeSetId}/apply`;
      const r = await post(path);
      return r.ok ? { ok: true, result: r.data } : r;
    },
    listChatSessions: async () => {
      const r = await get(`/api/chat/sessions`);
      return r.ok ? { ok: true, sessions: (r.data as { sessions?: unknown[] })?.sessions } : r;
    },
    createChatSession: async (input) => {
      const r = await post(`/api/chat/sessions`, input);
      return r.ok ? { ok: true, session: (r.data as { session?: unknown })?.session } : r;
    },
    getChatSession: async (sessionId) => {
      const r = await get(`/api/chat/sessions/${sessionId}`);
      if (!r.ok) return { ok: false, error: r.error };
      const d = r.data as { session?: unknown; messages?: unknown[]; openQuestions?: unknown[] } | null;
      return { ok: true, session: d?.session, messages: d?.messages, openQuestions: d?.openQuestions };
    },
    sendChatMessage: async (sessionId, input) => {
      const r = await post(`/api/chat/sessions/${sessionId}`, input);
      return r.ok ? { ok: true, session: (r.data as { session?: unknown })?.session, messages: (r.data as { messages?: unknown[] })?.messages } : r;
    },
    getOpenQuestions: async () => {
      const r = await get(`/api/questions/open`);
      return r.ok ? { ok: true, questions: (r.data as { questions?: unknown[] })?.questions } : r;
    },
    listModels: async () => {
      const r = await get(`/api/models`);
      return r.ok ? { ok: true, models: (r.data as { models?: string[] })?.models } : r;
    },
    getFileTree: async () => {
      const r = await get(`/api/filetree`);
      return r.ok ? { ok: true, files: (r.data as { files?: unknown[] })?.files } : r;
    },
    getFile: async (filePath) => {
      const r = await get(`/api/file?path=${encodeURIComponent(filePath)}`);
      if (!r.ok) return { ok: false, error: r.error };
      const d = r.data as { content?: string; summary?: string; importance?: number } | null;
      return { ok: true, content: d?.content, summary: d?.summary, importance: d?.importance };
    },
    getDashboard: async () => {
      const r = await get(`/api/dashboard`);
      return r.ok ? { ok: true, data: r.data } : { ok: false, error: r.error };
    },
    answerQuestion: async (questionId, answer) => {
      const r = await post(`/api/questions/${questionId}/answer`, { answer });
      return r.ok ? { ok: true, question: (r.data as { question?: unknown })?.question } : r;
    }
  };
}
