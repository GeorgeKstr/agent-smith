import type { SmithDatabase } from "../../db/db.js";
import type { SmithConfig } from "../../types/index.js";
import type { WorkingMemory } from "../workingMemory.js";

export type ToolMode = "readonly" | "patch" | "dangerous";

export type ToolResult = {
  ok: boolean;
  summary: string;
  content?: string;
  truncated?: boolean;
  metadata?: Record<string, unknown>;
  nextActions?: string[];
};

export type ToolContext = {
  root: string;
  db: SmithDatabase;
  config: SmithConfig;
  events?: NodeJS.EventEmitter;
  memory?: WorkingMemory;
  taskId?: string;
};

export type AgentTool = {
  name: string;
  description: string;
  parameters: unknown;
  mode: ToolMode;
  handler: (args: unknown, ctx: ToolContext) => Promise<ToolResult>;
};

export class ToolRegistry {
  private tools = new Map<string, AgentTool>();

  register(tool: AgentTool): void {
    this.tools.set(tool.name, tool);
  }

  registerAll(tools: AgentTool[]): void {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  list(mode?: ToolMode): AgentTool[] {
    const all = [...this.tools.values()];
    if (!mode) return all;
    return all.filter((t) => t.mode === mode);
  }

  get(name: string): AgentTool | undefined {
    return this.tools.get(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }
}
