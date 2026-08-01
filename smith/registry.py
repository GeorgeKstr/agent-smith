from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class ModelProfile:
    name: str
    model: str
    max_tokens: int = 2048
    temperature: float = 0.0


@dataclass(frozen=True)
class TaskProfile:
    name: str
    model_profile: str
    tools: list[str]
    context_budget_chars: int = 24000
    system_role: str = ""
    can_write: bool = False
    can_run_commands: bool = False


MODEL_PROFILES: dict[str, ModelProfile] = {
    "fast": ModelProfile(
        name="fast",
        model="project-selected",
        max_tokens=1024,
    ),
    "coding": ModelProfile(
        name="coding",
        model="project-selected",
        max_tokens=2048,
    ),
    "reviewer": ModelProfile(
        name="reviewer",
        model="project-selected",
        max_tokens=2048,
    ),
    "summarizer": ModelProfile(
        name="summarizer",
        model="project-selected",
        max_tokens=1024,
    ),
}

TASK_PROFILES: dict[str, TaskProfile] = {
    "ask": TaskProfile(
        name="ask",
        model_profile="fast",
        tools=["ls", "read", "grep", "find", "search_project_context", "get_file_summary", "get_related_files"],
        context_budget_chars=16000,
        system_role="Answer questions about the project. Prefer indexed context before broad file reads.",
    ),
    "implement": TaskProfile(
        name="implement",
        model_profile="coding",
        tools=[
            "ls",
            "read",
            "write",
            "edit",
            "grep",
            "find",
            "bash",
            "search_project_context",
            "get_file_summary",
            "get_related_files",
        ],
        context_budget_chars=30000,
        system_role="Implement the user's requested code change with small targeted edits.",
        can_write=True,
        can_run_commands=True,
    ),
    "review": TaskProfile(
        name="review",
        model_profile="reviewer",
        tools=["read", "grep", "bash", "search_project_context", "get_file_summary", "get_run_changes"],
        context_budget_chars=24000,
        system_role=(
            "Review the last implementation. Find correctness, safety, or requirement issues. Do not edit files.\n"
            "CRITICAL: You MUST actively verify the implementation by running relevant commands:\n"
            "- Run the project's test suite (pytest, npm test, go test, cargo test, etc.)\n"
            "- Run linters (ruff, eslint, shellcheck, etc.) and type checkers (mypy, tsc, etc.)\n"
            "- Try to run/build the changed code to catch import/syntax errors\n"
            "- If the project has no tests, at least check that imports resolve and syntax is valid\n"
            "Report what you ran, whether it passed, and any issues found. "
            "Conclude with a clear PASS/FAIL/WARN verdict."
        ),
        can_write=False,
        can_run_commands=True,
    ),
    "summarize_file": TaskProfile(
        name="summarize_file",
        model_profile="summarizer",
        tools=[],
        context_budget_chars=24000,
        system_role="Summarize a single source file into compact project memory.",
    ),
    "summarize_run": TaskProfile(
        name="summarize_run",
        model_profile="summarizer",
        tools=["search_project_context"],
        context_budget_chars=24000,
        system_role="Summarize a completed Smith run into durable project memory.",
    ),
}


def get_model_profile(name: str) -> ModelProfile:
    if name not in MODEL_PROFILES:
        raise KeyError(f"Unknown model profile: {name}")
    return MODEL_PROFILES[name]


def get_task_profile(name: str) -> TaskProfile:
    if name not in TASK_PROFILES:
        raise KeyError(f"Unknown task profile: {name}")
    return TASK_PROFILES[name]


def classify_prompt(prompt: str) -> str:
    low = prompt.lower()

    review_words = (
        "review",
        "check my changes",
        "inspect the diff",
        "review the diff",
        "critique the changes",
    )

    implement_words = (
        "fix",
        "change",
        "edit",
        "modify",
        "rewrite",
        "replace",
        "update",
        "add",
        "create",
        "implement",
        "refactor",
        "remove",
        "delete",
        "rename",
        "move",
        "turn",
        "convert",
        "write",
        "make",
        "correct",
        "correction",
        "patch",
        "adjust",
        "repair",
    )

    implement_phrases = (
        "turn the content",
        "change the content",
        "edit the file",
        "modify the file",
        "rewrite the file",
        "write to",
        "create a file",
        "update the file",
        "should be",
        "should use",
        "needs to be",
        "it should",
        "instead of",
        "not just",
        "not only",
        "is wrong",
        "are wrong",
        "does not work",
        "doesn't work",
        "api/v1",
        "/api/v1",
    )

    if any(w in low for w in review_words):
        return "review"

    if any(p in low for p in implement_phrases):
        return "implement"

    if any(w in low.split() for w in implement_words):
        return "implement"

    return "ask"
