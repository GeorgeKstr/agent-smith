"""
Text-based tool call parser for local/opensource models.

Many smaller models (Gemma, Qwen, Llama <70B, etc.) don't support OpenAI's
native function-calling API. Instead they emit tool calls as text in the
content field, using formats like:

- XML-style: <tool_call> <function=name> <parameter=key> value </parameter> </function> </tool_call>
- Anthropic-style: <function_calls><invoke name="..."><parameter name="...">...</parameter></invoke></function_calls>
- Markdown JSON: ```json\n{"tool": "name", "parameters": {...}}\n```
- Direct function call: function_name(arg1=val1, arg2="val2")

- Gemma/LM-Studio-style: <|tool_call>call:name{key:value, key2:value2}<tool_call|>

This module extracts these text-based tool calls and converts them to
LangChain-compatible ToolCall dicts that can be injected into AIMessages.
"""

from __future__ import annotations

import json
import re
from typing import Any


# ── Recognized tool call patterns ─────────────────────────────────────

# Pattern 1: <tool_call> <function=name> <parameter=key> value </parameter> </function> </tool_call>
_XML_TOOL_CALL_RE = re.compile(
    r"<tool_call>\s*"
    r"<function\s*=\s*(\w+)>\s*"
    r"(.*?)"
    r"</function>\s*"
    r"</tool_call>",
    re.DOTALL | re.IGNORECASE,
)

# Pattern 1b: <tool_call> without <function> wrapper (some models omit it)
_XML_TOOL_CALL_BARE_RE = re.compile(
    r"<tool_call>\s*"
    r"(\w+)\s*\((.*?)\)\s*"
    r"</tool_call>",
    re.DOTALL | re.IGNORECASE,
)

# Pattern 1c: GLM/Qwen-style XML (no opening <tool_call>, may lack </function>)
# Example: <function=bash<arg_key>command</arg_key><arg_value>ls</arg_value></tool_call>
# Qwen3-Coder often writes <tool_call> (no slash) as the closing marker.
# Match both </tool_call> and the malformed <tool_call> that follows </function>.
_GLM_TOOL_CALL_RE = re.compile(
    r"<function\s*=\s*(\w+)\s*"
    r"(.*?)"
    r"</?tool_call>",
    re.DOTALL | re.IGNORECASE,
)

_GLM_ARG_RE = re.compile(
    r"<arg_key>(\w+)</arg_key>\s*<arg_value>(.*?)</arg_value>",
    re.DOTALL,
)

# Pattern 2: Anthropic-style <function_calls>
_ANTHROPIC_INVOKE_RE = re.compile(
    r"<invoke\s+name\s*=\s*\"([^\"]+)\"\s*>(.*?)</invoke>",
    re.DOTALL,
)

_ANTHROPIC_FUNCTION_CALLS_RE = re.compile(
    r"<function_calls>(.*?)</function_calls>",
    re.DOTALL,
)

# Pattern 3: Markdown JSON code blocks
_MD_JSON_TOOL_RE = re.compile(
    r"```(?:json|tool_call)?\s*\n?"
    r"\s*\{[^}]*\"(?:tool|name|function)\"[^}]*\"(?:name|function|parameters|args|arguments)\"[^}]*\}"
    r"\s*\n?\s*```",
    re.DOTALL | re.IGNORECASE,
)

# Pattern 4: Gemma/LM-Studio style: <|tool_call>call:name{key:value, ...}<tool_call|>
# Values may be: <|"|>...<|"|>, '...', "...", ```...```, or plain text
_GEMINI_CALL_COLON_RE = re.compile(
    r"<\|tool_call>call:(\w+)\s*\{(.*?)\<tool_call\|>",
    re.DOTALL,
)

# Pattern 5: Direct function call syntax: function_name(key=value, ...)
# Only match when it looks like a tool call (has at least one keyword arg)
_DIRECT_CALL_RE = re.compile(
    r"(?:^|\n)\s*(\w+)\s*\(\s*"
    r"([\w_]+)\s*=\s*",
    re.MULTILINE,
)


# ── Parameter extraction ──────────────────────────────────────────────

