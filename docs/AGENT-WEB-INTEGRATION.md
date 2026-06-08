# Agent-Web Integration

This document describes every piece of code related to the web UIs and how the TUI, agent API, organizer, and dashboard integrate with each other.

## Architecture Overview

Agent Smith has three web interfaces and one terminal interface:

```
┌─────────────────────────────────────────────────────────────┐
│  Agent Smith Runtime (single process)                       │
│                                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────────────┐ │
│  │ TUI      │  │ LAN      │  │ API Server               │ │
│  │ (Ink)    │  │ Server   │  │ (port 31337)             │ │
│  │ terminal │  │ (port    │  │ REST + SSE               │ │
│  │          │  │  3000)   │  │                           │ │
│  └────┬─────┘  └────┬─────┘  └───────────┬───────────────┘ │
│       │             │                    │                  │
│       │    shared   │     EventEmitter    │  HTTP            │
│       └─────────────┴────────────────────┘  (auth optional)  │
│                    │                                          │
│         ┌──────────┴──────────────────────┐                  │
│         │  .agent/index.sqlite (SQLite)   │                  │
│         │  chat_sessions, chat_messages,  │                  │
│         │  tasks, files, changes, etc.    │                  │
│         └─────────────────────────────────┘                  │
│                                                             │
│  ┌─────────────────────────────────┐                        │
│  │ Organizer Server (port 8787)    │  ── browser            │
│  │ REST API + Dashboard SPA        │                        │
│  │                                 │                        │
│  │  proxied calls → worker agents  │                        │
│  └─────────────────────────────────┘                        │
└─────────────────────────────────────────────────────────────┘
            ↑                      ↑
    Worker Agent A         Worker Agent B
    (same process)        (separate process/machine)
```

---

## 1. The Agent's Own Web UI (LAN Server)

**File:** `src/lan/server.ts` (1821 lines)  
**Port:** configurable, default 3000  
**Framework:** None — Node `http` server + inline HTML/CSS/JS

### Purpose
Provides a web-based companion to the TUI. A Matrix-themed single-page app with chat, file browser, and dashboard views that mirrors the TUI's state in real-time.

### How it works
- The server embeds a complete single-page application as TypeScript template literals — HTML, CSS, and JavaScript are concatenated into the response
- Static assets (HTML shell, styles, client JS) are served from in-memory strings
- Real-time updates use Server-Sent Events (SSE) on `/api/events`
- Mode and model changes propagate bidirectionally between web UI and TUI via the shared `EventEmitter`

### API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/state` | Current chat history, mode, model, project info |
| GET | `/api/events` | SSE stream of `chat:entry`, `ui:mode:set`, `ui:model:set`, `chat:cleared` |
| GET | `/api/dashboard` | Summary stats for the dashboard view |
| GET | `/api/filetree` | Recursive file tree of the project root |
| GET | `/api/file` | Read a file (query param `path`) |
| POST | `/api/file` | Write a file (query param `path`, body = content) |
| GET | `/api/config` | Current configuration (sanitized) |
| GET | `/api/models` | All available models from all configured providers |
| POST | `/api/prompt` | Submit a prompt (returns streaming chunks or final) |
| POST | `/api/cancel` | Cancel the current running task |
| POST | `/api/command` | Execute a slash command (`/model`, `/mode`, etc.) |

### Key integration points
- **TUI Sync**: The TUI's `App.tsx` emits events (`ui:mode:set`, `ui:model:set`, `chat:entry`, `chat:cleared`) on the shared `EventEmitter`. The LAN server listens for these and fans them out to connected SSE clients.
- **Web → TUI**: When a user types in the LAN web UI and submits, the event `chat:entry` fires with `source: "web"`. The TUI picks this up, sets `busy=true`, processes through `runAsk`/`runPatch`, and streams tokens back through the same event bus.
- **Model Sync**: Both TUI and LAN web UI share the same model override logic. A model change in the web UI emits `ui:model:set` which the TUI captures and applies to its state.

