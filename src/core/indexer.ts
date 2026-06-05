import fs from "node:fs/promises";
import path from "node:path";
import type { SmithConfig, ExtractedSymbol } from "../types/index.js";
import type { SmithDatabase } from "./db.js";
import { setMeta } from "./db.js";
import { scanProjectFiles } from "./scanner.js";
import { hashFile } from "./hashing.js";
import { extractImports, extractSymbols, isParseableLanguage } from "./treeSitter.js";
import { rebuildImports } from "./graph.js";
import { isOllamaAvailable, listOllamaModels, resolveModelName } from "./ollama.js";
import { summarizeFile } from "./summarizer.js";
import { generateWithOllama, optionsFromConfig } from "./ollama.js";
import { tagFile } from "./tagger.js";
import { heuristicTags } from "./tags.js";

const PROJECT_SUM_SYSTEM = `You describe a software project. Given high-level stats and key tags, write a concise 2-3 sentence overview describing what the project does overall, its architecture, and its key technologies. No preamble, no markdown, no quotes.`;

type IndexerArgs = {
  root: string;
  config: SmithConfig;
  db: SmithDatabase;
  events: NodeJS.EventEmitter;
  /** When false, the background model intelligence pass is never started. */
  enableIntel?: boolean;
};

export type Indexer = ReturnType<typeof createIndexer>;

const TIPS = [
  "Dense context beats giant context.",
  "The system retrieves. The model patches.",
  "A small model with perfect context can beat a large model with noise.",
  "The Matrix has you. Agent Smith indexes you.",
  "Tree-sitter symbols are cheaper than blind prompting.",
  "Never send a model what a query can answer."
];

async function generateProjectSummary(db: SmithDatabase, root: string, config: SmithConfig, model: string): Promise<void> {
  const countRow = db.prepare("SELECT COUNT(*) AS c FROM files").get() as { c: number }
  const symRow = db.prepare("SELECT COUNT(*) AS c FROM symbols").get() as { c: number }
  const impRow = db.prepare("SELECT COUNT(*) AS c FROM imports").get() as { c: number }
  const totalFiles = countRow?.c ?? 0
  const totalSymbols = symRow?.c ?? 0
  const totalImports = impRow?.c ?? 0

  const langRows = db
    .prepare("SELECT language, COUNT(*) AS count FROM files WHERE language IS NOT NULL AND language != '' GROUP BY language ORDER BY count DESC LIMIT 5")
    .all() as Array<{ language: string; count: number }>

  const tagRows = db
    .prepare("SELECT t.name, COUNT(ft.file_id) AS count FROM file_tags ft JOIN tags t ON t.id = ft.tag_id GROUP BY ft.tag_id ORDER BY count DESC LIMIT 6")
    .all() as Array<{ name: string; count: number }>

  if (totalFiles <= 5) return

  const prevCount = (db.prepare("SELECT value FROM meta WHERE key = 'project_summary_file_count'").get() as { value: string } | undefined)?.value
  if (prevCount === String(totalFiles)) return

  setMeta(db, "project_summary_file_count", String(totalFiles))

  const langStr = langRows.map((l) => `${l.language} (${l.count})`).join(", ") || "unknown"
  const tagStr = tagRows.map((t) => t.name).join(", ") || "none"

  const prompt = `Stats: ${totalFiles} files, ${totalSymbols} symbols, ${totalImports} imports.
Languages: ${langStr}
Key tags: ${tagStr}

Describe this project in 2-3 concise sentences:`

  const result = await generateWithOllama({
    baseUrl: config.ollama.baseUrl,
    model,
    system: PROJECT_SUM_SYSTEM,
    prompt,
    options: optionsFromConfig(config, { num_predict: 400 })
  })

  if (result.ok && result.text.trim()) {
    const text = result.text.replace(/\s+/g, " ").trim().slice(0, 1000)
    setMeta(db, "project_summary", text)
  }
}

