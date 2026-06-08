export function createWorkerApiClient(args) {
    const baseUrl = args.baseUrl.replace(/\/+$/, "");
    const token = args.token;
    const timeoutMs = args.timeoutMs ?? 15000;
    async function post(path, body) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const headers = body ? { "Content-Type": "application/json" } : {};
            if (token)
                headers["Authorization"] = `Bearer ${token}`;
            const res = await fetch(`${baseUrl}${path}`, {
                method: "POST",
                headers,
                body: body ? JSON.stringify(body) : undefined,
                signal: controller.signal
            });
            const data = await res.json().catch(() => null);
            if (!res.ok) {
                const err = data?.error;
                return { ok: false, error: typeof err === "string" ? err : `HTTP ${res.status}` };
            }
            return { ok: true, data };
        }
        catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
        finally {
            clearTimeout(timer);
        }
    }
    async function get(path) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const headers = {};
            if (token)
                headers["Authorization"] = `Bearer ${token}`;
            const res = await fetch(`${baseUrl}${path}`, { headers, signal: controller.signal });
            const data = await res.json().catch(() => null);
            if (!res.ok) {
                const err = data?.error;
                return { ok: false, error: typeof err === "string" ? err : `HTTP ${res.status}` };
            }
            return { ok: true, data };
        }
        catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
        finally {
            clearTimeout(timer);
        }
    }
    async function del(path) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const headers = {};
            if (token)
                headers["Authorization"] = `Bearer ${token}`;
            const res = await fetch(`${baseUrl}${path}`, { method: "DELETE", headers, signal: controller.signal });
            const data = await res.json().catch(() => null);
            if (!res.ok) {
                const err = data?.error;
                return { ok: false, error: typeof err === "string" ? err : `HTTP ${res.status}` };
            }
            return { ok: true };
        }
        catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
        finally {
            clearTimeout(timer);
        }
    }
    async function patch(path, body) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const headers = body ? { "Content-Type": "application/json" } : {};
            if (token)
                headers["Authorization"] = `Bearer ${token}`;
            const res = await fetch(`${baseUrl}${path}`, {
                method: "PATCH",
                headers,
                body: body ? JSON.stringify(body) : undefined,
                signal: controller.signal
            });
            const data = await res.json().catch(() => null);
            if (!res.ok) {
                const err = data?.error;
                return { ok: false, error: typeof err === "string" ? err : `HTTP ${res.status}` };
            }
            return { ok: true, data };
        }
        catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
        finally {
            clearTimeout(timer);
        }
    }
    return {
        getStatus: () => get("/api/status"),
        dispatchAction: async (action) => {
            const r = await post("/api/actions", action);
            return r.ok ? { ok: true, result: r.data?.result } : r;
        },
        createTask: async (input) => {
            const r = await post("/api/tasks", {
                title: input.title,
                description: input.description,
                priority: input.priority,
                source: input.source ?? "organizer"
            });
            return r.ok ? { ok: true, task: r.data?.task } : r;
        },
        patchTask: async (taskId, opts) => {
            const r = await post(`/api/tasks/${taskId}/patch`, {
                apply: opts?.apply ?? false,
                dryRun: opts?.dryRun ?? false,
                model: opts?.model
            });
            return r.ok ? { ok: true, result: r.data?.result } : r;
        },
        listTaskChanges: async (taskId) => {
            const r = await get(`/api/changes?taskId=${encodeURIComponent(taskId)}`);
            return r.ok ? { ok: true, changeSets: r.data?.changeSets } : r;
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
            return r.ok ? { ok: true, sessions: r.data?.sessions } : r;
        },
        createChatSession: async (input) => {
            const r = await post(`/api/chat/sessions`, input);
            return r.ok ? { ok: true, session: r.data?.session } : r;
        },
        getChatSession: async (sessionId) => {
            const r = await get(`/api/chat/sessions/${sessionId}`);
            if (!r.ok)
                return { ok: false, error: r.error };
            const d = r.data;
            return { ok: true, session: d?.session, messages: d?.messages, openQuestions: d?.openQuestions };
        },
        sendChatMessage: async (sessionId, input) => {
            const r = await post(`/api/chat/sessions/${sessionId}`, input);
            return r.ok ? { ok: true, session: r.data?.session, messages: r.data?.messages } : r;
        },
        deleteChatSession: async (sessionId) => {
            return del(`/api/chat/sessions/${sessionId}`);
        },
        renameChatSession: async (sessionId, title) => {
            const r = await patch(`/api/chat/sessions/${sessionId}`, { title });
            return r.ok ? { ok: true, session: r.data?.session } : r;
        },
        getOpenQuestions: async () => {
            const r = await get(`/api/questions/open`);
            return r.ok ? { ok: true, questions: r.data?.questions } : r;
        },
        listModels: async () => {
            const r = await get(`/api/models`);
            return r.ok ? { ok: true, models: r.data?.models } : r;
        },
        getFileTree: async () => {
            const r = await get(`/api/filetree`);
            return r.ok ? { ok: true, files: r.data?.files } : r;
        },
        getFile: async (filePath) => {
            const r = await get(`/api/file?path=${encodeURIComponent(filePath)}`);
            if (!r.ok)
                return { ok: false, error: r.error };
            const d = r.data;
            return { ok: true, content: d?.content, summary: d?.summary, importance: d?.importance, mimeType: d?.mimeType, isImage: d?.isImage };
        },
        getDashboard: async () => {
            const r = await get(`/api/dashboard`);
            return r.ok ? { ok: true, data: r.data } : { ok: false, error: r.error };
        },
        answerQuestion: async (questionId, answer) => {
            const r = await post(`/api/questions/${questionId}/answer`, { answer });
            return r.ok ? { ok: true, question: r.data?.question } : r;
        }
    };
}