---

## 2. The Agent's API Server

**File:** `src/api/server.ts` (493 lines)  
**Port:** configurable, default 31337  
**Framework:** None — Node `http` server

### Purpose
Provides a structured REST API for programmatic agent access. This is the interface used by the **organizer system** to communicate with worker agents — dispatching tasks, proxying chat, managing change sets, and listing models.

### Authentication
- When no token is configured, the API only accepts connections from `127.0.0.1`/`::1`
- When a token is configured (`config.organizer.token`), requests must include `Authorization: Bearer <token>`

### API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/status` | Agent runtime status (project, mode, busy/idle) |
| POST | `/api/actions` | Dispatch a runtime action (`ask`, `patch`, `retrieve`, etc.) |
| GET | `/api/tasks` | List work items (optional query: `status`, `source`) |
| POST | `/api/tasks` | Create a work item |
| GET | `/api/tasks/:id` | Get a work item + plan steps + change sets |
| PATCH | `/api/tasks/:id` | Update task status, description, assigned agent |
| DELETE | `/api/tasks/:id` | Delete a task |
| GET | `/api/tasks/:id/plan` | List task plan steps |
| PUT | `/api/tasks/:id/plan` | Replace the entire task plan |
| POST | `/api/tasks/:id/plan/steps` | Add a plan step |
| POST | `/api/tasks/:id/patch` | Execute the task as a patch (optionally: apply, dryRun, model) |
| PATCH | `/api/plan-steps/:stepId` | Update a plan step (status, title, notes, sortOrder) |
| DELETE | `/api/plan-steps/:stepId` | Delete a plan step |
| GET | `/api/changes` | List change sets (optional query: `status`, `taskId`) |
| GET | `/api/changes/:id` | Get a change set with files and hunks |
| POST | `/api/changes/:id/accept` | Accept entire change set |
| POST | `/api/changes/:id/reject` | Reject entire change set |
| POST | `/api/changes/:id/apply` | Apply accepted hunks (optionally: hunks-only) |
| POST | `/api/changes/:id/revert` | Revert to the change set's git checkpoint |
| PATCH | `/api/changes/:id/file-status` | Update per-file review status |
| PATCH | `/api/hunks/:hunkId` | Update per-hunk review status |
| GET | `/api/chat/sessions` | List chat sessions |
| POST | `/api/chat/sessions` | Create a chat session |
| GET | `/api/chat/sessions/:id` | Get a session with messages and open questions |
| POST | `/api/chat/sessions/:id` | Send a chat message (prompt + optional actionKind, model) |
| POST | `/api/chat/messages` | Send a chat message (same as above, different path) |
| GET | `/api/questions/open` | List open (unanswered) user questions |
| POST | `/api/questions/:id/answer` | Answer a user question |
| POST | `/api/questions/:id/cancel` | Cancel a user question |
| GET | `/api/models` | **Added**: List all available models from all providers |
| GET | `/api/task-flow-templates` | List task flow templates |
| POST | `/api/task-flow-templates/render` | Render a template |
| GET | `/api/events` | SSE stream of `task:phase`, `task:stream`, etc. |

### Key data model
The API server reads from and writes to the shared `.agent/index.sqlite` database:
- **Chat**: `chat_sessions` and `chat_messages` tables (via `chatStore.ts`)
- **Tasks**: `work_items` and `task_plan_steps` tables (via `taskStore.ts`)
- **Changes**: `change_sets`, `changed_files`, `changed_hunks` tables
- **Models**: Calls `listProviderModels(config)` from the providers module

### How the organizer connects
The organizer's `workerApiClient.ts` (132 lines) wraps fetch calls to these endpoints:
```typescript
createWorkerApiClient({ baseUrl: agent.api_base_url, token })
// Provides: getStatus, dispatchAction, createTask, patchTask,
// listChatSessions, createChatSession, getChatSession, sendChatMessage,
// listModels, getOpenQuestions, answerQuestion
```

