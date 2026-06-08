import { jsx as _jsx } from "react/jsx-runtime";
import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useApp, useInput, useStdout } from "ink";
import fs from "node:fs/promises";
import path from "node:path";
import { runAsk, runPatch, undoPatchFromDiff } from "../agent/taskRunner.js";
import { isProviderAvailable, listProviderModels, resolveProviderModelName, invalidateProviderCache } from "../providers/providers.js";
import { startLanServer } from "../lan/server.js";
import { startApiServer } from "../api/server.js";
import { listChangeSets, getChangeSet, listChangedFiles, listChangedHunks, updateChangeSetStatus, updateChangedFileStatus, updateChangedHunkStatus, updateChangedHunksForFile } from "../changes/changeSetStore.js";
import { applyAcceptedChangeSet } from "../changes/changeSetApply.js";
import { revertCheckpoint } from "../checkpoints/gitCheckpoint.js";
import { startOrganizerServer } from "../organizer/server.js";
import { startOrganizerHeartbeat } from "../organizer/heartbeat.js";
import { extractFileDiff, compactDiffPreview } from "../changes/diffPreview.js";
import { BootScreen } from "./screens/BootScreen.js";
import { MainScreen } from "./screens/MainScreen.js";
import { IndexDashboard } from "./screens/IndexDashboard.js";
import { ContextPreview } from "./screens/ContextPreview.js";
import { ChangesScreen } from "./screens/ChangesScreen.js";
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
const UI_STATE_VERSION = 3;
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
function resolveModelLocal(preferred, installed) {
    if (installed.length === 0)
        return preferred;
    if (installed.includes(preferred))
        return preferred;
    const family = preferred.split(":")[0];
    const sameFamily = installed.filter((m) => m.split(":")[0] === family);
    if (sameFamily.length > 0)
        return sameFamily[0];
    return installed[0];
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
                : [],
            answeredQuestions: Array.isArray(parsed.answeredQuestions)
                ? parsed.answeredQuestions.filter((v) => typeof v === "string")
                : [],
            animationEnabled: typeof parsed.animationEnabled === "boolean" ? parsed.animationEnabled : true
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
    const [selChangeId, setSelChangeId] = useState(null);
    const [selChangeSet, setSelChangeSet] = useState(null);
    const [selChangedFiles, setSelChangedFiles] = useState([]);
    const [selFilePath, setSelFilePath] = useState(null);
    const [selDiffPreview, setSelDiffPreview] = useState("");
    const [selHunks, setSelHunks] = useState([]);
    const [selHunkIndex, setSelHunkIndex] = useState(0);
    const [reviewFocus, setReviewFocus] = useState("files");
    const [streamText, setStreamText] = useState("");
    const [streamTokens, setStreamTokens] = useState(0);
    const streamStartRef = useRef(0);
    // Streaming: write to refs synchronously on every token, flush to state at ~12fps.
    // This prevents React/Ink from dropping rapid-fire setState calls.
    const streamBuf = useRef("");
    const streamTokRef = useRef(0);
    const [pendingPrompt, setPendingPrompt] = useState(null);
    const lanRef = useRef(null);
    const apiRef = useRef(null);
    const dashboardRef = useRef(null);
    const organizerHeartbeatRef = useRef(null);
    const abortRef = useRef(null);
    const escTimerRef = useRef(null);
    const seenWebChatRef = useRef(new Set());
    const webTaskActiveRef = useRef(false);
    const [animationEnabled, setAnimationEnabled] = useState(config.theme.animations);
    const [setupAwaitingInput, setSetupAwaitingInput] = useState(null);
    const [activeQuestion, setActiveQuestion] = useState(null);
    const [textInputModal, setTextInputModal] = useState(null);
    const [textInputModalValue, setTextInputModalValue] = useState("");
    const [answerMetrics, setAnswerMetrics] = useState(null);
    const [assistantMetrics, setAssistantMetrics] = useState([]);
    const answeredQuestionFp = useRef(new Set());
    const questionFromCommand = useRef(false);
    const setupRef = useRef(null);
    const CMD_LIST = ["/help", "/mode", "/model", "/provider", "/setup", "/reindex", "/index", "/organize", "/clear", "/summarize", "/lan", "/api", "/changes", "/change", "/accept", "/reject", "/apply", "/revert", "/undo", "/exit", "/quit", "/animation", "/context"];
    const PROVIDER_SUBS = ["list", "add", "remove", "default", "key"];
    const [autocompleteIndex, setAutocompleteIndex] = useState(0);
    const autocomplete = useMemo(() => {
        if (!input || busy)
            return null;
        const trimmed = input.trimStart();
        let suggestions = [];
        if (trimmed.startsWith("/")) {
            const spaceIdx = trimmed.indexOf(" ");
            if (spaceIdx > 0) {
                const cmd = trimmed.slice(0, spaceIdx);
                const arg = trimmed.slice(spaceIdx + 1);
                if (cmd === "/model" && arg) {
                    suggestions = availableModels
                        .filter(m => m.toLowerCase().startsWith(arg.toLowerCase()))
                        .slice(0, 8)
                        .map(m => cmd + " " + m);
                }
                else if (cmd === "/provider" && arg) {
                    suggestions = PROVIDER_SUBS.filter(s => s.startsWith(arg)).map(s => cmd + " " + s);
                }
                else if (cmd === "/mode" && arg) {
                    suggestions = ["build", "discuss"].filter(m => m.startsWith(arg)).map(m => cmd + " " + m);
                }
                else if (cmd === "/api" && arg) {
                    suggestions = ["stop", "status", "config"].filter(s => s.startsWith(arg)).map(s => cmd + " " + s);
                }
                else if (cmd === "/lan" && arg) {
                    suggestions = ["stop", "status"].filter(s => s.startsWith(arg)).map(s => cmd + " " + s);
                }
                else if (cmd === "/organize" && arg) {
                    suggestions = ["stop", "status"].filter(s => s.startsWith(arg)).map(s => cmd + " " + s);
                }
            }
            else {
                suggestions = CMD_LIST.filter(c => c.startsWith(trimmed) && c !== trimmed).slice(0, 10);
            }
        }
        if (trimmed.length >= 2 && !trimmed.startsWith("/") && suggestions.length === 0) {
            suggestions = availableModels
                .filter(m => m.toLowerCase().startsWith(trimmed.toLowerCase()))
                .slice(0, 6);
        }
        if (suggestions.length === 0)
            return null;
        return { suggestions, top: suggestions[0] };
    }, [input, busy, availableModels]);
    const appendOutput = useCallback((lines) => {
        const next = Array.isArray(lines) ? lines : [lines];
        setOutput((prev) => limitLines([...prev, ...next], MAX_OUTPUT_LINES));
    }, []);
    const saveProviderConfig = useCallback(async () => {
        const configPath = path.join(root, ".agent", "config.json");
        try {
            await fs.writeFile(configPath, JSON.stringify(config, null, 2), "utf8");
            invalidateProviderCache();
        }
        catch { }
    }, [root, config]);
    useEffect(() => {
        if (!stdout.isTTY)
            return;
        process.stdout.write("\u001B[?1049h\u001B[2J\u001B[H");
        let cleaned = false;
        const restore = () => {
            if (cleaned)
                return;
            cleaned = true;
            process.stdout.write("\u001B[?1049l\u001B[?25h");
        };
        process.on("exit", restore);
        return () => {
            process.off("exit", restore);
            restore();
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
                for (const q of persisted.answeredQuestions) {
                    answeredQuestionFp.current.add(q);
                }
                setAnimationEnabled(persisted.animationEnabled);
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
                promptHistory: limitLines(promptHistory, MAX_PROMPT_HISTORY),
                answeredQuestions: [...answeredQuestionFp.current],
                animationEnabled
            });
        }, 120);
        return () => clearTimeout(timer);
    }, [root, uiStateLoaded, mode, modelOverride, output, promptHistory, animationEnabled]);
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
    useEffect(() => {
        return () => {
            lanRef.current?.stop();
            void apiRef.current?.stop();
            dashboardRef.current?.stop();
            organizerHeartbeatRef.current?.stop();
        };
    }, []);
    // Flush streaming refs to rendered state at ~12fps while busy.
    // Using refs avoids overwhelming Ink's reconciler with per-token setState calls.
    useEffect(() => {
        if (!busy) {
            setStreamText(streamBuf.current);
            setStreamTokens(streamTokRef.current);
            return;
        }
        const tick = setInterval(() => {
            setStreamText(streamBuf.current);
            setStreamTokens(streamTokRef.current);
        }, 80);
        return () => clearInterval(tick);
    }, [busy]);
    const refreshModels = useCallback(async () => {
        const online = await isProviderAvailable(config);
        setOllamaReady(online);
        if (!online) {
            setAvailableModels([]);
            return [];
        }
        const models = await listProviderModels(config);
        setAvailableModels(models);
        return models;
    }, [config]);
    const pickModel = useCallback(async (requested, models) => {
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
        return resolveProviderModelName(config, q, models);
    }, [config]);
    const finishProviderSetup = useCallback((id, type, model) => {
        void saveProviderConfig();
        void refreshModels();
        setupRef.current = null;
        appendOutput("");
        appendOutput(`✓ Provider "${id}" (${type}) configured.`);
        if (model)
            appendOutput(`  Model: ${model}`);
        if (id !== config.defaultProvider)
            appendOutput(`  Tip: /provider default ${id} to make it the default`);
        appendOutput(`  Tip: /model list to verify available models`);
        appendOutput("");
    }, [saveProviderConfig, refreshModels, config.defaultProvider, appendOutput]);
    const fetchAndShowModels = useCallback(async (providerId, providerType, _apiKey) => {
        let models = [];
        try {
            invalidateProviderCache();
            const fetched = await listProviderModels(config);
            models = fetched
                .filter(m => m.startsWith(providerId + ":") || providerId === "ollama" || !m.includes(":"))
                .map(m => m.startsWith(providerId + ":") ? m.slice(providerId.length + 1) : m)
                .filter(m => !m.toLowerCase().includes("embedding") &&
                !m.toLowerCase().includes("embed") &&
                !m.toLowerCase().includes("moderation") &&
                !m.toLowerCase().includes("dall-e") &&
                !m.toLowerCase().includes("tti") &&
                !m.toLowerCase().includes("text-embedding"));
        }
        catch { }
        if (models.length === 0) {
            const fallbacks = {
                ollama: ["llama3", "qwen2.5", "codellama", "mistral", "deepseek-r1", "phi4"],
                openai: ["gpt-5.4", "gpt-5.4-mini", "gpt-4o", "gpt-4o-mini", "o4-mini"],
                anthropic: ["claude-sonnet-4-6", "claude-sonnet-4-5", "claude-opus-4-8", "claude-haiku-4-5"],
                openrouter: ["openai/gpt-5.4", "anthropic/claude-sonnet-4-6"],
                google: ["gemini-3.5-flash", "gemini-3.1-pro", "gemini-3-flash"],
                deepseek: ["deepseek-v4-flash", "deepseek-chat", "deepseek-reasoner"],
                zen: ["gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano", "gpt-5.3-codex", "claude-sonnet-4-6", "claude-opus-4-8", "claude-haiku-4-5", "gemini-3.5-flash", "deepseek-v4-flash", "qwen3.7-max", "grok-build-0.1", "big-pickle", "minimax-m2.7"],
                "opencode-zen-go": ["deepseek-v4-flash-free", "gpt-5.4-nano", "claude-haiku-4-5", "gemini-3-flash", "qwen3.5-plus"],
            };
            models = fallbacks[providerType] || fallbacks["openai"] || ["default-model"];
        }
        questionFromCommand.current = true;
        setActiveQuestion({
            question: `Select model for ${providerId}:`,
            options: models,
            selectedIndex: 0,
            command: `/setup-step 2`,
        });
    }, [config, setActiveQuestion]);
    useEffect(() => {
        const onPhase = (p) => {
            setPhase(p);
            if (webTaskActiveRef.current) {
                if (p === "idle") {
                    setBusy(false);
                    setPendingPrompt(null);
                    webTaskActiveRef.current = false;
                }
                else {
                    setBusy(true);
                }
            }
            // Reset streaming buffer on each new phase so the pane shows only current generation
            streamBuf.current = "";
            streamTokRef.current = 0;
            streamStartRef.current = Date.now();
            setStreamText("");
            setStreamTokens(0);
            setAnswerMetrics(null);
        };
        const onIntent = (i) => setIntent(i);
        const onContext = (pkt) => setPacket(pkt);
        const onAnswer = (text) => {
            setAnswer(text);
            setAnswerMetrics({
                totalTimeMs: Date.now() - streamStartRef.current,
                totalTokens: streamTokRef.current
            });
        };
        const onPatch = (d) => setPatchText(d);
        const onStream = (data) => {
            // Write to refs only — ticker flushes to state at 80ms
            streamBuf.current = data.text;
            streamTokRef.current++;
        };
        events.on("task:phase", onPhase);
        events.on("task:intent", onIntent);
        events.on("task:context", onContext);
        events.on("task:answer", onAnswer);
        events.on("task:patch", onPatch);
        events.on("task:stream", onStream);
        return () => {
            events.off("task:phase", onPhase);
            events.off("task:intent", onIntent);
            events.off("task:context", onContext);
            events.off("task:answer", onAnswer);
            events.off("task:patch", onPatch);
            events.off("task:stream", onStream);
        };
    }, [events]);
    useEffect(() => {
        const onModeSet = (payload) => {
            if (payload?.mode === "build" || payload?.mode === "discuss") {
                setMode(payload.mode);
            }
        };
        const onModelSet = (payload) => {
            if (typeof payload?.model === "string") {
                const trimmed = payload.model.trim();
                setModelOverride(trimmed || null);
            }
            else if (payload?.model === null) {
                setModelOverride(null);
            }
        };
        const onChatCleared = () => {
            setOutput([]);
            setAnswer("");
            setPatchText("");
            setPacket(null);
            setIntent(null);
            setExecutions([]);
            setScrollOffset(0);
            setBusy(false);
            setPendingPrompt(null);
            setAssistantMetrics([]);
            webTaskActiveRef.current = false;
            seenWebChatRef.current.clear();
        };
        const onChatEntry = (payload) => {
            if (payload?.source !== "web" || !payload.entry?.content)
                return;
            const key = `${payload.entry.ts}|${payload.entry.role}|${payload.entry.content}`;
            if (seenWebChatRef.current.has(key))
                return;
            seenWebChatRef.current.add(key);
            if (payload.entry.role === "user") {
                webTaskActiveRef.current = true;
                setBusy(true);
                setPendingPrompt(payload.entry.content);
                streamBuf.current = "";
                streamTokRef.current = 0;
                streamStartRef.current = Date.now();
                setStreamText("");
                setStreamTokens(0);
                setAnswerMetrics(null);
                if (payload.mode === "build" || payload.mode === "discuss") {
                    setMode(payload.mode);
                }
                const promptLine = `▶ ${payload.mode === "discuss" ? "discuss" : "build"}: ${payload.entry.content}`;
                appendOutput(promptLine);
                return;
            }
            if (payload.entry.role === "assistant") {
                setPendingPrompt(null);
                setAssistantMetrics(prev => [...prev, null]);
                appendOutput(toChatLines("AI: ", payload.entry.content));
                return;
            }
            if (payload.entry.role === "patch") {
                setPendingPrompt(null);
                appendOutput(toChatLines("PATCH: ", payload.entry.content));
                return;
            }
            appendOutput(`⌘ ${payload.entry.content}`);
        };
        events.on("ui:mode:set", onModeSet);
        events.on("ui:model:set", onModelSet);
        events.on("chat:cleared", onChatCleared);
        events.on("chat:entry", onChatEntry);
        return () => {
            events.off("ui:mode:set", onModeSet);
            events.off("ui:model:set", onModelSet);
            events.off("chat:cleared", onChatCleared);
            events.off("chat:entry", onChatEntry);
        };
    }, [events, appendOutput]);
    useEffect(() => {
        events.emit("ui:mode:set", { mode, source: "cli" });
    }, [events, mode]);
    useEffect(() => {
        events.emit("ui:model:set", { model: modelOverride, source: "cli" });
    }, [events, modelOverride]);
    // Auto-refresh models when app becomes ready and UI state is loaded
    useEffect(() => {
        if (ready && uiStateLoaded) {
            void refreshModels();
        }
    }, [ready, uiStateLoaded, refreshModels]);
    // Refresh models when busy transitions to false (after a task completes)
    useEffect(() => {
        if (!busy && uiStateLoaded) {
            void refreshModels();
        }
    }, [busy]);
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
                    "  /model [name|list|reset]  List or switch AI provider model",
                    "  /tools       Show Qwen tool-calling integration notes",
                    "  /lan [port|status|stop]  Start/stop local project web UI",
                    "  /api [port|status|stop|config]  Start/stop API mode (auto-registers with organizer)",
                    "  /organize [port|status|stop]  Start/stop organizer server (registry + dashboard)",
                    "  /undo        Undo last prompt result (files + convo)",
                    "  /clear       Clear the output area",
                    "  /animation   Toggle terminal animations on/off",
                    "  /provider    Manage AI providers (list, add, remove, default, key)",
                    "  /setup       Interactive provider setup wizard",
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
                    if (models.length === 0) {
                        appendOutput("No models available (providers offline or none installed).");
                        return true;
                    }
                    const current = modelOverride ?? (mode === "build" ? config.models.patcher : config.models.summarizer);
                    questionFromCommand.current = true;
                    setActiveQuestion({
                        question: `Available models (${models.length}, current: ${current})`,
                        options: models,
                        selectedIndex: 0,
                        command: "/model",
                    });
                    return true;
                }
                if (argLower === "reset" || argLower === "default" || argLower === "auto") {
                    setModelOverride(null);
                    appendOutput("✓ Model override cleared (using mode defaults).");
                    return true;
                }
                const models = await refreshModels();
                if (models.length === 0) {
                    appendOutput("Cannot set model: provider offline or no installed models.");
                    return true;
                }
                const selected = await pickModel(arg, models);
                if (!selected) {
                    appendOutput(`Model not found: ${arg}`);
                    return true;
                }
                setModelOverride(selected);
                appendOutput(`✓ Model set to ${selected}`);
                return true;
            }
            case "/animation": {
                const arg = rawParts[1]?.toLowerCase();
                if (arg === "on" || arg === "true" || arg === "1") {
                    setAnimationEnabled(true);
                    appendOutput("✓ Animations enabled");
                }
                else if (arg === "off" || arg === "false" || arg === "0") {
                    setAnimationEnabled(false);
                    appendOutput("✓ Animations disabled");
                }
                else {
                    setAnimationEnabled((v) => !v);
                    appendOutput(`✓ Animations ${animationEnabled ? "disabled" : "enabled"}`);
                }
                return true;
            }
            case "/provider": {
                const sub = rawParts[1]?.toLowerCase();
                const providerId = rawParts[2];
                if (sub === "list") {
                    const providers = config.providers ? Object.keys(config.providers) : [];
                    if (providers.length === 0) {
                        appendOutput("No providers configured. Use /setup to add one.");
                    }
                    else {
                        const def = config.defaultProvider;
                        appendOutput([
                            "Configured providers:",
                            ...providers.map((p) => `${p === def ? "*" : " "} ${p} (${config.providers?.[p]?.type ?? "unknown"})`)
                        ]);
                    }
                    return true;
                }
                if (sub === "default" && providerId) {
                    config.defaultProvider = providerId;
                    void saveProviderConfig();
                    appendOutput(`✓ Default provider set to ${providerId}`);
                    return true;
                }
                if (sub === "add" && providerId && rawParts[3]) {
                    const type = rawParts[3].toLowerCase();
                    if (!config.providers)
                        config.providers = {};
                    config.providers[providerId] = { type: type, baseUrl: "" };
                    void saveProviderConfig();
                    appendOutput(`✓ Provider "${providerId}" (${type}) added. Use /setup to configure.`);
                    return true;
                }
                if (sub === "remove" && providerId) {
                    if (config.providers) {
                        delete config.providers[providerId];
                    }
                    if (config.defaultProvider === providerId) {
                        config.defaultProvider = "";
                    }
                    void saveProviderConfig();
                    appendOutput(`✓ Provider "${providerId}" removed.`);
                    return true;
                }
                if (sub === "key" && providerId) {
                    setSetupAwaitingInput(`Enter API key for ${providerId}:`);
                    return true;
                }
                appendOutput("Usage: /provider list|add|remove|default|key [id] [type]");
                return true;
            }
            case "/setup": {
                questionFromCommand.current = true;
                setActiveQuestion({
                    question: "Choose an AI provider to configure:",
                    options: [
                        "Ollama (local, auto-detect)",
                        "OpenAI (needs API key)",
                        "Anthropic (needs API key)",
                        "OpenCode Zen (needs API key)",
                        "OpenCode Zen Go (needs API key)",
                        "OpenRouter (needs API key)",
                        "Google Gemini (needs API key)",
                        "DeepSeek (needs API key)",
                    ],
                    selectedIndex: 0,
                    command: "/setup-step",
                });
                return true;
            }
            case "/setup-input": {
                const text = rawParts.slice(1).join(" ").trim();
                setSetupAwaitingInput(null);
                if (!text || !setupRef.current)
                    return true;
                appendOutput(`> ${text}`);
                const { providerType: type } = setupRef.current;
                config.providers[setupRef.current.providerId] = {
                    type: type,
                    baseUrl: type === "zen" ? "https://opencode.ai/zen/v1" : "",
                    apiKey: text.startsWith("sk-") || text.length > 30 ? text : undefined,
                    apiKeyEnv: (text.startsWith("sk-") || text.length > 30) ? undefined : (text || undefined),
                };
                void saveProviderConfig();
                setupRef.current.step = 1;
                void fetchAndShowModels(setupRef.current.providerId, type, text);
                return true;
            }
            case "/setup-step": {
                const arg = (rawParts[1] ?? "").trim();
                if (!arg) {
                    appendOutput("✗ Setup cancelled");
                    setupRef.current = null;
                    setSetupAwaitingInput(null);
                    return true;
                }
                if (!setupRef.current) {
                    const argLower = arg.toLowerCase();
                    let type;
                    let id;
                    if (argLower.startsWith("ollama")) {
                        type = "ollama";
                        id = "ollama";
                    }
                    else if (argLower.startsWith("openai")) {
                        type = "openai";
                        id = "openai";
                    }
                    else if (argLower.startsWith("anthropic")) {
                        type = "anthropic";
                        id = "anthropic";
                    }
                    else if (argLower.includes("zen go")) {
                        type = "openai";
                        id = "opencode-zen-go";
                    }
                    else if (argLower.startsWith("opencode")) {
                        type = "openai";
                        id = "opencode-zen";
                    }
                    else if (argLower.startsWith("openrouter")) {
                        type = "openai";
                        id = "openrouter";
                    }
                    else if (argLower.startsWith("google")) {
                        type = "openai";
                        id = "google";
                    }
                    else if (argLower.startsWith("deepseek")) {
                        type = "openai";
                        id = "deepseek";
                    }
                    else {
                        type = "openai";
                        id = argLower.split(/\s+/)[0];
                    }
                    setupRef.current = { providerId: id, providerType: type, step: 0 };
                    if (type === "ollama") {
                        if (!config.providers)
                            config.providers = {};
                        config.providers[id] = { type, baseUrl: config.ollama?.baseUrl ?? "" };
                        void saveProviderConfig();
                        void fetchAndShowModels(id, type, "");
                        return true;
                    }
                    const envHints = { openai: "OPENAI_API_KEY", anthropic: "ANTHROPIC_API_KEY", "opencode-zen": "ZEN_API_KEY", "opencode-zen-go": "ZEN_API_KEY", openrouter: "OPENROUTER_API_KEY", google: "GOOGLE_API_KEY", deepseek: "DEEPSEEK_API_KEY" };
                    appendOutput(`? Enter API key or env var for ${id}`);
                    appendOutput(`  Tip: paste key directly or type env var like ${envHints[id] || `${id.toUpperCase()}_API_KEY`}`);
                    setTextInputModal({
                        prompt: `API key / env var for ${id}`,
                        onSubmit: `/setup-key ${id}`,
                        onCancel: "/setup-cancel"
                    });
                    return true;
                }
                {
                    const { providerId: id, providerType: type } = setupRef.current;
                    const modelName = arg;
                    setActiveQuestion(null);
                    finishProviderSetup(id, type, modelName);
                }
                return true;
            }
            case "/setup-key": {
                const providerId = rawParts[1] ?? "";
                const keyText = rawParts.slice(2).join(" ").trim();
                if (!providerId || !keyText) {
                    setupRef.current = null;
                    setTextInputModal(null);
                    return true;
                }
                if (!setupRef.current) {
                    setupRef.current = { providerId, providerType: "openai", step: 0 };
                }
                const type = setupRef.current.providerType;
                const isApiKey = keyText.startsWith("sk-") || keyText.startsWith("sk-ant-") || keyText.length > 30;
                if (!config.providers)
                    config.providers = {};
                config.providers[providerId] = {
                    type: type === "zen" ? "openai" : type,
                    baseUrl: providerId === "opencode-zen" || providerId === "opencode-zen-go" ? "https://opencode.ai/zen/v1" : "",
                    apiKey: isApiKey ? keyText : undefined,
                    apiKeyEnv: isApiKey ? undefined : (keyText || undefined),
                };
                await saveProviderConfig();
                appendOutput(`? Key saved for ${providerId}`);
                void fetchAndShowModels(providerId, type, keyText);
                return true;
            }
            case "/setup-cancel": {
                setupRef.current = null;
                setTextInputModal(null);
                appendOutput("✗ Setup cancelled");
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
            case "/index": {
                setView("index");
                return true;
            }
            case "/context": {
                const sub = (rawParts[1] ?? "").toLowerCase();
                if (sub === "view" || !sub) {
                    setView("context");
                }
                else if (sub === "clear") {
                    setPacket(null);
                    setIntent(null);
                    setAnswer("");
                    appendOutput("⌘ Context cleared");
                }
                else {
                    appendOutput("Usage: /context [view|clear]");
                }
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
                setAssistantMetrics([]);
                seenWebChatRef.current.clear();
                events.emit("chat:cleared", { source: "cli" });
                return true;
            }
            case "/lan": {
                const arg = (rawParts[1] ?? "").toLowerCase();
                if (arg === "stop") {
                    if (lanRef.current) {
                        lanRef.current.stop();
                        lanRef.current = null;
                        appendOutput("Agent Smith web UI stopped.");
                    }
                    else {
                        appendOutput("Web UI is not running.");
                    }
                    return true;
                }
                if (arg === "status") {
                    if (lanRef.current) {
                        appendOutput(`Web UI running at http://localhost:${lanRef.current.port}`);
                    }
                    else {
                        appendOutput("Web UI is not running.");
                    }
                    return true;
                }
                const portArg = rawParts[1] ?? "";
                const lanPort = portArg && /^\d+$/.test(portArg) ? Number(portArg) : config.lan.port;
                if (lanRef.current) {
                    if (lanRef.current.port === lanPort) {
                        appendOutput(`Web UI already running at http://localhost:${lanRef.current.port}`);
                        return true;
                    }
                    lanRef.current.stop();
                    lanRef.current = null;
                }
                try {
                    const lan = startLanServer({
                        root,
                        config,
                        db,
                        events,
                        indexer,
                        port: lanPort,
                        initialOutput: output,
                        initialMode: mode,
                        initialModelOverride: modelOverride
                    });
                    lanRef.current = lan;
                    const url = `http://localhost:${lan.port}`;
                    appendOutput(`Agent Smith web UI listening at ${url}`);
                }
                catch (err) {
                    appendOutput(`✗ Failed to start web UI: ${err instanceof Error ? err.message : String(err)}`);
                }
                return true;
            }
            case "/api": {
                const arg = (rawParts[1] ?? "").toLowerCase();
                if (arg === "stop") {
                    if (apiRef.current) {
                        await apiRef.current.stop();
                        apiRef.current = null;
                        appendOutput("Agent Smith API stopped.");
                    }
                    else {
                        appendOutput("API is not running.");
                    }
                    return true;
                }
                if (arg === "status") {
                    if (apiRef.current) {
                        let msg = `API running at ${apiRef.current.url}`;
                        if (organizerHeartbeatRef.current)
                            msg += ` (organizer heartbeat: ${config.organizer.url})`;
                        appendOutput(msg);
                    }
                    else {
                        appendOutput("API is not running.");
                    }
                    return true;
                }
                if (arg === "config") {
                    appendOutput([
                        `API config:`,
                        `  enabled:       ${config.api.enabled}`,
                        `  host:          ${config.api.host}`,
                        `  port:          ${config.api.port}`,
                        `  allowLan:      ${config.api.allowLan}`,
                        `  token:         ${config.api.token ? "(set)" : "(none)"}`,
                        ``,
                        `Organizer config:`,
                        `  enabled:       ${config.organizer.enabled}`,
                        `  url:           ${config.organizer.url}`,
                        `  heartbeatMs:   ${config.organizer.heartbeatMs}`,
                        `  agentId:       ${config.organizer.agentId ?? "(auto)"}`,
                        `  agentName:     ${config.organizer.agentName ?? "(auto)"}`,
                        `  token:         ${config.organizer.token ? "(set)" : "(none)"}`,
                    ]);
                    return true;
                }
                const apiHost = config.api.host;
                const portArg = rawParts[1] ?? "";
                const apiPort = portArg && /^\d+$/.test(portArg) ? Number(portArg) : config.api.port;
                if (apiRef.current) {
                    if (apiRef.current.port === apiPort && apiRef.current.host === apiHost) {
                        appendOutput(`API already running at ${apiRef.current.url}`);
                        return true;
                    }
                    await apiRef.current.stop();
                    apiRef.current = null;
                }
                try {
                    const apiToken = config.api.token;
                    const api = await startApiServer({
                        root,
                        config,
                        db,
                        events,
                        indexer,
                        host: apiHost,
                        port: apiPort,
                        token: apiToken
                    });
                    apiRef.current = api;
                    let msg = `Agent Smith API listening at ${api.url}`;
                    if (apiHost === "0.0.0.0" && !apiToken) {
                        msg += "\nWARNING: API is exposed on LAN without a token.";
                    }
                    appendOutput(msg);
                    if (config.organizer.enabled) {
                        if (organizerHeartbeatRef.current) {
                            organizerHeartbeatRef.current.stop();
                        }
                        const hb = await startOrganizerHeartbeat({
                            root, config, db,
                            onLog: (m) => appendOutput(m)
                        });
                        organizerHeartbeatRef.current = hb;
                    }
                }
                catch (err) {
                    appendOutput(`✗ Failed to start API: ${err instanceof Error ? err.message : String(err)}`);
                }
                return true;
            }
            case "/organize": {
                const arg = (rawParts[1] ?? "").toLowerCase();
                if (arg === "stop") {
                    if (dashboardRef.current) {
                        dashboardRef.current.stop();
                        dashboardRef.current = null;
                        appendOutput("Organizer stopped.");
                    }
                    else {
                        appendOutput("Organizer is not running.");
                    }
                    return true;
                }
                if (arg === "status") {
                    if (dashboardRef.current) {
                        appendOutput(`Organizer running at http://127.0.0.1:${dashboardRef.current.port}  Dashboard: http://127.0.0.1:${dashboardRef.current.port}/dashboard`);
                    }
                    else {
                        appendOutput("Organizer is not running. Start with /organize");
                    }
                    return true;
                }
                if (dashboardRef.current) {
                    appendOutput(`Organizer already running at http://127.0.0.1:${dashboardRef.current.port}/dashboard`);
                    return true;
                }
                try {
                    const dashPort = arg && /^\d+$/.test(arg) ? Number(arg) : 8787;
                    const server = await startOrganizerServer({
                        port: dashPort,
                        onLog: (msg) => appendOutput(msg)
                    });
                    dashboardRef.current = { port: dashPort, stop: () => server.stop() };
                    appendOutput(`Organizer listening at ${server.url}`);
                    appendOutput(`Dashboard: http://127.0.0.1:${dashPort}/dashboard`);
                }
                catch (err) {
                    appendOutput(`✗ Failed to start organizer: ${err instanceof Error ? err.message : String(err)}`);
                }
                return true;
            }
            case "/changes": {
                const all = listChangeSets(db);
                if (all.length === 0) {
                    appendOutput("No change sets.");
                    return true;
                }
                const lines = ["— CHANGE SETS —"];
                for (const cs of all) {
                    const files = listChangedFiles(db, cs.id);
                    lines.push(`${cs.id}  ${cs.status.padEnd(20)} ${files.length} files  ${cs.summary ?? ""}`);
                }
                appendOutput(lines);
                return true;
            }
            case "/change": {
                const id = rawParts[1];
                if (!id) {
                    appendOutput("Usage: /change <id>");
                    return true;
                }
                const cs = getChangeSet(db, id);
                if (!cs) {
                    appendOutput(`Change set not found: ${id}`);
                    return true;
                }
                const files = listChangedFiles(db, id);
                const firstPath = files.length > 0 ? files[0].path : null;
                const diffPreview = firstPath ? compactDiffPreview(extractFileDiff(cs.diff, firstPath)) : "";
                const hunks = firstPath ? listChangedHunks(db, id, firstPath) : [];
                setSelChangeId(id);
                setSelChangeSet(cs);
                setSelChangedFiles(files);
                setSelFilePath(firstPath);
                setSelDiffPreview(diffPreview);
                setSelHunks(hunks);
                setSelHunkIndex(0);
                setReviewFocus("files");
                setView("changes");
                appendOutput(`Opened change set ${id} in review view.`);
                return true;
            }
            case "/accept": {
                const id = rawParts[1];
                if (!id) {
                    appendOutput("Usage: /accept <id> [<path>]");
                    return true;
                }
                const filePath = rawParts[2];
                if (filePath) {
                    const review = updateChangedFileStatus(db, id, filePath, "accepted");
                    if (review) {
                        const cs = getChangeSet(db, id);
                        appendOutput(`✓ Accepted file: ${filePath} (set: ${cs?.status ?? "?"})`);
                    }
                    else {
                        appendOutput(`File not found in change set: ${filePath}`);
                    }
                }
                else {
                    const cs = updateChangeSetStatus(db, id, "accepted");
                    if (cs) {
                        appendOutput(`✓ Accepted change set: ${cs.id}`);
                    }
                    else {
                        appendOutput(`Change set not found: ${id}`);
                    }
                }
                return true;
            }
            case "/reject": {
                const id = rawParts[1];
                if (!id) {
                    appendOutput("Usage: /reject <id> [<path>]");
                    return true;
                }
                const filePath = rawParts[2];
                if (filePath) {
                    const review = updateChangedFileStatus(db, id, filePath, "rejected");
                    if (review) {
                        const cs = getChangeSet(db, id);
                        appendOutput(`✓ Rejected file: ${filePath} (set: ${cs?.status ?? "?"})`);
                    }
                    else {
                        appendOutput(`File not found in change set: ${filePath}`);
                    }
                }
                else {
                    const cs = updateChangeSetStatus(db, id, "rejected");
                    if (cs) {
                        appendOutput(`✓ Rejected change set: ${cs.id}`);
                    }
                    else {
                        appendOutput(`Change set not found: ${id}`);
                    }
                }
                return true;
            }
            case "/apply": {
                const id = rawParts[1];
                if (!id) {
                    appendOutput("Usage: /apply <id>");
                    return true;
                }
                const result = await applyAcceptedChangeSet({ root, db, indexer, changeSetId: id });
                const lines = [result.ok ? "✓" : "✗", result.message];
                if (result.files.length)
                    lines.push(`files: ${result.files.join(", ")}`);
                if (result.checkpointId)
                    lines.push(`checkpoint: ${result.checkpointId}`);
                appendOutput(lines.join(" "));
                return true;
            }
            case "/revert": {
                const id = rawParts[1];
                if (!id) {
                    appendOutput("Usage: /revert <id>");
                    return true;
                }
                const cs = getChangeSet(db, id);
                if (!cs) {
                    appendOutput(`Change set not found: ${id}`);
                    return true;
                }
                if (!cs.checkpointId) {
                    appendOutput("Change set has no checkpoint to revert.");
                    return true;
                }
                const result = await revertCheckpoint({ root, db, id: cs.checkpointId });
                if (result.ok) {
                    updateChangeSetStatus(db, id, "reverted");
                    await indexer.reindexPaths(result.files);
                }
                const lines = [result.ok ? "✓" : "✗", result.message];
                if (result.files.length)
                    lines.push(`files: ${result.files.join(", ")}`);
                appendOutput(lines.join(" "));
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
        config,
        config.models.patcher,
        config.models.summarizer,
        modelOverride,
        refreshModels,
        pickModel,
        root,
        db,
        events,
        output,
        animationEnabled,
        finishProviderSetup,
        fetchAndShowModels,
        saveProviderConfig,
        setAnimationEnabled,
        setSetupAwaitingInput,
        setActiveQuestion
    ]);
    const submit = useCallback(async () => {
        const task = input.trim();
        if (!task || busy)
            return;
        if (setupAwaitingInput && task) {
            setInput("");
            setSetupAwaitingInput(null);
            appendOutput(`> ${task}`);
            await handleSlashCommand(`/setup-input ${task}`);
            return;
        }
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
        // Show the active prompt as a pinned row at the bottom of history immediately
        setPendingPrompt(task);
        // Reset stream state via refs (ticker will flush to state)
        streamBuf.current = "";
        streamTokRef.current = 0;
        streamStartRef.current = Date.now();
        setAnswerMetrics(null);
        let undoDiff;
        abortRef.current = new AbortController();
        const signal = abortRef.current.signal;
        // Pause background indexer summarization so the model is fully available
        indexer.pause();
        try {
            const activeModel = modelOverride
                ? await resolveProviderModelName(config, modelOverride, availableModels)
                : undefined;
            const promptLine = `▶ ${mode}: ${task}`;
            if (mode === "discuss") {
                const result = await runAsk({ db, root, config, events, indexer }, task, { modelOverride: activeModel, signal });
                const answerText = result.answer || result.message || "(no answer)";
                setAnswer(answerText);
                setAssistantMetrics(prev => [...prev, { totalTimeMs: Date.now() - streamStartRef.current, totalTokens: streamTokRef.current }]);
                // Append prompt + response together so history is consistent
                appendOutput([promptLine, ...toChatLines("AI: ", answerText)]);
            }
            else {
                const outcome = await runPatch({ db, root, config, events, indexer }, task, { apply: true, modelOverride: activeModel, signal });
                if (outcome.diff)
                    setPatchText(outcome.diff);
                if (outcome.answer) {
                    setAnswer(outcome.answer);
                    setAssistantMetrics(prev => [...prev, { totalTimeMs: Date.now() - streamStartRef.current, totalTokens: streamTokRef.current }]);
                }
                if (outcome.applied && outcome.diff)
                    undoDiff = outcome.diff;
                const statusLines = [outcome.message, ...outcome.checks.map((c) => `[${c.name}] ${c.ok ? "PASS" : "FAIL"} (exit ${c.exitCode})`)];
                appendOutput([
                    promptLine,
                    ...(outcome.answer ? toChatLines("AI: ", outcome.answer) : []),
                    ...statusLines.filter(Boolean)
                ]);
            }
        }
        catch (error) {
            const promptLine = `▶ ${mode}: ${task}`;
            appendOutput([promptLine, `error: ${error instanceof Error ? error.message : String(error)}`]);
        }
        finally {
            indexer.resume();
            setPendingPrompt(null);
            abortRef.current = null;
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
        appendOutput,
        setupAwaitingInput
    ]);
    useInput((char, key) => {
        if (key.ctrl && char === "c") {
            quit();
            return;
        }
        if (textInputModal) {
            if (key.escape) {
                const cmd = textInputModal.onCancel;
                setTextInputModalValue("");
                setTextInputModal(null);
                if (cmd)
                    void handleSlashCommand(cmd);
                return;
            }
            if (key.return) {
                const value = textInputModalValue;
                const cmd = textInputModal.onSubmit;
                setTextInputModalValue("");
                setTextInputModal(null);
                if (value)
                    void handleSlashCommand(`${cmd} ${value}`);
                return;
            }
            if (key.backspace || key.delete) {
                setTextInputModalValue((v) => v.slice(0, -1));
                return;
            }
            if (char && !key.ctrl && !key.meta) {
                setTextInputModalValue((v) => v + char);
                return;
            }
            return;
        }
        // Question modal input handling
        if (activeQuestion) {
            if (key.escape) {
                setActiveQuestion(null);
                return;
            }
            if (key.upArrow) {
                setActiveQuestion((q) => q ? { ...q, selectedIndex: Math.max(0, q.selectedIndex - 1) } : null);
                return;
            }
            if (key.downArrow) {
                setActiveQuestion((q) => q ? { ...q, selectedIndex: Math.min(q.options.length - 1, q.selectedIndex + 1) } : null);
                return;
            }
            if (key.return) {
                const aq = activeQuestion;
                setActiveQuestion(null);
                if (aq?.command) {
                    const selectedValue = aq.options[aq.selectedIndex];
                    void handleSlashCommand(`${aq.command} ${selectedValue}`);
                }
                return;
            }
            return;
        }
        // Escape handling — works even when busy (for abort)
        if (key.escape) {
            if (input) {
                setInput("");
                return;
            }
            if (busy) {
                if (escTimerRef.current) {
                    clearTimeout(escTimerRef.current);
                    escTimerRef.current = null;
                    abortRef.current?.abort();
                    abortRef.current = null;
                    setBusy(false);
                    setPhase("idle");
                    appendOutput("⏹ Cancelled");
                    return;
                }
                escTimerRef.current = setTimeout(() => { escTimerRef.current = null; }, 400);
                return;
            }
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
        if (autocomplete && key.upArrow) {
            setAutocompleteIndex((v) => Math.max(0, v - 1));
            return;
        }
        if (autocomplete && key.downArrow) {
            setAutocompleteIndex((v) => Math.min(autocomplete.suggestions.length - 1, v + 1));
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
        if (key.return) {
            void submit();
            return;
        }
        if (key.tab && autocomplete) {
            const idx = Math.min(autocompleteIndex, autocomplete.suggestions.length - 1);
            setInput(autocomplete.suggestions[idx]);
            setPromptHistoryIndex(null);
            setAutocompleteIndex(0);
            return;
        }
        if (key.backspace || key.delete) {
            setPromptHistoryIndex(null);
            setAutocompleteIndex(0);
            setInput((v) => v.slice(0, -1));
            return;
        }
        if (char && !key.ctrl && !key.meta) {
            setPromptHistoryIndex(null);
            setAutocompleteIndex(0);
            setInput((v) => v + char);
        }
    });
    // Question detection effect: watch the answer for question patterns
    // when not busy and no programmatic question is being shown
    useEffect(() => {
        if (busy || !answer)
            return;
        if (questionFromCommand.current) {
            questionFromCommand.current = false;
            return;
        }
        if (activeQuestion)
            return;
        const lines = answer.split("\n").map((l) => l.trim()).filter(Boolean);
        const questionLines = lines.filter((l) => /^\d+[\.\)]\s/.test(l) ||
            /^[-*]\s/.test(l) ||
            /^(select|choose|pick|which|option|would you like)/i.test(l));
        if (questionLines.length >= 2) {
            const question = questionLines[0].replace(/^\d+[\.\)]\s*/, "").replace(/^[-*]\s*/, "");
            const options = questionLines.map((l) => l.replace(/^\d+[\.\)]\s*/, "").replace(/^[-*]\s*/, ""));
            setActiveQuestion({
                question,
                options,
                selectedIndex: 0,
                command: null,
            });
        }
    }, [busy, answer, activeQuestion]);
    if (!ready && config.theme.showBootAnimation) {
        return _jsx(BootScreen, { state: boot, animate: config.theme.animations });
    }
    if (view === "index") {
        return (_jsx(IndexDashboard, { db: db, config: config, onBack: () => setView("main") }));
    }
    if (view === "context") {
        return (_jsx(ContextPreview, { packet: packet, maxTokens: config.context.maxPromptTokens, onBack: () => setView("main") }));
    }
    if (view === "changes") {
        const reloadFilesAndHunks = () => {
            if (selChangeId) {
                setSelChangedFiles(listChangedFiles(db, selChangeId));
                if (selFilePath) {
                    setSelHunks(listChangedHunks(db, selChangeId, selFilePath));
                }
            }
        };
        return (_jsx(ChangesScreen, { changeSet: selChangeSet, files: selChangedFiles, selectedPath: selFilePath, diffPreview: selDiffPreview, hunks: selHunks, selectedHunkIndex: selHunkIndex, reviewFocus: reviewFocus, onBack: () => setView("main"), onSelectFile: (path) => {
                setSelFilePath(path);
                setSelDiffPreview(compactDiffPreview(extractFileDiff(selChangeSet?.diff ?? "", path)));
                setSelHunks(listChangedHunks(db, selChangeId, path));
                setSelHunkIndex(0);
                setReviewFocus("files");
            }, onAcceptFile: () => {
                if (selFilePath) {
                    updateChangedFileStatus(db, selChangeId, selFilePath, "accepted");
                    reloadFilesAndHunks();
                    appendOutput(`Accepted ${selFilePath}`);
                }
            }, onRejectFile: () => {
                if (selFilePath) {
                    updateChangedFileStatus(db, selChangeId, selFilePath, "rejected");
                    reloadFilesAndHunks();
                    appendOutput(`Rejected ${selFilePath}`);
                }
            }, onAcceptAll: async () => {
                const cs = updateChangeSetStatus(db, selChangeId, "accepted");
                if (cs) {
                    reloadFilesAndHunks();
                    appendOutput(`Accepted change set ${selChangeId}`);
                }
            }, onRejectAll: async () => {
                const cs = updateChangeSetStatus(db, selChangeId, "rejected");
                if (cs) {
                    reloadFilesAndHunks();
                    appendOutput(`Rejected change set ${selChangeId}`);
                }
            }, onApply: async () => {
                const result = await applyAcceptedChangeSet({ root, db, indexer, changeSetId: selChangeId });
                appendOutput(`${result.ok ? "✓" : "✗"} ${result.message}`);
                const cs = getChangeSet(db, selChangeId);
                if (cs) {
                    reloadFilesAndHunks();
                }
            }, onFocusChange: (focus) => setReviewFocus(focus), onSelectHunk: (index) => setSelHunkIndex(index), onAcceptHunk: () => {
                const h = selHunks[selHunkIndex];
                if (h) {
                    updateChangedHunkStatus(db, h.id, "accepted");
                    reloadFilesAndHunks();
                    appendOutput(`Accepted hunk ${h.path}#${h.hunkIndex}`);
                }
            }, onRejectHunk: () => {
                const h = selHunks[selHunkIndex];
                if (h) {
                    updateChangedHunkStatus(db, h.id, "rejected");
                    reloadFilesAndHunks();
                    appendOutput(`Rejected hunk ${h.path}#${h.hunkIndex}`);
                }
            }, onAcceptFileHunks: () => {
                if (selFilePath) {
                    updateChangedHunksForFile(db, selChangeId, selFilePath, "accepted");
                    reloadFilesAndHunks();
                    appendOutput(`Accepted all hunks in ${selFilePath}`);
                }
            }, onRejectFileHunks: () => {
                if (selFilePath) {
                    updateChangedHunksForFile(db, selChangeId, selFilePath, "rejected");
                    reloadFilesAndHunks();
                    appendOutput(`Rejected all hunks in ${selFilePath}`);
                }
            } }));
    }
    return (_jsx(MainScreen, { root: root, model: modelOverride
            ? resolveModelLocal(modelOverride, availableModels)
            : mode === "build"
                ? config.models.patcher
                : config.models.summarizer, ollamaReady: ollamaReady, filesTotal: boot.filesTotal, dirtyFiles: boot.dirtyFiles, logs: logs, mode: mode, input: input, busy: busy, phase: phase, intent: intent, packet: packet, answer: answer, patchText: patchText, output: output, maxTokens: config.context.maxPromptTokens, animations: animationEnabled, scrollOffset: scrollOffset, scanPhase: boot.phase, scanProgress: boot.progress, scanScanned: boot.filesScanned, scanTotal: boot.filesTotal, streamText: streamText, streamTokens: streamTokens, streamStartMs: streamStartRef.current, pendingPrompt: pendingPrompt, activeQuestion: activeQuestion, setupPrompt: setupAwaitingInput, textInputModal: textInputModal, textInputModalValue: textInputModalValue, answerMetrics: answerMetrics, assistantMetrics: assistantMetrics, autocomplete: autocomplete, autocompleteIndex: autocompleteIndex }));
}
