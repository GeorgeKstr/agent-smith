export const styles = `*,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
:root{
  --bg:#020502;--panel:#060d06;--panel2:#0b150b;--panel3:#102010;
  --border:#1a321a;--border-h:#2a5a2a;--text:#a0eca0;--muted:#4a7a4a;
  --bright:#44ff44;--accent:#2ccfcf;--warn:#ffbb33;--danger:#ff5050;
  --r:5px;--touch:40px;--font:ui-monospace,"Cascadia Code","Fira Code",monospace;
}
html,body{height:100%;overflow:hidden;background:var(--bg);color:var(--text);font-family:var(--font);font-size:12px;line-height:1.4;-webkit-tap-highlight-color:transparent}

/* ── App shell ── */
#app{display:flex;flex-direction:column;height:100vh;height:100dvh}
#topbar{display:flex;align-items:center;gap:8px;padding:0 10px;min-height:42px;background:var(--panel);border-bottom:1px solid var(--border);flex-shrink:0;overflow:hidden}
.tb-title{font-size:12px;font-weight:700;color:var(--bright);white-space:nowrap;margin-right:4px}
.tb-stat{font-size:10px;color:var(--muted);white-space:nowrap}
.tb-stat.run{color:var(--warn)}
.tb-stat.rev{color:var(--accent)}
.tb-stat.fail{color:var(--danger)}
.tb-refresh{margin-left:auto;width:30px;height:30px;background:var(--panel2);color:var(--text);border:1px solid var(--border);border-radius:var(--r);cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.tb-refresh:hover{background:var(--bright);color:#000}

#layout{flex:1;display:flex;overflow:hidden;min-height:0}

/* ── Agent panel ── */
#agent-panel{width:220px;flex-shrink:0;overflow-y:auto;background:var(--panel);border-right:1px solid var(--border);display:flex;flex-direction:column}
.ap-header{display:flex;align-items:center;justify-content:space-between;padding:8px 10px 4px;flex-shrink:0}
.ap-title{font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.6px}
.ap-count{font-size:10px;color:var(--muted);background:var(--panel2);padding:1px 6px;border-radius:3px}
.ap-empty{color:var(--muted);font-size:10px;padding:12px 10px;font-style:italic}
.agent-item{padding:8px 10px;cursor:pointer;border-bottom:1px solid var(--border);transition:background .1s}
.agent-item:hover{background:var(--panel2)}
.agent-item.selected{background:var(--panel3);border-left:2px solid var(--bright)}
.ai-row1{display:flex;align-items:center;gap:5px;margin-bottom:2px}
.ai-name{font-size:11px;font-weight:600;color:var(--bright);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}
.ai-row2{font-size:9px;color:var(--muted);margin-bottom:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ai-row3{font-size:9px;margin-bottom:1px}
.at-active{color:var(--warn)}
.at-review{color:var(--accent)}
.ai-row4{font-size:9px;color:var(--muted)}

/* ── Main panel ── */
#main-panel{flex:1;display:flex;flex-direction:column;overflow:hidden;min-width:0}

/* No-agent landing */
.no-agent-msg{flex:1;display:flex;align-items:center;justify-content:center;padding:20px}
.na-inner{text-align:center;max-width:360px}
.na-icon{font-size:32px;color:var(--muted);margin-bottom:12px}
.na-title{font-size:14px;font-weight:700;color:var(--bright);margin-bottom:6px}
.na-sub{font-size:11px;color:var(--muted);margin-bottom:8px}
.na-empty{font-size:10px;color:var(--muted);font-style:italic;margin-top:6px}

/* ── Tab bar ── */
.tab-bar{display:flex;align-items:center;background:var(--panel);border-bottom:1px solid var(--border);flex-shrink:0;padding:0 4px;min-height:40px}
.tab-btn{background:transparent;color:var(--muted);border:none;border-bottom:2px solid transparent;padding:8px 14px;cursor:pointer;font-family:var(--font);font-size:11px;min-height:var(--touch);white-space:nowrap;transition:color .1s}
.tab-btn:hover{color:var(--text)}
.tab-btn.active{color:var(--bright);border-bottom-color:var(--bright)}
.tab-badge{display:inline-block;background:var(--warn);color:#000;font-size:8px;font-weight:700;padding:1px 5px;border-radius:8px;margin-left:4px}
.tab-agent-name{margin-left:auto;font-size:10px;color:var(--muted);display:flex;align-items:center;gap:4px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;max-width:200px;padding:0 8px}
.tab-agent-sub{color:var(--muted);font-size:9px}
.m-back-btn{display:none;background:transparent;color:var(--accent);border:none;padding:6px 8px;cursor:pointer;font-family:var(--font);font-size:10px}

/* ── Tab content ── */
.tab-content{flex:1;overflow-y:auto;padding:8px;-webkit-overflow-scrolling:touch}

/* ── Action/filter bars ── */
.action-bar{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px}
.filter-bar{display:flex;gap:4px;margin-bottom:8px;flex-wrap:wrap}
.filter-input{background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:var(--r);padding:5px 8px;font-family:var(--font);font-size:10px;min-height:var(--touch);flex:1;min-width:100px}
.filter-sel{background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:var(--r);padding:5px 6px;font-family:var(--font);font-size:10px;min-height:var(--touch)}

/* ── Buttons ── */
.btn{background:var(--panel2);color:var(--text);border:1px solid var(--border);border-radius:var(--r);padding:6px 12px;cursor:pointer;font-family:var(--font);font-size:10px;min-height:var(--touch);white-space:nowrap;transition:background .1s,color .1s;display:inline-flex;align-items:center;gap:4px}
.btn:hover{background:var(--bright);color:#000;border-color:var(--bright)}
.btn:active{transform:scale(.95)}
.btn-sm{padding:4px 8px;min-height:28px;font-size:9px}
.btn-accent{background:var(--border-h);color:var(--bright);border-color:var(--border-h);font-weight:600}
.btn-accent:hover{background:var(--bright);color:#000}
.btn-accept{background:#0a2a0a;color:var(--text);border-color:var(--border-h)}
.btn-accept:hover{background:var(--bright);color:#000}
.btn-danger{background:#2a0000;color:var(--danger);border-color:var(--danger)}
.btn-danger:hover{background:var(--danger);color:#000}
.btn.active{background:var(--panel3);border-color:var(--border-h);color:var(--bright)}
.btn[disabled],.btn:disabled{opacity:.4;pointer-events:none}

/* ── Status tags ── */
.stag{display:inline-block;padding:1px 6px;border-radius:3px;font-size:8px;font-weight:700;letter-spacing:.3px;text-transform:uppercase}
.stag-queued,.stag-skipped,.stag-cancelled{background:#111;color:#555}
.stag-assigned{background:#0a0820;color:#66f}
.stag-running{background:#082a08;color:var(--text)}
.stag-reviewing,.stag-iterating{background:#1a1a00;color:#ee0}
.stag-needs-review{background:#1a0800;color:var(--warn)}
.stag-auto-approved{background:#001a1a;color:var(--accent)}
.stag-completed{background:#082a08;color:var(--bright)}
.stag-failed{background:#2a0000;color:var(--danger)}

/* ── Badges ── */
.badge{display:inline-block;background:var(--panel2);color:var(--muted);padding:1px 5px;border-radius:3px;font-size:8px;margin:0 1px}
.badge-auto{background:#082a08;color:var(--text)}
.badge-apply{background:#081a1a;color:var(--accent)}
.badge-max{background:#1a0800;color:var(--warn)}

/* ── Status dots ── */
.dot{display:inline-block;width:6px;height:6px;border-radius:50%;flex-shrink:0}
.dot-on{background:var(--bright);box-shadow:0 0 4px var(--bright)}
.dot-off{background:var(--danger)}
.dot-busy{background:var(--warn);box-shadow:0 0 3px var(--warn)}
.dot-idle{background:var(--text)}

/* ── Task cards ── */
.task-group{margin-bottom:10px}
.group-hdr{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);padding:4px 0 2px;border-bottom:1px solid var(--border);margin-bottom:3px;display:flex;align-items:center;gap:4px}
.gh-ct{background:var(--panel2);color:var(--muted);padding:0 5px;border-radius:8px}

.tcard{background:var(--panel);border:1px solid var(--border);border-radius:var(--r);margin-bottom:3px;overflow:hidden;transition:border-color .1s}
.tcard:hover{border-color:var(--muted)}
.tcard.exp{border-color:var(--border-h)}

.tc-head{display:flex;align-items:center;gap:6px;padding:7px 10px;cursor:pointer;user-select:none}
.tc-head:hover{background:var(--panel2)}
.tc-title{flex:1;font-size:11px;font-weight:600;color:var(--bright);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.tc-chevron{color:var(--muted);font-size:10px;flex-shrink:0}

.tc-actions{display:flex;flex-wrap:wrap;gap:3px;padding:3px 8px 6px}

.tc-exp{padding:8px 10px 10px;border-top:1px solid var(--border);background:var(--panel2)}

/* ── Timeline / task detail ── */
.tl-info{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px;font-size:10px;color:var(--muted)}
.tli-row b{color:var(--text)}

.tl-sect{margin-bottom:10px}
.tl-sect-title{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);padding:4px 0 3px;border-bottom:1px solid var(--border);margin-bottom:5px;display:flex;align-items:center;gap:6px}

.tl-prompt{font-size:10px;color:var(--text);white-space:pre-wrap;word-break:break-word;max-height:120px;overflow:auto;background:var(--bg);border:1px solid var(--border);border-radius:var(--r);padding:6px}

.policy-form{background:var(--bg);border:1px solid var(--border);border-radius:var(--r);padding:8px;margin-top:4px}
.pf-row{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:6px}
.pf-row label{display:flex;flex-direction:column;gap:2px;font-size:9px;color:var(--muted);flex:1;min-width:120px}
.pf-row input,.pf-row select{background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:4px;padding:5px;font-family:var(--font);font-size:10px;min-height:28px;width:100%}
.pf-row input[type=checkbox]{width:auto;min-height:auto;margin-right:4px}

.tl-actions{display:flex;flex-wrap:wrap;gap:4px;margin-top:8px;padding-top:8px;border-top:1px solid var(--border)}

/* ── Iteration cards ── */
.iter-card{background:var(--bg);border:1px solid var(--border);border-radius:var(--r);padding:8px;margin-bottom:6px}
.ic-hdr{font-size:10px;font-weight:600;color:var(--accent);margin-bottom:4px;display:flex;flex-wrap:wrap;align-items:center;gap:4px}
.ic-sum{font-size:10px;color:#aaa;white-space:pre-wrap;max-height:80px;overflow:auto;margin-bottom:4px}
.ic-files{display:flex;flex-wrap:wrap;gap:2px;margin-bottom:4px}
.ic-file{background:var(--panel2);color:#888;padding:1px 5px;border-radius:3px;font-size:9px}
.ic-checks{display:flex;flex-wrap:wrap;gap:2px;margin-bottom:4px}
.ic-ck{padding:1px 6px;border-radius:3px;font-size:9px;font-weight:600}
.ic-ck.pass{background:#082a08;color:var(--text)}.ic-ck.fail{background:#2a0000;color:var(--danger)}
.ic-rev{padding:5px 8px;background:#1a1400;border-left:2px solid #aa8800;border-radius:0 var(--r) var(--r) 0;font-size:10px;margin:3px 0;word-break:break-word}
.ic-next{padding:5px 8px;background:#001a1a;border-left:2px solid var(--accent);border-radius:0 var(--r) var(--r) 0;font-size:10px;color:var(--accent);margin:3px 0;word-break:break-word}
.ic-dec{display:inline-block;padding:1px 6px;border-radius:3px;font-size:9px;font-weight:700;margin-right:4px}
.ic-dec.approve{background:#082a08;color:var(--text)}.ic-dec.reject{background:#2a0000;color:var(--danger)}
.ic-dec.failed{background:#2a2000;color:var(--warn)}.ic-dec.changes_requested{background:#1a1a00;color:#ee0}

.diff-btn{background:var(--panel3);color:var(--muted);border:1px solid var(--border);border-radius:var(--r);padding:3px 8px;cursor:pointer;font-family:var(--font);font-size:9px;margin-top:3px}
.diff-btn:hover{background:var(--text);color:#000}
.diff-block{background:var(--bg);border:1px solid var(--border);border-radius:var(--r);color:var(--text);font-size:9px;padding:6px;margin-top:3px;max-height:40vh;overflow:auto;white-space:pre;overflow-x:auto;font-family:var(--font);line-height:1.3}

/* ── Event rows ── */
.ev-row{font-size:9px;color:var(--muted);padding:3px 0;border-bottom:1px solid var(--border);word-break:break-word}
.ev-t{color:#444;margin-right:6px}

/* ── Ingest panel ── */
.ingest-panel{background:var(--panel);border:1px solid var(--border-h);border-radius:var(--r);padding:10px;margin-bottom:8px}
.ip-title{font-size:11px;font-weight:700;color:var(--bright);margin-bottom:8px}
.ip-body{}
.ip-row{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:6px}
.ip-row label{display:flex;flex-direction:column;gap:2px;font-size:9px;color:var(--muted);flex:1;min-width:120px}
.ip-row select,.ip-row input{background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:4px;padding:5px;font-family:var(--font);font-size:10px;min-height:28px;width:100%}
.ip-row input[type=checkbox]{width:auto;min-height:auto;margin-right:4px}
.ingest-ta{width:100%;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:var(--r);padding:8px;font-family:var(--font);font-size:10px;resize:vertical;margin-bottom:6px;min-height:80px}
.ip-btns{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px}
.ip-preview{font-size:10px;color:var(--text);padding:6px 8px;background:var(--bg);border:1px solid var(--border-h);border-radius:var(--r)}
.warn-row{color:var(--warn);font-size:9px;margin-top:3px}

/* ── New task panel ── */
.new-task-panel{background:var(--panel);border:1px solid var(--border-h);border-radius:var(--r);padding:10px;margin-bottom:8px}
.ntp-title{font-size:11px;font-weight:700;color:var(--bright);margin-bottom:8px}
.nt-input,.nt-ta{width:100%;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:var(--r);padding:7px;font-family:var(--font);font-size:10px;margin-bottom:4px;min-height:36px}
.nt-ta{resize:vertical;min-height:60px}
.nt-row{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:4px}
.nt-row label{display:flex;flex-direction:column;gap:2px;font-size:9px;color:var(--muted);flex:1;min-width:100px}
.nt-row input,.nt-row select{background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:4px;padding:5px;font-family:var(--font);font-size:10px;min-height:28px;width:100%}
.nt-row input[type=checkbox]{width:auto;min-height:auto;margin-right:4px}

/* ── Empty / loading / error ── */
.empty{color:var(--muted);font-style:italic;padding:16px;text-align:center;font-size:11px}
.loading{color:var(--muted);padding:16px;text-align:center;font-size:11px}
.err-msg{color:var(--danger);background:#1a0000;border:1px solid var(--danger);border-radius:var(--r);padding:8px;font-size:10px}

/* ── Chat ── */
.chat-outer{display:flex;flex-direction:column;height:100%;overflow:hidden}
.chat-tb{display:flex;align-items:center;gap:4px;padding:6px 8px;background:var(--panel);border-bottom:1px solid var(--border);flex-shrink:0;flex-wrap:wrap}
.ct-sel{background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:4px;padding:5px 6px;font-family:var(--font);font-size:10px;min-height:30px;flex:1;min-width:120px}
.chat-msgs{flex:1;overflow-y:auto;padding:8px;min-height:0;-webkit-overflow-scrolling:touch}
.chat-empty{color:var(--muted);font-style:italic;padding:20px;text-align:center;font-size:11px}
.cmsg{margin-bottom:8px;max-width:85%}
.cmsg.user{margin-left:auto}
.cmsg.user .cm-bub{background:var(--panel3);border-color:var(--border-h)}
.cm-meta{font-size:8px;color:var(--muted);margin-bottom:2px}
.cm-bub{background:var(--panel);border:1px solid var(--border);border-radius:var(--r);padding:8px;font-size:10px;line-height:1.5;white-space:pre-wrap;word-break:break-word}

/* Chat questions */
.chat-qtns{flex-shrink:0;background:var(--panel);border-top:1px solid var(--border-h);padding:8px;max-height:140px;overflow-y:auto}
.cq-title{font-size:9px;font-weight:700;color:var(--accent);text-transform:uppercase;margin-bottom:6px}
.cq-item{margin-bottom:6px;padding-bottom:6px;border-bottom:1px solid var(--border)}
.cq-text{font-size:10px;color:var(--text);margin-bottom:4px}
.cq-act{display:flex;gap:4px}
.cq-input{background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:4px;padding:4px 8px;font-family:var(--font);font-size:10px;flex:1;min-height:28px}

/* Chat input */
.chat-input-area{flex-shrink:0;border-top:1px solid var(--border);background:var(--panel)}
.cia-tb{display:flex;gap:4px;padding:5px 8px 0;flex-wrap:wrap}
.cia-tb select{background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:4px;padding:4px 6px;font-family:var(--font);font-size:9px;min-height:28px}
.cia-row{display:flex;gap:4px;padding:4px 8px 6px;align-items:flex-end}
.chat-textarea{flex:1;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:var(--r);padding:7px;font-family:var(--font);font-size:10px;resize:vertical;min-height:48px;max-height:120px}
.cia-send{flex-shrink:0;align-self:flex-end}

/* ── Toast ── */
.toast{position:fixed;bottom:14px;left:50%;transform:translateX(-50%);background:var(--panel3);border:1px solid var(--border-h);color:var(--bright);padding:7px 16px;border-radius:var(--r);font-size:10px;z-index:200;max-width:90vw;text-align:center;pointer-events:none;opacity:0;transition:opacity .2s;white-space:nowrap}
.toast.show{opacity:1}
.toast.err{border-color:var(--danger);color:var(--danger)}

/* ── Modal ── */
.modal{position:fixed;inset:0;background:rgba(0,0,0,.8);display:flex;align-items:center;justify-content:center;z-index:100}
.modal-box{background:var(--panel);border:2px solid var(--warn);border-radius:var(--r);padding:16px;max-width:340px;width:90vw}
.modal-msg{color:var(--text);margin-bottom:12px;font-size:11px;line-height:1.5}
.modal-btns{display:flex;gap:8px;justify-content:flex-end}

/* ── Scrollbar ── */
::-webkit-scrollbar{width:4px;height:4px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:var(--border);border-radius:2px}
::-webkit-scrollbar-thumb:hover{background:var(--muted)}

/* ── Mobile ─────────────────────────────── */
@media(max-width:767px){
  #layout{flex-direction:column}
  #agent-panel{width:100%;max-height:35vh;border-right:none;border-bottom:1px solid var(--border)}
  #main-panel{flex:1;min-height:0}
  .tab-agent-name{display:none}
  .m-back-btn{display:inline-flex}
  #layout.show-main #agent-panel{display:none}
  #layout.show-main #main-panel{flex:1}
}
@media(max-width:380px){
  .tc-actions .btn-sm{font-size:8px;padding:3px 6px}
  .action-bar .btn{font-size:9px;padding:5px 8px}
}
`
