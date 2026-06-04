import fs from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import ignore from "ignore";
export async function scanProjectFiles(root, ignorePatterns) {
    const ig = ignore();
    ig.add(ignorePatterns);
    for (const ignoreFile of [".gitignore", ".agentignore"]) {
        try {
            const text = await fs.readFile(path.join(root, ignoreFile), "utf8");
            ig.add(text.split(/\r?\n/).filter(Boolean));
        }
        catch {
            // ignore missing ignore files
        }
    }
    const files = await fg(["**/*"], {
        cwd: root,
        absolute: true,
        onlyFiles: true,
        dot: true,
        followSymbolicLinks: false
    });
    return files.filter((absolutePath) => {
        const relative = path.relative(root, absolutePath);
        return !ig.ignores(relative);
    });
}
