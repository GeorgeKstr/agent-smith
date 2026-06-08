import { execa } from "execa";
/**
 * Run a single configured check command. The command is taken verbatim from the
 * project config (never from the model) and executed via the shell. Returns a
 * structured result instead of throwing.
 */
export async function runCheck(root, name, command) {
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
    }
    catch (error) {
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
export async function runChecks(root, commands, selected = ["typecheck", "test"]) {
    const results = [];
    for (const key of selected) {
        const command = commands[key];
        if (!command)
            continue;
        results.push(await runCheck(root, key, command));
    }
    return results;
}
function tail(text, maxChars = 4000) {
    if (text.length <= maxChars)
        return text;
    return "...\n" + text.slice(text.length - maxChars);
}
