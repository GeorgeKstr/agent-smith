# AgentSmith Web UI — Missing & Broken Items

## Architecture Overview

The web UI is a **single-page vanilla JS app** served by `src/lan/server.ts` on port ~3000. There are three files:

| File | Lines | What |
|------|-------|------|
| `src/web/html.ts` | 23 | SPA shell: `#topbar`, `#sidebar`, `#main-panel`, `#bottom-nav`, `#modal-root`, `#toast` |
| `src/web/client.ts` | 317 | All client logic: tabs (Chat/Tasks/Files/Overview), polling, task cards, chat, SSE |
| `src/web/styles.ts` | 337 | Dark "Matrix" theme CSS |

The server (`src/lan/server.ts`) broadcasts state via SSE (`/api/events`) on every change. The frontend polls `/api/state` every 3 seconds and uses the SSE stream for live updates.

---

## 1. Source Code — `src/web/html.ts:1-23`

```ts
export const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0d1117">
<title>Agent Smith</title>
<link rel="stylesheet" href="_STYLE__URL_">
</head>
<body data-api-base="_API_BASE_" data-has-sidebar="_HAS_SIDEBAR_">
<div id="app">
  <header id="topbar"></header>
  <div id="layout">
    <nav id="sidebar"></nav>
    <main id="main-panel"></main>
  </div>
  <nav id="bottom-nav"></nav>
</div>
<div id="modal-root"></div>
<div id="toast" role="status" aria-live="polite"></div>
<script src="_SCRIPT__URL_"></script>
</body>
</html>`
```

---

## 2. Source Code — `src/web/client.ts:1-317`

The entire file is a single IIFE string exported as `clientJs`. Key sections:

**Line 14-25 — State object `S`:**
```javascript
var S={
  agents:[],tasks:[],projects:[],status:null,
  agentId:null,tab:'chat',
  chat:{sessions:[],sid:null,msgs:[],qtns:[],sending:false,allModels:[],model:null},
  exp:{},tl:{},tlQ:{},
  ingestOpen:false,newOpen:false,
  filter:{q:'',status:''},
  ing:{format:'auto',text:'',implModel:'',revModel:'',maxIter:3,autoapr:false,autoapl:false,preview:null},
  currentFile:null,fileContent:null,fileEditing:false,treeFilter:'',fileSummary:null,fileMimeType:null,fileIsImage:false,
  dashData:null,
  typing:false,confirmCb:null
};
```

**Line 164-178 — Tab bar rendering (main panel):**
```javascript
var h='<div class=tab-bar>'+
  '<button class="tb2'+(S.tab==='chat'?' active':'')+'" onclick="setTab(\'chat\')">Chat</button>'+
  '<button class="tb2'+(S.tab==='tasks'?' active':'')+'" onclick="setTab(\'tasks\')">Tasks ('+tasks.length+')</button>'+
  '<button class="tb2'+(S.tab==='files'?' active':'')+'" onclick="setTab(\'files\')">Files</button>'+
  '<button class="tb2'+(S.tab==='overview'?' active':'')+'" onclick="setTab(\'overview\')">Overview</button>'+
  ...
