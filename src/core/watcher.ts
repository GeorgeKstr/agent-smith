import path from "node:path";
import { watch, type FSWatcher } from "chokidar";
import type { SmithConfig } from "../types/index.js";

type WatcherArgs = {
  root: string;
  config: SmithConfig;
  events: NodeJS.EventEmitter;
  onChanged: (filePath: string) => void;
};

export function createWatcher({ root, config, events, onChanged }: WatcherArgs) {
  let watcher: FSWatcher | undefined;

  async function start() {
    if (!config.index.watch) return;

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

    const handle = (filePath: string) => {
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
