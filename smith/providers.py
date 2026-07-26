from __future__ import annotations

import os
from typing import Any

from langchain_openai import ChatOpenAI
from openai import OpenAI

from .db import ProjectDB


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


def build_chat_model_for_task(
    db: ProjectDB,
    task_type: str,
    max_tokens: int | None = None,
    model_override: dict[str, str] | None = None,
) -> ChatOpenAI:
    selection = model_override or get_project_model_selection(db, task_type)
    provider = get_provider(selection["provider_id"])

    return ChatOpenAI(
        model=selection["model_id"],
        base_url=provider["base_url"],
        api_key=provider.get("api_key") or "not-needed",
        temperature=0,
        max_tokens=max_tokens or 4096,
        timeout=300,
        stream_usage=False,
        extra_body={"chat_template_kwargs": {"enable_thinking": False}},
    )