_PARAM_RE = re.compile(
    r"<parameter\s*=\s*(\w+)>\s*(.*?)\s*</parameter>",
    re.DOTALL,
)

# Also support <parameter name="...">value</parameter> variant
_PARAM_NAMED_RE = re.compile(
    r"<parameter\s+name\s*=\s*\"([^\"]+)\"\s*>\s*(.*?)\s*</parameter>",
    re.DOTALL,
)


def _extract_xml_params(body: str) -> dict[str, Any]:
    """Extract parameter key-value pairs from XML body text."""
    params: dict[str, Any] = {}

    # Try <parameter=name>value</parameter> format first
    for match in _PARAM_RE.finditer(body):
        key = match.group(1).strip()
        value = match.group(2).strip()
        params[key] = _coerce_value(value)

    # Also try <parameter name="name">value</parameter>
    for match in _PARAM_NAMED_RE.finditer(body):
        key = match.group(1).strip()
        value = match.group(2).strip()
        if key not in params:
            params[key] = _coerce_value(value)

    return params


def _extract_gemini_call_args(body: str) -> dict[str, Any]:
    """Extract key:value pairs from a Gemma/LM-Studio style call body.

    Format: key1:<|"|>value1<|"|>, key2:'value2', key3:value3

    Values can be delimited by:
    - <|"|>...<|"|>  (LM Studio special quotes)
    - '...'          (single quotes)
    - "..."          (double quotes)
    - ```...```      (code block, optionally with language tag)
    - Plain text until next comma or }
    """
    params: dict[str, Any] = {}
    pos = 0
    body_len = len(body)

    while pos < body_len:
        # Skip whitespace and commas
        while pos < body_len and body[pos] in (' ', '\t', '\n', '\r', ','):
            pos += 1
        if pos >= body_len:
            break

        # Read key (word characters until colon)
        key_start = pos
        while pos < body_len and body[pos] not in (':', '}', ','):
            pos += 1
        if pos >= body_len or body[pos] != ':':
            break
        key = body[key_start:pos].strip()
        pos += 1  # skip colon

        # Skip whitespace after colon
        while pos < body_len and body[pos] in (' ', '\t'):
            pos += 1

        if pos >= body_len:
            break

        # Determine value delimiter
        value: str | None = None
        c = body[pos]

        # Case 1: LM Studio special quotes <|"|>...<|"|>
        # These are supposed to be opaque safe quotes — any character between
        # the opening and closing <|"|> is part of the value, including commas,
        # quotes, braces, etc. The ONLY delimiter we respect is the closing <|"|>.
        if body[pos:pos + 5] == '<|"|>':
            pos += 5
            end_close = body.find('<|"|>', pos)

            if end_close != -1:
                # Found closing <|"|> — everything between is the value.
                value = body[pos:end_close]
                pos = end_close + 5
            else:
                # No closing <|"|> found. The model probably has malformed output.
                # Consume everything until end of body.
                value = body[pos:].rstrip("},").strip()
                pos = body_len

        # Case 2: Code block ```...```
        elif body[pos:pos + 3] == '```':
            pos += 3
            # Skip optional language tag
            while pos < body_len and body[pos] not in ('\n', '\r'):
                pos += 1
            # Skip newline
            while pos < body_len and body[pos] in ('\n', '\r'):
                pos += 1
            # Find closing ```
            end = body.find('```', pos)
            if end == -1:
                end = body_len
            value = body[pos:end]
            pos = end + 3

        # Case 3: Double-quoted string "..."
        elif c == '"':
            pos += 1
            end = pos
            while end < body_len:
                if body[end] == '\\':
                    end += 2
                    continue
                if body[end] == '"':
                    break
                end += 1
            value = body[pos:end]
            pos = end + 1

        # Case 4: Single-quoted string '...'
        elif c == "'":
            pos += 1
            end = pos
            while end < body_len:
                if body[end] == '\\':
                    end += 2
                    continue
                if body[end] == "'":
                    break
                end += 1
            value = body[pos:end]
            pos = end + 1

        # Case 5: Plain text (until next comma or end)
        else:
            end_comma = body.find(',', pos)
            end = end_comma if end_comma != -1 else body_len
            value = body[pos:end].strip()
            pos = end

        if key and value is not None:
            params[key] = _coerce_value(value.strip())

    return params


