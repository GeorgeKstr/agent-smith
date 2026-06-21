import fs from "node:fs/promises";
import path from "node:path";
import type { PendingFileOperation } from "./approvalTypes.js";
import { makeOperationId } from "./approvalTypes.js";

export class ApprovalStore {
  private filePath: string;
  private cache: Map<string, PendingFileOperation> = new Map();
  private loaded = false;

  constructor(storePath: string) {
    this.filePath = storePath;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const dir = path.dirname(this.filePath);
      await fs.mkdir(dir, { recursive: true });
    } catch {}

    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const items = JSON.parse(raw) as PendingFileOperation[];
      for (const item of items) {
        this.cache.set(item.id, item);
      }
    } catch {}
  }

  private async save(): Promise<void> {
    const dir = path.dirname(this.filePath);
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch {}
    const items = [...this.cache.values()];
    await fs.writeFile(this.filePath, JSON.stringify(items, null, 2), "utf8");
  }

  async create(
    operation: Omit<PendingFileOperation, "id" | "createdAt" | "status">
  ): Promise<PendingFileOperation> {
    await this.ensureLoaded();
    const entry: PendingFileOperation = {
      ...operation,
      id: makeOperationId(),
      createdAt: new Date().toISOString(),
      status: "pending",
    };
    this.cache.set(entry.id, entry);
    await this.save();
    return entry;
  }

  async listPending(taskId?: string): Promise<PendingFileOperation[]> {
    await this.ensureLoaded();
    let items = [...this.cache.values()];
    if (taskId) {
      items = items.filter((o) => o.taskId === taskId);
    }
    return items.sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
  }

  async get(id: string): Promise<PendingFileOperation | null> {
    await this.ensureLoaded();
    return this.cache.get(id) ?? null;
  }

  async approve(id: string): Promise<PendingFileOperation> {
    await this.ensureLoaded();
    const entry = this.cache.get(id);
    if (!entry) throw new Error(`Operation ${id} not found`);
    entry.status = "approved";
    this.cache.set(id, entry);
    await this.save();
    return entry;
  }

  async reject(id: string): Promise<PendingFileOperation> {
    await this.ensureLoaded();
    const entry = this.cache.get(id);
    if (!entry) throw new Error(`Operation ${id} not found`);
    entry.status = "rejected";
    this.cache.set(id, entry);
    await this.save();
    return entry;
  }

  async markApplied(id: string): Promise<void> {
    await this.ensureLoaded();
    const entry = this.cache.get(id);
    if (!entry) throw new Error(`Operation ${id} not found`);
    entry.status = "applied";
    this.cache.set(id, entry);
    await this.save();
  }

  async markFailed(id: string, error: string): Promise<void> {
    await this.ensureLoaded();
    const entry = this.cache.get(id);
    if (!entry) throw new Error(`Operation ${id} not found`);
    entry.status = "failed";
    entry.error = error;
    this.cache.set(id, entry);
    await this.save();
  }

  async approveAll(taskId?: string): Promise<number> {
    await this.ensureLoaded();
    let count = 0;
    for (const [id, entry] of this.cache) {
      if (taskId && entry.taskId !== taskId) continue;
      if (entry.status === "pending") {
        entry.status = "approved";
        this.cache.set(id, entry);
        count++;
      }
    }
    if (count > 0) await this.save();
    return count;
  }

  async rejectAll(taskId?: string): Promise<number> {
    await this.ensureLoaded();
    let count = 0;
    for (const [id, entry] of this.cache) {
      if (taskId && entry.taskId !== taskId) continue;
      if (entry.status === "pending") {
        entry.status = "rejected";
        this.cache.set(id, entry);
        count++;
      }
    }
    if (count > 0) await this.save();
    return count;
  }
}

let defaultStore: ApprovalStore | null = null;

export function getApprovalStore(root: string): ApprovalStore {
  if (!defaultStore) {
    const storePath = path.join(root, ".smith", "pending-operations.json");
    defaultStore = new ApprovalStore(storePath);
  }
  return defaultStore;
}

export function resetApprovalStore(): void {
  defaultStore = null;
}
