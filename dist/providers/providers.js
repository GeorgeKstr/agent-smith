import { generateWithOllama, chatWithQwenFunctions } from "./ollama.js";
function resolveApiKey(entry) {
    if (entry.apiKey)
        return entry.apiKey;
    if (entry.apiKeyEnv && process.env[entry.apiKeyEnv])
        return process.env[entry.apiKeyEnv];
    return "";
}
class OllamaProvider {
    id = "ollama";
    type = "ollama";
    config;
    constructor(opts) {
        this.config = opts.config;
    }
    async generate(model, prompt, options) {
        const ollamaOpts = {
            temperature: options?.temperature ?? this.config.ollama.temperature,
            num_predict: options?.maxTokens ?? this.config.ollama.numPredict,
        };
        const result = await generateWithOllama({
            baseUrl: this.config.ollama.baseUrl,
            model,
            prompt,
            system: options?.system,
            options: ollamaOpts,
            signal: options?.signal,
            onToken: options?.onToken,
        });
        return { ok: result.ok, text: result.text, tokenCount: result.tokenCount, error: result.error };
    }
    async chat(model, messages, functions, options) {
        const ollamaOpts = {
            temperature: options?.temperature ?? this.config.ollama.temperature,
            num_predict: options?.maxTokens ?? this.config.ollama.numPredict,
        };
        // Normalize generic messages to Qwen format
        const qwenMsgs = messages.map((m) => ({
            role: m.role ?? "user",
            content: m.content ?? "",
            name: m.name,
            tool_call_id: m.tool_call_id,
            function_call: m.function_call,
            tool_calls: m.tool_calls,
        }));
        const qwenFns = functions
            ? functions.map((f) => ({
                name: f.name ?? f.function?.name ?? "",
                description: f.description ?? f.function?.description ?? "",
                parameters: f.parameters ?? f.function?.parameters ?? f.input_schema ?? {},
            }))
            : undefined;
        const result = await chatWithQwenFunctions({
            baseUrl: this.config.ollama.baseUrl,
            model,
            messages: qwenMsgs,
            functions: qwenFns,
            options: ollamaOpts,
        });
        return { ok: result.ok, messages: result.messages, text: result.text, error: result.error };
    }
    async listModels() {
        const { listOllamaModels } = await import("./ollama.js");
        return listOllamaModels(this.config.ollama.baseUrl);
    }
    async isAvailable() {
        const { isOllamaAvailable } = await import("./ollama.js");
        return isOllamaAvailable(this.config.ollama.baseUrl);
    }
}
class OpenAIProvider {
    type = "openai";
    entry;
    id;
    apiKey;
    constructor(id, entry) {
        this.id = id;
        this.entry = entry;
        this.apiKey = resolveApiKey(entry);
    }
    baseUrl() {
        return this.entry.baseUrl.replace(/\/+$/, "");
    }
    async generate(model, prompt, options) {
        const headers = {
            "Content-Type": "application/json",
        };
        if (this.apiKey)
            headers["Authorization"] = `Bearer ${this.apiKey}`;
        const body = {
            model,
            messages: [
                ...(options?.system ? [{ role: "system", content: options.system }] : []),
                { role: "user", content: prompt },
            ],
            max_tokens: options?.maxTokens ?? 2048,
            temperature: options?.temperature ?? 0,
            stream: false,
        };
        const url = `${this.baseUrl()}/chat/completions`;
        try {
            const response = await fetch(url, {
                method: "POST",
                headers,
                body: JSON.stringify(body),
                signal: options?.signal,
            });
            if (!response.ok) {
                const errText = await response.text().catch(() => "");
                return { ok: false, text: "", error: `OpenAI ${response.status}: ${errText}` };
            }
            const data = (await response.json());
            const text = data.choices?.[0]?.message?.content ?? "";
            return { ok: true, text, tokenCount: data.usage?.total_tokens };
        }
        catch (error) {
            return { ok: false, text: "", error: error instanceof Error ? error.message : String(error) };
        }
    }
    async chat(model, messages, functions, options) {
        const headers = {
            "Content-Type": "application/json",
        };
        if (this.apiKey)
            headers["Authorization"] = `Bearer ${this.apiKey}`;
        const bodyMsg = messages.map((m) => {
            const out = { role: m.role, content: m.content ?? "" };
            if (m.tool_call_id)
                out.tool_call_id = m.tool_call_id;
            if (m.name)
                out.name = m.name;
            if (m.tool_calls)
                out.tool_calls = m.tool_calls;
            if (m.function_call) {
                out.function_call = m.function_call;
                out.role = "assistant";
            }
            if (m.role === "tool" && !m.tool_call_id) {
                out.role = "user";
                out.content = `[Tool result] ${m.content}`;
            }
            return out;
        });
        const tools = functions
            ? functions.map((f) => {
                if (f.type === "function")
                    return f;
                return {
                    type: "function",
                    function: {
                        name: f.name ?? "",
                        description: f.description ?? "",
                        parameters: f.parameters ?? f.input_schema ?? {},
                    },
                };
            })
            : undefined;
        const body = {
            model,
            messages: bodyMsg,
            max_tokens: options?.maxTokens ?? 2048,
            temperature: options?.temperature ?? 0,
            ...(tools?.length ? { tools, tool_choice: "auto" } : {}),
        };
        const url = `${this.baseUrl()}/chat/completions`;
        try {
            const response = await fetch(url, {
                method: "POST",
                headers,
                body: JSON.stringify(body),
                signal: options?.signal,
            });
            if (!response.ok) {
                const errText = await response.text().catch(() => "");
                return { ok: false, messages: [], text: "", error: `OpenAI ${response.status}: ${errText}` };
            }
            const data = (await response.json());
            const msg = data.choices?.[0]?.message;
            if (!msg)
                return { ok: true, messages: [], text: "" };
            const resultMsgs = [];
            if (msg.tool_calls?.length) {
                for (const tc of msg.tool_calls) {
                    resultMsgs.push({
                        role: "assistant",
                        content: "",
                        function_call: tc.function
                            ? { name: tc.function.name ?? "", arguments: tc.function.arguments ?? "{}" }
                            : undefined,
                    });
                }
            }
            else if (msg.content) {
                resultMsgs.push({ role: "assistant", content: msg.content });
            }
            return { ok: true, messages: resultMsgs, text: msg.content ?? "" };
        }
        catch (error) {
            return { ok: false, messages: [], text: "", error: error instanceof Error ? error.message : String(error) };
        }
    }
    async listModels() {
        if (!this.apiKey)
            return [];
        try {
            const response = await fetch(`${this.baseUrl()}/models`, {
                headers: { Authorization: `Bearer ${this.apiKey}` },
            });
            if (!response.ok)
                return [];
            const data = (await response.json());
            return (data.data ?? []).map((m) => m.id ?? "").filter(Boolean);
        }
        catch {
            return [];
        }
    }
    async isAvailable() {
        if (!this.apiKey)
            return false;
        try {
            const response = await fetch(`${this.baseUrl()}/models`, {
                headers: { Authorization: `Bearer ${this.apiKey}` },
                signal: AbortSignal.timeout(5000),
            });
            return response.ok;
        }
        catch {
            return false;
        }
    }
}
class AnthropicProvider {
    type = "anthropic";
    entry;
    id;
    apiKey;
    constructor(id, entry) {
        this.id = id;
        this.entry = entry;
        this.apiKey = resolveApiKey(entry);
    }
    baseUrl() {
        return this.entry.baseUrl.replace(/\/+$/, "");
    }
    async generate(model, prompt, options) {
        const headers = {
            "Content-Type": "application/json",
            "x-api-key": this.apiKey,
            "anthropic-version": "2023-06-01",
        };
        const messages = [];
        if (options?.system) {
            messages.push({ role: "user", content: options.system });
        }
        messages.push({ role: "user", content: prompt });
        const body = {
            model,
            messages,
            max_tokens: options?.maxTokens ?? 2048,
            temperature: options?.temperature ?? 0,
        };
        try {
            const response = await fetch(`${this.baseUrl()}/messages`, {
                method: "POST",
                headers,
                body: JSON.stringify(body),
                signal: options?.signal,
            });
            if (!response.ok) {
                const errText = await response.text().catch(() => "");
                return { ok: false, text: "", error: `Anthropic ${response.status}: ${errText}` };
            }
            const data = (await response.json());
            const text = data.content?.find((c) => c.type === "text")?.text ?? "";
            const tokenCount = (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0);
            return { ok: true, text, tokenCount };
        }
        catch (error) {
            return { ok: false, text: "", error: error instanceof Error ? error.message : String(error) };
        }
    }
    async chat(model, messages, functions, options) {
        const headers = {
            "Content-Type": "application/json",
            "x-api-key": this.apiKey,
            "anthropic-version": "2023-06-01",
        };
        // Build convMessages from generic or Qwen messages
        const allMsgs = messages.map((m) => ({
            role: m.role ?? "user",
            content: m.content ?? "",
            name: m.name,
            tool_call_id: m.tool_call_id,
            function_call: m.function_call,
            tool_calls: m.tool_calls,
        }));
        const systemMsg = allMsgs.find((m) => m.role === "system")?.content;
        const convMessages = allMsgs
            .filter((m) => m.role === "user" || m.role === "assistant")
            .map((m) => ({
            role: m.role,
            content: Array.isArray(m.content) ? m.content : m.content,
        }));
        const tools = functions
            ? functions.map((f) => ({
                name: f.name ?? f.function?.name ?? "",
                description: f.description ?? f.function?.description ?? "",
                input_schema: f.input_schema ?? f.parameters ?? f.function?.parameters ?? {},
            }))
            : undefined;
        const body = {
            model,
            messages: convMessages,
            max_tokens: options?.maxTokens ?? 2048,
            temperature: options?.temperature ?? 0,
            ...(systemMsg ? { system: systemMsg } : {}),
            ...(tools?.length ? { tools } : {}),
        };
        try {
            const response = await fetch(`${this.baseUrl()}/messages`, {
                method: "POST",
                headers,
                body: JSON.stringify(body),
                signal: options?.signal,
            });
            if (!response.ok) {
                const errText = await response.text().catch(() => "");
                return { ok: false, messages: [], text: "", error: `Anthropic ${response.status}: ${errText}` };
            }
            const data = (await response.json());
            const resultMsgs = [];
            let text = "";
            for (const block of data.content ?? []) {
                if (block.type === "text" && block.text) {
                    text += block.text;
                }
                if (block.type === "tool_use" && block.name) {
                    resultMsgs.push({
                        role: "assistant",
                        content: "",
                        function_call: {
                            name: block.name,
                            arguments: typeof block.input === "string" ? block.input : JSON.stringify(block.input ?? {}),
                        },
                    });
                }
            }
            if (resultMsgs.length === 0 && text) {
                resultMsgs.push({ role: "assistant", content: text });
            }
            return { ok: true, messages: resultMsgs, text };
        }
        catch (error) {
            return { ok: false, messages: [], text: "", error: error instanceof Error ? error.message : String(error) };
        }
    }
    async listModels() {
        if (!this.apiKey)
            return [];
        try {
            const response = await fetch(`${this.baseUrl()}/models`, {
                headers: { "x-api-key": this.apiKey, "anthropic-version": "2023-06-01" },
            });
            if (!response.ok)
                return [];
            const data = (await response.json());
            return (data.data ?? []).map((m) => m.id ?? "").filter(Boolean);
        }
        catch {
            return [];
        }
    }
    async isAvailable() {
        if (!this.apiKey)
            return false;
        try {
            const response = await fetch(`${this.baseUrl()}/models`, {
                headers: { "x-api-key": this.apiKey, "anthropic-version": "2023-06-01" },
                signal: AbortSignal.timeout(5000),
            });
            return response.ok;
        }
        catch {
            return false;
        }
    }
}
export function createProviders(config) {
    const providers = new Map();
    const ollama = new OllamaProvider({ config });
    providers.set("ollama", ollama);
    for (const [id, entry] of Object.entries(config.providers)) {
        if (id === "ollama")
            continue;
        switch (entry.type) {
            case "openai":
                providers.set(id, new OpenAIProvider(id, entry));
                break;
            case "anthropic":
                providers.set(id, new AnthropicProvider(id, entry));
                break;
            case "ollama":
                providers.set(id, ollama);
                break;
        }
    }
    return providers;
}
export function resolveModelProvider(modelSpec, defaultProvider, providers) {
    const colonIdx = modelSpec.indexOf(":");
    if (colonIdx > 0 && colonIdx < modelSpec.length - 1) {
        const prefix = modelSpec.slice(0, colonIdx);
        const model = modelSpec.slice(colonIdx + 1);
        const provider = providers.get(prefix);
        if (provider)
            return { provider, model };
    }
    const provider = providers.get(defaultProvider);
    if (!provider) {
        const first = providers.values().next().value;
        if (!first)
            return null;
        return { provider: first, model: modelSpec };
    }
    return { provider, model: modelSpec };
}
export function resolveModelNameFromSpec(modelSpec, defaultProvider, installed, providers) {
    const resolved = resolveModelProvider(modelSpec, defaultProvider, providers);
    if (!resolved)
        return modelSpec;
    if (installed.includes(resolved.model))
        return resolved.model;
    if (installed.length > 0)
        return installed[0];
    return resolved.model;
}
export function extractModelPart(modelSpec) {
    const colonIdx = modelSpec.indexOf(":");
    if (colonIdx > 0 && colonIdx < modelSpec.length - 1) {
        return modelSpec.slice(colonIdx + 1);
    }
    return modelSpec;
}
let _providersCache = null;
let _providersConfig = null;
function getProviders(config) {
    if (_providersCache && _providersConfig === config)
        return _providersCache;
    _providersCache = createProviders(config);
    _providersConfig = config;
    return _providersCache;
}
export function invalidateProviderCache() {
    _providersCache = null;
    _providersConfig = null;
}
export async function generateWithProvider(config, modelSpec, prompt, options) {
    const providers = getProviders(config);
    const resolved = resolveModelProvider(modelSpec, config.defaultProvider, providers);
    if (!resolved)
        return { ok: false, text: "", error: `No provider found for model: ${modelSpec}` };
    return resolved.provider.generate(resolved.model, prompt, options);
}
export async function chatWithProvider(config, modelSpec, messages, functions, options) {
    const providers = getProviders(config);
    const resolved = resolveModelProvider(modelSpec, config.defaultProvider, providers);
    if (!resolved)
        return { ok: false, messages: [], text: "", error: `No provider found for model: ${modelSpec}` };
    return resolved.provider.chat(resolved.model, messages, functions, options);
}
export async function isProviderAvailable(config, providerId) {
    const providers = getProviders(config);
    const id = providerId ?? config.defaultProvider;
    const provider = providers.get(id);
    if (!provider)
        return false;
    return provider.isAvailable();
}
export async function listProviderModels(config, providerId) {
    const providers = getProviders(config);
    const id = providerId ?? config.defaultProvider;
    if (id === "ollama" || !providerId) {
        const allModels = [];
        for (const [pid, provider] of providers) {
            try {
                const models = await provider.listModels();
                for (const m of models) {
                    allModels.push(pid === config.defaultProvider ? m : `${pid}:${m}`);
                }
            }
            catch { /* skip offline providers */ }
        }
        return allModels;
    }
    const provider = providers.get(id);
    if (!provider)
        return [];
    try {
        const models = await provider.listModels();
        return id === config.defaultProvider ? models : models.map((m) => `${id}:${m}`);
    }
    catch {
        return [];
    }
}
export async function resolveProviderModelName(config, preferred, installed, fallbackProviderId) {
    if (installed.length === 0)
        return preferred;
    if (installed.includes(preferred))
        return preferred;
    const providers = getProviders(config);
    const resolved = resolveModelProvider(preferred, config.defaultProvider, providers);
    if (!resolved)
        return installed.length > 0 ? installed[0] : preferred;
    const modelShort = resolved.model;
    if (installed.includes(modelShort))
        return modelShort;
    const family = modelShort.split(":")[0];
    const sameFamily = installed.filter((m) => {
        const part = m.includes(":") ? m.slice(m.indexOf(":") + 1) : m;
        return part.split(":")[0] === family;
    });
    if (sameFamily.length > 0)
        return sameFamily[0];
    return installed[0];
}
