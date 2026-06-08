import http from "node:http";
import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { runAsk } from "../agent/taskRunner.js";
import { summarizeFile } from "../agent/summarizer.js";
import { listProviderModels, resolveProviderModelName } from "../providers/providers.js";
function parseOutputToChat(lines) {
    const chat = [];
    for (const line of lines) {
        if (line.startsWith("▶ ")) {
            const content = line.slice(2).replace(/^(build|discuss):\s*/, "");
            chat.push({ role: "user", content, ts: 0 });
        }
        else if (line.startsWith("> ")) {
            chat.push({ role: "user", content: line.slice(2), ts: 0 });
        }
        else if (line.startsWith("AI: ")) {
            chat.push({ role: "assistant", content: line.slice(4), ts: 0 });
        }
        else if (line.startsWith("  ") && chat.length > 0) {
            const last = chat[chat.length - 1];
            if (last.ts === 0)
                last.content += "\n" + line.trim();
        }
        else if (line.startsWith("⌘ ")) {
            chat.push({ role: "system", content: line.slice(2), ts: 0 });
        }
    }
    return chat;
}
const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0,viewport-fit=cover">
<meta name="theme-color" content="#0a0f0a">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Cpolygon points='16,3 30,10 30,22 16,29 2,22 2,10' fill='%230a0f0a' stroke='%234ade80' stroke-width='1.5'/%3E%3Ctext x='16' y='22' text-anchor='middle' font-family='system-ui' font-size='17' font-weight='700' fill='%234ade80'%3ES%3C/text%3E%3C/svg%3E">
<title>Agent Smith · __PROJECT__</title>
<style>
:root{
  --bg:#0a0f0a;--surface:#111911;--surface2:#181e18;--border:#1e2e1e;--border2:#2e422e;
  --text:#d8f0d8;--text-dim:#7ab47a;--text-muted:#4a724a;
  --accent:#4ade80;--accent2:#22c55e;--accent-dim:#14532d;
  --blue:#3b82f6;--blue-dim:#1e3a5f;
  --amber:#f59e0b;--amber-dim:#451a03;
  --red:#ef4444;--red-dim:#450a0a;
  --purple:#a855f7;--purple-dim:#2e1065;
  --radius:10px;--radius-sm:6px;
  --font:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;
  --mono:"SFMono-Regular",Consolas,"Liberation Mono",Menlo,monospace;
  --header-h:58px;--footer-h:112px;
}
*{margin:0;padding:0;box-sizing:border-box}
html,body{height:100%;background:var(--bg);overflow:hidden;color:var(--text);font-family:var(--font);font-size:14px;line-height:1.6}
a{color:var(--accent)}

/* ── Layout ─────────────────────────────────────────────── */
#app{display:flex;flex-direction:column;height:100%;max-width:980px;margin:0 auto;width:100%}