'</div><div class=tab-content id=tab-content></div>';
```

**Line 99-111 — Topbar (top status bar):**
```javascript
function renderShell(){
  var tb=$e('topbar');if(!tb)return;
  var sc=(S.status&&S.status.agents)||{},tc=(S.status&&S.status.tasks)||{};
  var on=sc.online||0,run=tc.running||0,rev=tc.needs_review||0,fail=tc.failed||0;
  tb.innerHTML='<span class=tb-logo>Agent Smith</span><span class=tb-dot>\u2022</span>'+
    (hasSidebar?'<span class="tb-stat on">'+on+'/'+S.agents.length+' agents</span>':'')+
    (run?'<span class="tb-stat run">'+run+' running</span>':'')+
    (rev?'<span class="tb-stat rev">'+rev+' review</span>':'')+
    (fail?'<span class="tb-stat err">'+fail+' failed</span>':'')+
    '<span class=tb-fill></span>'+
    '<button class=tb-icon-btn onclick=doRefresh() title=Refresh>&#8635;</button>';
  renderBottomNav();
}
```

**Line 221 — Task status filter dropdown (ONLY has organizer statuses):**
```javascript
['queued','assigned','running','reviewing','iterating','needs_review','auto_approved','completed','failed','skipped']
```

**Line 226 — Task card with Approve button (only for `needs_review`):**
```javascript
(t.status==='needs_review'?'<button class="btn btn-sm btn-success" 
 onclick="event.stopPropagation();ask(\'Approve?\',function()
 {doAct(\'/tasks/'+t.id+'/approve\',{apply:false})})">Approve</button>':'')
```

**Line 293-301 — Boot/init:**
```javascript
window.addEventListener('DOMContentLoaded',function(){
  if(!hasSidebar&&!S.agentId)S.agentId='_';
  loadModels();
  refresh(false);
  setInterval(function(){if(!S.typing&&!S.chat.sending)refresh(true);},3000);
});
```

---

## 3. Source Code — `src/web/styles.ts:1-337`

Full CSS in the Matrix dark theme. All colors use CSS variables:

```css
:root{
  --bg:#0d1117;--s1:#161b22;--s2:#21262d;--s3:#2d333b;
  --bd:#30363d;--bd-hi:#58a6ff;--tx:#c9d1d9;--tx2:#8b949e;--tx3:#484f58;
  --bright:#e6edf3;--accent:#58a6ff;--accent-dim:#1f3d6e;
  --green:#3fb950;--gd:#0d2a16;
  --yellow:#d29922;--yd:#2d1f00;
  --red:#f85149;--rd:#2d0a0a;
  --cyan:#39d0d0;
  ...
}
```

Status tags use color-coded CSS classes (lines 115-122):
```css
.stag-running,.stag-completed{background:var(--gd);color:var(--green)}
.stag-reviewing,.stag-iterating{background:var(--yd);color:var(--yellow)}
.stag-needs-review{background:var(--yd);color:var(--yellow);font-weight:700}
.stag-failed{background:var(--rd);color:var(--red)}
.stag-queued,.stag-skipped,.stag-cancelled{background:var(--s3);color:var(--tx3)}
.stag-assigned{background:var(--accent-dim);color:var(--accent)}
.stag-auto-approved{background:#0a2222;color:var(--cyan)}
```

---

## 4. What Is Broken or Missing

### 4.1 — **No Approvals tab or panel**

The web UI has 4 tabs: Chat, Tasks, Files, Overview. There is **no tab for viewing pending file operations** queued by the approval system (`src/agent/approval/approvalStore.ts`).

**Gap:** When a tool like `create_file` or `edit` queues an operation (because `approval.policy` is `on_write`), the user has **no way to approve or reject it from the web UI**. The `renderAgentResult.ts` tells users to run `smith approvals approve <id>` but that CLI command doesn't even exist yet.

**What needs adding:**
- A 5th tab called "Approvals" (or integrate into the Chat tab)
- List of `PendingFileOperation` items with: path, kind, risk, diff preview, reason
- Per-item Approve/Reject buttons
- Bulk approve-all / reject-all

### 4.2 — **No agent status `waiting_for_approval` in the filter**

The task status filter dropdown at `client.ts:221` only lists organizer task statuses:
```javascript
['queued','assigned','running','reviewing','iterating','needs_review','auto_approved','completed','failed','skipped']
```

Missing from this list:
- `waiting_for_approval` — added to `FocusedAgentStatus` in `focusedAgentLoop.ts:58`
- `waiting_for_user` — also a valid agent status
- `blocked` — added in the previous round
- `partial` — agent completed partially

### 4.3 — **No CSS for `waiting_for_approval` or `blocked` status tags**

The `stag()` helper at `client.ts:30` generates CSS classes from the status string. For `waiting_for_approval`, it would produce `stag-waiting-for-approval` — but there is **no CSS rule** for that class. It would render with default browser styling.

Missing CSS classes:
```css
.stag-waiting-for-approval{background:var(--accent-dim);color:var(--accent)}
.stag-blocked{background:var(--rd);color:var(--red)}
.stag-partial{background:var(--yd);color:var(--yellow)}
.stag-waiting-for-user{background:var(--accent-dim);color:var(--accent)}
```

### 4.4 — **No pending-approval badge in topbar**

The topbar at `client.ts:99-111` shows counts for: online agents, running tasks, review tasks, failed tasks. There is **no badge showing how many file operations are pending approval**.

### 4.5 — **No approval SSE events**

The LAN server broadcasts state changes via SSE (`/api/events`), but only for existing event types:
- `state` — full state snapshot
- `status` — partial state update
- `chat` — new chat message
- `stream` — streaming text
- `dashboard` — dashboard data

The approval store operations (`pending`, `approved`, `rejected`, `applied`) are **not broadcast**. The web UI has no way to know when new operations are queued.

### 4.6 — **No approval API endpoints**

The LAN server has no routes for the approval system:
- `GET /api/approvals` → list pending operations
- `GET /api/approvals/:id` → get operation with diff
- `POST /api/approvals/:id/approve` → approve
- `POST /api/approvals/:id/reject` → reject
- `POST /api/approvals/approve-all` → bulk approve
- `POST /api/approvals/reject-all` → bulk reject

### 4.7 — **Chat tab always sends as `runAsk()`**

At `lan/server.ts:444`, the `/api/prompt` endpoint always calls `runAsk()`:
```typescript
await runAsk({ db, root, config, events, indexer }, text, { 
  signal: currentAbort.signal, 
  modelOverride: selectedModel 
});
```

Even when the action kind is `patch` in the chat dropdown (`client.ts:203`), the server ignores it and runs `runAsk`. The action kind selector in the web UI (ask/patch/retrieve/context) is cosmetic — it does not change server behavior for the LAN server.

The chat session system (`/api/chat/sessions/:id`) does handle action kinds properly through `sendChatMessage()`, but the direct `/api/prompt` endpoint does not.

### 4.8 — **The result from a run is appended as plain chat text**

After a run completes, `lanState.answer` is set and the `onAnswer` handler appends it as a chat bubble:
```typescript
const onAnswer = (answer: string) => {
  const source = currentTaskSource === "web" ? "web" : "cli"
  lanState.answer = answer
  const last = lanState.chatLog[lanState.chatLog.length - 1]
  if (answer && (!last || last.role !== "assistant")) {
    appendChat({ role: "assistant", content: answer, ts: Date.now() }, source)
  }
  emitState()
}
```

There is no structured result rendering in the web UI. The `renderAgentResult.ts` formatter is **never called from the web path** — it's only referenced as a standalone module with no consumers wired up. The web UI just dumps raw text into chat bubbles.

This means:
- When `status === "waiting_for_approval"`, the user sees raw text: `"File changes queued for approval.\n\nQueued file creation...\n\nPending operations: op_123"`
- No approve/reject buttons appear
- No structured display of pending operations
- The old "Patch mode completion requires verified change evidence" failure text is still shown raw

### 4.9 — **No context token metrics display in web UI**

The TUI has `InfoPanel.tsx` which shows context token usage as a bar. The web UI has **no context token display**. The `context:usage` event is emitted by `focusedAgentLoop.ts` but the LAN server does not listen for it or forward it via SSE.

### 4.10 — **Files tab has no approval indicators**

The Files tab shows a file tree with file preview. It does **not** show:
- Whether a file has a pending operation queued against it
- Whether a file was recently changed by the agent
- The change history for a file

### 4.11 — **No CLI `approvals` command**

The CLI (`src/cli.ts`) registers many subcommands (`ask`, `patch`, `retrieve`, `context`, `changes`, `tasks`, etc.) but there is **no `approvals` subcommand**. The approval system tells users to run `smith approvals approve <id>` but that command doesn't exist.

### 4.12 — **Mobile bottom nav missing Approvals tab**

The mobile bottom navigation at `client.ts:118-122` shows: Chat, Tasks, Files, Overview. No Approvals tab.

---

## 5. Specific Fix Locations

### 5.1 — LAN Server: Add approval API endpoints (`src/lan/server.ts` ~line 691)

After the `GET /api/dashboard` handler:

```typescript
// Need to import: getApprovalStore from "../agent/approval/approvalStore.js"
// and applyApprovedOperation from "../agent/approval/applyOperation.js"

if (pathname === "/api/approvals" && req.method === "GET") {
  const store = getApprovalStore(root);
  const ops = await store.listPending();
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true, operations: ops }));
  return;
}

