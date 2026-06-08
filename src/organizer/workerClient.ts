import type { OrganizerWorkerHeartbeat } from "../types/index.js";

export type OrganizerClient = {
  register(payload: OrganizerWorkerHeartbeat): Promise<{ ok: boolean; error?: string }>;
  heartbeat(payload: OrganizerWorkerHeartbeat): Promise<{ ok: boolean; error?: string }>;
};

export function createOrganizerClient(args: { url: string; token?: string }): OrganizerClient {
  const { url, token } = args;

  async function post(path: string, payload: unknown): Promise<{ ok: boolean; error?: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const fullUrl = `${url}${path}`;
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(fullUrl, {
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
    } catch (err) {
      if (err instanceof TypeError && err.message === "fetch failed") {
        return { ok: false, error: `Cannot reach organizer at ${fullUrl}. Is the organizer running? Run: smith organize` };
      }
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    register: (payload) => post(`/api/agents/register`, payload),
    heartbeat: (payload) => post(`/api/agents/${payload.agentId}/heartbeat`, payload)
  };
}