header{
  flex-shrink:0;
  background:var(--surface);
  border-bottom:1px solid var(--border);
  position:sticky;top:0;z-index:20;
  padding:0 16px;
  padding-top:env(safe-area-inset-top);
}
.header-row{display:flex;align-items:center;gap:10px;height:var(--header-h)}
.brand{display:flex;align-items:center;gap:8px;flex:1;min-width:0}
.brand-glyph{font-size:20px;color:var(--accent);flex-shrink:0}
.brand-name{font-weight:700;font-size:16px;letter-spacing:-.3px;color:var(--accent);white-space:nowrap}
.brand-sep{color:var(--text-muted);margin:0 4px;font-weight:400}
.brand-proj{color:var(--text-dim);font-size:14px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:180px}
.header-pills{display:flex;align-items:center;gap:6px;flex-shrink:0}
.pill{display:inline-flex;align-items:center;gap:4px;padding:3px 9px;border-radius:20px;font-size:11px;font-weight:600;border:1px solid transparent;white-space:nowrap}
.pill.green{background:var(--accent-dim);color:var(--accent);border-color:#166534}
.pill.amber{background:var(--amber-dim);color:var(--amber);border-color:#78350f}
.pill.red{background:var(--red-dim);color:var(--red);border-color:#7f1d1d}
.pill.gray{background:var(--surface2);color:var(--text-dim);border-color:var(--border2)}
.pill.blue{background:var(--blue-dim);color:var(--blue);border-color:#1e3a5f}
.pill .dot{width:6px;height:6px;border-radius:50%;background:currentColor}
.pill.spin .dot{animation:spin-dot .8s linear infinite}
@keyframes spin-dot{0%{transform:scale(1);opacity:1}50%{transform:scale(1.5);opacity:.5}100%{transform:scale(1);opacity:1}}

.tabs{display:flex;gap:0;border-top:1px solid var(--border)}
.tab{
  flex:1;padding:8px 0;border:none;background:transparent;color:var(--text-dim);
  font-family:var(--font);font-size:12px;font-weight:600;letter-spacing:.4px;text-transform:uppercase;
  cursor:pointer;transition:color .15s,border-color .15s;
  border-bottom:2px solid transparent;position:relative;
}
.tab.active{color:var(--accent);border-bottom-color:var(--accent)}
.tab:hover:not(.active){color:var(--text)}
.tab-badge{
  position:absolute;top:4px;right:calc(50% - 22px);
  background:var(--red);color:#fff;
  font-size:9px;font-weight:700;padding:1px 4px;border-radius:10px;
  min-width:14px;text-align:center;
  display:none;
}
.tab-badge.show{display:block}

main{flex:1;overflow:hidden;position:relative}
.panel{display:none;height:100%;flex-direction:column;overflow:hidden}
.panel.active{display:flex}

/* ── Chat panel ─────────────────────────────────────────── */
#panel-chat{flex-direction:column}

#chat-messages{
  flex:1;overflow-y:auto;overflow-x:hidden;
  padding:16px 12px 8px;
  scroll-behavior:smooth;
  display:flex;flex-direction:column;gap:10px;
}
#chat-messages::-webkit-scrollbar{width:4px}
#chat-messages::-webkit-scrollbar-track{background:transparent}
#chat-messages::-webkit-scrollbar-thumb{background:var(--border2);border-radius:4px}

.empty-state{flex:1;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:8px;color:var(--text-dim);font-size:13px;text-align:center;padding:24px;min-height:120px}
.empty-state .e-glyph{font-size:36px;opacity:.4}

/* ── Message bubbles ────────────────────────────────────── */
.msg{display:flex;flex-direction:column;max-width:82%;animation:fadeUp .18s ease}
@keyframes fadeUp{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}

.msg.user{align-self:flex-end;align-items:flex-end}
.msg.assistant,.msg.patch,.msg.system{align-self:flex-start;align-items:flex-start}

.msg-bubble{
  padding:10px 13px;border-radius:var(--radius);
  word-break:break-word;white-space:pre-wrap;font-size:13px;line-height:1.55;
  max-width:100%;
}
.msg.user .msg-bubble{background:#1e3a5f;border:1px solid #2563eb44;border-bottom-right-radius:3px;color:#bfdbfe}
.msg.user.pending .msg-bubble{background:#2a2a10;border-color:var(--amber);color:#fef3c7}
.msg.assistant .msg-bubble{background:var(--surface2);border:1px solid var(--border2);border-bottom-left-radius:3px;color:var(--text)}
.msg.patch .msg-bubble{background:#150c1f;border:1px solid #7c3aed44;border-bottom-left-radius:3px;font-family:var(--mono);font-size:11.5px;color:#c4b5fd}
.msg.system .msg-bubble{background:transparent;color:var(--text-dim);font-size:12px;font-style:italic;padding:4px 0}
.msg.system{align-self:center;align-items:center;max-width:100%}

.msg-meta{display:flex;align-items:center;gap:5px;margin-bottom:3px;font-size:10.5px;font-weight:600;padding:0 3px}
.msg.user .msg-meta{color:var(--blue);flex-direction:row-reverse}
.msg.assistant .msg-meta{color:var(--accent)}
.msg.patch .msg-meta{color:var(--purple)}
.msg-time{color:var(--text-dim);font-weight:400}
.msg-label{color:inherit}

.msg.pending .msg-meta::after{content:" ⟳";color:var(--amber);animation:pulse .7s ease-in-out infinite alternate}

/* ── Question options ─────────────────────────────────── */
.q-opts{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;padding:0 3px}
.q-btn{
  background:var(--surface2);color:var(--text);border:1px solid var(--border2);
  border-radius:var(--radius-sm);padding:6px 13px;font-family:var(--font);
  font-size:12px;font-weight:600;cursor:pointer;transition:all .12s;white-space:nowrap;
}
.q-btn:hover{background:var(--accent-dim);border-color:var(--accent);color:var(--accent)}
.q-btn:active{transform:scale(.97)}
@keyframes pulse{from{opacity:.4}to{opacity:1}}

/* code inline */
.msg-bubble code{background:#00000066;padding:1px 5px;border-radius:4px;font-family:var(--mono);font-size:11.5px}

/* ── Thinking / streaming bubble ───────────────────────── */
.thinking-cursor{display:inline-block;width:8px;height:13px;background:var(--accent);opacity:.8;margin-left:2px;animation:blink .6s step-end infinite;vertical-align:text-bottom;border-radius:1px}
@keyframes blink{0%,100%{opacity:.8}50%{opacity:0}}
.phase-label{background:var(--accent-dim);color:var(--accent);padding:1px 7px;border-radius:10px;font-size:10px}

/* ── Chat footer ────────────────────────────────────────── */
#chat-footer{
  flex-shrink:0;background:var(--surface);
  border-top:1px solid var(--border);
  padding:10px 12px 10px;
  padding-bottom:calc(10px + env(safe-area-inset-bottom));
}
.input-row{display:flex;gap:8px;align-items:flex-end}
#chat-input{
  flex:1;background:var(--surface2);color:var(--text);
  border:1px solid var(--border2);border-radius:var(--radius);
  padding:9px 13px;font-family:var(--font);font-size:14px;line-height:1.5;
  resize:none;min-height:40px;max-height:120px;overflow-y:auto;outline:none;
  transition:border-color .15s;
}
#chat-input:focus{border-color:var(--accent)}
#chat-input::placeholder{color:var(--text-muted)}
#chat-input:disabled{opacity:.4}
.input-actions{display:flex;gap:6px;align-items:center;flex-shrink:0}
.header-select{
  background:var(--surface2);color:var(--text);
  border:1px solid var(--border2);border-radius:var(--radius-sm);
  padding:5px 7px;font-family:var(--font);font-size:11px;cursor:pointer;outline:none;
  max-width:130px;min-width:60px;
}
.header-select:focus{border-color:var(--accent)}
.header-select option{background:var(--surface2)}
#send-btn{
  background:var(--accent);color:#052e16;
  border:none;border-radius:var(--radius-sm);
  padding:8px 18px;font-family:var(--font);font-size:13px;font-weight:700;
  cursor:pointer;transition:opacity .15s;white-space:nowrap;flex-shrink:0;
}
#send-btn:disabled{opacity:.25;cursor:default}
#send-btn:hover:not(:disabled){opacity:.85}
#stop-btn{
  background:var(--red-dim);color:var(--red);
  border:1px solid var(--red);border-radius:var(--radius-sm);
  padding:8px 14px;font-family:var(--font);font-size:12px;font-weight:700;
  cursor:pointer;transition:opacity .15s;white-space:nowrap;flex-shrink:0;display:none;
}
#stop-btn:hover{opacity:.8}
.status-row{
  display:flex;flex-wrap:wrap;gap:6px;
  margin-top:5px;
  font-size:11px;color:var(--text-dim);align-items:center;
}
#status-text{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.sr-right{
  margin-left:auto;display:flex;gap:6px;align-items:center;flex-shrink:0;
  background:linear-gradient(180deg,var(--surface2),#121912);
  border:1px solid var(--border2);border-radius:999px;padding:2px;
}
.si{color:var(--text-dim)}
.si.on{color:var(--accent)}
.si.busy{color:var(--amber)}
.si.err{color:var(--red)}
.si-sep{color:var(--border2)}
.footer-select{
  background:transparent;color:var(--text);
  border:1px solid transparent;border-radius:999px;
  padding:4px 26px 4px 10px;font-family:var(--font);font-size:11.5px;font-weight:600;
  cursor:pointer;outline:none;
  appearance:none;-webkit-appearance:none;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='5'%3E%3Cpath d='M0 0l4 5 4-5z' fill='%234a724a'/%3E%3C/svg%3E");
  background-repeat:no-repeat;background-position:right 8px center;
  min-width:80px;
}
.footer-select:focus{border-color:var(--accent);background:var(--surface)}
.footer-select option{background:var(--surface2);color:var(--text)}

/* ── Dashboard panel ────────────────────────────────────── */
#panel-dashboard{overflow-y:auto;overflow-x:hidden;padding:16px 12px}
#panel-dashboard::-webkit-scrollbar{width:4px}
#panel-dashboard::-webkit-scrollbar-thumb{background:var(--border2);border-radius:4px}

.section-head{
  display:flex;align-items:center;gap:8px;
  margin:20px 0 10px;font-size:11px;font-weight:700;
  color:var(--text-dim);text-transform:uppercase;letter-spacing:.7px;
}
.section-head::after{content:"";flex:1;height:1px;background:var(--border)}

.stat-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
@media(max-width:560px){.stat-grid{grid-template-columns:repeat(2,1fr)}}
.stat-card{
  background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);
  padding:14px 12px;display:flex;flex-direction:column;gap:4px;
}
.stat-value{font-size:22px;font-weight:700;color:var(--accent);line-height:1}
.stat-label{font-size:10px;color:var(--text-dim);font-weight:600;text-transform:uppercase;letter-spacing:.5px}
.stat-bar{height:3px;background:var(--border2);border-radius:2px;margin-top:6px;overflow:hidden}
.stat-bar-fill{height:100%;background:var(--accent);border-radius:2px;transition:width .4s}

.project-summary{
  background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);
  padding:12px 14px;font-size:13px;line-height:1.6;color:var(--text);margin-bottom:4px;
}

.tag-chips{display:flex;flex-wrap:wrap;gap:5px;margin:4px 0}
.chip{
  padding:3px 9px;border-radius:20px;font-size:11px;font-weight:600;
  background:var(--accent-dim);color:var(--accent);border:1px solid #166534;
}
.chip.lang{background:#1e3a5f;color:#93c5fd;border-color:#1e40af}
.chip.count{font-weight:400;color:var(--text-dim)}

.file-list{display:flex;flex-direction:column;gap:1px}
.file-row{
  display:flex;flex-direction:column;gap:3px;
  padding:9px 10px;border-radius:var(--radius-sm);
  background:var(--surface);border:1px solid transparent;
  transition:border-color .15s;cursor:default;
}
.file-row:hover{border-color:var(--border2)}
.file-row-top{display:flex;align-items:baseline;flex-wrap:wrap;gap:6px}
.file-rank{font-size:11px;color:var(--text-muted);min-width:20px;font-family:var(--mono)}
.file-path{font-family:var(--mono);font-size:12px;color:var(--blue);word-break:break-all}
.file-imp{font-size:11px;color:var(--amber)}
.file-tags{display:flex;flex-wrap:wrap;gap:4px;margin-top:2px}
.ftag{font-size:10px;background:var(--purple-dim);color:#c4b5fd;padding:1px 6px;border-radius:3px}
.ftag.test{background:#1e3a5f;color:#93c5fd}
.file-summary{font-size:12px;color:var(--text-dim);line-height:1.5;padding-left:26px}

.lang-grid{display:flex;flex-direction:column;gap:5px}
.lang-row{display:flex;align-items:center;gap:8px;font-size:12px}
.lang-name{width:120px;color:var(--text);flex-shrink:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lang-bar-wrap{flex:1;height:6px;background:var(--border2);border-radius:3px;overflow:hidden}
.lang-bar-fill{height:100%;background:var(--accent2);border-radius:3px}
.lang-count{font-size:11px;color:var(--text-dim);width:30px;text-align:right;flex-shrink:0}

/* ── Files panel ────────────────────────────────────────── */
.files-layout{display:flex;height:100%;overflow:hidden}
.files-toolbar{display:none;padding:6px;border-bottom:1px solid var(--border);background:var(--surface)}
.tree-toggle{background:var(--surface2);color:var(--text);border:1px solid var(--border2);border-radius:var(--radius-sm);padding:4px 10px;cursor:pointer;font-size:14px}
.tree-toggle:hover{background:var(--surface)}
#file-tree-panel{width:240px;flex-shrink:0;border-right:1px solid var(--border);display:flex;flex-direction:column;overflow:hidden}
.tree-search{padding:8px 8px 6px;flex-shrink:0}
#tree-search{width:100%;background:var(--surface2);color:var(--text);border:1px solid var(--border2);border-radius:var(--radius-sm);padding:5px 9px;font-size:12px;outline:none;font-family:var(--font)}
#tree-search:focus{border-color:var(--accent)}
#file-tree{flex:1;overflow-y:auto;padding:4px 0}
#file-preview-panel{flex:1;display:flex;flex-direction:column;overflow:hidden}
.preview-header{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--border);flex-shrink:0;min-height:40px}
.preview-actions{display:flex;gap:6px;margin-left:auto;flex-shrink:0}
.preview-btn{background:var(--surface2);color:var(--text-dim);border:1px solid var(--border2);border-radius:var(--radius-sm);padding:3px 10px;font-size:11px;cursor:pointer;font-family:var(--font)}
.preview-btn:hover{border-color:var(--border2);color:var(--text);background:var(--surface)}
.preview-btn.save{color:var(--accent);border-color:var(--accent)}
.preview-btn.summarize{color:var(--amber);border-color:var(--amber-dim)}
.preview-btn:disabled{opacity:.4;cursor:default}
#preview-content{flex:1;overflow:auto;padding:12px 14px;font-family:var(--mono);font-size:12px;line-height:1.6;white-space:pre;color:var(--text);margin:0;background:transparent;border:none}
#edit-content{flex:1;padding:12px 14px;font-family:var(--mono);font-size:12px;line-height:1.6;background:var(--surface2);color:var(--text);border:none;outline:none;resize:none}
.preview-empty{display:flex;align-items:center;justify-content:center;gap:8px;color:var(--text-muted);font-size:13px}
.tree-file{display:flex;align-items:center;gap:6px;padding:3px 8px;cursor:pointer;border-radius:4px;font-size:12px;color:var(--text-dim)}
.tree-file:hover,.tree-file.active{background:var(--surface2);color:var(--text)}
.tree-file.active{color:var(--accent)}
.tree-folder{display:flex;align-items:center;gap:5px;padding:3px 8px;cursor:pointer;font-size:12px;color:var(--text-muted);font-weight:600}
.tree-folder:hover{color:var(--text)}
.tree-children.collapsed{display:none}
.tree-icon{font-size:10px;flex-shrink:0;font-style:normal;width:14px;text-align:center;color:var(--text-muted)}
.tree-name{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tree-lang{font-size:10px;color:var(--text-muted);flex-shrink:0;opacity:.6}
.file-path-link{font-family:var(--mono);font-size:12px;color:var(--blue);cursor:pointer}
.file-path-link:hover{text-decoration:underline}

/* ── Scrollbar ──────────────────────────────────────────── */
*{scrollbar-width:thin;scrollbar-color:var(--border2) transparent}

/* ── Mobile overrides ───────────────────────────────────── */
@media(max-width:600px){
  .brand-name{font-size:14px}
  .brand-proj{max-width:90px;font-size:12px}
  #ollama-pill{display:none}
  #chat-messages{padding:10px 8px 6px}
  .msg{max-width:94%}
  .thinking-wrapper{max-width:94%}
  #panel-dashboard{padding:10px 8px}
  #chat-footer{padding:8px 8px 8px;padding-bottom:calc(8px + env(safe-area-inset-bottom))}
  .status-row{gap:8px}
  #status-text{flex:1 1 100%;font-size:10.5px;line-height:1.3}
  .sr-right{margin-left:0;width:100%;display:grid;grid-template-columns:1fr 1fr;border-radius:12px;padding:4px;background:var(--surface2)}
  .footer-select{width:100%;min-width:0;border:1px solid var(--border2);border-radius:9px;padding:7px 24px 7px 10px;font-size:11px;background:var(--surface)}
  .stat-grid{grid-template-columns:repeat(2,1fr)}
  .files-toolbar{display:flex}
  #file-tree-panel.collapsed{display:none}
  #file-tree-panel:not(.collapsed)~#file-preview-panel .preview-actions{display:none!important}
}
</style>
</head>
<body>
<div id="app">

  <header>
    <div class="header-row">
      <div class="brand">
        <span class="brand-glyph">◈</span>
        <span class="brand-name">Agent Smith</span>
        <span class="brand-sep">/</span>
        <span class="brand-proj">__PROJECT__</span>
      </div>
      <div class="header-pills" id="header-pills">
        <span class="pill gray" id="ollama-pill">Ollama …</span>
        <span class="pill gray" id="busy-pill">Ready</span>
      </div>
    </div>
    <nav class="tabs">
      <button class="tab active" data-tab="chat">Chat<span class="tab-badge" id="chat-badge">0</span></button>
      <button class="tab" data-tab="dashboard">Dashboard</button>
      <button class="tab" data-tab="files">Files</button>
    </nav>
  </header>

  <main>
    <!-- Chat panel -->
    <div id="panel-chat" class="panel active" style="flex-direction:column">
      <div id="chat-messages">
        <div class="empty-state" id="chat-empty">
          <span class="e-glyph">◈</span>
          <span>No messages yet.<br>Start a conversation below.</span>
        </div>
      </div>
      <!-- Sticky input footer -->
      <div id="chat-footer">
        <div class="input-row">
          <textarea id="chat-input" rows="1" placeholder="Ask about the codebase, or type /help…" disabled></textarea>
          <div class="input-actions">
            <button id="send-btn" disabled>Send</button>
            <button id="stop-btn">■ Stop</button>
          </div>
        </div>
        <div class="status-row">
          <span id="status-text"></span>
          <span class="sr-right">
            <select id="model-select" class="footer-select" title="Model"></select>
            <select id="mode-select" class="footer-select">
              <option value="discuss">Discuss</option>
              <option value="build">Build</option>
            </select>
          </span>
        </div>
      </div>
    </div>

    <!-- Dashboard panel -->
    <div id="panel-dashboard" class="panel"></div>

    <!-- Files panel -->
    <div id="panel-files" class="panel">
      <div class="files-toolbar">
        <button class="tree-toggle" id="tree-toggle" title="Toggle file tree">☰</button>
      </div>
      <div class="files-layout">
        <div id="file-tree-panel">
          <div class="tree-search">
            <input type="text" id="tree-search" placeholder="Filter files…" autocomplete="off">
          </div>
          <div id="file-tree"><div class="preview-empty">Loading…</div></div>
        </div>
        <div id="file-preview-panel">
          <div class="preview-header">
            <span id="preview-path" style="color:var(--text-muted);font-style:italic">No file selected</span>
            <div class="preview-actions">
              <button class="preview-btn" id="view-summary-btn" style="display:none">View Summary</button>
              <button class="preview-btn summarize" id="summarize-file-btn" style="display:none">Summarize</button>
              <button class="preview-btn" id="edit-toggle" style="display:none">Edit</button>
              <button class="preview-btn save" id="save-file-btn" style="display:none">Save</button>
            </div>
          </div>
          <div id="preview-summary" style="display:none;padding:8px 14px;font-size:12px;line-height:1.6;color:var(--text-dim);border-bottom:1px solid var(--border);background:var(--surface)"></div>
          <pre id="preview-content" class="preview-empty" style="display:flex"><span class="e-glyph" style="font-size:28px;opacity:.3">◈</span><span>Select a file from the tree</span></pre>
          <textarea id="edit-content" style="display:none"></textarea>
        </div>
      </div>
    </div>
  </main>
</div>

<script>
const S={
  scanPhase:"",scanProgress:0,scanScanned:0,scanTotal:0,
  ollamaReady:null,phase:"",intent:null,packet:null,
  answer:"",patchText:"",output:[],busy:false,mode:"build",modelOverride:null,uptime:0,
  chatLog:[]
}
let dashData=null
let streamTokCount=0
let streamStartMs=0
let unreadChat=0
let activeTab="chat"
let pendingUserMsg=null
let thinkingActive=false
let chatInitialized=false
let currentFilePath=null
let currentFileContent=null
let currentFileSummary=null

/* ── Helpers ───────────────────────────────────────────── */
function esc(s){const d=document.createElement("div");d.textContent=s||"";return d.innerHTML}
function ts(t){if(!t)return"";const d=new Date(t);return d.getHours().toString().padStart(2,"0")+":"+d.getMinutes().toString().padStart(2,"0")}
function fmtDur(s){if(s<60)return s+"s";return Math.floor(s/60)+"m "+String(s%60).padStart(2,"0")+"s"}
function dateLabel(t){
  const d=new Date(t),now=new Date()
  const diff=now-d
  if(diff<864e5)return"Today"
  if(diff<1728e5)return"Yesterday"
  return d.toLocaleDateString()
}

/* ── Header pills ──────────────────────────────────────── */
  function updateHeader(){
  const op=document.getElementById("ollama-pill")
  const bp=document.getElementById("busy-pill")
  if(op){
    if(S.ollamaReady===true){op.className="pill green";op.innerHTML='<span class="dot"></span>Provider'}
    else if(S.ollamaReady===false){op.className="pill red";op.innerHTML='<span class="dot"></span>Offline'}
    else{op.className="pill gray";op.textContent="Provider …"}
  }
  if(bp){
    if(S.busy){
      const lbl=S.phase&&S.phase!=="idle"?S.phase:"busy"
      bp.className="pill amber spin";bp.innerHTML='<span class="dot"></span>'+esc(lbl)
    }else{
      bp.className="pill green";bp.innerHTML='<span class="dot"></span>Ready'
    }
  }
  const msel=document.getElementById("mode-select")
  if(msel&&msel.value!==S.mode)msel.value=S.mode
}

/* ── Chat input UI ─────────────────────────────────────── */
function updateInputUI(){
  const inp=document.getElementById("chat-input")
  const btn=document.getElementById("send-btn")
  const stop=document.getElementById("stop-btn")
  if(!inp)return
  inp.disabled=false
  const isSlash=inp.value.trim().startsWith("/")
  if(btn)btn.disabled=(!isSlash&&S.busy)||!inp.value.trim()
  if(stop)stop.style.display=S.busy?"inline-block":"none"
}

/* ── Status bar ────────────────────────────────────────── */
function renderStatus(){
  updateHeader()
  updateInputUI()
  const bar=document.getElementById("status-text")
  if(!bar)return
  const items=[]
  const uptime=Math.floor((Date.now()-S.uptime)/1000)
  if(S.scanPhase&&S.scanPhase!=="idle"&&S.scanPhase!=="ready"){
    items.push('<span class="si on">scan:'+esc(S.scanPhase)+" "+S.scanScanned+"/"+S.scanTotal+'</span>')
    items.push('<span class="si-sep">·</span>')
  }
  if(S.busy&&S.phase&&S.phase!=="idle"){
    items.push('<span class="si busy">'+esc(S.phase)+'</span>')
    items.push('<span class="si-sep">·</span>')
  }
  items.push('<span class="si">uptime '+esc(fmtDur(uptime))+'</span>')
  if(S.packet&&S.packet.estimatedTokens>0){
    items.push('<span class="si-sep">·</span>')
    items.push('<span class="si">ctx '+S.packet.estimatedTokens+' tok</span>')
  }
  bar.innerHTML=items.join("")
}

/* ── Question/quiz parsing ─────────────────────────────── */
function parseQuestionBlock(text){
  const lines=text.split('\n')
  let q=null
  const opts=[]
  for(const line of lines){
    const t=line.trim()
    const qm=t.match(/^\?\s*(.+)/)
    if(qm){q=qm[1];continue}
    const om=t.match(/^[-*]\s+(.+)/)
    if(om&&q){opts.push(om[1]);continue}
    if(q&&opts.length>0&&t)break
  }
  return q&&opts.length>0?{question:q,options:opts}:null
}

function renderQuestionOptions(qBlock,msgIdx){
  if(!qBlock||!qBlock.options.length)return''
  return '<div class="q-opts" data-msg-idx="'+msgIdx+'">'+
    qBlock.options.map((o,i)=>'<button class="q-btn" onclick="selectOption('+msgIdx+','+i+')" data-idx="'+i+'">'+esc(o)+'</button>').join('')+
    '</div>'
}

function selectOption(msgIdx,optIdx){
  const opts=document.querySelectorAll('.q-opts[data-msg-idx="'+msgIdx+'"] .q-btn')
  const text=opts[optIdx]?.textContent
  if(!text)return
  const inp=document.getElementById("chat-input")
  if(inp){inp.value=text;resizeInput(inp);send()}
}

/* ── Chat rendering ────────────────────────────────────── */
function msgHTML(m,pendingLast,msgIdx){
  const timeStr=ts(m.ts)
  const labels={user:"You",assistant:"Smith",patch:"Patch",system:"System"}
  const label=labels[m.role]||m.role
  const cls="msg "+m.role+(m.role==="user"&&pendingLast?" pending":"")
  if(m.role==="system")return '<div class="msg system"><div class="msg-bubble">'+esc(m.content)+'</div></div>'
  const qBlock=m.role==="assistant"?parseQuestionBlock(m.content):null
  const contentText=qBlock?m.content.replace(/^\?[^\n]*\n?/m,'').replace(/^[-*]\s+[^\n]*\n?/gm,'').trim():m.content
  return '<div class="'+cls+'">'+
    '<div class="msg-meta">'+
      '<span class="msg-label">'+esc(label)+'</span>'+
      (timeStr?'<span class="msg-time">'+timeStr+'</span>':'')+
    '</div>'+
    '<div class="msg-bubble">'+esc(contentText||m.content)+(qBlock?'':'')+'</div>'+
    (qBlock?renderQuestionOptions(qBlock,msgIdx):'')+
  '</div>'
}

let lastRenderDateLabel=""
function fullChatHTML(log){
  if(!log||log.length===0)return""
  let html=""
  lastRenderDateLabel=""
  for(let i=0;i<log.length;i++){
    const m=log[i]
    if(m.ts){
      const dl=dateLabel(m.ts)
      if(dl!==lastRenderDateLabel){
        lastRenderDateLabel=dl
        html+='<div style="text-align:center;font-size:10px;color:var(--text-muted);margin:8px 0;letter-spacing:.4px">'+esc(dl)+'</div>'
      }
    }
    html+=msgHTML(m,S.busy&&i===log.length-1&&m.role==="user",i)
  }
  return html
}

function renderChat(){
  const box=document.getElementById("chat-messages")
  const empty=document.getElementById("chat-empty")
  const log=S.chatLog
  if(!log||log.length===0){
    box.innerHTML=""
    if(empty){empty.style.display="";box.appendChild(empty)}
    if(thinkingActive)ensureThinkingBubble()
    return
  }
  if(empty)empty.style.display="none"
  box.innerHTML=fullChatHTML(log)
  if(thinkingActive)ensureThinkingBubble()
  scrollToBottom()
}

function scrollToBottom(){
  const box=document.getElementById("chat-messages")
  if(box)box.scrollTop=box.scrollHeight
}

function appendChatMsg(m){
  // Dedup: if server confirms a user msg we already added locally, update ts and skip
  if(m.role==="user"){
    const idx=S.chatLog.findIndex(x=>x.role==="user"&&x.content===m.content)
    if(idx>=0){
      if(m.ts)S.chatLog[idx].ts=m.ts
      if(pendingUserMsg&&pendingUserMsg.content===m.content)pendingUserMsg=null
      renderChat()
      return
    }
  }
  S.chatLog.push(m)
  const box=document.getElementById("chat-messages")
  const empty=document.getElementById("chat-empty")
  if(empty)empty.style.display="none"
  const atBottom=box.scrollHeight-box.scrollTop-box.clientHeight<80
  const isPending=S.busy&&m.role==="user"
  const msgIdx=S.chatLog.length-1
  const div=document.createElement("div")
  const qBlock=m.role==="assistant"?parseQuestionBlock(m.content):null
  const contentText=qBlock?m.content.replace(/^\?[^\n]*\n?/m,'').replace(/^[-*]\s+[^\n]*\n?/gm,'').trim():m.content
  if(m.role==="system"){
    div.className="msg system"
    div.innerHTML='<div class="msg-bubble">'+esc(m.content)+'</div>'
  }else{
    div.className="msg "+m.role+(isPending?" pending":"")
    div.innerHTML=
      '<div class="msg-meta"><span class="msg-label">'+esc({user:"You",assistant:"Smith",patch:"Patch"}[m.role]||m.role)+'</span>'+
      (m.ts?'<span class="msg-time">'+ts(m.ts)+'</span>':'')+
      '</div><div class="msg-bubble">'+esc(contentText||m.content)+'</div>'+
      (qBlock?renderQuestionOptions(qBlock,msgIdx):'')
  }
  box.appendChild(div)
  if(atBottom)scrollToBottom()
  // Unread badge if user is on dashboard tab
  if(activeTab!=="chat"&&m.role!=="system"){
    unreadChat++
    const badge=document.getElementById("chat-badge")
    if(badge){badge.textContent=String(unreadChat);badge.classList.add("show")}
  }
}

function setPendingClass(val){
  const box=document.getElementById("chat-messages")
  if(!box)return
  const userMsgs=box.querySelectorAll(".msg.user")
  if(userMsgs.length===0)return
  const last=userMsgs[userMsgs.length-1]
  if(val)last.classList.add("pending")
  else last.classList.remove("pending")
}

/* ── Thinking bubble ───────────────────────────────────── */
function ensureThinkingBubble(){
  const box=document.getElementById("chat-messages")
  if(!box)return
  if(document.getElementById("thinking-bubble"))return
  const empty=document.getElementById("chat-empty")
  if(empty)empty.style.display="none"
  const el=document.createElement("div")
  el.id="thinking-bubble"
  el.className="msg assistant"
  el.innerHTML='<div class="msg-meta"><span class="msg-label">Smith</span><span class="phase-label" id="thinking-phase">thinking</span><span class="tok-count" id="thinking-toks" style="margin-left:auto;color:var(--text-muted);font-weight:400"></span></div><div class="msg-bubble" id="thinking-text" style="max-height:160px;overflow-y:auto;color:var(--text-dim)"><span class="thinking-cursor"></span></div>'
  box.appendChild(el)
  scrollToBottom()
}
function showThinking(show){
  if(show){
    thinkingActive=true
    if(!streamStartMs){streamStartMs=Date.now();streamTokCount=0}
    ensureThinkingBubble()
  }else{
    thinkingActive=false
    const el=document.getElementById("thinking-bubble")
    if(el)el.remove()
    streamTokCount=0
    streamStartMs=0
  }
}

function updateStreamText(text){
  if(!text)return
  streamTokCount++
  const el=document.getElementById("thinking-text")
  if(!el)return
  const elapsed=streamStartMs?(Date.now()-streamStartMs)/1000:0
  const tps=elapsed>0.2?Math.round(streamTokCount/elapsed*10)/10:0
  const tok=document.getElementById("thinking-toks")
  if(tok&&streamTokCount>0)tok.textContent=streamTokCount+" tok"+(tps>0?" · "+tps+" t/s":"")
  el.textContent=text
  el.appendChild(Object.assign(document.createElement("span"),{className:"thinking-cursor"}))
  el.scrollTop=el.scrollHeight
  const box=document.getElementById("chat-messages")
  if(box){const atBottom=box.scrollHeight-box.scrollTop-box.clientHeight<120;if(atBottom)scrollToBottom()}
}

function updateThinkingPhase(phase){
  const lbl=document.getElementById("thinking-phase")
  if(lbl&&phase&&phase!=="idle")lbl.textContent=phase
}

/* ── Dashboard ─────────────────────────────────────────── */
function renderDashboard(){
  const el=document.getElementById("panel-dashboard")
  if(!dashData){el.innerHTML='<div class="empty-state" style="flex-direction:column;gap:8px;padding:40px"><span class="e-glyph" style="font-size:36px">◈</span><span>Loading dashboard…</span></div>';return}
  const d=dashData
  const sumPct=d.totalFiles>0?Math.min(100,Math.round(d.totalWithSummary/d.totalFiles*100)):0
  let html=""

  /* Stats */
  html+='<div class="stat-grid">'
  for(const [val,lbl,pct] of [
    [d.totalFiles,"Files",null],
    [d.totalSymbols||0,"Symbols",null],
    [d.totalImports||0,"Imports",null],
    [sumPct+"%","Summarized",sumPct]
  ]){
    html+='<div class="stat-card">'
    html+='<div class="stat-value">'+esc(String(val))+'</div>'
    html+='<div class="stat-label">'+esc(lbl)+'</div>'
    if(pct!==null)html+='<div class="stat-bar"><div class="stat-bar-fill" style="width:'+pct+'%"></div></div>'
    html+='</div>'
  }
  html+='</div>'

  /* Project summary */
  html+='<div class="section-head">Project Summary</div>'
  html+='<div class="project-summary">'+(d.projectSummary?esc(d.projectSummary):'<span style="color:var(--text-muted)">Not yet generated — indexing in progress.</span>')+'</div>'

  /* Languages */
  if(d.langCounts&&d.langCounts.length>0){
    html+='<div class="section-head">Languages</div>'
    const maxCount=d.langCounts[0]?.count||1
    html+='<div class="lang-grid">'
    for(const l of d.langCounts.slice(0,12)){
      const pct=Math.round(l.count/maxCount*100)
      html+='<div class="lang-row"><div class="lang-name">'+esc(l.language)+'</div>'
      html+='<div class="lang-bar-wrap"><div class="lang-bar-fill" style="width:'+pct+'%"></div></div>'
      html+='<div class="lang-count">'+l.count+'</div></div>'
    }
    html+='</div>'
  }

  /* Tags */
  if(d.topTags&&d.topTags.length>0){
    html+='<div class="section-head">Key Tags</div>'
    html+='<div class="tag-chips">'
    for(const t of d.topTags)html+='<span class="chip">'+esc(t.name)+' <span class="count" style="opacity:.6">'+t.count+'</span></span>'
    html+='</div>'
  }

  /* Top files */
  const top20=[...(d.files||[])].filter(f=>f.summary).sort((a,b)=>b.importance-a.importance).slice(0,20)
  html+='<div class="section-head">Top Files by Importance</div>'
  if(top20.length===0){html+='<div style="color:var(--text-muted);font-size:12px;padding:8px 0">No summaries yet — indexing in progress.</div>'}
  else{
    html+='<div class="file-list">'
    for(let i=0;i<top20.length;i++){
      const f=top20[i]
      const stars=f.importance>=8?"★★★":f.importance>=5?"★★":f.importance>=3?"★":""
      html+='<div class="file-row">'
      html+='<div class="file-row-top">'
      html+='<span class="file-rank">'+(i+1)+'.</span>'
      html+='<span class="file-path" data-file="'+esc(f.path)+'" title="Open file">'+esc(f.path)+'</span>'
      if(stars)html+='<span class="file-imp">'+stars+'</span>'
      html+='</div>'
      if(f.tags&&f.tags.length>0){
        html+='<div class="file-tags">'
        if(f.isTest)html+='<span class="ftag test">test</span>'
        for(const t of f.tags.slice(0,5))html+='<span class="ftag">'+esc(t)+'</span>'
        html+='</div>'
      }
      if(f.summary)html+='<div class="file-summary">'+esc(f.summary)+'</div>'
      html+='</div>'
    }
    html+='</div>'
  }
  html+='<div style="height:24px"></div>'
  el.innerHTML=html
}

/* ── File tree ────────────────────────────────────────── */
function getFileIcon(ext){
  const m={ts:'ts',tsx:'tsx',js:'js',jsx:'jsx',py:'py',go:'go',rs:'rs',
    json:'{}',yaml:'yml',yml:'yml',md:'md',html:'htm',css:'css',scss:'css',
    sh:'sh',txt:'txt',sql:'sql',c:'c',cpp:'c++'}
  return m[(ext||'').toLowerCase()]||'·'
}
function buildFileTree(files){
  const tree={}
  for(const f of files){
    let _p=f.path;if(_p.startsWith('./'))_p=_p.slice(2);else if(_p.startsWith('/'))_p=_p.slice(1)
    const parts=_p.split('/')
    let node=tree
    for(let i=0;i<parts.length-1;i++){
      if(!node[parts[i]])node[parts[i]]={__dir:true,__ch:{}}
      node=node[parts[i]].__ch
    }
    const fn=parts[parts.length-1]
    node[fn]={__file:true,path:f.path,lang:f.language}
  }
  return tree
}
function renderTreeNode(name,node,depth){
  if(node.__file){
    const ext=(name.split('.').pop()||'')
    return '<div class="tree-file" data-file="'+esc(node.path)+'" style="padding-left:'+(depth*14+8)+'px">'+
      '<span class="tree-icon">'+getFileIcon(ext)+'</span>'+
      '<span class="tree-name">'+esc(name)+'</span>'+
      (node.lang?'<span class="tree-lang">'+esc(node.lang)+'</span>':'')+
      '</div>'
  }
  const id='fd'+Math.random().toString(36).slice(2)
  const ch=node.__ch||{}
  const sorted=Object.entries(ch).sort(([a,an],[b,bn])=>{
    const af=an.__file,bf=bn.__file
    if(af!==bf)return af?1:-1
    return a.localeCompare(b)
  })
  return '<div class="tree-folder" data-folder="'+id+'" style="padding-left:'+(depth*14+6)+'px">'+
    '<span class="tree-icon">▾</span><span class="tree-name">'+esc(name)+'</span>'+
    '</div>'+
    '<div class="tree-children" id="'+id+'">'+
    sorted.map(([n,nd])=>renderTreeNode(n,nd,depth+1)).join('')+
    '</div>'
}
async function fetchFileTree(){
  try{
    const r=await fetch('/api/filetree')
    const d=await r.json()
    const el=document.getElementById('file-tree')
    if(!el)return
    const files=d.files||[]
    if(!files.length){el.innerHTML='<div class="preview-empty" style="padding:16px;font-size:12px">No indexed files yet.</div>';return}
    const tree=buildFileTree(files)
    const sorted=Object.entries(tree).sort(([a,an],[b,bn])=>{
      const af=an.__file,bf=bn.__file
      if(af!==bf)return af?1:-1
      return a.localeCompare(b)
    })
    el.innerHTML=sorted.map(([n,nd])=>renderTreeNode(n,nd,0)).join('')
  }catch{}
}
function filterTree(q){
  const lq=q.toLowerCase()
  document.querySelectorAll('#file-tree .tree-file').forEach(el=>{
    el.style.display=(!lq||el.dataset.file.toLowerCase().includes(lq))?'':'none'
  })
  document.querySelectorAll('#file-tree .tree-folder').forEach(el=>{
    const sib=el.nextElementSibling
    if(sib&&sib.classList.contains('tree-children')){
      const any=[...sib.querySelectorAll('.tree-file')].some(f=>f.style.display!=='none')
      el.style.display=(any||!lq)?'':'none'
      if(lq)sib.classList.remove('collapsed')
    }
  })
}
async function openFile(filePath){
  // Switch to Files tab
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'))
  document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'))
  const fTab=document.querySelector('.tab[data-tab="files"]')
  const fPanel=document.getElementById('panel-files')
  if(fTab)fTab.classList.add('active')
  if(fPanel)fPanel.classList.add('active')
  activeTab='files'
  // Highlight in tree
  document.querySelectorAll('#file-tree .tree-file').forEach(f=>f.classList.remove('active'))
  const treeEl=document.querySelector('#file-tree .tree-file[data-file="'+CSS.escape(filePath)+'"]')
  if(treeEl){
    treeEl.classList.add('active')
    treeEl.scrollIntoView({block:'nearest'})
    let p=treeEl.parentElement
    while(p){
      if(p.classList&&p.classList.contains('tree-children'))p.classList.remove('collapsed')
      p=p.parentElement
    }
  }
  // Reset UI
  const pathEl=document.getElementById('preview-path')
  const pre=document.getElementById('preview-content')
  const sumDiv=document.getElementById('preview-summary')
  const textarea=document.getElementById('edit-content')
  const editBtn=document.getElementById('edit-toggle')
  const saveBtn=document.getElementById('save-file-btn')
  const sumBtn=document.getElementById('summarize-file-btn')
  const viewSumBtn=document.getElementById('view-summary-btn')
  if(pathEl)pathEl.textContent=filePath
  if(pathEl)pathEl.style.cssText='font-family:var(--mono);font-size:12px;color:var(--blue);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1'
  if(pre){pre.textContent='Loading…';pre.className='';pre.style.display=''}
  if(sumDiv)sumDiv.style.display='none'
  if(textarea)textarea.style.display='none'
  if(editBtn){editBtn.textContent='Edit';editBtn.style.display=''}
  if(saveBtn)saveBtn.style.display='none'
  if(viewSumBtn){viewSumBtn.style.display='none';viewSumBtn.textContent='View Summary'}
  if(sumBtn){sumBtn.style.display='';sumBtn.textContent='Summarize'}
  currentFilePath=filePath
  currentFileContent=null
  currentFileSummary=null
  try{
    const r=await fetch('/api/file?path='+encodeURIComponent(filePath))
    const d=await r.json()
    currentFileContent=d.content
    currentFileSummary=d.summary||null
    if(pre)pre.textContent=d.content
    if(d.summary){
      if(viewSumBtn){viewSumBtn.style.display='';viewSumBtn.textContent='View Summary'}
      if(sumBtn)sumBtn.textContent='↻'
    }
  }catch{
    if(pre)pre.textContent='Error loading file.'
  }
}
function toggleEdit(){
  const pre=document.getElementById('preview-content')
  const textarea=document.getElementById('edit-content')
  const editBtn=document.getElementById('edit-toggle')
  const saveBtn=document.getElementById('save-file-btn')
  if(!pre||!textarea)return
  const toEdit=editBtn&&editBtn.textContent==='Edit'
  if(toEdit){
    textarea.value=currentFileContent||''
    pre.style.display='none'
    textarea.style.display=''
    if(editBtn)editBtn.textContent='View'
    if(saveBtn)saveBtn.style.display=''
  }else{
    pre.style.display=''
    textarea.style.display='none'
    if(editBtn)editBtn.textContent='Edit'
    if(saveBtn)saveBtn.style.display='none'
  }
}
async function summarizeCurrentFile(){
  if(!currentFilePath)return
  const sumBtn=document.getElementById('summarize-file-btn')
  const viewSumBtn=document.getElementById('view-summary-btn')
  if(sumBtn){sumBtn.disabled=true;sumBtn.textContent='Summarizing…'}
  if(viewSumBtn)viewSumBtn.style.display='none'
  try{
    const r=await fetch('/api/command',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({command:'summarize',args:currentFilePath})})
    const d=await r.json()
    if(d.ok){
      currentFileSummary='(refreshing…)'
      // Re-fetch to get updated summary
      const rr=await fetch('/api/file?path='+encodeURIComponent(currentFilePath))
      const dd=await rr.json()
      currentFileSummary=dd.summary||null
      if(currentFileSummary){
        if(viewSumBtn){viewSumBtn.style.display='';viewSumBtn.textContent='View Summary'}
        if(sumBtn)sumBtn.textContent='↻'
      }else{
        if(sumBtn)sumBtn.textContent='Summarize'
      }
    }else{
      if(sumBtn)sumBtn.textContent='Error!'
      setTimeout(()=>{if(sumBtn&&sumBtn.textContent==='Error!')sumBtn.textContent='Summarize'},2500)
    }
  }catch{
    if(sumBtn)sumBtn.textContent='Error!'
    setTimeout(()=>{if(sumBtn&&sumBtn.textContent==='Error!')sumBtn.textContent='Summarize'},2500)
  }finally{
    if(sumBtn)sumBtn.disabled=false
  }
}
function viewSummary(){
  const sumDiv=document.getElementById('preview-summary')
  const pre=document.getElementById('preview-content')
  const viewSumBtn=document.getElementById('view-summary-btn')
  if(!sumDiv||!viewSumBtn)return
  if(sumDiv.style.display==='none'){
    if(!currentFileSummary)return
    sumDiv.textContent=currentFileSummary
    sumDiv.style.display=''
    if(viewSumBtn)viewSumBtn.textContent='Hide Summary'
  }else{
    sumDiv.style.display='none'
    if(viewSumBtn)viewSumBtn.textContent='View Summary'
  }
}

async function saveFile(){
  if(!currentFilePath)return
  const textarea=document.getElementById('edit-content')
  const saveBtn=document.getElementById('save-file-btn')
  if(!textarea)return
  const content=textarea.value
  if(saveBtn){saveBtn.disabled=true;saveBtn.textContent='Saving…'}
  try{
    const r=await fetch('/api/file',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:currentFilePath,content})})
    const d=await r.json()
    if(d.ok){
      currentFileContent=content
      const pre=document.getElementById('preview-content')
      if(pre)pre.textContent=content
      if(saveBtn){saveBtn.textContent='Saved ✓';setTimeout(()=>{if(saveBtn&&saveBtn.textContent==='Saved ✓')saveBtn.textContent='Save'},2000)}
    }
  }catch{
    if(saveBtn)saveBtn.textContent='Error!'
  }finally{
    if(saveBtn)saveBtn.disabled=false
  }
}
/* ── Models ───────────────────────────────────────────── */
let _fetchModelsReq = 0
async function fetchModels(){
  const req = ++_fetchModelsReq
  try{
    const r=await fetch("/api/models")
    if (req !== _fetchModelsReq) return
    const d=await r.json()
    const sel=document.getElementById("model-select")
    if(!sel||!Array.isArray(d.models))return
    const selected=(typeof d.selected==="string"&&d.selected.trim())?d.selected.trim():(S.modelOverride||"")
    sel.innerHTML=d.models.map(m=>'<option value="'+esc(m)+'"'+(m===selected?' selected':'')+'>'+esc(m)+'</option>').join("")
    if(selected&&d.models.includes(selected))sel.value=selected
    else if(d.models[0])sel.value=d.models[0]
  }catch{}
}

/* ── SSE ───────────────────────────────────────────────── */
let evtSrc=null
function connectSSE(){
  if(evtSrc)evtSrc.close()
  evtSrc=new EventSource("/api/events")
  evtSrc.onmessage=e=>{
    try{
      const ev=JSON.parse(e.data)
      if(ev.type==="state"){
        const prev=S.busy
        const prevModel=S.modelOverride
        const serverChatLog=ev.data.chatLog
        const {chatLog:_cl,...rest}=ev.data
        Object.assign(S,rest)
        S.uptime=ev.data.uptime||S.uptime
        if(prevModel!==S.modelOverride)fetchModels()
        if(!chatInitialized){
          S.chatLog=serverChatLog||[]
          chatInitialized=true
        }
        if(pendingUserMsg){
          const found=S.chatLog.some(m=>m.role==="user"&&m.content===pendingUserMsg.content)
          if(!found)S.chatLog=[...S.chatLog,pendingUserMsg]
        }
        if(!prev&&S.busy)showThinking(true)
        if(prev&&!S.busy){showThinking(false);pendingUserMsg=null}
        updateThinkingPhase(S.phase)
        renderChat();renderStatus()
      }else if(ev.type==="stream"){
        updateStreamText(ev.data.text)
        updateThinkingPhase(S.phase)
      }else if(ev.type==="dashboard"){
        dashData=ev.data;renderDashboard()
      }else if(ev.type==="chat"){
        if(Array.isArray(ev.data)){ev.data.forEach(m=>appendChatMsg(m))}
        else appendChatMsg(ev.data)
      }else if(ev.type==="status"){
        Object.assign(S,ev.data)
        if(ev.data.phase)updateThinkingPhase(ev.data.phase)
        renderStatus()
      }
    }catch{}
  }
  evtSrc.onerror=()=>{setTimeout(connectSSE,3000)}
}

async function fetchState(){
  try{
    const r=await fetch("/api/state"),d=await r.json()
    const prevModel=S.modelOverride
    const {chatLog:serverChatLog,...rest}=d
    Object.assign(S,rest);S.uptime=d.uptime||Date.now()
    if(prevModel!==S.modelOverride)fetchModels()
    if(!chatInitialized){
      S.chatLog=serverChatLog||[]
      chatInitialized=true
    }
    renderChat();renderStatus()
  }catch{}
}
async function fetchDashboard(){
  try{
    const r=await fetch("/api/dashboard");dashData=await r.json();renderDashboard()
  }catch{}
}

/* ── Auto-resize textarea ──────────────────────────────── */
function resizeInput(el){
  el.style.height="auto"
  el.style.height=Math.min(el.scrollHeight,120)+"px"
}

/* ── Send ──────────────────────────────────────────────── */
async function send(){
  const inp=document.getElementById("chat-input")
  if(!inp)return
  const text=inp.value.trim()
  if(!text)return
  if(S.busy&&!text.startsWith("/"))return
  inp.value="";resizeInput(inp);updateInputUI()
  if(text.startsWith("/")){
    if(text==="/clear"){
      S.chatLog=[];chatInitialized=false;pendingUserMsg=null
      renderChat()
      fetch("/api/command",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({command:"clear"})}).catch(()=>{})
      return
    }
    if(text.startsWith("/mode ")){
      const m=text.slice(6).trim()
      if(m==="build"||m==="discuss"){
        await fetch("/api/command",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({command:"mode",args:m})}).catch(()=>{})
      }
    }else{
      const _cp=text.slice(1).trim().split(' ');const _cn=_cp[0],_ca=_cp.slice(1).join(' ')
      await fetch("/api/command",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({command:_cn,args:_ca})}).catch(()=>{})
    }
    return
  }
  // If text matches a known model name, route as /model command instead of prompt
  const msel=document.getElementById("model-select")
  if(msel){
    const knownModels=[...msel.options].map(o=>o.value)
    if(knownModels.includes(text)){
      await fetch("/api/command",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({command:"model",args:text})}).catch(()=>{})
      return
    }
  }
  S.busy=true
  pendingUserMsg={role:"user",content:text,ts:Date.now()}
  appendChatMsg(pendingUserMsg)
  showThinking(true)
  updateInputUI()
  try{
    const model=document.getElementById("model-select")?.value||""
    const r=await fetch("/api/prompt",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text,mode:S.mode,model})})
    const d=await r.json()
    if(!d.ok&&d.error)appendChatMsg({role:"system",content:"Error: "+d.error,ts:Date.now()})
  }catch(err){
    appendChatMsg({role:"system",content:"Error: "+err.message,ts:Date.now()})
  }finally{
    showThinking(false)
    S.busy=false;pendingUserMsg=null
    updateInputUI()
  }
}