if (pathname.match(/^\/api\/approvals\/([^/]+)$/) && req.method === "GET") {
  const id = pathname.match(...)[1];
  const store = getApprovalStore(root);
  const op = await store.get(id);
  if (!op) { res.writeHead(404); res.end(JSON.stringify({error:"not found"})); return }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true, operation: op }));
  return;
}

// POST /api/approvals/:id/approve
// POST /api/approvals/:id/reject
// POST /api/approvals/approve-all
// POST /api/approvals/reject-all
```

### 5.2 — LAN Server: Broadcast approval events via SSE (`src/lan/server.ts` ~line 204)

After existing event listeners:
```typescript
events.on("approval:created", (data) => broadcast({ type: "approval:created", data }));
events.on("approval:updated", (data) => broadcast({ type: "approval:updated", data }));
```

### 5.3 — Web Client: Add Approvals tab (`src/web/client.ts` ~line 168)

In the tab bar:
```javascript
'<button class="tb2'+(S.tab==='approvals'?' active':'')+'" onclick="setTab(\'approvals\')">Approvals ('+(S.pendingOps?.length||0)+')</button>'
```

Add a `renderApprovals()` function that fetches from `/api/approvals` and renders operation cards with Approve/Reject buttons.

### 5.4 — Web Client: Add pending count to topbar (`src/web/client.ts` ~line 103)

```javascript
(pendApprovals?'<span class="tb-stat rev">'+pendApprovals+' pending approvals</span>':'')
```

### 5.5 — Web Client: Add missing status CSS (`src/web/styles.ts` ~line 122)

```css
.stag-waiting-for-approval{background:var(--accent-dim);color:var(--accent);animation:pulse 2s infinite}
.stag-blocked{background:var(--rd);color:var(--red)}
.stag-partial{background:var(--yd);color:var(--yellow)}
.stag-waiting-for-user{background:var(--accent-dim);color:var(--accent)}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.6}}
```

### 5.6 — LAN Server: Handle action kind in `/api/prompt` (`src/lan/server.ts` ~line 444)

Instead of always calling `runAsk()`, check the requested action kind and route accordingly:
```typescript
const actionKind = typeof body.actionKind === "string" ? body.actionKind : "ask";
if (actionKind === "patch") {
  await runPatch({ db, root, config, events, indexer }, text, { ... });
} else {
  await runAsk({ db, root, config, events, indexer }, text, { ... });
}
```

### 5.7 — Wire `renderAgentResult` into the web path

After `runAsk`/`runPatch` completes, call `renderAgentResult(result)` and send the formatted result to the web UI instead of raw text.

---

## 6. Summary Table

| # | Issue | Severity | Location(s) |
|---|-------|----------|-------------|
| 1 | No Approvals tab in web UI | High | `client.ts:164-178` |
| 2 | Missing statuses in filter dropdown | High | `client.ts:221` |
| 3 | No CSS for new status tags | Medium | `styles.ts:115-122` |
| 4 | No pending-approval badge in topbar | Medium | `client.ts:99-111` |
| 5 | No approval SSE events | High | `lan/server.ts:196-204` |
| 6 | No approval API endpoints | High | `lan/server.ts:687-695` |
| 7 | `/api/prompt` ignores action kind | High | `lan/server.ts:444` |
| 8 | Raw text output instead of structured render | Medium | `lan/server.ts:160-176` |
| 9 | No context token display | Low | `client.ts` — no usage |
| 10 | Files tab missing operation indicators | Low | `client.ts:249-273` |
| 11 | No CLI `approvals` command | High | `cli.ts` — missing subcommand |
| 12 | Mobile bottom nav missing Approvals | Low | `client.ts:118-122` |