export function createIndexer({ root, config, db, events, enableIntel = true }: IndexerArgs) {
  let filesTotal = 0;
  let filesScanned = 0;
  let dirtyFiles = 0;
  let symbolsIndexed = 0;
  let tagsRefreshed = 0;

  // Background summary/tag queue (concurrency 1).
  const summaryQueue: string[] = [];
  let summaryRunning = false;
  let ollamaReady: boolean | null = null;
  let intelDone: Promise<void> = Promise.resolve();

  // Pause/resume support: callers (e.g. TUI during a prompt) can suspend the
  // background intel queue so the model is fully available for generation.
  let paused = false;
  const resumeCallbacks: Array<() => void> = [];

  function pause() { paused = true; }
  function resume() {
    if (!paused) return;
    paused = false;
    const cbs = resumeCallbacks.splice(0);
    for (const cb of cbs) cb();
  }
  function waitForResume(): Promise<void> {
    if (!paused) return Promise.resolve();
    return new Promise<void>((resolve) => { resumeCallbacks.push(resolve); });
  }
  let summarizerModel = config.models.summarizer;
  let taggerModel = config.models.tagger;

  function kickQueue() {
    if (!enableIntel) {
      summaryQueue.length = 0;
      return;
    }
    if (!summaryRunning && summaryQueue.length > 0) {
      intelDone = runSummaryQueue();
    }
  }

  /** Resolves when the background intelligence queue is idle. */
  async function whenIdle(): Promise<void> {
    await intelDone;
  }

  const upsertFile = db.prepare(`
    INSERT INTO files (path, language, hash, size_bytes, mtime, is_test, is_generated, last_indexed_at, status)
    VALUES (@path, @language, @hash, @size_bytes, @mtime, @is_test, @is_generated, @last_indexed_at, @status)
    ON CONFLICT(path) DO UPDATE SET
      language=excluded.language,
      hash=excluded.hash,
      size_bytes=excluded.size_bytes,
      mtime=excluded.mtime,
      is_test=excluded.is_test,
      is_generated=excluded.is_generated,
      last_indexed_at=excluded.last_indexed_at,
      status=excluded.status
  `);

  function emitProgress(phase: string, extra: Record<string, unknown> = {}) {
    events.emit("index:progress", {
      phase,
      progress: filesTotal > 0 ? Math.min(0.99, filesScanned / filesTotal) : 0,
      filesScanned,
      filesTotal,
      dirtyFiles,
      symbolsIndexed,
      tagsRefreshed,
      tip: TIPS[filesScanned % TIPS.length],
      ...extra
    });
  }

  function knownPathMaps() {
    const rows = db.prepare("SELECT id, path FROM files").all() as Array<{ id: number; path: string }>;
    const knownPaths = new Set<string>();
    const pathToId = new Map<string, number>();
    for (const r of rows) {
      knownPaths.add(r.path);
      pathToId.set(r.path, r.id);
    }
    return { knownPaths, pathToId };
  }

  /** Re-extract symbols for one file, preserving summaries of unchanged symbols. */
  function indexSymbols(fileId: number, language: string, content: string): number {
    if (!isParseableLanguage(language)) {
      db.prepare("DELETE FROM symbols WHERE file_id = ?").run(fileId);
      return 0;
    }
    const previous = db.prepare("SELECT hash, summary FROM symbols WHERE file_id = ?").all(fileId) as Array<{
      hash: string | null;
      summary: string | null;
    }>;
    const summaryByHash = new Map<string, string>();
    for (const row of previous) {
      if (row.hash && row.summary) summaryByHash.set(row.hash, row.summary);
    }

    const symbols: ExtractedSymbol[] = extractSymbols(language, content);
    db.prepare("DELETE FROM symbols WHERE file_id = ?").run(fileId);

    const insert = db.prepare(`
      INSERT INTO symbols (file_id, name, qualified_name, kind, start_line, end_line, signature, summary, hash, status)
      VALUES (@file_id, @name, @qualified_name, @kind, @start_line, @end_line, @signature, @summary, @hash, @status)
    `);
    const tx = db.transaction(() => {
      for (const sym of symbols) {
        insert.run({
          file_id: fileId,
          name: sym.name,
          qualified_name: sym.name,
          kind: sym.kind,
          start_line: sym.startLine,
          end_line: sym.endLine,
          signature: sym.signature,
          summary: summaryByHash.get(sym.hash) ?? null,
          hash: sym.hash,
          status: "fresh"
        });
      }
    });
    tx();
    return symbols.length;
  }

  function indexImports(fileId: number, relPath: string, language: string, content: string) {
    const { knownPaths, pathToId } = knownPathMaps();
    const imports = extractImports(language, content);
    rebuildImports(db, fileId, relPath, imports, knownPaths, pathToId);
  }

  /** Fast, deterministic keyword tagging applied synchronously during indexing. */
  function applyHeuristicTags(fileId: number, relPath: string, content: string): boolean {
    const tagIds = heuristicTags(relPath, content);
    if (tagIds.length === 0) return false;
    db.prepare("DELETE FROM file_tags WHERE file_id = ? AND source = 'heuristic'").run(fileId);
    const insertTag = db.prepare(
      "INSERT OR IGNORE INTO file_tags (file_id, tag_id, confidence, source) VALUES (?, ?, ?, ?)"
    );
    for (const id of tagIds) insertTag.run(fileId, id, 0.6, "heuristic");
    return true;
  }

  async function quickStartupScan() {
    events.emit("index:start");
    emitProgress("scanning");

    const files = await scanProjectFiles(root, config.index.ignore);
    filesTotal = files.length;
    filesScanned = 0;
    dirtyFiles = 0;
    symbolsIndexed = 0;
    emitProgress("scanning");

    const changedParseable: Array<{ fileId: number; relPath: string; language: string; content: string }> = [];

    for (const absolutePath of files) {
      const relative = path.relative(root, absolutePath);
      let stat;
      let hash: string;
      try {
        stat = await fs.stat(absolutePath);
        hash = await hashFile(absolutePath);
      } catch {
        filesScanned++;
        continue;
      }

      const existing = db.prepare("SELECT id, hash FROM files WHERE path = ?").get(relative) as
        | { id: number; hash: string }
        | undefined;
      const changed = !existing || existing.hash !== hash;
      const language = detectLanguage(relative);

      filesScanned++;
      if (changed) dirtyFiles++;

      upsertFile.run({
        path: relative,
        language,
        hash,
        size_bytes: stat.size,
        mtime: Number(stat.mtimeMs),
        is_test: isTestFile(relative) ? 1 : 0,
        is_generated: isGeneratedFile(relative) ? 1 : 0,
        last_indexed_at: Date.now(),
        status: changed ? "dirty" : "fresh"
      });

      if (changed && isParseableLanguage(language) && stat.size < 600_000) {
        const fileRow = db.prepare("SELECT id FROM files WHERE path = ?").get(relative) as { id: number };
        try {
          const content = await fs.readFile(absolutePath, "utf8");
          changedParseable.push({ fileId: fileRow.id, relPath: relative, language, content });
        } catch {
          // skip unreadable file
        }
      }

      events.emit("index:fileScanned", relative);
      emitProgress("scanning", { currentFile: relative });
    }

    // Phase: parse symbols.
    emitProgress("parsing");
    for (const item of changedParseable) {
      symbolsIndexed += indexSymbols(item.fileId, item.language, item.content);
      if (applyHeuristicTags(item.fileId, item.relPath, item.content)) tagsRefreshed++;
      emitProgress("parsing", { currentFile: item.relPath });
    }

    // Phase: build import graph.
    emitProgress("graph");
    for (const item of changedParseable) {
      indexImports(item.fileId, item.relPath, item.language, item.content);
    }

    // Mark dirty files ready and queue summaries/tags.
    db.prepare("UPDATE files SET status = 'fresh' WHERE status = 'dirty'").run();

    emitProgress("ready");
    events.emit("index:progress", {
      phase: "ready",
      progress: 1,
      filesScanned,
      filesTotal,
      dirtyFiles,
      symbolsIndexed,
      tagsRefreshed,
      currentFile: undefined,
      tip: "Index core ready. Watch mode engaged."
    });
    events.emit("index:done");

    // Background intelligence pass.
    for (const item of changedParseable) summaryQueue.push(item.relPath);
    // Also (re)queue parseable files still missing intel from prior runs.
    const missing = db
      .prepare(
        `SELECT path, language FROM files f
         WHERE (summary IS NULL OR NOT EXISTS (SELECT 1 FROM file_tags ft WHERE ft.file_id = f.id))`
      )
      .all() as Array<{ path: string; language: string }>;
    const queued = new Set(summaryQueue);
    for (const row of missing) {
      if (isParseableLanguage(row.language) && !queued.has(row.path)) {
        summaryQueue.push(row.path);
        queued.add(row.path);
      }
    }
    kickQueue();
  }

  /** Background worker: summarize + tag files one at a time when Ollama is up. */
  async function runSummaryQueue() {
    summaryRunning = true;

    if (ollamaReady === null) {
      ollamaReady = await isOllamaAvailable(config.ollama.baseUrl);
      setMeta(db, "ollama_available", ollamaReady ? "1" : "0");
      if (ollamaReady) {
        const installed = await listOllamaModels(config.ollama.baseUrl);
        summarizerModel = resolveModelName(config.models.summarizer, installed);
        taggerModel = resolveModelName(config.models.tagger, installed);
      }
      events.emit("ollama:status", ollamaReady);
    }

    // Heuristic tags are applied synchronously during indexing. The background
    // pass only adds value when a model is available, so bail out when offline.
    if (!ollamaReady) {
      summaryQueue.length = 0;
      summaryRunning = false;
      events.emit("index:intel-done", { tagsRefreshed });
      return;
    }

    try {
      while (summaryQueue.length > 0) {
        // Yield to caller if indexer is paused (e.g. during a user prompt)
        await waitForResume();
        const relPath = summaryQueue.shift()!;
        const fileRow = db.prepare("SELECT id, language, hash, summary FROM files WHERE path = ?").get(relPath) as
          | { id: number; language: string; hash: string; summary: string | null }
          | undefined;
        if (!fileRow) continue;

        const cacheKey = `summary:${fileRow.hash}`;
        const impKey = `importance:${fileRow.hash}`;
        const cached = db.prepare("SELECT value FROM meta WHERE key = ?").get(cacheKey) as { value: string } | undefined;
        const cachedImp = db.prepare("SELECT value FROM meta WHERE key = ?").get(impKey) as { value: string } | undefined;

        let content: string;
        try {
          content = await fs.readFile(path.join(root, relPath), "utf8");
        } catch {
          continue;
        }

        let summary = cached?.value ?? fileRow.summary ?? "";
        let importance = cachedImp ? parseInt(cachedImp.value, 10) : 0;
        if ((!summary || !importance) && ollamaReady) {
          const result = await summarizeFile({ config, relPath, language: fileRow.language, content, model: summarizerModel });
          if (result.summary) {
            summary = result.summary;
            setMeta(db, cacheKey, summary);
          }
          importance = result.importance > 0 ? result.importance : 0;
          setMeta(db, impKey, String(importance));
        }
        if (summary) {
          db.prepare("UPDATE files SET summary = ? WHERE id = ?").run(summary, fileRow.id);
        }

        // Model-refined tags replace the synchronous heuristic set.
        const tagIds = await tagFile({ config, relPath, language: fileRow.language, content, model: taggerModel });
        if (tagIds.length > 0) {
          db.prepare("DELETE FROM file_tags WHERE file_id = ?").run(fileRow.id);
          const insertTag = db.prepare(
            "INSERT OR IGNORE INTO file_tags (file_id, tag_id, confidence, source) VALUES (?, ?, ?, ?)"
          );
          for (const id of tagIds) insertTag.run(fileRow.id, id, 0.8, "model");
          tagsRefreshed++;
        }

        events.emit("index:progress", {
          phase: "tagging",
          progress: 1,
          filesScanned,
          filesTotal,
          dirtyFiles,
          symbolsIndexed,
          tagsRefreshed,
          currentFile: relPath,
          tip: "Model intelligence pass running."
        });

        // Generate/regenerate project summary early (≥10 important files) and on each update.
        if (ollamaReady) {
          await generateProjectSummary(db, root, config, summarizerModel);
        }
      }
    } finally {
      summaryRunning = false;
      events.emit("index:intel-done", { tagsRefreshed });
    }
  }

  let debounceTimer: NodeJS.Timeout | undefined;
  const pendingChanges = new Set<string>();

  async function enqueueChangedFile(filePath: string) {
    const relative = path.isAbsolute(filePath) ? path.relative(root, filePath) : filePath;
    pendingChanges.add(relative);
    events.emit("index:fileDirty", relative);

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const batch = [...pendingChanges];
      pendingChanges.clear();
      void reindexPaths(batch);
    }, config.index.debounceMs);
  }

  /** Re-index a set of files immediately (used by watcher and the patch loop). */
  async function reindexPaths(relPaths: string[]): Promise<void> {
    for (const relative of relPaths) {
      const absolutePath = path.join(root, relative);
      let stat;
      let hash: string;
      try {
        stat = await fs.stat(absolutePath);
        hash = await hashFile(absolutePath);
      } catch {
        // File deleted -> drop from index.
        const row = db.prepare("SELECT id FROM files WHERE path = ?").get(relative) as { id: number } | undefined;
        if (row) {
          db.prepare("DELETE FROM symbols WHERE file_id = ?").run(row.id);
          db.prepare("DELETE FROM imports WHERE from_file_id = ?").run(row.id);
          db.prepare("DELETE FROM file_tags WHERE file_id = ?").run(row.id);
          db.prepare("DELETE FROM files WHERE id = ?").run(row.id);
        }
        events.emit("index:fileRemoved", relative);
        continue;
      }

      const language = detectLanguage(relative);

      // Check if the file content changed since the last index.
      const oldRow = db.prepare("SELECT hash, summary FROM files WHERE path = ?").get(relative) as { hash: string; summary: string | null } | undefined;
      const changed = !oldRow || oldRow.hash !== hash;

      upsertFile.run({
        path: relative,
        language,
        hash,
        size_bytes: stat.size,
        mtime: Number(stat.mtimeMs),
        is_test: isTestFile(relative) ? 1 : 0,
        is_generated: isGeneratedFile(relative) ? 1 : 0,
        last_indexed_at: Date.now(),
        status: "fresh"
      });

      if (isParseableLanguage(language) && stat.size < 600_000) {
        try {
          const content = await fs.readFile(absolutePath, "utf8");
          const fileRow = db.prepare("SELECT id FROM files WHERE path = ?").get(relative) as { id: number };
          indexSymbols(fileRow.id, language, content);
          indexImports(fileRow.id, relative, language, content);
          if (applyHeuristicTags(fileRow.id, relative, content)) tagsRefreshed++;
          if (changed) {
            // File content changed: clear cached intel so summary + importance are
            // regenerated from scratch on the next intelligence pass.
            db.prepare("DELETE FROM meta WHERE key = ?").run(`summary:${oldRow ? oldRow.hash : hash}`);
            db.prepare("DELETE FROM meta WHERE key = ?").run(`importance:${oldRow ? oldRow.hash : hash}`);
            // Invalidate project summary since a top-20 file's summary may change.
            db.prepare("DELETE FROM meta WHERE key IN ('project_summary','project_summary_file_count')").run();
          }
          summaryQueue.push(relative);
        } catch {
          // skip
        }
      }
      events.emit("index:fileReindexed", relative);
    }
    kickQueue();
  }

  function getStats() {
    const symbolCount = (db.prepare("SELECT COUNT(*) AS c FROM symbols").get() as { c: number }).c;
    const tagCount = (db.prepare("SELECT COUNT(DISTINCT file_id) AS c FROM file_tags").get() as { c: number }).c;
    return { filesTotal, filesScanned, dirtyFiles, symbolsIndexed: symbolCount, tagsRefreshed: tagCount };
  }

  return { quickStartupScan, enqueueChangedFile, reindexPaths, getStats, whenIdle, pause, resume };
}

