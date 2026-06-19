# Question System Review

## Overview

There are **two independent question systems** that share no code path:

| System | Mechanism | Used By | Persistence |
|--------|-----------|---------|-------------|
| **TUI-internal** | React state (`activeQuestion`) | Slash commands in terminal | None (ephemeral) |
| **Database/REST** | SQLite `user_questions` table | Web client, Organizer, external API | SQLite |

Neither system is triggered by the agent or LLM output. There is no heuristic detection of questions in model responses.

---

## System 1: TUI-Internal Questions

### Triggered exclusively by slash commands

All question modals in the TUI are created by explicit `setActiveQuestion()` calls in `src/tui/App.tsx`:

| Line | Trigger | What |
|------|---------|------|
| **432** | `/setup-step` after provider configured | Model selection picker |
| **758** | `/model` with >15 installed models | Model selection picker |
| **866** | `/setup` (no args) | Provider selection (8 options) |

### Rendering (`src/tui/screens/MainScreen.tsx:309`)

```
{aq && !props.busy && ...}
```

The question modal shows only when `activeQuestion !== null` **and** `busy === false`. During a task run, questions are held in state but never rendered.

### Keyboard handling (`src/tui/App.tsx:1595-1621`)

| Key | Action |
|-----|--------|
| `Esc` | Dismiss question (`setActiveQuestion(null)`) |
| `↑`/`↓` | Move selection |
| `Enter` | Accept selection. If `command` is set, dispatches it. If `null`, sets input to `"I choose: ${selectedValue}"` |

### Task phase dismissal (`src/tui/App.tsx:445`)

When phase transitions to `"distilling"` or `"triaging"`, any lingering question is cleared via `setActiveQuestion(null)`.

---

## System 2: Database/REST Questions

### Schema (`src/db/db.ts:233-244`)

```sql
CREATE TABLE user_questions (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  kind TEXT NOT NULL,          -- confirm | select | text | secret | file | model_select
  prompt TEXT NOT NULL,
  options_json TEXT,
  default_value_json TEXT,
  answer_json TEXT,
  status TEXT NOT NULL,        -- open | answered | cancelled | expired
  created_at INTEGER NOT NULL,
  answered_at INTEGER
);
```

### Factory functions (`src/chat/questions.ts`)

| Function | Kind | Options | Used by |
|----------|------|---------|---------|
| `askConfirm()` | confirm | `["yes", "no"]` | Web client, Organizer |
| `askSelect()` | select | caller-provided | Web client, Organizer |
| `askText()` | text | none | Web client, Organizer |
| `askSecret()` | secret | none | Web client, Organizer |
| `resolveQuestion()` | (closes) | — | Web client answer handler |

**None of these are imported by the agent, tools, TUI, or task runner.** They exist only for external API consumers.

### CRUD (`src/chat/chatStore.ts:48-66`)

- `createUserQuestion()` — inserts open question
- `getOpenQuestions(sessionId?)` — queries open questions
- `answerUserQuestion(id, answer)` — marks answered
- `cancelUserQuestion(id)` — marks cancelled

### REST endpoints

| Server | File | Endpoints |
|--------|------|-----------|
| API | `src/api/server.ts:380-396` | `GET /api/questions/open`, `POST /api/questions/:id/answer`, `POST /api/questions/:id/cancel` |
| LAN | `src/lan/server.ts:662-683` | `GET /api/questions/open`, `POST /api/questions/:id/answer` |
| Organizer | `src/organizer/server.ts:557-600` | Proxies `GET /api/agents/:id/questions`, `POST /api/agents/:id/questions/:id` |

Sessions also return `openQuestions` in their response (e.g., `GET /api/chat/sessions/:id`).

### Web client (`src/web/client.ts`)

- Loads `openQuestions` on session fetch (line 75)
- Renders them as input fields with Answer buttons (line 202)
- `answerQ()` POSTs to `/api/questions/:id/answer` (line 210)

---

## Dead Code

### `task:question` event listener (`src/tui/App.tsx:493`)

```ts
events.on("task:question", onQuestion)   // registered
events.off("task:question", onQuestion)  // cleaned up
```

The listener is connected but **nothing emits `task:question`**. The event was previously emitted by `parseQuestions()` in `focusedAgentLoop.ts`, which was removed. The handler sets `activeQuestion` with `command: null`, which would have placed the selected answer into the input box.

### `questionFromCommand` ref (`src/tui/App.tsx:193`)

Set to `true` at three locations (lines 431, 757, 865) but **never read**. The differentiation between command-driven and event-driven questions already works correctly via the `command` field (null vs non-null) in the Enter handler.

### `answeredQuestionFp` ref (`src/tui/App.tsx:192`)

Loaded from persisted `tui-state.json` on startup (line 282) and saved on state changes (line 303), but **never written to after startup**. No code calls `.add()` when a question is answered. The persistence reads an always-empty set.

### `ask*` functions in `chat/questions.ts`

`askConfirm`, `askSelect`, `askText`, `askSecret` — defined and exported but **not imported by any module in `src/`**. Only used by external API consumers. The agent runtime never creates or resolves questions through these functions.

---

## What's Missing

1. **No way for the agent to ask the user a question** — The agent loop has no tool or mechanism to pause and request user input. The `finish` tool returns text but cannot solicit a choice.

2. **No question polling in the TUI** — The TUI never reads `getOpenQuestions()` from the database. Persistent questions from the API are invisible in the terminal.

3. **Two systems, no bridge** — TUI slash-command questions use React state. Database questions use SQLite + REST. Neither system is aware of the other.

4. **`answeredQuestionFp` is a stub** — Persistence infrastructure exists but the write path was never implemented.

---

## Current Behavior Summary

| Scenario | What happens |
|----------|-------------|
| User types `/model` with many models | TUI shows a scrollable picker modal |
| User types `/setup` | TUI shows provider selection modal |
| User presses `Esc` on a question | Modal dismissed, no action |
| User presses `Enter` on a question with `command` | Slash command dispatched with selected option |
| User presses `Enter` on a question with `command: null` | Selected option written to input as `"I choose: ..."` |
| Agent wants to ask user something | **Not possible** — no mechanism exists |
| Web client fetches a session | Open questions render as input fields |
| TUI idle after a task | No question polling, no database questions shown |
