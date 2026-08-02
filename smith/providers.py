from __future__ import annotations

import logging
import os
from typing import Any

import urllib.request
import urllib.error
import json as _json

from langchain_openai import ChatOpenAI
from openai import OpenAI

from .db import ProjectDB

logger = logging.getLogger(__name__)


HARD_CODED_PROVIDERS: dict[str, dict[str, Any]] = {
    "lmstudio": {
        "id": "lmstudio",
        "name": "LM Studio Local",
        "kind": "openai_compatible",
        "base_url": "http://localhost:1234/v1",
        "api_key": "not-needed",
        "enabled": True,
        "default_model": "qwen3.6-35b-a3b-mtp",
    },
    "ollama-openai": {
        "id": "ollama-openai",
        "name": "Ollama OpenAI-Compatible",
        "kind": "openai_compatible",
        "base_url": "http://localhost:11434/v1",
        "api_key": "ollama",
        "enabled": True,
        "default_model": "llama3.1",
    },
    "llamacpp": {
        "id": "llamacpp",
        "name": "llama.cpp OpenAI-Compatible Server",
        "kind": "openai_compatible",
        "base_url": "http://localhost:8080/v1",
        "api_key": "not-needed",
        "enabled": True,
        "default_model": "local-model",
    },
    "openrouter": {
        "id": "openrouter",
        "name": "OpenRouter",
        "kind": "openai_compatible",
        "base_url": "https://openrouter.ai/api/v1",
        "api_key": os.getenv("OPENROUTER_API_KEY", ""),
        "enabled": False,
        "default_model": "openai/gpt-oss-20b",
    },
}

# In-memory cache only. Nothing provider/model-list-related is persisted centrally.
_MODEL_CACHE: dict[str, list[dict[str, Any]]] = {}


class ProviderError(RuntimeError):
    pass


def list_providers() -> list[dict[str, Any]]:
    return list(HARD_CODED_PROVIDERS.values())


def get_provider(provider_id: str = "lmstudio") -> dict[str, Any]:
    provider = HARD_CODED_PROVIDERS.get(provider_id)
    if not provider:
        raise ProviderError(f"Unknown provider: {provider_id}")
    return provider


def refresh_provider_models(provider_id: str = "lmstudio") -> list[dict[str, Any]]:
    provider = get_provider(provider_id)
    if provider["kind"] != "openai_compatible":
        raise ProviderError(f"Unsupported provider kind: {provider['kind']}")
    if not provider.get("enabled"):
        raise ProviderError(f"Provider is disabled: {provider_id}")

    client = OpenAI(
        base_url=provider["base_url"],
        api_key=provider.get("api_key") or "not-needed",
    )
    response = client.models.list()
    models: list[dict[str, Any]] = []
    for model in response.data:
        models.append(
            {
                "provider_id": provider_id,
                "model_id": model.id,
                "display_name": model.id,
                "owned_by": getattr(model, "owned_by", None),
            }
        )
    _MODEL_CACHE[provider_id] = models
    return models


def list_models(provider_id: str = "lmstudio", refresh: bool = False) -> list[dict[str, Any]]:
    if refresh or provider_id not in _MODEL_CACHE:
        try:
            return refresh_provider_models(provider_id)
        except Exception:
            provider = get_provider(provider_id)
            return [
                {
                    "provider_id": provider_id,
                    "model_id": provider["default_model"],
                    "display_name": provider["default_model"],
                    "owned_by": "fallback",
                    "error": "Could not refresh live model list; showing hardcoded fallback.",
                }
            ]
    return _MODEL_CACHE[provider_id]


def set_project_default_model(db: ProjectDB, provider_id: str, model_id: str) -> None:
    get_provider(provider_id)
    db.set_setting("model.default", {"provider_id": provider_id, "model_id": model_id})


def set_project_task_model(db: ProjectDB, task_type: str, provider_id: str, model_id: str) -> None:
    get_provider(provider_id)
    db.set_setting(f"model.task.{task_type}", {"provider_id": provider_id, "model_id": model_id})


def get_project_model_selection(db: ProjectDB, task_type: str = "ask") -> dict[str, str]:
    task_specific = db.get_setting(f"model.task.{task_type}")
    if task_specific:
        return task_specific

    default = db.get_setting("model.default")
    if default:
        return default

    provider = get_provider("lmstudio")
    return {"provider_id": "lmstudio", "model_id": provider["default_model"]}


def model_family(model_id: str) -> str:
    """Classify a model_id into a known family for behavioral steering.

    Returns one of: "gemma", "qwen", "glm", "deepseek", "llama",
    "mistral", "phi", "gpt", "other".
    """
    mid = (model_id or "").lower()
    for family, keys in (
        ("gemma", ("gemma",)),
        ("qwen", ("qwen", "omnicoder", "coder-next")),
        ("glm", ("glm", "chatglm", "zhipu")),
        ("deepseek", ("deepseek",)),
        ("llama", ("llama", "hermes", "nous-hermes")),
        ("mistral", ("mistral", "mixtral", "codestral", "ministral")),
        ("phi", ("phi",)),
        ("gpt", ("gpt-", "gpt-oss", "o1", "o3", "openai")),
    ):
        if any(k in mid for k in keys):
            return family
    return "other"