The `getChatSession()` and `listModels()` methods were added to fix the initial broken `.status` hacks.

---

## 3. The Organizer Server

**File:** `src/organizer/server.ts` (572 lines)  
**Port:** configurable, default 8787  
**Framework:** None — Node `http` server

### Purpose
The central orchestration hub. Manages its own SQLite database (`~/.agent-smith/organizer.sqlite`) separate from any single agent's project DB. Provides:
1. A REST API for agent registration, task management, and reviews
2. Proxy routes that forward chat, models, and question requests to individual worker agents
3. Serves the dashboard SPA at `/dashboard`

### Served Assets
| Path | Content-Type | Source |
|------|-------------|--------|
| `/` | `302 → /dashboard` | Redirect |
| `/dashboard` | `text/html` | `web/html.ts` |
| `/dashboard/styles.css` | `text/css` | `web/styles.ts` |
| `/dashboard/client.js` | `application/javascript` | `web/client.ts` |

### REST API (Organizer's Own Data)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/organizer/status` | Agent counts, task counts, project/bucket counts |
| GET | `/api/agents` | List all registered agents |
| GET | `/api/agents/:id` | Single agent detail |
| POST | `/api/agents/register` | Register a new agent (heartbeat payload) |
| POST | `/api/agents/:id/heartbeat` | Agent heartbeat update |
| GET `/ POST` | `/api/projects` | List / create projects |
| GET `/ PATCH `/ DELETE | `/api/projects/:id` | CRUD project |
| GET `/ POST` | `/api/buckets` | List / create buckets |
| GET `/ PATCH `/ DELETE | `/api/buckets/:id` | CRUD bucket |
| GET `/ POST` | `/api/tasks` | List / create tasks |
| GET `/ PATCH `/ DELETE | `/api/tasks/:id` | CRUD task |
| POST | `/api/tasks/:id/assign` | Assign task to agent |
| POST | `/api/tasks/:id/dispatch` | Dispatch task to worker |
| POST | `/api/tasks/dispatch-next` | Auto-dispatch next queued/assigned task |
| GET | `/api/tasks/:id/timeline` | Task timeline (iterations + events) |
| GET | `/api/tasks/:id/iterations` | List iterations |
| GET | `/api/tasks/:id/events` | List events |
| POST | `/api/tasks/:id/restart` | Restart task |
| POST | `/api/tasks/:id/skip` | Skip task |
| POST | `/api/tasks/:id/approve` | Approve task |
| POST | `/api/tasks/import-preview` | Preview task import |
| POST | `/api/tasks/import` | Import tasks (plain/markdown/csv/json) |
| GET | `/api/task-flow-templates` | List task flow templates |
| POST | `/api/task-flow-templates/render` | Render template |

### Proxy Routes (Forwarded to Worker Agents)

These routes connect to individual worker agents via `workerApiClient.ts`:

| Method | Path | Worker Endpoint Proxied |
|--------|------|------------------------|
| GET | `/api/agents/:id/chats` | `GET /api/chat/sessions` |
| POST | `/api/agents/:id/chats` | `POST /api/chat/sessions` |
| GET | `/api/agents/:id/chats/:sid` | `GET /api/chat/sessions/:sid` (now uses `getChatSession`) |
| POST | `/api/agents/:id/chats/:sid` | `POST /api/chat/sessions/:sid` |
| GET | `/api/agents/:id/questions` | `GET /api/questions/open` |
| POST | `/api/agents/:id/questions/:qid` | `POST /api/questions/:qid/answer` |
| GET | `/api/agents/:id/models` | **Added**: `GET /api/models` on the worker |
| GET | `/api/agents/:id/tasks` | List organizer tasks with agentId filter |

### Error Handling
If a worker agent is unreachable (offline, network error), the organizer returns `502` with `{ ok: false, error: "Agent API unreachable" }`. The dashboard displays these gracefully without crashing.

---

## 4. The Organizer Dashboard (Web UI)