/* ── Init ──────────────────────────────────────────────── */
document.addEventListener("DOMContentLoaded",()=>{
  connectSSE();fetchState();fetchDashboard();fetchModels();fetchFileTree()

  /* Tabs */
  document.querySelectorAll(".tab").forEach(t=>{
    t.addEventListener("click",()=>{
      document.querySelectorAll(".tab").forEach(x=>x.classList.remove("active"))
      t.classList.add("active")
      activeTab=t.dataset.tab
      document.querySelectorAll(".panel").forEach(p=>p.classList.remove("active"))
      const panel=document.getElementById("panel-"+t.dataset.tab)
      if(panel)panel.classList.add("active")
      if(activeTab==="chat"){
        unreadChat=0
        const badge=document.getElementById("chat-badge")
        if(badge)badge.classList.remove("show")
        scrollToBottom()
      }
      if(activeTab==="dashboard")fetchDashboard()
      if(activeTab==="files")fetchFileTree()
    })
  })

  /* Input */
  const inp=document.getElementById("chat-input")
  const btn=document.getElementById("send-btn")
  const stop=document.getElementById("stop-btn")
  const msel=document.getElementById("mode-select")

  inp.addEventListener("input",()=>{resizeInput(inp);updateInputUI()})
  inp.addEventListener("keydown",e=>{
    if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();const txt=inp.value.trim();if(txt&&(!S.busy||txt.startsWith("/")))send()}
  })
  inp.addEventListener("focus",()=>{setTimeout(scrollToBottom,80)})
  btn.addEventListener("click",send)
  stop.addEventListener("click",()=>fetch("/api/cancel",{method:"POST"}).catch(()=>{}))
  if(msel)msel.addEventListener("change",()=>{
    const m=msel.value
    fetch("/api/command",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({command:"mode",args:m})}).catch(()=>{})
  })
  const modSel=document.getElementById("model-select")
  if(modSel)modSel.addEventListener("change",()=>{
    fetch("/api/command",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({command:"model",args:modSel.value})}).catch(()=>{})
  })

  /* File tree toggle */
  document.getElementById('tree-toggle')?.addEventListener('click',()=>{
    const tp=document.getElementById('file-tree-panel')
    if(tp){tp.classList.toggle('collapsed')
      const btn=document.getElementById('tree-toggle')
      if(btn)btn.textContent=tp.classList.contains('collapsed')?'☰':'☰'}
  })

  /* File tree */
  document.getElementById('file-tree')?.addEventListener('click',e=>{
    const folder=e.target.closest('.tree-folder')
    if(folder){
      const ch=folder.nextElementSibling
      if(ch&&ch.classList.contains('tree-children')){
        ch.classList.toggle('collapsed')
        const icon=folder.querySelector('.tree-icon')
        if(icon)icon.textContent=ch.classList.contains('collapsed')?'►':'▾'
      }
      return
    }
    const file=e.target.closest('.tree-file')
    if(file&&file.dataset.file)openFile(file.dataset.file)
  })
  document.getElementById('tree-search')?.addEventListener('input',e=>filterTree(e.target.value))
  document.getElementById('summarize-file-btn')?.addEventListener('click',summarizeCurrentFile)
  document.getElementById('view-summary-btn')?.addEventListener('click',viewSummary)
  document.getElementById('edit-toggle')?.addEventListener('click',toggleEdit)
  document.getElementById('save-file-btn')?.addEventListener('click',saveFile)
  /* Global file-path click */
  document.addEventListener('click',e=>{
    const el=e.target.closest('.file-path[data-file],.file-path-link[data-file]')
    if(el)openFile(el.dataset.file)
  })

  updateInputUI()
})
</script>
</body>
</html>`;
export function startLanServer(args) {
    const { root, config, db, events, indexer } = args;
    const port = args.port ?? 3000;
    const lanState = {
        scanPhase: "idle",
        scanProgress: 0,
        scanScanned: 0,
        scanTotal: 0,
        ollamaReady: null,
        phase: "idle",
        intent: null,
        packet: null,
        answer: "",
        patchText: "",
        output: [],
        busy: false,
        mode: args.initialMode ?? "build",
        modelOverride: args.initialModelOverride ?? null,
        uptime: Date.now(),
        chatLog: parseOutputToChat(args.initialOutput ?? []),
    };
    const sseClients = new Set();
    let currentAbort = null;
    let currentTaskSource = null;
    function broadcast(data) {
        const msg = `data: ${JSON.stringify(data)}\n\n`;
        for (const res of sseClients) {
            try {
                res.write(msg);
            }
            catch {
                sseClients.delete(res);
            }
        }
    }
    function emitState() {
        broadcast({ type: "state", data: { ...lanState, uptime: lanState.uptime } });
    }
    function emitStatus(partial) {
        Object.assign(lanState, partial);
        broadcast({ type: "status", data: partial });
    }
    function appendChat(entry, source = "system") {
        lanState.chatLog.push(entry);
        broadcast({ type: "chat", data: entry });
        if (source === "web") {
            events.emit("chat:entry", { entry, source: "web", mode: lanState.mode });
        }
    }
    function cancelCurrent() {
        if (currentAbort) {
            currentAbort.abort();
            currentAbort = null;
        }
        lanState.busy = false;
        lanState.phase = "idle";
        emitState();
        appendChat({ role: "system", content: "⏹ Cancelled", ts: Date.now() }, "web");
    }
    // Subscribe to events
    const onProgress = (s) => {
        const update = {};
        if (s.phase)
            update.scanPhase = String(s.phase);
        if (s.progress !== undefined)
            update.scanProgress = Number(s.progress);
        if (s.filesScanned !== undefined)
            update.scanScanned = Number(s.filesScanned);
        if (s.filesTotal !== undefined)
            update.scanTotal = Number(s.filesTotal);
        emitStatus(update);
    };
    const onOllama = (ok) => {
        lanState.ollamaReady = ok;
        emitState();
    };
    const onPhase = (p) => emitStatus({ phase: p, busy: p !== "idle" });
    const onIntent = (intent) => emitStatus({ intent });
    const onContext = (packet) => {
        lanState.packet = packet;
        emitState();
        const source = currentTaskSource === "web" ? "web" : "cli";
        // TUI-originated prompt: add user message if not duplicate
        const last = lanState.chatLog[lanState.chatLog.length - 1];
        if (packet.task && (!last || last.role !== "user" || last.content !== packet.task)) {
            appendChat({ role: "user", content: packet.task, ts: Date.now() }, source);
        }
    };
    const onAnswer = (answer) => {
        const source = currentTaskSource === "web" ? "web" : "cli";
        lanState.answer = answer;
        const last = lanState.chatLog[lanState.chatLog.length - 1];
        if (answer && (!last || last.role !== "assistant")) {
            appendChat({ role: "assistant", content: answer, ts: Date.now() }, source);
        }
        emitState();
    };
    const onPatch = (patchText) => {
        const source = currentTaskSource === "web" ? "web" : "cli";
        lanState.patchText = patchText;
        const last = lanState.chatLog[lanState.chatLog.length - 1];
        if (patchText && (!last || last.role !== "patch")) {
            appendChat({ role: "patch", content: patchText, ts: Date.now() }, source);
        }
        emitStatus({ patchText });
    };
    const onUiModeSet = (payload) => {
        if (payload?.mode !== "build" && payload?.mode !== "discuss")
            return;
        if (lanState.mode !== payload.mode) {
            lanState.mode = payload.mode;
            emitState();
        }
    };
    const onUiModelSet = (payload) => {
        if (!(typeof payload?.model === "string" || payload?.model === null))
            return;
        const nextModel = payload.model === null ? null : payload.model.trim() || null;
        if (lanState.modelOverride !== nextModel) {
            lanState.modelOverride = nextModel;
            emitState();
        }
    };
    events.on("index:progress", onProgress);
    events.on("ollama:status", onOllama);
    events.on("task:phase", onPhase);
    events.on("task:intent", onIntent);
    events.on("task:context", onContext);
    events.on("task:answer", onAnswer);
    events.on("task:patch", onPatch);
    events.on("ui:mode:set", onUiModeSet);
    events.on("ui:model:set", onUiModelSet);
    const onStream = (data) => {
        broadcast({ type: "stream", data: { text: data.text } });
    };
    events.on("task:stream", onStream);
    function dashboardData() {
        const totalFiles = db.prepare("SELECT COUNT(*) AS c FROM files").get().c;
        const totalSymbols = db.prepare("SELECT COUNT(*) AS c FROM symbols").get().c;
        const totalImports = db.prepare("SELECT COUNT(*) AS c FROM imports").get().c;
        const totalWithSummary = db.prepare("SELECT COUNT(*) AS c FROM files WHERE summary IS NOT NULL AND summary != ''").get().c;
        const fileRows = db.prepare("SELECT id,path,language,summary,is_test AS isTest FROM files ORDER BY CASE WHEN summary IS NULL OR summary='' THEN 1 ELSE 0 END,path").all();
        const tagRows = db.prepare("SELECT ft.file_id,t.name FROM file_tags ft JOIN tags t ON t.id=ft.tag_id").all();
        const tagsByFile = new Map();
        for (const r of tagRows) {
            const list = tagsByFile.get(r.file_id) ?? [];
            list.push(r.name);
            tagsByFile.set(r.file_id, list);
        }
        const impMeta = db.prepare("SELECT m.key,m.value FROM meta m WHERE m.key LIKE 'importance:%'").all();
        const hashToImp = new Map();
        for (const r of impMeta) {
            const h = r.key.replace("importance:", "");
            const v = parseInt(r.value, 10);
            if (!isNaN(v))
                hashToImp.set(h, v);
        }
        const fileHashes = db.prepare("SELECT id,hash FROM files").all();
        const llmImpMap = new Map();
        for (const fh of fileHashes) {
            const imp = hashToImp.get(fh.hash);
            if (imp)
                llmImpMap.set(fh.id, imp);
        }
        const impRows = db.prepare("SELECT f.id,IFNULL(inb.c,0) AS inbound,IFNULL(outb.c,0) AS outbound,IFNULL(sym.c,0) AS symbols FROM files f LEFT JOIN(SELECT to_file_id AS fid,COUNT(*)AS c FROM imports GROUP BY to_file_id)inb ON inb.fid=f.id LEFT JOIN(SELECT from_file_id AS fid,COUNT(*)AS c FROM imports GROUP BY from_file_id)outb ON outb.fid=f.id LEFT JOIN(SELECT file_id AS fid,COUNT(*)AS c FROM symbols GROUP BY file_id)sym ON sym.fid=f.id").all();
        const heurImpMap = new Map();
        for (const r of impRows)
            heurImpMap.set(r.id, Math.round(r.inbound * 3 + r.outbound * 1 + r.symbols * 0.5));
        const files = fileRows.map((r) => ({
            path: r.path,
            language: r.language,
            summary: r.summary,
            isTest: !!r.isTest,
            tags: tagsByFile.get(r.id) ?? [],
            importance: llmImpMap.get(r.id) ?? heurImpMap.get(r.id) ?? 0,
        }));
        const topTags = db.prepare("SELECT t.name,COUNT(ft.file_id)AS count FROM file_tags ft JOIN tags t ON t.id=ft.tag_id GROUP BY ft.tag_id ORDER BY count DESC LIMIT 10").all();
        const langCounts = db.prepare("SELECT language,COUNT(*)AS count FROM files WHERE language IS NOT NULL AND language!='' GROUP BY language ORDER BY count DESC").all();
        const projectSummary = db.prepare("SELECT value FROM meta WHERE key='project_summary'").get()?.value ?? "";
        return { totalFiles, totalSymbols, totalImports, totalWithSummary, files, topTags, langCounts, projectSummary };
    }
    const server = http.createServer((req, res) => {
        const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
        const pathname = url.pathname;
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type");
        if (req.method === "OPTIONS") {
            res.writeHead(204);
            res.end();
            return;
        }
        if (pathname === "/api/state" && req.method === "GET") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ...lanState, uptime: lanState.uptime }));
            return;
        }
        if (pathname === "/api/events" && req.method === "GET") {
            res.writeHead(200, {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
            });
            res.write(`data: ${JSON.stringify({ type: "state", data: { ...lanState, uptime: lanState.uptime } })}\n\n`);
            const dash = dashboardData();
            res.write(`data: ${JSON.stringify({ type: "dashboard", data: dash })}\n\n`);
            sseClients.add(res);
            req.on("close", () => { sseClients.delete(res); });
            return;
        }
        if (pathname === "/api/dashboard" && req.method === "GET") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(dashboardData()));
            return;
        }
        if (pathname === "/api/filetree" && req.method === "GET") {
            try {
                const files = db.prepare("SELECT path, language FROM files ORDER BY path").all();
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ files }));
            }
            catch (err) {
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: String(err) }));
            }
            return;
        }
        if (pathname === "/api/file" && req.method === "GET") {
            const filePath = url.searchParams.get("path");
            if (!filePath) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: "missing path" }));
                return;
            }
            const resolvedRoot = path.resolve(root);
            const absPath = path.resolve(root, filePath);
            const rel = path.relative(resolvedRoot, absPath);
            if (rel.startsWith("..") || path.isAbsolute(rel)) {
                res.writeHead(403, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "access denied" }));
                return;
            }
            void (async () => {
                try {
                    const content = await readFile(absPath, "utf-8");
                    const fileRow = db.prepare("SELECT summary, importance FROM files WHERE path=?").get(rel);
                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ content, summary: fileRow?.summary ?? null, importance: fileRow?.importance ?? 0 }));
                }
                catch {
                    res.writeHead(404, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ error: "file not found" }));
                }
            })();
            return;
        }
        if (pathname === "/api/file" && req.method === "POST") {
            let body = "";
            req.on("data", (chunk) => { body += chunk; });
            req.on("end", async () => {
                try {
                    const { path: filePath, content } = JSON.parse(body);
                    if (!filePath || content === undefined) {
                        res.writeHead(400);
                        res.end(JSON.stringify({ error: "missing fields" }));
                        return;
                    }
                    const resolvedRoot = path.resolve(root);
                    const absPath = path.resolve(root, filePath);
                    const rel = path.relative(resolvedRoot, absPath);
                    if (rel.startsWith("..") || path.isAbsolute(rel)) {
                        res.writeHead(403, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ error: "access denied" }));
                        return;
                    }
                    await writeFile(absPath, content, "utf-8");
                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: true }));
                }
                catch (err) {
                    res.writeHead(500, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: String(err) }));
                }
            });
            return;
        }
        if (pathname === "/api/config" && req.method === "GET") {
            res.writeHead(200, { "Content-Type": "application/json" });
            const safeConfig = {};
            for (const [k, v] of Object.entries(config)) {
                if (k === "providers") {
                    const safeProviders = {};
                    for (const [pid, entry] of Object.entries(v)) {
                        const e = entry;
                        safeProviders[pid] = {
                            type: e.type,
                            baseUrl: e.baseUrl,
                            apiKeyEnv: e.apiKeyEnv,
                            hasApiKey: Boolean(e.apiKey)
                        };
                    }
                    safeConfig[k] = safeProviders;
                }
                else {
                    safeConfig[k] = v;
                }
            }
            res.end(JSON.stringify(safeConfig));
            return;
        }
        if (pathname === "/api/models" && req.method === "GET") {
            void (async () => {
                try {
                    const models = await listProviderModels(config);
                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ models, selected: lanState.modelOverride ?? "" }));
                }
                catch {
                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ models: [], selected: lanState.modelOverride ?? "" }));
                }
            })();
            return;
        }
        if (pathname === "/api/prompt" && req.method === "POST") {
            let body = "";
            req.on("data", (chunk) => { body += chunk; });
            req.on("end", async () => {
                try {
                    const { text, model } = JSON.parse(body);
                    if (!text) {
                        res.writeHead(400);
                        res.end(JSON.stringify({ ok: false, error: "missing text" }));
                        return;
                    }
                    // Handle slash commands client-side can also send to /api/command,
                    // but /mode is common enough to intercept here.
                    if (text === "/mode discuss" || text === "/mode build") {
                        lanState.mode = text === "/mode build" ? "build" : "discuss";
                        events.emit("ui:mode:set", { mode: lanState.mode, source: "web" });
                        emitState();
                        appendChat({ role: "system", content: `Switched to ${lanState.mode} mode`, ts: Date.now() }, "web");
                        res.writeHead(200, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: true }));
                        return;
                    }
                    if (text.startsWith("/")) {
                        res.writeHead(200, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: true }));
                        return;
                    }
                    currentAbort = new AbortController();
                    currentTaskSource = "web";
                    lanState.busy = true;
                    const selectedModel = typeof model === "string" && model.trim() ? model.trim() : lanState.modelOverride ?? undefined;
                    if (selectedModel && selectedModel !== lanState.modelOverride && lanState.modelOverride !== null) {
                        lanState.modelOverride = selectedModel;
                        events.emit("ui:model:set", { model: selectedModel, source: "web" });
                    }
                    const last = lanState.chatLog[lanState.chatLog.length - 1];
                    if (!last || last.role !== "user" || last.content !== text) {
                        appendChat({ role: "user", content: text, ts: Date.now() }, "web");
                    }
                    emitState();
                    try {
                        await runAsk({ db, root, config, events, indexer }, text, { signal: currentAbort.signal, modelOverride: selectedModel });
                    }
                    finally {
                        currentAbort = null;
                        currentTaskSource = null;
                    }
                    lanState.busy = false;
                    emitState();
                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: true }));
                }
                catch (err) {
                    currentAbort = null;
                    currentTaskSource = null;
                    lanState.busy = false;
                    emitState();
                    appendChat({ role: "system", content: `Error: ${err instanceof Error ? err.message : String(err)}`, ts: Date.now() }, "web");
                    res.writeHead(500, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: String(err) }));
                }
            });
            return;
        }
        if (pathname === "/api/cancel" && req.method === "POST") {
            cancelCurrent();
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true }));
            return;
        }
        if (pathname === "/api/command" && req.method === "POST") {
            let body = "";
            req.on("data", (chunk) => { body += chunk; });
            req.on("end", async () => {
                try {
                    const { command, args } = JSON.parse(body);
                    switch (command) {
                        case "mode":
                            if (args === "build" || args === "discuss") {
                                lanState.mode = args;
                                events.emit("ui:mode:set", { mode: lanState.mode, source: "web" });
                                emitState();
                                appendChat({ role: "system", content: `Switched to ${lanState.mode} mode`, ts: Date.now() }, "web");
                            }
                            break;
                        case "model": {
                            const raw = typeof args === "string" ? args.trim() : "";
                            if (!raw || raw === "list") {
                                const models = await listProviderModels(config).catch(() => []);
                                if (models.length) {
                                    appendChat({ role: "assistant", content: "? Available models\n" + models.map((m) => "- " + m).join("\n"), ts: Date.now() }, "web");
                                }
                                else {
                                    appendChat({ role: "system", content: "No models available from any provider.", ts: Date.now() }, "web");
                                }
                                break;
                            }
                            if (raw === "reset" || raw === "default" || raw === "auto") {
                                lanState.modelOverride = null;
                                events.emit("ui:model:set", { model: null, source: "web" });
                                emitState();
                                appendChat({ role: "system", content: "Model reset to mode default", ts: Date.now() }, "web");
                                break;
                            }
                            const models = await listProviderModels(config).catch(() => []);
                            const resolved = models.length ? await resolveProviderModelName(config, raw, models) : raw;
                            lanState.modelOverride = resolved || null;
                            events.emit("ui:model:set", { model: lanState.modelOverride, source: "web" });
                            emitState();
                            appendChat({ role: "system", content: `Model set to ${lanState.modelOverride}`, ts: Date.now() }, "web");
                            break;
                        }
                        case "reindex":
                            void indexer.quickStartupScan();
                            appendChat({ role: "system", content: "Reindexing started", ts: Date.now() }, "web");
                            break;
                        case "clear":
                            lanState.chatLog = [];
                            emitState();
                            events.emit("chat:cleared", { source: "web" });
                            break;
                        case "summarize": {
                            const targetPath = args?.trim() || "";
                            void (async () => {
                                if (targetPath) {
                                    // Summarize a specific file
                                    try {
                                        const absPath = path.resolve(root, targetPath);
                                        const rel = path.relative(path.resolve(root), absPath);
                                        if (rel.startsWith("..") || path.isAbsolute(rel))
                                            return;
                                        const content = await readFile(absPath, "utf-8");
                                        const row = db.prepare("SELECT language FROM files WHERE path=?").get(rel);
                                        const lang = row?.language ?? "text";
                                        appendChat({ role: "system", content: `Summarizing ${rel}…`, ts: Date.now() }, "web");
                                        const { summary, importance } = await summarizeFile({ config, relPath: rel, language: lang, content });
                                        if (summary) {
                                            db.prepare("UPDATE files SET summary=?,importance=? WHERE path=?").run(summary, importance, rel);
                                            appendChat({ role: "system", content: `Summarized ${rel}: ${summary}`, ts: Date.now() }, "web");
                                        }
                                        else {
                                            appendChat({ role: "system", content: `Summarize failed for ${rel} (provider unavailable?)`, ts: Date.now() }, "web");
                                        }
                                    }
                                    catch (e) {
                                        appendChat({ role: "system", content: `Summarize error: ${String(e)}`, ts: Date.now() }, "web");
                                    }
                                }
                                else {
                                    // Summarize all files without summaries
                                    const unsummarized = db.prepare("SELECT path, language FROM files WHERE summary IS NULL OR summary='' ORDER BY importance DESC").all();
                                    if (!unsummarized.length) {
                                        appendChat({ role: "system", content: "All files already have summaries.", ts: Date.now() }, "web");
                                        return;
                                    }
                                    appendChat({ role: "system", content: `Starting summarization of ${unsummarized.length} files…`, ts: Date.now() }, "web");
                                    let done = 0;
                                    for (const f of unsummarized) {
                                        try {
                                            const absPath = path.resolve(root, f.path);
                                            const content = await readFile(absPath, "utf-8").catch(() => "");
                                            if (!content)
                                                continue;
                                            const { summary, importance } = await summarizeFile({ config, relPath: f.path, language: f.language, content });
                                            if (summary) {
                                                db.prepare("UPDATE files SET summary=?,importance=? WHERE path=?").run(summary, importance, f.path);
                                                done++;
                                            }
                                        }
                                        catch { /* skip */ }
                                        if (done % 5 === 0 && done > 0)
                                            appendChat({ role: "system", content: `Summarized ${done}/${unsummarized.length}…`, ts: Date.now() }, "web");
                                    }
                                    appendChat({ role: "system", content: `Summarization complete: ${done}/${unsummarized.length} files.`, ts: Date.now() }, "web");
                                }
                            })();
                            break;
                        }
                    }
                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: true }));
                }
                catch (err) {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: String(err) }));
                }
            });
            return;
        }
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(HTML.replace("__PROJECT__", root.split("/").pop() ?? "project"));
    });
    server.listen(port, () => {
        lanState.uptime = Date.now();
    });
    function stop() {
        events.off("index:progress", onProgress);
        events.off("ollama:status", onOllama);
        events.off("task:phase", onPhase);
        events.off("task:intent", onIntent);
        events.off("task:context", onContext);
        events.off("task:answer", onAnswer);
        events.off("task:patch", onPatch);
        events.off("task:stream", onStream);
        events.off("ui:mode:set", onUiModeSet);
        events.off("ui:model:set", onUiModelSet);
        for (const client of sseClients) {
            try {
                client.end();
            }
            catch { /* ignore */ }
        }
        sseClients.clear();
        server.close();
    }
    return { port, stop };
}
