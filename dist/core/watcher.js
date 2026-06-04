import path from "node:path";
import { watch } from "chokidar";
export function createWatcher({ root, config, events, onChanged }) {
    let watcher;
    async function start() {
        if (!config.index.watch)
            return;
        watcher = watch(root, {
            ignoreInitial: true,
            persistent: true,
            ignored: [
                "**/node_modules/**",
                "**/.git/**",
                "**/.agent/**",
                "**/dist/**",
                "**/build/**",
                "**/.next/**",
                "**/coverage/**"
            ]
        });
        const handle = (filePath) => {
            const relative = path.relative(root, filePath);
            events.emit("watcher:fileChanged", relative);
            onChanged(relative);
        };
        watcher.on("add", handle);
        watcher.on("change", handle);
        watcher.on("unlink", handle);
    }
    async function stop() {
        await watcher?.close();
    }
    return { start, stop };
}