**Files:** `src/organizer/web/html.ts` + `styles.ts` + `client.ts`  
**Framework:** None — vanilla JavaScript SPA, inline in TypeScript template literals  
**Theme:** GitHub-dark palette (chartreuse-free)

### HTML Shell (`html.ts`)
Minimal structure — 28-line export:
```html
<div id="app">
  <header id="topbar"></header>
  <div id="layout">
    <nav id="agent-panel"></nav>
    <main id="main-panel"></main>
  </div>
  <nav id="bottom-nav"></nav>
</div>
<div id="modal-root"></div>
<div id="toast"></div>
```
All actual UI is rendered dynamically by `client.ts`.

### CSS (`styles.ts`)
~420 lines. Key characteristics:
- **Grid-based shell**: CSS Grid for desktop (sidebar + content + detail), flex column for mobile stack
- **Mobile layout**: `#layout` flex-direction: column, agent panel capped at 35vh, `.main-view` class hides agent panel and expands main panel to full height
- **Bottom nav**: 3-button mobile nav (←Agents | Tasks | Chat) with `env(safe-area-inset-bottom)` for iPhone notch
- **Chat layout**: `.chat-outer` is flex column with `.chat-msgs` filling remaining space and `.chat-inp-area` pinned at bottom
- **Message bubbles**: User messages right-aligned with blue border, assistant messages left-aligned with monospace font
- **Touch**: all buttons/interactive elements ≥44px height
- **No horizontal overflow**: All code/diff blocks use `overflow-x: auto` with `max-height: 40-50vh`

### JavaScript SPA (`client.ts`)
~690 lines. Single state object `S` drives all rendering.

#### State Structure
```javascript
var S = {
  agents:[], tasks:[], projects:[], status:null,
  agentId:null, tab:'tasks',
  chat: { sessions:[], sid:null, msgs:[], qtns:[], sending:false, allModels:[] },
  exp:{}, tl:{}, tlQ:{},            // expanded task cards + cached timelines
  ingestOpen:false, newOpen:false,
  filter: { q:'', status:'' },
  ing: { format:'auto', text:'', implModel:'', revModel:'', maxIter:3, autoapr:false, autoapl:false, preview:null },
  typing:false, confirmCb:null
};
```

#### Views
| View | Rendered by | When shown |
|------|------------|------------|
| Empty state | `renderMainOnly()` | No agent selected |
| Tasks tab | `renderTasksTab()` | Agent selected, tab='tasks' |
| Chat tab | `renderChatTab()` | Agent selected, tab='chat' |
| Task card expanded | `renderTimeline()` | Clicking a task card header |
| Ingest panel | `renderIngestPanel()` | "Ingest Flow" button in task actions |
| New task panel | `renderNewPanel()` | "+ New Task" button |
| Agent info pane | `renderAgentInfoPane()` | Agent selected (desktop detail pane) |
| Modal confirm | `ask()` → `yesConfirm()` | Destructive actions |
| Toast | `toast()` | Success/error feedback |

#### API Calls Made by the Dashboard

| When | Path | Purpose |
|------|------|---------|
| On load + every 3s | `/api/organizer/status` | Global stats |
| On load + every 3s | `/api/agents` | Agent list |
| On load + every 3s | `/api/tasks` | All tasks |
| On load | `/api/projects` | Project list (for task creation) |
| Expand task card | `/api/tasks/:id/timeline` | Iterations + events |
| Chat tab opens | `/api/agents/:id/chats` | Load sessions |
| Session selected | `/api/agents/:id/chats/:sid` | Load messages |
| New chat session | `POST /api/agents/:id/chats` | Create session |
| Send message | `POST /api/agents/:id/chats/:sid` | Send prompt |
| Chat tab opens | `/api/agents/:id/models` | Load all provider models |
| Dispatch task | `POST /api/tasks/:id/dispatch` | Dispatch |
| Approve | `POST /api/tasks/:id/approve` | Approve |
| Restart | `POST /api/tasks/:id/restart` | Restart |
| Skip | `POST /api/tasks/:id/skip` | Skip |
| Edit policy | `PATCH /api/tasks/:id` | Update policy |
| Create task | `POST /api/tasks` | Create |
| Dispatch next | `POST /api/tasks/dispatch-next` | Dispatch |
| Import preview | `POST /api/tasks/import-preview` | Preview |
| Import | `POST /api/tasks/import` | Import |
| Assign task | `POST /api/tasks/:id/assign` | Assign |
| Render template | `POST /api/task-flow-templates/render` | Render |
| Answer question | `POST /api/agents/:id/questions/:qid` | Answer |

