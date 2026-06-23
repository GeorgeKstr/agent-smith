import { execa } from "execa";
import type { AgentTool } from "./toolRegistry.js";

const MAX_OUTPUT_CHARS = 3000;
const DEFAULT_TIMEOUT_MS = 120_000;

const bashTool: AgentTool = {
  name: "bash",
  description: "Run an arbitrary shell command in the project directory and return the output.",
  parameters: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "The shell command to run (supports pipes, redirects, chaining).",
      },
      description: {
        type: "string",
        description: "Brief human-readable explanation of what the command does.",
      },
      timeout: {
        type: "number",
        description: `Timeout in milliseconds (default ${DEFAULT_TIMEOUT_MS}).`,
      },
      workdir: {
        type: "string",
        description: "Working directory relative to project root. Defaults to project root.",
      },
    },
    required: ["command"],
  },
  mode: "dangerous",

  async handler(rawArgs, ctx): Promise<any> {
    const args = rawArgs as Record<string, unknown>;
    const command = typeof args.command === "string" ? args.command.trim() : "";

    if (!command) {
      return { ok: false, summary: "No command provided. Use the command field." };
    }

    const description = typeof args.description === "string" ? args.description : "";
    const timeout = typeof args.timeout === "number" && args.timeout > 0 ? args.timeout : DEFAULT_TIMEOUT_MS;
    const workdir = typeof args.workdir === "string" ? args.workdir : "";

    const cwd = workdir ? `${ctx.root}/${workdir}` : ctx.root;

    let result;
    try {
      result = await execa(command, {
        shell: true,
        cwd,
        reject: false,
        timeout,
        all: true,
      });
    } catch (err) {
      return {
        ok: false,
        summary: `Command failed to run: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    const exitCode = result.exitCode ?? 1;
    const allOutput = (result.all ?? "").trim();
    const truncated = allOutput.length > MAX_OUTPUT_CHARS;
    const output = truncated
      ? allOutput.slice(0, MAX_OUTPUT_CHARS) + `\n... [output truncated at ${MAX_OUTPUT_CHARS} chars]`
      : allOutput;

    const cmdLabel = description ? `${command} (${description})` : command;

    return {
      ok: true,
      summary: `${exitCode === 0 ? "OK" : "EXIT " + exitCode} ${cmdLabel}`,
      content: output,
      truncated,
      metadata: {
        command,
        description,
        exitCode,
        cwd,
        timedOut: result.timedOut ?? false,
        isCanceled: result.isCanceled ?? false,
        failed: result.failed ?? false,
      },
      nextActions: exitCode === 0
        ? undefined
        : [`Command exited with code ${exitCode}. Inspect the error output above.`],
    };
  },
};

export { bashTool };
