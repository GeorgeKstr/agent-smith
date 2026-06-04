import { jsx as _jsx } from "react/jsx-runtime";
import { useEffect, useState, useCallback } from "react";
import { useApp, useInput } from "ink";
import { runAsk, runPatch } from "../core/taskRunner.js";
import { BootScreen } from "./screens/BootScreen.js";
import { MainScreen } from "./screens/MainScreen.js";
const initialBootState = {
    phase: "idle",
    progress: 0,
    filesScanned: 0,
    filesTotal: 0,
    dirtyFiles: 0,
    symbolsIndexed: 0,
    tagsRefreshed: 0,
    tip: "Wake up, Smith."
};
export function App({ root, config, db, events, indexer }) {
    const { exit } = useApp();
    const [boot, setBoot] = useState(initialBootState);
    const [ready, setReady] = useState(false);
    const [logs, setLogs] = useState([]);
    const [ollamaReady, setOllamaReady] = useState(null);
    const [mode, setMode] = useState("patch");
    const [view, setView] = useState("context");
    const [input, setInput] = useState("");
    const [busy, setBusy] = useState(false);
    const [phase, setPhase] = useState("idle");
    const [packet, setPacket] = useState(null);
    const [answer, setAnswer] = useState("");
    const [patchText, setPatchText] = useState("");
    const [output, setOutput] = useState([]);
    // Index + watcher events.
    useEffect(() => {
        const onProgress = (state) => {
            setBoot((previous) => ({
                ...previous,
                phase: state.phase ?? previous.phase,
                progress: Number(state.progress ?? previous.progress),
                filesScanned: Number(state.filesScanned ?? previous.filesScanned),
                filesTotal: Number(state.filesTotal ?? previous.filesTotal),
                dirtyFiles: Number(state.dirtyFiles ?? previous.dirtyFiles),
                symbolsIndexed: Number(state.symbolsIndexed ?? previous.symbolsIndexed),
                tagsRefreshed: Number(state.tagsRefreshed ?? previous.tagsRefreshed),
                currentFile: state.currentFile ?? previous.currentFile,
                tip: state.tip ?? previous.tip
            }));
        };
        const onDone = () => setReady(true);
        const onChanged = (filePath) => setLogs((p) => [`Δ ${filePath}`, ...p].slice(0, 8));
        const onReindexed = (filePath) => setLogs((p) => [`↻ ${filePath}`, ...p].slice(0, 8));
        const onOllama = (status) => setOllamaReady(status);
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
        const onPhase = (p) => setPhase(p);
        const onContext = (pkt) => setPacket(pkt);
        const onPatch = (diff) => setPatchText(diff);
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
        if (!task || busy)
            return;
        setBusy(true);
        setAnswer("");
        setPatchText("");
        setOutput([`▶ ${mode}: ${task}`]);
        try {
            if (mode === "ask") {
                setView("context");
                const result = await runAsk({ db, root, config, events, indexer }, task);
                setAnswer(result.answer || result.message || "(no answer)");
                if (result.message)
                    setOutput((o) => [...o, result.message]);
                setView("answer");
            }
            else {
                setView("patch");
                const outcome = await runPatch({ db, root, config, events, indexer }, task, { apply: true });
                if (outcome.diff)
                    setPatchText(outcome.diff);
                const lines = [outcome.message, ...outcome.checks.map((c) => `[${c.name}] ${c.ok ? "PASS" : "FAIL"} (exit ${c.exitCode})`)];
                setOutput((o) => [...o, ...lines.filter(Boolean)]);
            }
        }
        catch (error) {
            setOutput((o) => [...o, `error: ${error instanceof Error ? error.message : String(error)}`]);
        }
        finally {
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
        if (busy)
            return;
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
        return _jsx(BootScreen, { state: boot, animate: config.theme.animations });
    }
    return (_jsx(MainScreen, { root: root, model: mode === "patch" ? config.models.patcher : config.models.summarizer, ollamaReady: ollamaReady, filesTotal: boot.filesTotal, dirtyFiles: boot.dirtyFiles, symbolsIndexed: boot.symbolsIndexed, tagsRefreshed: boot.tagsRefreshed, logs: logs, mode: mode, view: view, input: input, busy: busy, phase: phase, packet: packet, answer: answer, patchText: patchText, output: output, maxTokens: config.context.maxPromptTokens }));
}
