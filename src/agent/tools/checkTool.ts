import { execa } from "execa";
import type { AgentTool } from "./toolRegistry.js";

const MAX_OUTPUT_CHARS = 1500;

const checkTool: AgentTool = {
  name: "check",
  description: "Run a configured project check and return a compact result.",
  parameters: {
    type: "object",
    properties: {
      name: {
        type: "string",
        enum: ["typecheck", "test", "lint", "build"],
        description: "Which check to run.",
      },
    },
    required: ["name"],
  },
  mode: "patch",

  async handler(rawArgs, ctx): Promise<any> {
    const args = rawArgs as Record<string, unknown>;
    const name = typeof args.name === "string" ? args.name : "";

    if (!["typecheck", "test", "lint", "build"].includes(name)) {
      return { ok: false, summary: `Unknown check: ${name}. Use typecheck, test, lint, or build.` };
    }

    const cmdKey = name as "typecheck" | "test" | "lint" | "build";
    const command = ctx.config.commands[cmdKey];
    if (!command || !command.trim()) {
      return {
        ok: false,
        summary: `Command not configured for check: ${name}. Set it in .agent/config.json commands.${name}.`,
      };
    }

    const [cmd, ...cmdArgs] = command.split(/\s+/).filter(Boolean);
    if (!cmd) {
      return { ok: false, summary: `Invalid command for check: ${name}` };
    }

    let result;
    try {
      result = await execa(cmd, cmdArgs, {
        cwd: ctx.root,
        reject: false,
        timeout: 120_000,
      });
    } catch (err) {
      return {
        ok: false,
        summary: `Check ${name} failed to run: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    const exitCode = result.exitCode ?? 1;
    const stdout = result.stdout ?? "";
    const stderr = result.stderr ?? "";
    const combined = (stdout + "\n" + stderr).trim();
    const truncated = combined.length > MAX_OUTPUT_CHARS;
    const output = truncated ? combined.slice(0, MAX_OUTPUT_CHARS) + "\n... [output truncated]" : combined;

    const ok = exitCode === 0;

    return {
      ok: true,
      summary: `${ok ? "PASS" : "FAIL"} ${name} (exit ${exitCode})`,
      content: output,
      truncated,
      metadata: {
        cmdKey: name,
        command,
        exitCode,
        ok,
      },
      nextActions: ok ? undefined : ["Inspect errors above and repair."],
    };
  },
};

export { checkTool };