def _coerce_value(value: str) -> Any:
    """Try to convert string value to appropriate Python type.

    Coerces booleans, numbers, null, and JSON arrays/objects.
    JSON parsing is attempted only when the value starts with "[" or "{".
    If JSON parsing fails, falls back to returning the raw string (safe for
    arbitrary file content in parameters like 'content' or 'path').
    """
    import json as _json
    v = value.strip()

    # Boolean
    if v.lower() in ("true", "yes"):
        return True
    if v.lower() in ("false", "no"):
        return False

    # Numbers
    try:
        if "." in v or "e" in v.lower():
            return float(v)
        return int(v)
    except (ValueError, TypeError):
        pass

    # Null
    if v.lower() in ("null", "none", "nil"):
        return None

    # JSON arrays/objects — try to parse. If it fails, return raw string.
    # This handles parameters like edits=[{"oldText":..., "newText":...}]
    # without corrupting file content that happens to start with "[" or "{".
    if v and (v[0] == "[" or v[0] == "{"):
        try:
            parsed = _json.loads(v)
            return parsed
        except (_json.JSONDecodeError, ValueError):
            pass

    return v


# ── Parser for markdown JSON blocks ───────────────────────────────────

def _parse_md_json_tool(text: str) -> list[dict[str, Any]]:
    """Extract tool calls from markdown JSON code blocks."""
    results: list[dict[str, Any]] = []

    # Find all JSON code blocks
    code_block_re = re.compile(
        r"```(?:json|tool_call)?\s*\n?(.*?)\n?\s*```",
        re.DOTALL,
    )
    for match in code_block_re.finditer(text):
        block = match.group(1).strip()
        # Try to parse as a single JSON object or array
        try:
            parsed = json.loads(block)
        except json.JSONDecodeError:
            continue

        if isinstance(parsed, list):
            for item in parsed:
                tc = _dict_to_tool_call(item)
                if tc:
                    results.append(tc)
        elif isinstance(parsed, dict):
            tc = _dict_to_tool_call(parsed)
            if tc:
                results.append(tc)

    return results


def _dict_to_tool_call(d: dict) -> dict[str, Any] | None:
    """Convert a dict to a LangChain tool_call dict."""
    # Support multiple JSON schemas
    name = d.get("tool") or d.get("name") or d.get("function") or d.get("tool_name")
    if not name:
        return None

    if isinstance(name, dict):
        # {"function": {"name": "foo", "arguments": {...}}}
        inner_name = name.get("name", "")
        args = name.get("arguments", name.get("parameters", {}))
        name = inner_name
    else:
        args = d.get("args") or d.get("arguments") or d.get("parameters") or d.get("params") or d

    # Remove metadata keys from args
    if isinstance(args, dict):
        args = {k: v for k, v in args.items() if k not in ("tool", "name", "function", "tool_name")}

    if not name:
        return None

    return {
        "name": str(name),
        "args": args if isinstance(args, dict) else {},
        "id": f"text_tc_{name}_{len(str(args))}",
        "type": "tool_call",
    }


# ── Main parser ────────────────────────────────────────────────────────

