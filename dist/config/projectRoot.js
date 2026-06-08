import fs from "node:fs/promises";
import path from "node:path";
async function exists(filePath) {
    try {
        await fs.access(filePath);
        return true;
    }
    catch {
        return false;
    }
}
export async function detectProjectRoot(start) {
    let current = path.resolve(start);
    while (true) {
        if (await exists(path.join(current, ".git")))
            return current;
        if (await exists(path.join(current, "package.json")))
            return current;
        const parent = path.dirname(current);
        if (parent === current)
            return path.resolve(start);
        current = parent;
    }
}
