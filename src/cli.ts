import React from "react";
import { Command } from "commander";
import { render } from "ink";
import { detectProjectRoot } from "./core/projectRoot.js";
import { ensureConfig, loadConfig } from "./core/config.js";
import { createEventBus } from "./core/events.js";
import { openDatabase } from "./core/db.js";
import { createIndexer } from "./core/indexer.js";
import { createWatcher } from "./core/watcher.js";
import { isOllamaAvailable, listOllamaModels } from "./core/ollama.js";
import { runAsk, runPatch } from "./core/taskRunner.js";
import { fileNeighbors, renderFileGraph } from "./core/graph.js";
import { tagName } from "./core/tags.js";
import { App } from "./tui/App.js";

async function bootstrap() {
  const root = await detectProjectRoot(process.cwd());
  await ensureConfig(root);
  const config = await loadConfig(root);
  const db = openDatabase(root);
  const events = createEventBus();
  return { root, config, db, events };
}

export function createCli() {
  const program = new Command();

  program
    .name("smith")
    .description("Matrix-themed local-first terminal coding agent")
    .version("0.1.0");

  program
    .command("index")
    .description("Run a full scan/index bootstrap (files, symbols, graph, tags)")
    .option("--summarize", "also run the model intelligence pass (slower)", false)
    .action(async (opts: { summarize: boolean }) => {
      const { root, config, db, events } = await bootstrap();
      const indexer = createIndexer({ root, config, db, events, enableIntel: opts.summarize });
      await indexer.quickStartupScan();
      if (opts.summarize) await indexer.whenIdle();
      const stats = indexer.getStats();
      console.log(JSON.stringify({ root, ...stats }, null, 2));
      db.close();
    });

  program
    .command("status")
    .description("Show project/index status")
    .action(async () => {
      const { root, config, db } = await bootstrap();
      const files = (db.prepare("SELECT COUNT(*) AS c FROM files").get() as { c: number }).c;
      const symbols = (db.prepare("SELECT COUNT(*) AS c FROM symbols").get() as { c: number }).c;
      const imports = (db.prepare("SELECT COUNT(*) AS c FROM imports WHERE to_file_id IS NOT NULL").get() as { c: number }).c;
      const tagged = (db.prepare("SELECT COUNT(DISTINCT file_id) AS c FROM file_tags").get() as { c: number }).c;
      const ollama = await isOllamaAvailable(config.ollama.baseUrl);
      const models = ollama ? await listOllamaModels(config.ollama.baseUrl) : [];
      console.log(
        JSON.stringify(
          {
            root,
            patcherModel: config.models.patcher,
            ollama: ollama ? "online" : "offline",
            installedModels: models,
            files,
            symbols,
            localImports: imports,
            taggedFiles: tagged
          },
          null,
          2
        )
      );
      db.close();
    });

  program
    .command("ask")
    .description("Ask a question; builds dense context and answers with the local model")
    .argument("<task...>")
    .action(async (taskParts: string[]) => {
      const task = taskParts.join(" ");
      const { root, config, db, events } = await bootstrap();
      const indexer = createIndexer({ root, config, db, events });
      const result = await runAsk({ db, root, config, events, indexer }, task);

      console.log("\n— CONTEXT —");
      console.log(`tokens ~${result.packet.estimatedTokens} | files: ${result.packet.files.map((f) => f.path).join(", ") || "(none)"}`);
      if (result.message) console.log(`note: ${result.message}`);
      if (result.answer) {
        console.log("\n— ANSWER —");
        console.log(result.answer);
      }
      db.close();
    });

  program
    .command("patch")
    .description("Generate, validate and apply a unified-diff patch for a task")
    .argument("<task...>")
    .option("--dry-run", "validate without applying", false)
    .action(async (taskParts: string[], opts: { dryRun: boolean }) => {
      const task = taskParts.join(" ");
      const { root, config, db, events } = await bootstrap();
      const indexer = createIndexer({ root, config, db, events });
      const outcome = await runPatch({ db, root, config, events, indexer }, task, { apply: !opts.dryRun });

      console.log(`\n— PATCH (${outcome.attempts} attempt(s)) —`);
      console.log(outcome.message);
      if (outcome.files.length) console.log(`files: ${outcome.files.join(", ")}`);
      if (outcome.diff) {
        console.log("\n— DIFF —");
        console.log(outcome.diff);
      }
      for (const check of outcome.checks) {
        console.log(`\n[check ${check.name}] ${check.ok ? "PASS" : "FAIL"} (exit ${check.exitCode})`);
        if (!check.ok) console.log((check.stderr || check.stdout).slice(0, 1500));
      }
      await indexer.whenIdle();
      db.close();
      process.exitCode = outcome.ok ? 0 : 1;
    });

  program
    .command("inspect")
    .description("Inspect a file (summary/symbols/imports) or a symbol by name")
    .argument("<target>")
    .action(async (target: string) => {
      const { db } = await bootstrap();
      const file = db.prepare("SELECT id, path, language, summary FROM files WHERE path = ?").get(target) as
        | { id: number; path: string; language: string; summary: string | null }
        | undefined;

      if (file) {
        const symbols = db
          .prepare("SELECT name, kind, start_line, end_line FROM symbols WHERE file_id = ? ORDER BY start_line")
          .all(file.id) as Array<{ name: string; kind: string; start_line: number; end_line: number }>;
        const tags = (
          db
            .prepare("SELECT tag_id FROM file_tags WHERE file_id = ?")
            .all(file.id) as Array<{ tag_id: number }>
        ).map((r) => tagName(r.tag_id));
        console.log(`FILE  ${file.path} [${file.language}]`);
        console.log(`TAGS  ${tags.join(", ") || "(none)"}`);
        console.log(`SUMMARY  ${file.summary ?? "(pending)"}`);
        console.log(`SYMBOLS (${symbols.length}):`);
        for (const s of symbols) console.log(`  ${s.kind.padEnd(10)} ${s.name}  (L${s.start_line}-${s.end_line})`);
      } else {
        const matches = db
          .prepare(
            "SELECT s.name, s.kind, s.start_line, s.end_line, f.path FROM symbols s JOIN files f ON f.id = s.file_id WHERE s.name LIKE ? ORDER BY s.name LIMIT 25"
          )
          .all(`%${target}%`) as Array<{ name: string; kind: string; start_line: number; end_line: number; path: string }>;
        if (matches.length === 0) {
          console.log(`No file or symbol matched "${target}".`);
        } else {
          console.log(`SYMBOL MATCHES for "${target}":`);
          for (const m of matches) console.log(`  ${m.kind.padEnd(10)} ${m.name}  ${m.path}:${m.start_line}`);
        }
      }
      db.close();
    });

  program
    .command("graph")
    .description("Show the import neighborhood of a file (or a symbol's file)")
    .argument("<target>")
    .action(async (target: string) => {
      const { db } = await bootstrap();
      let relPath = target;
      const direct = db.prepare("SELECT path FROM files WHERE path = ?").get(target) as { path: string } | undefined;
      if (!direct) {
        const sym = db
          .prepare("SELECT f.path AS path FROM symbols s JOIN files f ON f.id = s.file_id WHERE s.name = ? LIMIT 1")
          .get(target) as { path: string } | undefined;
        if (sym) relPath = sym.path;
      }
      const neighbors = fileNeighbors(db, relPath);
      console.log(neighbors ? renderFileGraph(neighbors) : `No graph data for "${target}".`);
      db.close();
    });

  program.action(async () => {
    const { root, config, db, events } = await bootstrap();

    const indexer = createIndexer({ root, config, db, events });
    const watcher = createWatcher({
      root,
      config,
      events,
      onChanged: (filePath) => {
        void indexer.enqueueChangedFile(filePath);
      }
    });

    render(React.createElement(App, { root, config, db, events, indexer }));

    void indexer.quickStartupScan();
    await watcher.start();
  });

  return program;
}
