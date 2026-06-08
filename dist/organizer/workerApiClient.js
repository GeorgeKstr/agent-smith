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
            if (!res.ok)
                return { ok: false, error: `HTTP ${res.status}: ${JSON.stringify(data).slice(0, 200)}` };
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
            if (!res.ok)
                return { ok: false, error: `HTTP ${res.status}` };
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
        getOpenQuestions: async () => {
            const r = await get(`/api/questions/open`);
            return r.ok ? { ok: true, questions: r.data?.questions } : r;
        },
        answerQuestion: async (questionId, answer) => {
            const r = await post(`/api/questions/${questionId}/answer`, { answer });
            return r.ok ? { ok: true, question: r.data?.question } : r;
        }
    };
}
