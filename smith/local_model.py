"""
Local-model-friendly ChatOpenAI wrapper with text-based tool call extraction.

When smaller/open-source models don't support OpenAI's native function-calling
API, they emit tool calls as text in the content field. This wrapper:

1. Calls the underlying ChatOpenAI model normally
2. If the response has no native tool_calls, scans the text content for
   text-based tool call syntax (XML, markdown JSON, etc.)
3. Extracts found tool calls and adds them as proper tool_calls on the message
4. Cleans the tool call syntax from the message content

Usage:
    from smith.local_model import LocalModelChatOpenAI

    llm = LocalModelChatOpenAI(
        model="gemma4-26b-a4b",
        base_url="http://localhost:1234/v1",
        api_key="not-needed",
        temperature=0,
        max_tokens=4096,
    )
    # Use exactly like ChatOpenAI - bind_tools, invoke, stream all work
"""

from __future__ import annotations

import logging
from typing import Any

from langchain_core.callbacks import CallbackManagerForLLMRun
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage, ToolMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from langchain_openai import ChatOpenAI

from .tool_parser import extract_tool_calls_from_text, has_text_tool_calls, clean_tool_call_text

logger = logging.getLogger(__name__)


class LocalModelChatOpenAI(ChatOpenAI):
    """ChatOpenAI subclass that extracts text-based tool calls from model output.

    Designed for local models (Gemma, Qwen, Llama, etc.) that don't support
    native OpenAI function calling. When the model emits tool-call-like text
    instead of proper tool_calls, this wrapper detects and converts them.

    Set SMITH_TEXT_TOOL_MODE=1 or pass text_tool_mode=True to enable.
    When disabled, behaves exactly like ChatOpenAI.
    """

    text_tool_mode: bool = False
    """When True, scan model output for text-based tool calls."""

    _available_tool_names: set[str] | None = None
    """Set of tool names currently bound to the model."""

    def __init__(self, *args, text_tool_mode: bool = False, **kwargs):
        super().__init__(*args, **kwargs)
        self.text_tool_mode = text_tool_mode

    def bind_tools(
        self,
        tools: list[Any],
        **kwargs: Any,
    ) -> "LocalModelChatOpenAI":
        """Track bound tool names for validation during text extraction.

        In text_tool_mode, we still call super().bind_tools() so the LangChain
        agent graph has proper tool bindings. But we also store tool names for
        validating text-extracted tool calls in _generate().

        The system prompt (not OpenAI tool definitions) is the primary driver
        of tool calling in text mode.
        """
        # Extract tool names from the tools list for validation
        tool_names: set[str] = set()
        for t in tools:
            if isinstance(t, dict):
                name = t.get("name") or t.get("function", {}).get("name", "")
                if name:
                    tool_names.add(name)
            elif hasattr(t, "name"):
                tool_names.add(t.name)
            elif callable(t) and hasattr(t, "__name__"):
                tool_names.add(t.__name__)

        # In text_tool_mode, remove tool_choice from kwargs if present — the
        # agent may pass it, but we want the model to use text, not forced tool calls.
        if self.text_tool_mode:
            kwargs.pop("tool_choice", None)

        result = super().bind_tools(tools, **kwargs)

        # super().bind_tools() returns a RunnableBinding (_ChatModelBinding),
        # not a LocalModelChatOpenAI directly. We need to set our attributes
        # on the inner model that _generate actually runs on.
        inner = getattr(result, "bound", None)
        if isinstance(inner, LocalModelChatOpenAI):
            inner._available_tool_names = tool_names
        elif isinstance(result, LocalModelChatOpenAI):
            result._available_tool_names = tool_names

        return result

    def _generate(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: CallbackManagerForLLMRun | None = None,
        **kwargs: Any,
    ) -> ChatResult:
        """Generate response, then extract text-based tool calls if needed.

        In text_tool_mode, we strip OpenAI tool definitions from the request
        so the model relies purely on the text-based system prompt instructions.
        Models like Gemma don't support native function calling and get confused
        when they receive OpenAI tool schemas alongside text instructions.
        """
        if self.text_tool_mode:
            # Strip native tool definitions — the model uses text-based instructions
            kwargs.pop("tools", None)
            kwargs.pop("tool_choice", None)
        result = super()._generate(messages, stop, run_manager, **kwargs)

        if not self.text_tool_mode:
            return result

        # Post-process each generation to extract text-based tool calls
        for gen in result.generations:
            msg = gen.message
            if not isinstance(msg, AIMessage):
                continue

            # Already has native tool_calls — nothing to do
            if msg.tool_calls:
                continue

            content = msg.content
            if isinstance(content, list):
                # Multi-block content — extract text parts
                text_parts = []
                for block in content:
                    if isinstance(block, dict) and block.get("type") == "text":
                        text_parts.append(block.get("text", ""))
                content = "\n".join(text_parts)
            content = str(content or "")

            if not has_text_tool_calls(content):
                continue

            # Extract tool calls from text
            text_tool_calls = extract_tool_calls_from_text(
                content,
                available_tool_names=self._available_tool_names,
            )

            if text_tool_calls:
                # Clean tool call syntax from content
                cleaned = clean_tool_call_text(content)
                msg.content = cleaned
                msg.tool_calls = text_tool_calls
                logger.debug(
                    "Extracted %d text-based tool calls: %s",
                    len(text_tool_calls),
                    [tc["name"] for tc in text_tool_calls],
                )

        return result
