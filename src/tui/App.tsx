import React, { useEffect, useState, useCallback } from "react";
import { useApp, useInput } from "ink";
import type { BootState, SmithConfig, ContextPacket } from "../types/index.js";
import type { SmithDatabase } from "../core/db.js";
import type { Indexer } from "../core/indexer.js";
import { runAsk, runPatch } from "../core/taskRunner.js";
import { BootScreen } from "./screens/BootScreen.js";
import { MainScreen, type MainView } from "./screens/MainScreen.js";

const initialBootState: BootState = {
  phase: "idle",
  progress: 0,
  filesScanned: 0,
  filesTotal: 0,
  dirtyFiles: 0,
  symbolsIndexed: 0,
  tagsRefreshed: 0,
  tip: "Wake up, Smith."
};

export type AppProps = {
  root: string;
  config: SmithConfig;
  db: SmithDatabase;
  events: NodeJS.EventEmitter;
  indexer: Indexer;
};

export function App({ root, config, db, events, indexer }: AppProps) {
  const { exit } = useApp();
  const [boot, setBoot] = useState<BootState>(initialBootState);
  const [ready, setReady] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [ollamaReady, setOllamaReady] = useState<boolean | null>(null);

  const [mode, setMode] = useState<"ask" | "patch">("patch");
  const [view, setView] = useState<MainView>("context");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<string>("idle");
  const [packet, setPacket] = useState<ContextPacket | null>(null);
  const [answer, setAnswer] = useState("");
  const [patchText, setPatchText] = useState("");
  const [output, setOutput] = useState<string[]>([]);

  // Index + watcher events.
  useEffect(() => {
    const onProgress = (state: Record<string, unknown>) => {
      setBoot((previous) => ({
        ...previous,
        phase: (state.phase as BootState["phase"]) ?? previous.phase,
        progress: Number(state.progress ?? previous.progress),
        filesScanned: Number(state.filesScanned ?? previous.filesScanned),
        filesTotal: Number(state.filesTotal ?? previous.filesTotal),
        dirtyFiles: Number(state.dirtyFiles ?? previous.dirtyFiles),
        symbolsIndexed: Number(state.symbolsIndexed ?? previous.symbolsIndexed),
        tagsRefreshed: Number(state.tagsRefreshed ?? previous.tagsRefreshed),
        currentFile: (state.currentFile as string | undefined) ?? previous.currentFile,
        tip: (state.tip as string | undefined) ?? previous.tip
      }));
    };
    const onDone = () => setReady(true);
    const onChanged = (filePath: string) => setLogs((p) => [`Δ ${filePath}`, ...p].slice(0, 8));
    const onReindexed = (filePath: string) => setLogs((p) => [`↻ ${filePath}`, ...p].slice(0, 8));
    const onOllama = (status: boolean) => setOllamaReady(status);

    events.on("index:progress", onProgress);
    events.on("index:done", onDone);
    events.on("watcher:fileChanged", onChanged);
    events.on("index:fileReindexed", onReindexed);
    events.on("ollama:status", onOllama);

    return () => {
      events.off("index:progress", onProgress);
      events.off("index:done", onDone);
      events.off("watcher:fileChanged", onChanged);
      events.off("index:fileReindexed", onReindexed);
      events.off("ollama:status", onOllama);
    };
  }, [events]);

  // Task lifecycle events.
  useEffect(() => {
    const onPhase = (p: string) => setPhase(p);
    const onContext = (pkt: ContextPacket) => setPacket(pkt);
    const onPatch = (diff: string) => setPatchText(diff);
    events.on("task:phase", onPhase);
    events.on("task:context", onContext);
    events.on("task:patch", onPatch);
    return () => {
      events.off("task:phase", onPhase);
      events.off("task:context", onContext);
      events.off("task:patch", onPatch);
    };
  }, [events]);

  const submit = useCallback(async () => {
    const task = input.trim();
    if (!task || busy) return;
    setBusy(true);
    setAnswer("");
    setPatchText("");
    setOutput([`▶ ${mode}: ${task}`]);

    try {
      if (mode === "ask") {
        setView("context");
        const result = await runAsk({ db, root, config, events, indexer }, task);
        setAnswer(result.answer || result.message || "(no answer)");
        if (result.message) setOutput((o) => [...o, result.message!]);
        setView("answer");
      } else {
        setView("patch");
        const outcome = await runPatch({ db, root, config, events, indexer }, task, { apply: true });
        if (outcome.diff) setPatchText(outcome.diff);
        const lines = [outcome.message, ...outcome.checks.map((c) => `[${c.name}] ${c.ok ? "PASS" : "FAIL"} (exit ${c.exitCode})`)];
        setOutput((o) => [...o, ...lines.filter(Boolean) as string[]]);
      }
    } catch (error) {
      setOutput((o) => [...o, `error: ${error instanceof Error ? error.message : String(error)}`]);
    } finally {
      setBusy(false);
      setPhase("idle");
      setInput("");
    }
  }, [input, busy, mode, db, root, config, events, indexer]);

  useInput((char, key) => {
    if (key.ctrl && char === "c") {
      exit();
      return;
    }
    if (busy) return;

    if (key.ctrl && char === "a") {
      setMode("ask");
      return;
    }
    if (key.ctrl && char === "p") {
      setMode("patch");
      return;
    }
    if (key.ctrl && char === "i") {
      setView("context");
      return;
    }
    if (key.ctrl && char === "t") {
      setView("patch");
      return;
    }
    if (key.ctrl && char === "r") {
      setOutput(["↻ reindexing…"]);
      void indexer.quickStartupScan();
      return;
    }
    if (key.escape) {
      setInput("");
      return;
    }
    if (key.return) {
      void submit();
      return;
    }
    if (key.backspace || key.delete) {
      setInput((value) => value.slice(0, -1));
      return;
    }
    if (char && !key.ctrl && !key.meta) {
      setInput((value) => value + char);
    }
  });

  if (!ready && config.theme.showBootAnimation) {
    return <BootScreen state={boot} animate={config.theme.animations} />;
  }

  return (
    <MainScreen
      root={root}
      model={mode === "patch" ? config.models.patcher : config.models.summarizer}
      ollamaReady={ollamaReady}
      filesTotal={boot.filesTotal}
      dirtyFiles={boot.dirtyFiles}
      symbolsIndexed={boot.symbolsIndexed}
      tagsRefreshed={boot.tagsRefreshed}
      logs={logs}
      mode={mode}
      view={view}
      input={input}
      busy={busy}
      phase={phase}
      packet={packet}
      answer={answer}
      patchText={patchText}
      output={output}
      maxTokens={config.context.maxPromptTokens}
    />
  );
}