def extract_tool_calls_from_text(text: str, available_tool_names: set[str] | None = None) -> list[dict[str, Any]]:
    """Extract tool calls from raw model text output.

    Tries multiple parsing strategies in order, returning all found tool calls.

    Args:
        text: Raw assistant text output from the model.
        available_tool_names: Optional set of known tool names to validate against.

    Returns:
        List of tool_call dicts with keys: name, args, id, type.
    """
    if not text or len(text.strip()) < 5:
        return []

    results: list[dict[str, Any]] = []

    # Strategy 1: XML-style <tool_call> with <function=name>
    for match in _XML_TOOL_CALL_RE.finditer(text):
        func_name = match.group(1).strip()
        body = match.group(2)
        params = _extract_xml_params(body)
        if func_name:
            results.append({
                "name": func_name,
                "args": params,
                "id": f"text_tc_{func_name}_{len(results)}",
                "type": "tool_call",
            })

    # Strategy 2: Bare <tool_call> without <function>
    if not results:
        for match in _XML_TOOL_CALL_BARE_RE.finditer(text):
            func_name = match.group(1).strip()
            args_str = match.group(2).strip()
            params = _extract_xml_params(args_str)
            if func_name:
                results.append({
                    "name": func_name,
                    "args": params,
                    "id": f"text_tc_{func_name}_{len(results)}",
                    "type": "tool_call",
                })

    # Strategy 2b: GLM-style XML (no <tool_call> wrapper, may use <arg_key>/<arg_value>
    # or <parameter=name>value</parameter>)
    if not results:
        for match in _GLM_TOOL_CALL_RE.finditer(text):
            func_name = match.group(1).strip()
            body = match.group(2)
            params: dict[str, Any] = {}
            # Try <arg_key>/<arg_value> format first
            for arg_match in _GLM_ARG_RE.finditer(body):
                key = arg_match.group(1).strip()
                value = _coerce_value(arg_match.group(2).strip())
                params[key] = value
            # Fall back to <parameter=name>value</parameter> format (used by Qwen, etc.)
            if not params:
                params = _extract_xml_params(body)
            if func_name and params:
                results.append({
                    "name": func_name,
                    "args": params,
                    "id": f"text_tc_{func_name}_{len(results)}",
                    "type": "tool_call",
                })

    # Strategy 3: Anthropic-style <function_calls>/<invoke>
    if not results:
        fc_match = _ANTHROPIC_FUNCTION_CALLS_RE.search(text)
        search_text = fc_match.group(1) if fc_match else text
        for match in _ANTHROPIC_INVOKE_RE.finditer(search_text):
            func_name = match.group(1).strip()
            body = match.group(2)
            params = _extract_xml_params(body)
            if func_name:
                results.append({
                    "name": func_name,
                    "args": params,
                    "id": f"text_tc_{func_name}_{len(results)}",
                    "type": "tool_call",
                })

    # Strategy 4: Gemma/LM-Studio style <|tool_call>call:name{...}<tool_call|>
    if not results:
        for match in _GEMINI_CALL_COLON_RE.finditer(text):
            func_name = match.group(1).strip()
            body = match.group(2).rstrip("}")  # Strip trailing } before <tool_call|>
            params = _extract_gemini_call_args(body)
            if func_name and params:
                results.append({
                    "name": func_name,
                    "args": params,
                    "id": f"text_tc_{func_name}_{len(results)}",
                    "type": "tool_call",
                })

    # Strategy 5: Markdown JSON code blocks
    if not results:
        results.extend(_parse_md_json_tool(text))

    # Filter by available tool names if provided
    if available_tool_names:
        results = [tc for tc in results if tc["name"] in available_tool_names]

    return results


def has_text_tool_calls(text: str) -> bool:
    """Quick check if text likely contains tool calls that need extraction."""
    if not text:
        return False
    return bool(
        _XML_TOOL_CALL_RE.search(text)
        or _XML_TOOL_CALL_BARE_RE.search(text)
        or _GLM_TOOL_CALL_RE.search(text)
        or _ANTHROPIC_INVOKE_RE.search(text)
        or _GEMINI_CALL_COLON_RE.search(text)
        or _MD_JSON_TOOL_RE.search(text)
    )


def clean_tool_call_text(text: str) -> str:
    """Remove recognized tool call syntax from model output text.

    Returns the cleaned text suitable for displaying to the user.
    """
    cleaned = text
    cleaned = _XML_TOOL_CALL_RE.sub("", cleaned)
    cleaned = _XML_TOOL_CALL_BARE_RE.sub("", cleaned)
    cleaned = _GLM_TOOL_CALL_RE.sub("", cleaned)
    cleaned = _GEMINI_CALL_COLON_RE.sub("", cleaned)
    cleaned = _ANTHROPIC_FUNCTION_CALLS_RE.sub("", cleaned)
    # Don't remove JSON blocks that might be legitimate output
    # Only remove if they were parsed as tool calls
    return cleaned.strip()
