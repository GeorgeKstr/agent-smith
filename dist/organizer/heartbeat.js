import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { createOrganizerClient } from "./workerClient.js";
export function buildWorkerHeartbeat(args) {
    const { root, config, db } = args;
    const hostname = os.hostname();
    const projectName = path.basename(root);
    let agentId = config.organizer.agentId;
    if (!agentId) {
        const hash = createHash("sha256").update(`${hostname}:${root}`).digest("hex").slice(0, 12);
        agentId = hash;
    }
    const name = config.organizer.agentName ?? `${hostname}-${projectName}`;
    const apiHost = config.api.host === "0.0.0.0" || config.api.host === "::" ? hostname : config.api.host;
    const apiBaseUrl = args.apiBaseUrl ?? config.organizer.apiBaseUrl ?? `http://${apiHost}:${config.api.port}`;
    const fileCount = db.prepare("SELECT COUNT(*) AS c FROM files").get().c;
    const dirtyCount = db.prepare("SELECT COUNT(*) AS c FROM files WHERE status != 'fresh'").get().c;
    const symbolCount = db.prepare("SELECT COUNT(*) AS c FROM symbols").get().c;
    const taggedCount = db.prepare("SELECT COUNT(DISTINCT file_id) AS c FROM file_tags").get().c;
    const actions = ["ask", "patch", "retrieve", "context", "index", "check", "smoke", "setup-check"];
    const capabilities = [
        "ask", "patch", "retrieve", "context", "index", "tasks", "changes", "api", "diff_only", "json_tools"
    ];
    if (config.compatibility.toolMode === "native_tools" ||
        config.compatibility.mode === "large-model" ||
        config.compatibility.mode === "cloud-agent") {
        capabilities.push("native_tools");
    }
    return {
        agentId,
        name,
        hostname,
        projectName,
        projectRoot: root,
        status: args.status ?? "idle",
        api: {
            enabled: config.api.enabled,
            baseUrl: apiBaseUrl,
            actions
        },
        models: {
            planner: config.models.summarizer,
            summarizer: config.models.summarizer,
            patcher: config.models.patcher,
            debugger: config.models.debugger,
            tooling: config.models.tagger
        },
        index: {
            files: fileCount,
            dirty: dirtyCount,
            symbols: symbolCount,
            taggedFiles: taggedCount,
            freshness: fileCount > 0 ? (fileCount - dirtyCount) / fileCount : 1
        },
        capabilities,
        currentTaskId: args.currentTaskId ?? null,
        timestamp: Date.now()
    };
}
export async function startOrganizerHeartbeat(args) {
    const { root, config, db, apiBaseUrl, onLog } = args;
    const client = createOrganizerClient({ url: config.organizer.url, token: config.organizer.token });
    let first = true;
    let registered = false;
    const tick = async () => {
        const payload = buildWorkerHeartbeat({ root, config, db, status: args.status, apiBaseUrl, currentTaskId: null });
        const result = registered
            ? await client.heartbeat(payload)
            : await client.register(payload);
        if (result.ok) {
            if (!registered && onLog) {
                onLog(`Registered with organizer at ${config.organizer.url}`);
            }
            registered = true;
        }
        else if (first && onLog) {
            onLog(`Organizer not reachable at ${config.organizer.url} — will keep retrying every ${config.organizer.heartbeatMs}ms`);
        }
        first = false;
    };
    await tick();
    const interval = setInterval(() => { void tick(); }, config.organizer.heartbeatMs);
    return { stop: () => clearInterval(interval) };
}