#### Key Features
- **Inline task expansion**: Click a task card → loads timeline via API → caches in `S.tl[id]` → renders iterations, diffs, checks, events. Collapse hides without re-fetching.
- **Policy editor**: Expand within an expanded task → inline form with auto-approve/auto-apply toggles, model fields, max iterations. Save calls `PATCH /api/tasks/:id`.
- **Ingest task flow**: Paste markdown/JSON/CSV/plain text → configure models, iterations, auto-approve → Preview calls `POST /api/tasks/import-preview` → Import calls `POST /api/tasks/import` with auto-created Default project if none exists → all tasks auto-assigned to selected agent.
- **Safe markdown**: No raw HTML injection. Handles code fences, inline code, bold, italic, bullet lists, headings. Backtick escaping solved in TS template literal with `\`` → produces literal backtick in output JS.
- **Enter to send**: Chat textarea uses `onkeydown="if(event.key==='Enter'&&!event.shiftKey){preventDefault();sendMsg();}"` — plain Enter sends, Shift+Enter for newline. Auto-resize on input.
- **Optimistic UI**: User chat messages appear immediately in the message list, then the full history refreshes from the API on response.

---

## 5. Integration Flows

### 5.1 Organizer ↔ Worker Agent

```
Organizer Dashboard (browser)
    ↓ HTTP fetch
Organizer Server (port 8787)
    ↓ workerApiClient.fetch()
Worker Agent API Server (port 31337)
    ↓ chatRuntime / taskStore / providers
Agent's SQLite DB (.agent/index.sqlite)
```

The organizer never touches the agent's SQLite directly. All data flows through the worker's API server, which enforces authentication and provides a clean REST interface.

### 5.2 TUI Chat → Organizer Dashboard Sync

```
TUI App.tsx submit()
    ↓ runAsk / runPatch → answer
    ↓ useEffect (busy→false)
    ↓ createChatSession("TUI") / addChatMessage()
Agent's SQLite (chat_sessions, chat_messages)
    ↑ GET /api/chat/sessions (via API server)
    ↑ GET /api/chat/sessions/:id (via getChatSession)
Organizer Server (proxy)
    ↓ HTTP response
Organizer Dashboard → shows "TUI" session with full message history
```

This sync is **one-directional** (TUI → dashboard). Dashboard messages go through the API server's chat system which already writes to the same DB tables, so they're visible in both the dashboard and via the API.

### 5.3 Model Sharing

```
providers/providers.ts: listProviderModels(config)
    ↓ called by:
    ├── TUI:    refreshModels() → setAvailableModels
    ├── API:    GET /api/models endpoint
    └── LAN:    GET /api/models endpoint
         ↓
    └── Organizer: GET /api/agents/:id/models (proxy → worker's /api/models)
         ↓
    └── Dashboard: loadModelList(agentId) → populates chat model selector
```

All model listings use the same `listProviderModels()` function from the providers module. The dashboard has access to the full provider model list, not just the agent's configured per-role models.

### 5.4 Chat Session Lifecycle

