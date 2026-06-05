import { jsx as _jsx } from "react/jsx-runtime";
import { useEffect, useState, useCallback } from "react";
import { useApp, useInput, useStdout } from "ink";
import fs from "node:fs/promises";
import path from "node:path";
import { runAsk, runPatch, undoPatchFromDiff } from "../core/taskRunner.js";
import { isOllamaAvailable, listOllamaModels, resolveModelName } from "../core/ollama.js";
import { BootScreen } from "./screens/BootScreen.js";
import { MainScreen } from "./screens/MainScreen.js";
import { IndexDashboard } from "./screens/IndexDashboard.js";
const initialBoot = {
    phase: "idle",
    progress: 0,
    filesScanned: 0,
    filesTotal: 0,
    dirtyFiles: 0,
    symbolsIndexed: 0,
    tagsRefreshed: 0,
};
const UI_STATE_REL_PATH = path.join(".agent", "tui-state.json");
const UI_STATE_VERSION = 1;
const MAX_OUTPUT_LINES = 1500;
const MAX_PROMPT_HISTORY = 120;
function limitLines(lines, max) {
    return lines.length > max ? lines.slice(lines.length - max) : lines;
}
function toChatLines(prefix, text) {
    const lines = text.split("\n");
    if (lines.length === 0)
        return [prefix];
    const [first, ...rest] = lines;
    return [`${prefix}${first}`, ...rest.map((line) => `  ${line}`)];
}
async function loadUiState(root) {
    const statePath = path.join(root, UI_STATE_REL_PATH);
    try {
        const raw = await fs.readFile(statePath, "utf8");
        const parsed = JSON.parse(raw);
        if (parsed.version !== UI_STATE_VERSION)
            return null;
        if (parsed.mode !== "build" && parsed.mode !== "discuss")
            return null;
        return {
            version: UI_STATE_VERSION,
            mode: parsed.mode,
            modelOverride: typeof parsed.modelOverride === "string" ? parsed.modelOverride : null,
            output: Array.isArray(parsed.output) ? parsed.output.filter((v) => typeof v === "string") : [],
            promptHistory: Array.isArray(parsed.promptHistory)
                ? parsed.promptHistory.filter((v) => typeof v === "string")
                : []
        };
    }
    catch {
        return null;
    }
}
async function saveUiState(root, state) {
    const statePath = path.join(root, UI_STATE_REL_PATH);
    await fs.mkdir(path.dirname(statePath), { recursive: true });
    await fs.writeFile(statePath, `${JSON.stringify(state)}\n`, "utf8");
}
export function App({ root, config, db, events, indexer }) {
    const { exit } = useApp();
    const { stdout } = useStdout();
    const quit = useCallback(() => {
        console.clear();
        exit();
    }, [exit]);
    const [boot, setBoot] = useState(initialBoot);
    const [ready, setReady] = useState(false);
    const [ollamaReady, setOllamaReady] = useState(null);
    const [mode, setMode] = useState("build");
    const [input, setInput] = useState("");
    const [busy, setBusy] = useState(false);
    const [phase, setPhase] = useState("idle");
    const [intent, setIntent] = useState(null);
    const [scrollOffset, setScrollOffset] = useState(0);
    const [packet, setPacket] = useState(null);
    const [answer, setAnswer] = useState("");
    const [patchText, setPatchText] = useState("");
    const [output, setOutput] = useState([]);
    const [logs, setLogs] = useState([]);
    const [availableModels, setAvailableModels] = useState([]);
    const [modelOverride, setModelOverride] = useState(null);
    const [promptHistory, setPromptHistory] = useState([]);
    const [promptHistoryIndex, setPromptHistoryIndex] = useState(null);
    const [executions, setExecutions] = useState([]);
    const [uiStateLoaded, setUiStateLoaded] = useState(false);
    const [view, setView] = useState("main");
    const appendOutput = useCallback((lines) => {
        const next = Array.isArray(lines) ? lines : [lines];
        setOutput((prev) => limitLines([...prev, ...next], MAX_OUTPUT_LINES));
    }, []);
    useEffect(() => {
        // Use alternate screen buffer so the UI owns a bounded area and does not
        // accumulate rows from prior terminal output.
        if (!stdout.isTTY)
            return;
        stdout.write("\u001B[?1049h\u001B[2J\u001B[H");
        return () => {
            stdout.write("\u001B[?1049l");
        };
    }, [stdout]);
    useEffect(() => {
        let cancelled = false;
        void (async () => {
            const persisted = await loadUiState(root);
            if (cancelled)
                return;
            if (persisted) {
                setMode(persisted.mode);
                setModelOverride(persisted.modelOverride);
                setOutput(limitLines(persisted.output, MAX_OUTPUT_LINES));
                setPromptHistory(limitLines(persisted.promptHistory, MAX_PROMPT_HISTORY));
            }
            setUiStateLoaded(true);
        })();
        return () => {
            cancelled = true;
        };
    }, [root]);
    useEffect(() => {
        if (!uiStateLoaded)
            return;
        const timer = setTimeout(() => {
            void saveUiState(root, {
                version: UI_STATE_VERSION,
                mode,
                modelOverride,
                output: limitLines(output, MAX_OUTPUT_LINES),
                promptHistory: limitLines(promptHistory, MAX_PROMPT_HISTORY)
            });
        }, 120);
        return () => clearTimeout(timer);
    }, [root, uiStateLoaded, mode, modelOverride, output, promptHistory]);
    useEffect(() => {
        const onProgress = (s) => setBoot((p) => ({
            ...p,
            phase: s.phase ?? p.phase,
            progress: Number(s.progress ?? p.progress),
            filesScanned: Number(s.filesScanned ?? p.filesScanned),
            filesTotal: Number(s.filesTotal ?? p.filesTotal),
            dirtyFiles: Number(s.dirtyFiles ?? p.dirtyFiles),
            symbolsIndexed: Number(s.symbolsIndexed ?? p.symbolsIndexed),
            tagsRefreshed: Number(s.tagsRefreshed ?? p.tagsRefreshed),
            currentFile: s.currentFile ?? p.currentFile,
        }));
        const onDone = () => setReady(true);
        const onChanged = (fp) => setLogs((p) => [`Δ ${fp}`, ...p].slice(0, 6));
        const onReindexed = (fp) => setLogs((p) => [`↻ ${fp}`, ...p].slice(0, 6));
        const onOllama = (s) => setOllamaReady(s);
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
    const refreshModels = useCallback(async () => {
        const online = await isOllamaAvailable(config.ollama.baseUrl);
        setOllamaReady(online);
        if (!online) {
            setAvailableModels([]);
            return [];
        }
        const models = await listOllamaModels(config.ollama.baseUrl);
        setAvailableModels(models);
        return models;
    }, [config.ollama.baseUrl]);
    const pickModel = useCallback((requested, models) => {
        const q = requested.trim();
        if (!q || models.length === 0)
            return "";
        if (models.includes(q))
            return q;
        const starts = models.filter((m) => m.toLowerCase().startsWith(q.toLowerCase()));
        if (starts.length === 1)
            return starts[0];
        const family = models.filter((m) => m.split(":")[0].toLowerCase() === q.toLowerCase());
        if (family.length === 1)
            return family[0];
        return resolveModelName(q, models);
    }, []);
    useEffect(() => {
        const onPhase = (p) => setPhase(p);
        const onIntent = (i) => setIntent(i);
        const onContext = (pkt) => setPacket(pkt);
        const onPatch = (d) => setPatchText(d);
        events.on("task:phase", onPhase);
        events.on("task:intent", onIntent);
        events.on("task:context", onContext);
        events.on("task:patch", onPatch);
        return () => {
            events.off("task:phase", onPhase);
            events.off("task:intent", onIntent);
            events.off("task:context", onContext);
            events.off("task:patch", onPatch);
        };
    }, [events]);
    const undoLast = useCallback(async () => {
        const last = executions[executions.length - 1];
        if (!last) {
            appendOutput("Nothing to undo.");
            return;
        }
        setBusy(true);
        setPhase("undoing");
        let fileNote = "";
        if (last.undoDiff) {
            const reverted = await undoPatchFromDiff({ db, root, config, events, indexer }, last.undoDiff);
            fileNote = reverted.ok ? ` | files: ${reverted.files.length} reverted` : ` | ${reverted.message}`;
        }
        setOutput((o) => limitLines([...o.slice(0, last.outputStart), `↶ undo: ${last.prompt}${fileNote}`], MAX_OUTPUT_LINES));
        setAnswer(last.prevAnswer);
        setPatchText(last.prevPatchText);
        setPacket(last.prevPacket);
        setIntent(last.prevIntent);
        setExecutions((e) => e.slice(0, -1));
        setPromptHistory((h) => (h[h.length - 1] === last.prompt ? h.slice(0, -1) : h));
        setPromptHistoryIndex(null);
        setBusy(false);
        setPhase("idle");
    }, [executions, db, root, config, events, indexer, appendOutput]);
    const handleSlashCommand = useCallback(async (input) => {
        const rawParts = input.trim().split(/\s+/);
        const parts = rawParts.map((p) => p.toLowerCase());
        const cmd = parts[0];
        switch (cmd) {
            case "/ask": {
                setMode("discuss");
                appendOutput("✓ Switched to discuss mode");
                return true;
            }
            case "/patch": {
                setMode("build");
                appendOutput("✓ Switched to build mode");
                return true;
            }
            case "/mode": {
                const target = parts[1];
                if (!target) {
                    appendOutput(`current mode: ${mode}`);
                    return true;
                }
                if (target === "build" || target === "patch") {
                    setMode("build");
                    appendOutput("✓ Mode set to build");
                    return true;
                }
                if (target === "discuss" || target === "ask" || target === "chat") {
                    setMode("discuss");
                    appendOutput("✓ Mode set to discuss");
                    return true;
                }
                appendOutput(`Unknown mode: ${target}. Use /mode build or /mode discuss`);
                return true;
            }
            case "/help": {
                appendOutput([
                    "",
                    "  Commands:",
                    "",
                    "  /mode build  Build/apply patches (task mode)",
                    "  /mode discuss  Discuss/chat/explain mode",
                    "  /ask         Alias for /mode discuss",
                    "  /patch       Alias for /mode build",
                    "  /reindex     Re-index the project",
                    "  /index       Show the index dashboard (file summaries, graph, stats)",
                    "  /model [name|list|reset]  List or switch Ollama model",
                    "  /tools       Show Qwen tool-calling integration notes",
                    "  /undo        Undo last prompt result (files + convo)",
                    "  /clear       Clear the output area",
                    "  /help        Show this help message",
                    "  /exit        Exit the application",
                    "",
                    "  Keys:  Enter submit · Esc clear · ↑/↓ scroll · Ctrl+↑/↓ prompt history · PgUp/PgDn fast scroll · Ctrl+C quit",
                    "",
                ]);
                return true;
            }
            case "/model": {
                const arg = rawParts[1];
                const argLower = arg?.toLowerCase();
                if (!arg || argLower === "list") {
                    const models = await refreshModels();
                    const current = modelOverride ?? (mode === "build" ? config.models.patcher : config.models.summarizer);
                    if (models.length === 0) {
                        appendOutput("No Ollama models found (offline or none installed).");
                        return true;
                    }
                    appendOutput([
                        `Active model: ${resolveModelName(current, models)}`,
                        ...models.map((m) => `${m === resolveModelName(current, models) ? "*" : " "} ${m}`)
                    ]);
                    return true;
                }
                if (argLower === "reset" || argLower === "default" || argLower === "auto") {
                    setModelOverride(null);
                    appendOutput("✓ Model override cleared (using mode defaults).");
                    return true;
                }
                const models = await refreshModels();
                if (models.length === 0) {
                    appendOutput("Cannot set model: Ollama offline or no installed models.");
                    return true;
                }
                const selected = pickModel(arg, models);
                if (!selected) {
                    appendOutput(`Model not found: ${arg}`);
                    return true;
                }
                setModelOverride(selected);
                appendOutput(`✓ Model set to ${selected}`);
                return true;
            }
            case "/reindex":
            case "/sync": {
                appendOutput("↻ Reindexing...");
                void indexer.quickStartupScan();
                return true;
            }
            case "/tools": {
                appendOutput([
                    "",
                    "  Qwen tools:",
                    "",
                    "  This drop-in adds src/core/qwenTools.ts and src/core/localProjectTools.ts.",
                    "  Wire runQwenFunctionLoop into runAsk/runPatch to let Qwen call find_files, find_symbols, read_file and file_neighbors.",
                    "  The UI already shows tool progress through task:phase events such as tool:read_file.",
                    "",
                ]);
                return true;
            }
            case "/index":
            case "/dashboard": {
                setView("index");
                return true;
            }
            case "/clear": {
                setOutput([]);
                setAnswer("");
                setPatchText("");
                setPacket(null);
                setIntent(null);
                setExecutions([]);
                setScrollOffset(0);
                return true;
            }
            case "/undo": {
                await undoLast();
                return true;
            }
            case "/exit":
            case "/quit": {
                quit();
                return true;
            }
            default: {
                if (cmd?.startsWith("/")) {
                    appendOutput(`Unknown command: ${cmd}. Try /help`);
                    return true;
                }
                return false;
            }
        }
    }, [
        quit,
        indexer,
        mode,
        undoLast,
        appendOutput,
        config.models.patcher,
        config.models.summarizer,
        modelOverride,
        refreshModels,
        pickModel
    ]);
    const submit = useCallback(async () => {
        const task = input.trim();
        if (!task || busy)
            return;
        setInput("");
        if (task.startsWith("/")) {
            appendOutput(`⌘ ${task}`);
            await handleSlashCommand(task);
            return;
        }
        const outputStart = output.length;
        const prevAnswer = answer;
        const prevPatchText = patchText;
        const prevPacket = packet;
        const prevIntent = intent;
        setPromptHistory((h) => {
            if (h[h.length - 1] === task)
                return h;
            return [...h, task].slice(-MAX_PROMPT_HISTORY);
        });
        setPromptHistoryIndex(null);
        setBusy(true);
        setAnswer("");
        setPatchText("");
        setPacket(null);
        setIntent(null);
        setScrollOffset(0);
        appendOutput(`▶ ${mode}: ${task}`);
        let undoDiff;
        try {
            const activeModel = modelOverride
                ? resolveModelName(modelOverride, availableModels)
                : undefined;
            if (mode === "discuss") {
                const result = await runAsk({ db, root, config, events, indexer }, task, { modelOverride: activeModel });
                const answerText = result.answer || result.message || "(no answer)";
                setAnswer(answerText);
                appendOutput(toChatLines("AI: ", answerText));
            }
            else {
                const outcome = await runPatch({ db, root, config, events, indexer }, task, { apply: true, modelOverride: activeModel });
                if (outcome.diff)
                    setPatchText(outcome.diff);
                if (outcome.answer)
                    setAnswer(outcome.answer);
                if (outcome.answer)
                    appendOutput(toChatLines("AI: ", outcome.answer));
                if (outcome.applied && outcome.diff)
                    undoDiff = outcome.diff;
                const lines = [outcome.message, ...outcome.checks.map((c) => `[${c.name}] ${c.ok ? "PASS" : "FAIL"} (exit ${c.exitCode})`)];
                appendOutput(lines.filter(Boolean));
            }
        }
        catch (error) {
            appendOutput(`error: ${error instanceof Error ? error.message : String(error)}`);
        }
        finally {
            setExecutions((e) => [
                ...e,
                {
                    prompt: task,
                    outputStart,
                    prevAnswer,
                    prevPatchText,
                    prevPacket,
                    prevIntent,
                    undoDiff
                }
            ]);
            setBusy(false);
            setPhase("idle");
        }
    }, [
        input,
        busy,
        mode,
        db,
        root,
        config,
        events,
        indexer,
        handleSlashCommand,
        output.length,
        answer,
        patchText,
        packet,
        intent,
        modelOverride,
        availableModels,
        appendOutput
    ]);
    useInput((char, key) => {
        if (key.ctrl && char === "c") {
            quit();
            return;
        }
        if (busy)
            return;
        if (key.ctrl && key.upArrow) {
            if (promptHistory.length === 0)
                return;
            const next = promptHistoryIndex === null ? promptHistory.length - 1 : Math.max(0, promptHistoryIndex - 1);
            setPromptHistoryIndex(next);
            setInput(promptHistory[next] ?? "");
            return;
        }
        if (key.ctrl && key.downArrow) {
            if (promptHistory.length === 0 || promptHistoryIndex === null)
                return;
            const next = promptHistoryIndex + 1;
            if (next >= promptHistory.length) {
                setPromptHistoryIndex(null);
                setInput("");
            }
            else {
                setPromptHistoryIndex(next);
                setInput(promptHistory[next] ?? "");
            }
            return;
        }
        if (key.upArrow) {
            setScrollOffset((v) => v + 2);
            return;
        }
        if (key.downArrow) {
            setScrollOffset((v) => Math.max(0, v - 2));
            return;
        }
        if (key.pageUp) {
            setScrollOffset((v) => v + 12);
            return;
        }
        if (key.pageDown) {
            setScrollOffset((v) => Math.max(0, v - 12));
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
            setPromptHistoryIndex(null);
            setInput((v) => v.slice(0, -1));
            return;
        }
        if (char && !key.ctrl && !key.meta) {
            setPromptHistoryIndex(null);
            setInput((v) => v + char);
        }
    });
    if (!ready && config.theme.showBootAnimation) {
        return _jsx(BootScreen, { state: boot, animate: config.theme.animations });
    }
    if (view === "index") {
        return (_jsx(IndexDashboard, { db: db, config: config, onBack: () => setView("main") }));
    }
    return (_jsx(MainScreen, { root: root, model: modelOverride
            ? resolveModelName(modelOverride, availableModels)
            : mode === "build"
                ? config.models.patcher
                : config.models.summarizer, ollamaReady: ollamaReady, filesTotal: boot.filesTotal, dirtyFiles: boot.dirtyFiles, logs: logs, mode: mode, input: input, busy: busy, phase: phase, intent: intent, packet: packet, answer: answer, patchText: patchText, output: output, maxTokens: config.context.maxPromptTokens, animations: config.theme.animations, scrollOffset: scrollOffset, scanPhase: boot.phase, scanProgress: boot.progress, scanScanned: boot.filesScanned, scanTotal: boot.filesTotal }));
}
