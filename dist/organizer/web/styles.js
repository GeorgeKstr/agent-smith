export const styles = `*,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#080c08;--surface:#0d120d;--surface2:#111811;--border:#1a2a1a;--fg:#3a3;--fg-dim:#263626;--fg-bright:#4b4;--accent:#0cc;--warn:#e80;--danger:#f44;--font:ui-monospace,'Cascadia Code','Fira Code','JetBrains Mono',monospace;--radius:6px;--shadow:0 1px 3px rgba(0,0,0,.4)}
html,body{height:100%;overflow:hidden}
body{background:var(--bg);color:var(--fg);font-family:var(--font);font-size:12px;line-height:1.4;-webkit-tap-highlight-color:transparent;user-select:none}
#app{display:flex;flex-direction:column;height:100%}

/* Top bar */
#topbar{display:flex;align-items:center;justify-content:space-between;background:var(--surface);border-bottom:1px solid var(--border);padding:0 10px;min-height:44px;flex-shrink:0;z-index:20}
#topbar-left{display:flex;align-items:baseline;gap:12px;overflow:hidden;flex-wrap:wrap}
#topbar h1{font-size:12px;font-weight:700;color:var(--fg-bright);white-space:nowrap;letter-spacing:.5px}
#topbar-stats{font-size:10px;color:var(--fg-dim);white-space:nowrap}
#topbar-stats span{color:var(--fg);font-weight:600}
#topbar-right{display:flex;align-items:center;gap:8px}
#refresh-btn{width:32px;height:32px;background:var(--surface2);color:var(--fg);border:1px solid var(--border);border-radius:var(--radius);cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
#refresh-btn:hover{background:var(--fg);color:#000}
#refresh-btn:active{transform:scale(.92)}

/* Main layout: left panel + right panel */
#main{display:flex;flex:1;overflow:hidden}

/* Agent panel (left) */
#agent-panel{display:flex;flex-direction:column;width:230px;min-width:200px;max-width:280px;background:var(--surface);border-right:1px solid var(--border);flex-shrink:0;overflow:hidden}
#ap-header{color:var(--fg-bright);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;padding:10px 10px 6px;border-bottom:1px solid var(--border)}
#agent-list{flex:1;overflow-y:auto;padding:4px 6px}
#ap-status{color:var(--fg-dim);font-size:9px;padding:6px 10px;border-top:1px solid var(--border)}

/* Agent item in left panel */
.agent-item{display:flex;flex-direction:column;padding:7px 8px;margin:2px 0;border-radius:var(--radius);cursor:pointer;transition:background .1s;border:1px solid transparent}
.agent-item:hover{border-color:var(--border);background:var(--surface2)}
.agent-item.selected{border-color:var(--fg);background:#0a1a0a}
.agent-item .ai-top{display:flex;align-items:center;gap:6px}
.agent-item .ai-name{color:var(--fg);font-weight:600;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.agent-item .ai-status{font-size:9px;color:var(--fg-dim);margin-top:1px;text-transform:capitalize;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.agent-item .ai-task{font-size:9px;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.agent-item .ai-meta{font-size:8px;color:var(--fg-dim);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

/* Detail panel (right) */
#detail-panel{flex:1;display:flex;flex-direction:column;overflow:hidden}
#detail-tabs{display:flex;background:var(--surface);border-bottom:1px solid var(--border);flex-shrink:0;padding:0 4px}
.tab-btn{background:transparent;color:var(--fg-dim);border:none;padding:10px 14px;cursor:pointer;font-family:var(--font);font-size:11px;border-bottom:2px solid transparent;transition:color .1s}
.tab-btn:hover{color:var(--fg)}
.tab-btn.active{color:var(--fg-bright);border-bottom-color:var(--fg-bright)}
.tab-btn .tab-badge{display:inline-block;background:var(--surface2);color:var(--fg-dim);padding:1px 5px;border-radius:3px;font-size:9px;margin-left:4px}
#detail-content{flex:1;overflow-y:auto;padding:8px;-webkit-overflow-scrolling:touch}

/* Status dot */
.status-dot{display:inline-block;width:7px;height:7px;border-radius:50%;flex-shrink:0}
.dot-online{background:var(--fg-bright);box-shadow:0 0 5px var(--fg-bright)}
.dot-offline{background:var(--danger)}
.dot-busy{background:var(--warn);box-shadow:0 0 4px var(--warn)}
.dot-idle{background:var(--fg);box-shadow:0 0 3px var(--fg)}

/* Tags */
.tag{display:inline-block;padding:1px 6px;border-radius:3px;font-size:9px;font-weight:600;line-height:16px;margin:1px;text-transform:uppercase;letter-spacing:.3px}
.tag-queued{background:#1a1a1a;color:#666}
.tag-assigned{background:#0a0a2a;color:#66f}
.tag-running{background:#0a2a0a;color:var(--fg)}
.tag-reviewing{background:#2a2a0a;color:#ee0}
.tag-iterating{background:#2a2a0a;color:#ee0}
.tag-needs_review{background:#2a1500;color:var(--warn)}
.tag-auto_approved{background:#002a2a;color:var(--accent)}
.tag-completed{background:#0a2a0a;color:var(--fg)}
.tag-failed{background:#2a0000;color:var(--danger)}
.tag-skipped{background:#1a1a1a;color:#555}
.tag-cancelled{background:#1a1a1a;color:#444}

/* Badges */
.badge{display:inline-block;background:var(--surface2);color:var(--fg-dim);padding:1px 6px;border-radius:3px;font-size:9px;margin:1px;font-weight:500}
.badge-on{background:#0a2a0a;color:var(--fg)}
.badge-warn{background:#2a1500;color:var(--warn)}
.badge-info{background:#0a0a2a;color:#88f}

/* Stats cards (overview when no agent selected) */
.stats-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:8px;margin-bottom:12px}
.stat-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:12px;text-align:center;cursor:pointer;transition:border-color .2s,background .2s}
.stat-card:hover{border-color:var(--fg-dim);background:var(--surface2)}
.stat-card:active{transform:scale(.97)}
.stat-num{font-size:22px;color:var(--fg-bright);font-weight:700}
.stat-label{font-size:9px;color:var(--fg-dim);text-transform:uppercase;margin-top:3px;letter-spacing:.5px}
.stat-card.warn .stat-num{color:var(--warn)}
.stat-card.danger .stat-num{color:var(--danger)}

/* Panels / sections */
.panel{margin-bottom:10px}
.panel-title{font-size:11px;font-weight:600;color:var(--fg-dim);text-transform:uppercase;letter-spacing:.8px;padding:6px 0;border-bottom:1px solid var(--border);margin-bottom:6px}

/* Cards */
.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:8px 10px;margin-bottom:4px;cursor:pointer;min-height:42px;display:flex;flex-direction:column;justify-content:center;transition:border-color .1s,background .1s;overflow:hidden}
.card:hover{border-color:var(--fg-dim);background:var(--surface2)}
.card.selected{border-color:var(--fg);background:#0a1a0a}
.card .name{color:var(--fg-bright);font-weight:600;font-size:12px;word-break:break-word}
.card .meta{color:var(--fg-dim);font-size:10px;margin-top:2px}
.card .sub{color:#555;font-size:9px;margin-top:1px}

/* Group header */
.group-header{color:var(--fg-dim);font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;padding:6px 0 3px;margin-top:8px;border-bottom:1px solid var(--border)}

/* Empty state */
.empty{color:#444;font-style:italic;padding:10px;font-size:11px;text-align:center}

/* Detail view */
.detail-row{margin-bottom:8px}
.detail-label{color:var(--fg-dim);font-size:9px;text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:2px}
.detail-value{color:#bbb;font-size:11px;white-space:pre-wrap;max-height:120px;overflow:auto;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius);padding:6px;margin-top:2px;word-break:break-word}

/* Buttons */
.btn-row{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px}
.btn{background:var(--surface2);color:var(--fg);border:1px solid var(--border);border-radius:var(--radius);padding:6px 10px;cursor:pointer;font-family:var(--font);font-size:10px;min-height:36px;white-space:nowrap;transition:background .1s}
.btn:hover{background:var(--fg);color:#000;border-color:var(--fg)}
.btn:active{transform:scale(.96)}
.btn-sm{font-size:9px;padding:4px 8px;min-height:30px}
.btn-accent{background:var(--fg);color:#000;border-color:var(--fg);font-weight:600}
.btn-accent:hover{background:var(--fg-bright)}
.btn-warn{background:#2a1500;color:var(--warn);border-color:var(--warn)}
.btn-warn:hover{background:var(--warn);color:#000}
.btn-danger{background:#2a0000;color:var(--danger);border-color:var(--danger)}
.btn-danger:hover{background:var(--danger);color:#000}

/* Warning banner */
.warn-banner{padding:6px 10px;background:#2a1500;border-left:3px solid var(--warn);color:var(--warn);font-size:10px;margin:6px 0;border-radius:0 var(--radius) var(--radius) 0}

/* Event row */
.event-row{font-size:10px;color:var(--fg-dim);padding:4px 0;border-bottom:1px solid var(--border);word-break:break-word}
.event-time{color:#555;margin-right:6px}

/* Iteration card */
.iter-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:8px;margin-bottom:8px}
.iter-header{color:var(--accent);font-size:11px;font-weight:600;margin-bottom:4px}
.iter-summary{color:#bbb;font-size:10px;margin-bottom:4px;white-space:pre-wrap;max-height:100px;overflow:auto}
.iter-files{margin-bottom:4px;display:flex;flex-wrap:wrap;gap:2px}
.iter-file{display:inline-block;background:var(--surface2);color:#999;padding:2px 6px;border-radius:3px;font-size:9px;font-family:var(--font)}
.iter-checks{margin-bottom:4px;display:flex;flex-wrap:wrap;gap:2px}
.iter-check{padding:2px 6px;border-radius:3px;font-size:9px;font-weight:600}
.iter-check.pass{background:#0a2a0a;color:var(--fg)}.iter-check.fail{background:#2a0000;color:var(--danger)}
.iter-review{margin:4px 0;padding:6px;background:#1a1a0a;border-left:2px solid #ee0;border-radius:0 var(--radius) var(--radius) 0;font-size:10px;word-break:break-word}
.iter-next{margin:4px 0;padding:6px;background:#0a1a1a;border-left:2px solid var(--accent);border-radius:0 var(--radius) var(--radius) 0;font-size:10px;color:var(--accent);word-break:break-word}
.iter-dec{display:inline-block;padding:2px 6px;border-radius:3px;font-size:9px;font-weight:700;margin-right:4px}
.iter-dec.approve{background:#0a2a0a;color:var(--fg)}
.iter-dec.reject{background:#2a0000;color:var(--danger)}
.iter-dec.failed{background:#2a2a00;color:#e80}
.iter-dec.changes_requested{background:#2a2a0a;color:#ee0}

/* Collapsible section */
.collapsible-header{cursor:pointer;color:var(--fg);padding:6px 0;border-bottom:1px solid var(--border);font-size:11px;font-weight:600;display:flex;justify-content:space-between;align-items:center;min-height:36px;user-select:none}
.collapsible-header:hover{color:var(--fg-bright)}
.collapsible-body{padding:4px 0}

/* Diff */
.diff-toggle{background:var(--surface2);color:var(--fg-dim);border:1px solid var(--border);border-radius:var(--radius);padding:4px 8px;cursor:pointer;font-family:var(--font);font-size:9px;margin-top:4px;min-height:30px}
.diff-toggle:hover{background:var(--fg);color:#000}
.diff-preview{background:var(--bg);border:1px solid var(--border);border-radius:var(--radius);color:var(--fg);font-size:9px;padding:6px;margin-top:4px;max-height:50vh;overflow:auto;white-space:pre;overflow-x:auto;font-family:var(--font);line-height:1.3}

/* Confirm overlay */
.confirm-overlay{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.85);display:flex;align-items:center;justify-content:center;z-index:100}
.confirm-box{background:var(--surface);border:2px solid var(--warn);border-radius:var(--radius);padding:16px;max-width:320px;text-align:center}
.confirm-box p{color:var(--warn);margin-bottom:12px;font-size:12px}
.confirm-box button{margin:4px 8px;padding:8px 16px;font-family:var(--font);font-size:12px;cursor:pointer;min-height:40px;border-radius:var(--radius)}
.confirm-box .btn-yes{background:#2a0000;color:var(--danger);border:1px solid var(--danger)}
.confirm-box .btn-no{background:var(--surface2);color:var(--fg);border:1px solid var(--border)}

/* Chat tab */
.chat-container{display:flex;flex-direction:column;height:100%;flex:1}
.chat-messages{flex:1;overflow-y:auto;padding:8px}
.chat-msg{margin-bottom:8px;max-width:90%}
.chat-msg.user{align-self:flex-end;margin-left:auto}
.chat-msg.user .chat-bubble{background:#0a1a0a;border-color:var(--fg)}
.chat-bubble{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:8px;font-size:11px;line-height:1.5;white-space:pre-wrap;word-break:break-word}
.chat-meta{font-size:9px;color:var(--fg-dim);margin-bottom:2px}
.chat-input-row{display:flex;gap:4px;padding:8px;border-top:1px solid var(--border);background:var(--surface)}
.chat-input-row input{flex:1;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:var(--radius);padding:8px;font-family:var(--font);font-size:11px;min-height:36px}
.chat-input-row .btn{flex-shrink:0}
.chat-toolbar{display:flex;align-items:center;justify-content:space-between;padding:6px 8px;background:var(--surface);border-bottom:1px solid var(--border)}
.chat-toolbar select{background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:4px;padding:4px 8px;font-family:var(--font);font-size:10px}

/* Sessions modal */
.session-modal{background:var(--surface);border:2px solid var(--fg);border-radius:var(--radius);padding:16px;max-width:400px;width:90%;max-height:70vh;overflow-y:auto;margin:auto}
.session-modal h3{color:var(--fg-bright);margin-bottom:10px;font-size:13px}
.session-item{padding:8px;border:1px solid var(--border);border-radius:var(--radius);margin-bottom:4px;cursor:pointer}
.session-item:hover{border-color:var(--fg-dim);background:var(--surface2)}
.session-item.selected{border-color:var(--fg);background:#0a1a0a}

/* Edit form */
.edit-form{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:8px;margin-top:6px}
.edit-form label{display:block;color:var(--fg-dim);font-size:10px;margin-bottom:4px}
.edit-form input,.edit-form select,.edit-form textarea{background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:4px;padding:6px;font-family:var(--font);font-size:11px;width:100%;margin-bottom:4px;min-height:32px}
.edit-form input[type=checkbox]{width:auto;min-height:auto;margin-right:4px}
.edit-form textarea{resize:vertical;min-height:80px}
.edit-form .btn{margin-top:4px}

/* Assign form */
.assign-form{display:flex;gap:4px;margin-bottom:8px}
.assign-form select{flex:1;background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:4px;padding:6px;font-family:var(--font);font-size:11px;min-height:32px}

/* Scrollbar */
::-webkit-scrollbar{width:5px;height:5px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:var(--border);border-radius:3px}
::-webkit-scrollbar-thumb:hover{background:var(--fg-dim)}

/* Pulse animation for refresh */
@keyframes spin{to{transform:rotate(360deg)}}
.spinning{animation:spin .6s linear;pointer-events:none;opacity:.6}

/* Mobile responsive */
@media(max-width:640px){
  #agent-panel{width:120px;min-width:100px}
  .agent-item .ai-task{display:none}
  .agent-item .ai-meta{display:none}
  #topbar-stats{font-size:9px}
  #topbar-left{gap:4px}
  .tab-btn{padding:8px 8px;font-size:10px}
  #detail-content{padding:4px}
}
`;
