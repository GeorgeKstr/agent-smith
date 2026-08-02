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
from typing import Any, Iterator

import openai
from langchain_core.callbacks import CallbackManagerForLLMRun
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, AIMessageChunk, BaseMessage, ToolMessage
from langchain_core.outputs import ChatGeneration, ChatGenerationChunk, ChatResult
from langchain_openai import ChatOpenAI
from langchain_openai.chat_models.base import _handle_openai_api_error, _handle_openai_bad_request

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

        # In text_tool_mode, we must NOT pass real tools to super().bind_tools()
        # because that sets up native OpenAI function-calling schemas which
        # confuse models like Qwen/Gemma that emit text-based tool calls.
        # Instead, bind an empty list so the agent graph still gets a proper
        # RunnableBinding, but the model receives no native tool definitions.
        if self.text_tool_mode:
            kwargs.pop("tool_choice", None)
            # Bind empty tools — the agent graph needs a RunnableBinding wrapper
            # but the model should NOT receive OpenAI tool schemas.
            result = super().bind_tools([], **kwargs)
        else:
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

    def _stream(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: CallbackManagerForLLMRun | None = None,
        **kwargs: Any,
    ) -> Iterator[ChatGenerationChunk | AIMessageChunk]:
        """Stream response, buffering to extract text-based tool calls."""
        if not self.text_tool_mode:
            yield from super()._stream(messages, stop, run_manager, **kwargs)
            return

        kwargs.pop("tools", None)
        kwargs.pop("tool_choice", None)

        # Manual streaming through the raw OpenAI client. LangChain's
        # ChatOpenAI drops `reasoning_content` from streamed chunks before our
        # wrapper sees them, and qwen-family models (omnicoder-9b, Qwen3-Coder)
        # sometimes place their <function=...> XML tool call inside the
        # reasoning stream. So we parse the SSE chunks ourselves and scan BOTH
        # `content` and `reasoning_content` for text tool calls.
        self._ensure_sync_client_available()
        payload = self._get_request_payload(messages, stop=stop, **kwargs)
        payload["stream"] = True

        raw_dicts: list[dict] = []
        parts: list[str] = []
        reasoning_parts: list[str] = []
        try:
            response = self.client.create(**payload)
            with response as stream:
                for chunk in stream:
                    d = chunk.model_dump() if not isinstance(chunk, dict) else chunk
                    raw_dicts.append(d)
                    try:
                        delta = d["choices"][0]["delta"]
                    except (KeyError, IndexError, TypeError):
                        continue
                    c = delta.get("content")
                    if c:
                        parts.append(c)
                    rc = delta.get("reasoning_content")
                    if rc:
                        reasoning_parts.append(rc)
        except openai.BadRequestError as e:
            _handle_openai_bad_request(e)
        except openai.APIError as e:
            _handle_openai_api_error(e)

        if not raw_dicts:
            return

        # Scan visible content first; fall back to reasoning content.
        full_content = "".join(parts)
        reasoning_text = "".join(reasoning_parts)
        if not has_text_tool_calls(full_content) and reasoning_text:
            full_content = full_content + "\n" + reasoning_text

        if has_text_tool_calls(full_content):
            text_tool_calls = extract_tool_calls_from_text(
                full_content,
                available_tool_names=self._available_tool_names,
            )
            if text_tool_calls:
                cleaned = clean_tool_call_text("".join(parts))
                logger.debug(
                    "Stream extracted %d text tool calls: %s",
                    len(text_tool_calls),
                    [tc["name"] for tc in text_tool_calls],
                )
                # Yield a single chunk with cleaned content + tool_calls.
                # The agent graph aggregates chunks; a single-chunk response
                # with both content and tool_calls works correctly.
                msg = AIMessageChunk(content=cleaned)
                msg.tool_calls = text_tool_calls
                import json as _json
                if hasattr(msg, "tool_call_chunks"):
                    msg.tool_call_chunks = [
                        {
                            "name": tc["name"],
                            "args": _json.dumps(tc["args"]),
                            "id": tc["id"],
                            "index": i,
                        }
                        for i, tc in enumerate(text_tool_calls)
                    ]
                yield ChatGenerationChunk(message=msg)
                return

        # No text tool calls — replay raw chunks through LangChain's converter
        # so the graph sees normal streaming content chunks.
        for d in raw_dicts:
            gen_chunk = self._convert_chunk_to_generation_chunk(
                d, AIMessageChunk, {}
            )
            if gen_chunk is None:
                continue
            if run_manager is not None and gen_chunk.text:
                run_manager.on_llm_new_token(gen_chunk.text, chunk=gen_chunk)
            yield gen_chunk
