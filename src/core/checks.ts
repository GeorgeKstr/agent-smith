import { execa } from "execa";
import type { CheckResult } from "../types/index.js";

/**
 * Run a single configured check command. The command is taken verbatim from the
 * project config (never from the model) and executed via the shell. Returns a
 * structured result instead of throwing.
 */
export async function runCheck(root: string, name: string, command: string): Promise<CheckResult> {
  if (!command || !command.trim()) {
    return { name, command, exitCode: 0, stdout: "", stderr: "(skipped: no command configured)", ok: true };
  }

  try {
    const result = await execa(command, {
      cwd: root,
      shell: true,
      reject: false,
      timeout: 180_000,
      all: false
    });
    return {
      name,
      command,
      exitCode: result.exitCode ?? 1,
      stdout: tail(result.stdout ?? ""),
      stderr: tail(result.stderr ?? ""),
      ok: (result.exitCode ?? 1) === 0
    };
  } catch (error) {
    return {
      name,
      command,
      exitCode: 1,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
      ok: false
    };
  }
}

/** Run the standard validation checks (typecheck, test) configured for the project. */
export async function runChecks(
  root: string,
  commands: { typecheck?: string; test?: string; lint?: string; build?: string },
  selected: Array<keyof typeof commands> = ["typecheck", "test"]
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  for (const key of selected) {
    const command = commands[key];
    if (!command) continue;
    results.push(await runCheck(root, key, command));
  }
  return results;
}

function tail(text: string, maxChars = 4000): string {
  if (text.length <= maxChars) return text;
  return "...\n" + text.slice(text.length - maxChars);
}
