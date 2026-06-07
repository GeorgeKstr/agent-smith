import React from "react";
import fs from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";
import { render } from "ink";
import { detectProjectRoot } from "./core/projectRoot.js";
import { ensureConfig, loadConfig, DEFAULT_CONFIG } from "./core/config.js";
import { createEventBus } from "./core/events.js";
import { openDatabase } from "./core/db.js";
import { createIndexer } from "./core/indexer.js";
import { createWatcher } from "./core/watcher.js";
import { isProviderAvailable, listProviderModels } from "./core/providers.js";
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

function getConfigValue(obj: Record<string, unknown>, keyPath: string): unknown {
  const parts = keyPath.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current && typeof current === "object" && part in (current as Record<string, unknown>)) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return current;
}

function setConfigValue(obj: Record<string, unknown>, keyPath: string, rawValue: string): void {
  const parts = keyPath.split(".");
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!(parts[i] in current) || typeof current[parts[i]] !== "object") {
      current[parts[i]] = {};
    }
    current = current[parts[i]] as Record<string, unknown>;
  }
  const lastKey = parts[parts.length - 1];
  const existing = current[lastKey];
  if (typeof existing === "number") {
    current[lastKey] = Number(rawValue);
  } else if (typeof existing === "boolean") {
    current[lastKey] = rawValue === "true" || rawValue === "1";
  } else if (Array.isArray(existing)) {
    try {
      current[lastKey] = JSON.parse(rawValue);
    } catch {
      current[lastKey] = rawValue.split(",").map((s) => s.trim());
    }
  } else {
    try { current[lastKey] = JSON.parse(rawValue); } catch { current[lastKey] = rawValue; }
  }
}

function unsetConfigValue(obj: Record<string, unknown>, keyPath: string): void {
  const parts = keyPath.split(".");
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!(parts[i] in current)) return;
    current = current[parts[i]] as Record<string, unknown>;
  }
  delete current[parts[parts.length - 1]];
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
      const available = await isProviderAvailable(config);
      const models = available ? await listProviderModels(config) : [];
      console.log(
        JSON.stringify(
          {
            root,
            patcherModel: config.models.patcher,
            defaultProvider: config.defaultProvider,
            providers: Object.keys(config.providers).length > 0 ? Object.keys(config.providers) : ["ollama"],
            providerAvailable: available,
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
      if (outcome.answer) {
        console.log("\n— ANSWER —");
        console.log(outcome.answer);
      }
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

  program
    .command("config")
    .description("Manage Agent Smith configuration")
    .argument("[action]", "show, set, get, unset, add-provider, remove-provider, default-provider")
    .argument("[key...]", "config key path (e.g., models.patcher) and optional value")
    .option("--provider <name>", "provider ID for add-provider/remove-provider")
    .option("--url <url>", "base URL for add-provider")
    .option("--key-env <env>", "API key env var for add-provider")
    .option("--type <type>", "provider type: openai, anthropic, ollama")
    .action(async (action, keyParts, opts) => {
      const { root, config } = await bootstrap();
      const configPath = path.join(root, ".agent", "config.json");

      const saveConfig = async () => {
        await fs.writeFile(configPath, JSON.stringify(config, null, 2), "utf8");
      };

      if (!action || action === "show") {
        console.log(JSON.stringify(config, null, 2));
        return;
      }

      if (action === "list-providers") {
        console.log(JSON.stringify({
          defaultProvider: config.defaultProvider,
          providers: Object.keys(config.providers),
          builtin: ["ollama"]
        }, null, 2));
        return;
      }

      if (action === "add-provider") {
        const providerId = opts.provider;
        const providerType = (opts.type || "openai") as "openai" | "anthropic" | "ollama";
        const baseUrl = opts.url || (
          providerType === "openai" ? "https://api.openai.com/v1" :
          providerType === "anthropic" ? "https://api.anthropic.com" :
          "http://127.0.0.1:11434"
        );
        if (!providerId) {
          console.log("Usage: smith config add-provider --provider <id> [--url <url>] [--key-env <env>] [--type <openai|anthropic|ollama>]");
          return;
        }
        config.providers[providerId] = {
          type: providerType,
          baseUrl,
          apiKeyEnv: opts.keyEnv || undefined,
        };
        await saveConfig();
        console.log(`Provider "${providerId}" (${providerType}) added.`);
        return;
      }

      if (action === "remove-provider") {
        const providerId = opts.provider;
        if (!providerId) {
          console.log("Usage: smith config remove-provider --provider <id>");
          return;
        }
        if (providerId === "ollama") {
          console.log("Cannot remove the built-in ollama provider.");
          return;
        }
        delete config.providers[providerId];
        if (config.defaultProvider === providerId) {
          config.defaultProvider = "ollama";
        }
        await saveConfig();
        console.log(`Provider "${providerId}" removed.`);
        return;
      }

      if (action === "default-provider") {
        const providerId = keyParts?.[0];
        if (!providerId) {
          console.log(`Current default provider: ${config.defaultProvider}`);
          return;
        }
        if (providerId !== "ollama" && !config.providers[providerId]) {
          console.log(`Unknown provider: ${providerId}. Add it first with: smith config add-provider --provider ${providerId}`);
          return;
        }
        config.defaultProvider = providerId;
        await saveConfig();
        console.log(`Default provider set to "${providerId}".`);
        return;
      }

      if (action === "set") {
        if (!keyParts || keyParts.length < 2) {
          console.log("Usage: smith config set <key.path> <value>");
          return;
        }
        const keyPath = keyParts[0];
        const rawValue = keyParts.slice(1).join(" ");
        setConfigValue(config, keyPath, rawValue);
        await saveConfig();
        console.log(`Set ${keyPath} = ${JSON.stringify(getConfigValue(config, keyPath))}`);
        return;
      }

      if (action === "get") {
        const keyPath = keyParts?.[0];
        if (!keyPath) {
          console.log("Usage: smith config get <key.path>");
          return;
        }
        const value = getConfigValue(config, keyPath);
        console.log(JSON.stringify(value, null, 2));
        return;
      }

      if (action === "unset") {
        const keyPath = keyParts?.[0];
        if (!keyPath) {
          console.log("Usage: smith config unset <key.path>");
          return;
        }
        unsetConfigValue(config, keyPath);
        await saveConfig();
        console.log(`Unset ${keyPath} (reverted to default).`);
        return;
      }

      console.log(`Unknown config action: ${action}. Try: show, set, get, unset, list-providers, add-provider, remove-provider, default-provider`);
    });

  program.action(async () => {
    const { root, config, db, events } = await bootstrap();

    console.clear();

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