def _should_use_text_tools(model_id: str) -> bool:
    """Determine if text-based tool calling should be used for this model.

    Decision order:
    1. SMITH_TEXT_TOOL_MODE env var (explicit override: 1/true/yes/on = force text,
       0/false/no/off = force native)
    2. Model-family heuristic: certain open-source model families emit tool
       calls as text rather than via OpenAI's native function-calling API
    3. Default: native mode (works for qwen3-coder, GPT-OSS, etc.)
    """
    env_val = os.getenv("SMITH_TEXT_TOOL_MODE", "").strip().lower()
    if env_val in ("1", "true", "yes", "on"):
        return True
    if env_val in ("0", "false", "no", "off"):
        return False

    # ── Model-family heuristic ──────────────────────────────────────────
    # These families are known to emit textual tool calls (<|tool_call>,
    # <tool_call>, etc.) rather than native OpenAI function-calling JSON.
    family = model_family(model_id)
    _TEXT_MODE_FAMILIES = {
        "gemma",      # Gemma 4 — native tool streaming is broken in langchain, use text parser
        "glm",        # GLM models — uses <function=...> XML format, no native support
        "qwen",       # Qwen3-Coder / omnicoder-9b (qwen3.5 base) — <function=...> XML
        "deepseek",   # DeepSeek local variants
        "llama",      # Llama 3.1 / Llama 2 / etc. — many local variants lack native support
        "phi",        # Microsoft Phi models
        "mistral",    # Mistral variants without native support
    }
    if family in _TEXT_MODE_FAMILIES:
        return True

    # ── Default: native ─────────────────────────────────────────────────
    return False


def _fetch_model_meta(provider_id: str, model_id: str) -> dict[str, Any] | None:
    """Fetch per-model metadata (max_context_length, state, etc.) from LM Studio.

    Tries the rich /api/v0/models endpoint first, then falls back to
    the standard /v1/models/{model_id} endpoint.
    Returns None on any failure — callers fall back to defaults.
    """
    try:
        provider = get_provider(provider_id)
        base = provider["base_url"].rstrip("/")

        # Strategy 1: LM Studio management API (rich metadata)
        mgmt_base = base.replace("/v1", "")
        url = f"{mgmt_base}/api/v0/models"
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = _json.loads(resp.read().decode())
        # Look up the specific model in the list
        models_list = data.get("data", []) if isinstance(data, dict) else data
        for m in models_list:
            if isinstance(m, dict) and m.get("id") == model_id:
                return m
        # Not found in list
        return None
    except Exception:
        pass

    try:
        # Strategy 2: standard /v1/models/{id} (OpenAI-compatible)
        provider = get_provider(provider_id)
        base = provider["base_url"].rstrip("/")
        url = f"{base}/models/{urllib.request.quote(model_id, safe='')}"
        req = urllib.request.Request(url)
        req.add_header("Authorization", f"Bearer {provider.get('api_key') or 'not-needed'}")
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = _json.loads(resp.read().decode())
        return data
    except Exception:
        return None


def _unload_lm_studio_model(provider_id: str, model_id: str) -> bool:
    """Attempt to unload a model from LM Studio using the lms CLI.

    Falls back to LM Studio's REST management API if the CLI is unavailable.
    Returns True if successful, False otherwise (callers continue silently).
    """
    import subprocess

    # ── Strategy 1: lms CLI (most reliable) ─────────────────────
    lms_bin = os.path.expanduser("~/.lmstudio/bin/lms")
    try:
        result = subprocess.run(
            [lms_bin, "unload", model_id],
            capture_output=True,
            text=True,
            timeout=15,
        )
        if result.returncode == 0:
            logger.info("Unloaded model %r via lms CLI", model_id)
            return True
        else:
            stderr = (result.stderr or "").strip()
            stdout = (result.stdout or "").strip()
            logger.debug("lms unload failed (rc=%d): %s %s", result.returncode, stdout, stderr)
    except FileNotFoundError:
        logger.debug("lms CLI not found at %s", lms_bin)
    except subprocess.TimeoutExpired:
        logger.debug("lms unload timed out for %r", model_id)
    except Exception as exc:
        logger.debug("lms unload error: %s", exc)

    # ── Strategy 2: REST management API (newer LM Studio versions) ──
    try:
        provider = get_provider(provider_id)
        base = provider["base_url"].rstrip("/")
        mgmt_base = base.replace("/v1", "")
        url = f"{mgmt_base}/api/v0/models/unload"
        payload = _json.dumps({"model_identifier": model_id}).encode("utf-8")
        req = urllib.request.Request(url, data=payload, method="POST")
        req.add_header("Content-Type", "application/json")
        with urllib.request.urlopen(req, timeout=5) as resp:
            resp.read()
        logger.info("Unloaded model %r via REST API", model_id)
        return True
    except Exception as exc:
        logger.debug("REST unload failed for %r: %s", model_id, exc)

    return False


