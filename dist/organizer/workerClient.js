export function createOrganizerClient(args) {
    const { url, token } = args;
    async function post(path, payload) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        try {
            const headers = { "Content-Type": "application/json" };
            if (token)
                headers["Authorization"] = `Bearer ${token}`;
            const res = await fetch(`${url}${path}`, {
                method: "POST",
                headers,
                body: JSON.stringify(payload),
                signal: controller.signal
            });
            if (!res.ok) {
                const text = await res.text().catch(() => "");
                return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
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
    return {
        register: (payload) => post(`/api/agents/register`, payload),
        heartbeat: (payload) => post(`/api/agents/${payload.agentId}/heartbeat`, payload)
    };
}