1. **Dashboard creates session**: Dashboard → `POST /api/agents/:id/chats` → Organizer → `POST /api/chat/sessions` → Agent → `createChatSession(db)` → returns session ID back through the chain
2. **Dashboard sends message**: Dashboard → `POST /api/agents/:id/chats/:sid` with `{prompt, actionKind, model}` → Organizer → `POST /api/chat/sessions/:sid` → Agent → `sendChatMessage()` → `runAsk()/runPatch()` → response written to `chat_messages` → session returned
3. **Dashboard loads messages**: Dashboard → `GET /api/agents/:id/chats/:sid` → Organizer → `GET /api/chat/sessions/:sid` → Agent → `getSessionWithMessages()` → returns `{session, messages, openQuestions}`
4. **TUI creates session**: TUI `useEffect` on `busy→false` → `createChatSession(db, {title:"TUI", scope:"local"})` → writes user msg + AI answer to `chat_messages` via `addChatMessage()`

### 5.5 Task Lifecycle (Organizer)

1. **Create task**: Dashboard → `POST /api/tasks` (title, prompt, mode, etc.) → Organizer → `createOrganizerTask()` → Organizer DB
2. **Assign**: `POST /api/tasks/:id/assign` → `assignOrganizerTask()` → sets `assigned_agent_id`
3. **Dispatch**: `POST /api/tasks/:id/dispatch` → `dispatchOrganizerTask()` → sends action to worker agent's `/api/actions` → worker executes → heartbeat updates iteration data back to organizer
4. **Review**: `POST /api/tasks/:id/approve` → marks task completed/auto_approved → optionally triggers auto-apply on worker
5. **Restart/Skip**: Resets task to `assigned`/`queued` status or marks as `skipped`

---

## 6. Key Files Reference

| File | Lines | Role |
|------|-------|------|
| `src/lan/server.ts` | 1821 | Agent's own web UI (chat, files, dashboard) |
| `src/api/server.ts` | 493 | Agent's REST API (used by organizer) |
| `src/organizer/server.ts` | 572 | Organizer REST API + dashboard server |
| `src/organizer/web/html.ts` | 28 | Dashboard HTML shell |
| `src/organizer/web/styles.ts` | ~420 | Dashboard CSS (GitHub-dark, responsive) |
| `src/organizer/web/client.ts` | 690 | Dashboard SPA (state, views, actions, ingest) |
| `src/organizer/workerApiClient.ts` | 143 | HTTP client to worker agent APIs |
| `src/organizer/heartbeat.ts` | 115 | Heartbeat sender (agent → organizer) |
| `src/organizer/organizerDb.ts` | 312 | Organizer's own SQLite schema + CRUD |
| `src/organizer/taskDispatcher.ts` | 382 | Task dispatch orchestration |
| `src/organizer/taskTimeline.ts` | 34 | Timeline builder (iterations + events) |
| `src/chat/chatStore.ts` | 67 | Chat session/message/question CRUD |
| `src/chat/chatRuntime.ts` | — | Chat message processing + dispatch |
| `src/tui/App.tsx` | 1769 | TUI main component (added chat session sync) |
| `src/tui/screens/OrganizerScreen.tsx` | 225 | TUI compact organizer monitor |
| `src/providers/providers.ts` | 623 | Provider registry + model listing |

---

## 7. Error Handling Patterns

All web-facing code follows these conventions:
- **API failures**: The `api()` wrapper in client.ts catches HTTP errors and `{ok:false}` responses, throws with the error message, and callers display via `toast(msg, true)` (red toast) or inline error boxes
- **Offline agents**: Organizer proxy routes return 502 with `{ok:false, error:"Agent API unreachable"}`. Dashboard renders "Agent not found" or "Chat unavailable" states
- **Missing endpoints**: Every fallible `api()` call in client.ts uses `.catch()` to fall back to defaults (empty arrays, null state). The dashboard never crashes from a missing backend route
- **SQLite errors**: DB operations are wrapped in try/catch; failure shows as empty data in the dashboard rather than crashing
- **Template literal safety**: The dashboard's client JS avoids backticks by using `\`` escape sequences in the TS template literal; the markdown renderer `md()` uses `\`\`\`` for triple-backtick matching (produces literal backtick in output JS)
