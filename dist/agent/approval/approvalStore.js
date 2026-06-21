import fs from "node:fs/promises";
import path from "node:path";
import { makeOperationId } from "./approvalTypes.js";
export class ApprovalStore {
    filePath;
    cache = new Map();
    loaded = false;
    constructor(storePath) {
        this.filePath = storePath;
    }
    async ensureLoaded() {
        if (this.loaded)
            return;
        this.loaded = true;
        try {
            const dir = path.dirname(this.filePath);
            await fs.mkdir(dir, { recursive: true });
        }
        catch { }
        try {
            const raw = await fs.readFile(this.filePath, "utf8");
            const items = JSON.parse(raw);
            for (const item of items) {
                this.cache.set(item.id, item);
            }
        }
        catch { }
    }
    async save() {
        const dir = path.dirname(this.filePath);
        try {
            await fs.mkdir(dir, { recursive: true });
        }
        catch { }
        const items = [...this.cache.values()];
        await fs.writeFile(this.filePath, JSON.stringify(items, null, 2), "utf8");
    }
    async create(operation) {
        await this.ensureLoaded();
        const entry = {
            ...operation,
            id: makeOperationId(),
            createdAt: new Date().toISOString(),
            status: "pending",
        };
        this.cache.set(entry.id, entry);
        await this.save();
        return entry;
    }
    async listPending(taskId) {
        await this.ensureLoaded();
        let items = [...this.cache.values()];
        if (taskId) {
            items = items.filter((o) => o.taskId === taskId);
        }
        return items.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    }
    async get(id) {
        await this.ensureLoaded();
        return this.cache.get(id) ?? null;
    }
    async approve(id) {
        await this.ensureLoaded();
        const entry = this.cache.get(id);
        if (!entry)
            throw new Error(`Operation ${id} not found`);
        entry.status = "approved";
        this.cache.set(id, entry);
        await this.save();
        return entry;
    }
    async reject(id) {
        await this.ensureLoaded();
        const entry = this.cache.get(id);
        if (!entry)
            throw new Error(`Operation ${id} not found`);
        entry.status = "rejected";
        this.cache.set(id, entry);
        await this.save();
        return entry;
    }
    async markApplied(id) {
        await this.ensureLoaded();
        const entry = this.cache.get(id);
        if (!entry)
            throw new Error(`Operation ${id} not found`);
        entry.status = "applied";
        this.cache.set(id, entry);
        await this.save();
    }
    async markFailed(id, error) {
        await this.ensureLoaded();
        const entry = this.cache.get(id);
        if (!entry)
            throw new Error(`Operation ${id} not found`);
        entry.status = "failed";
        entry.error = error;
        this.cache.set(id, entry);
        await this.save();
    }
    async approveAll(taskId) {
        await this.ensureLoaded();
        let count = 0;
        for (const [id, entry] of this.cache) {
            if (taskId && entry.taskId !== taskId)
                continue;
            if (entry.status === "pending") {
                entry.status = "approved";
                this.cache.set(id, entry);
                count++;
            }
        }
        if (count > 0)
            await this.save();
        return count;
    }
    async rejectAll(taskId) {
        await this.ensureLoaded();
        let count = 0;
        for (const [id, entry] of this.cache) {
            if (taskId && entry.taskId !== taskId)
                continue;
            if (entry.status === "pending") {
                entry.status = "rejected";
                this.cache.set(id, entry);
                count++;
            }
        }
        if (count > 0)
            await this.save();
        return count;
    }
}
let defaultStore = null;
export function getApprovalStore(root) {
    if (!defaultStore) {
        const storePath = path.join(root, ".smith", "pending-operations.json");
        defaultStore = new ApprovalStore(storePath);
    }
    return defaultStore;
}
export function resetApprovalStore() {
    defaultStore = null;
}