export function detectLanguage(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    ".ts": "typescript",
    ".tsx": "typescript-react",
    ".js": "javascript",
    ".jsx": "javascript-react",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".json": "json",
    ".py": "python",
    ".css": "css",
    ".html": "html",
    ".md": "markdown",
    ".cpp": "cpp",
    ".cxx": "cpp",
    ".cc": "cpp",
    ".c++": "cpp",
    ".h": "c-header",
    ".hpp": "cpp-header",
    ".hxx": "cpp-header",
    ".hh": "cpp-header",
    ".c": "c",
    ".cs": "csharp",
    ".java": "java",
    ".kt": "kotlin",
    ".kts": "kotlin",
    ".scala": "scala",
    ".swift": "swift",
    ".go": "go",
    ".rs": "rust",
    ".rb": "ruby",
    ".php": "php",
    ".r": "r",
    ".m": "objective-c",
    ".mm": "objective-cpp",
    ".dart": "dart",
    ".lua": "lua",
    ".pl": "perl",
    ".pm": "perl",
    ".sh": "shell",
    ".bash": "shell",
    ".zsh": "shell",
    ".yaml": "yaml",
    ".yml": "yaml",
    ".toml": "toml",
    ".sql": "sql",
    ".graphql": "graphql",
    ".gql": "graphql",
    ".proto": "protobuf",
    ".vue": "vue",
    ".svelte": "svelte",
    ".astro": "astro",
    ".tex": "latex",
    ".ml": "ocaml",
    ".fs": "fsharp",
    ".ex": "elixir",
    ".exs": "elixir",
    ".erl": "erlang",
    ".hrl": "erlang",
    ".hs": "haskell",
    ".lhs": "haskell",
    ".nim": "nim",
    ".zig": "zig",
    ".clj": "clojure",
    ".cljs": "clojure",
    ".edn": "clojure",
    ".tf": "terraform",
    ".tfvars": "terraform",
    ".dockerfile": "dockerfile",
    ".sass": "sass",
    ".scss": "scss",
    ".less": "less"
  };
  return map[ext] ?? "text";
}

function isTestFile(filePath: string): boolean {
  return /(^|\/|\\)(test|tests|__tests__)(\/|\\)/.test(filePath)
    || /\.(test|spec)\.[a-z]+$/.test(filePath)
    || /_test\.(cpp|c|h|hpp|cc)$/.test(filePath)
    || /_spec\.(rb|rs)$/.test(filePath)
    || /_test\.go$/.test(filePath)
    || /test_\w+\.(py|rb)$/.test(filePath);
}

function isGeneratedFile(filePath: string): boolean {
  return filePath.includes("generated") || filePath.endsWith(".min.js");
}