# Track the last-used model per provider so we know when a switch happens
_last_model: dict[str, str] = {}


def _read_lm_studio_saved_config(model_id: str) -> dict[str, Any] | None:
    """Read LM Studio's saved per-model config preset from disk.

    LM Studio stores per-model settings (context length, GPU offload, etc.)
    under ~/.lmstudio/.internal/user-concrete-model-default-config/
    organized by publisher/model-name/specific-gguf.json.

    We fuzzy-match the model_id against directory and file names.
    Returns the first matching config dict, or None.
    """
    import fnmatch

    config_root = os.path.expanduser("~/.lmstudio/.internal/user-concrete-model-default-config")
    if not os.path.isdir(config_root):
        return None

    model_lower = model_id.lower().replace("-", " ").replace("_", " ")
    # Build search tokens from the model ID
    tokens = [t for t in model_lower.split() if len(t) > 1]

    candidates: list[tuple[int, str]] = []

    for root, dirs, files in os.walk(config_root):
        for fname in files:
            if not fname.endswith(".json"):
                continue
            full = os.path.join(root, fname)
            path_lower = full.lower().replace("-", " ").replace("_", " ")
            # Score: count how many tokens from model_id appear in the path
            score = sum(1 for t in tokens if t in path_lower)
            if score > 0:
                candidates.append((score, full))

    # Best match (highest score)
    candidates.sort(key=lambda x: x[0], reverse=True)
    for score, path in candidates:
        try:
            with open(path) as f:
                data = _json.load(f)
            if isinstance(data, dict):
                return data
        except Exception:
            continue

    return None


def _get_saved_context_length(model_id: str) -> int | None:
    """Extract saved context length from LM Studio's per-model config preset."""
    config = _read_lm_studio_saved_config(model_id)
    if not config:
        return None

    load_fields = config.get("load", {}).get("fields", [])
    for field in load_fields:
        if field.get("key") == "llm.load.contextLength":
            val = field.get("value")
            if isinstance(val, (int, float)) and val > 0:
                return int(val)
    return None


def _resolve_max_tokens(provider_id: str, model_id: str, fallback: int | None = None) -> int:
    """Resolve max_tokens: prefer saved LM Studio config, then model max, then env, then fallback."""
    # 1. LM Studio saved per-model config (user's optimized setting)
    saved_ctx = _get_saved_context_length(model_id)
    if saved_ctx:
        return saved_ctx

    # 2. Model's maximum context_length from server metadata
    meta = _fetch_model_meta(provider_id, model_id)
    if meta and isinstance(meta, dict):
        ctx = meta.get("max_context_length") or meta.get("context_length") or meta.get("context_window")
        if isinstance(ctx, (int, float)) and ctx > 0:
            return int(ctx)

    # 3. Env override
    env_val = os.getenv("SMITH_MAX_TOKENS", "").strip()
    if env_val.isdigit():
        return int(env_val)

    # 4. Caller-provided fallback
    if fallback:
        return fallback

    # 5. Hard default
    return 4096


def build_chat_model_for_task(
    db: ProjectDB,
    task_type: str,
    max_tokens: int | None = None,
    model_override: dict[str, str] | None = None,
) -> ChatOpenAI:
    selection = model_override or get_project_model_selection(db, task_type)
    provider_id = selection["provider_id"]
    provider = get_provider(provider_id)
    model_id = selection["model_id"]

    # ── Track model switches ────────────────────────────────────
    prev = _last_model.get(provider_id)
    if prev and prev != model_id:
        logger.info("Model switch: %r → %r (LM Studio will handle via just-in-time loading)", prev, model_id)
        # Only auto-unload if explicitly enabled (off by default — LM Studio handles it)
        if os.getenv("SMITH_UNLOAD_ON_SWITCH", "").strip().lower() in ("1", "true", "yes"):
            _unload_lm_studio_model(provider_id, prev)
    _last_model[provider_id] = model_id

    # ── Resolve max_tokens from model metadata ────────────────────
    resolved_max_tokens = _resolve_max_tokens(provider_id, model_id, max_tokens)

    text_tool_mode = _should_use_text_tools(model_id)

    if text_tool_mode:
        from .local_model import LocalModelChatOpenAI
        return LocalModelChatOpenAI(
            model=model_id,
            base_url=provider["base_url"],
            api_key=provider.get("api_key") or "not-needed",
            temperature=0,
            max_tokens=resolved_max_tokens,
            timeout=300,
            stream_usage=False,
            text_tool_mode=True,
        )

    return ChatOpenAI(
        model=model_id,
        base_url=provider["base_url"],
        api_key=provider.get("api_key") or "not-needed",
        temperature=0,
        max_tokens=resolved_max_tokens,
        timeout=300,
        stream_usage=False,
    )
