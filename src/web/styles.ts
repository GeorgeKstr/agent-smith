export const styles = `*,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
:root{
  --bg:#0d1117;--s1:#161b22;--s2:#21262d;--s3:#2d333b;
  --bd:#30363d;--bd-hi:#58a6ff;--tx:#c9d1d9;--tx2:#8b949e;--tx3:#484f58;
  --bright:#e6edf3;--accent:#58a6ff;--accent-dim:#1f3d6e;
  --green:#3fb950;--gd:#0d2a16;
  --yellow:#d29922;--yd:#2d1f00;
  --red:#f85149;--rd:#2d0a0a;
  --cyan:#39d0d0;
  --r:6px;--r2:10px;--touch:44px;
  --th:48px;--aw:230px;--nh:56px;
  --font:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,system-ui,sans-serif;
  --mono:ui-monospace,"Cascadia Code","Fira Code","JetBrains Mono",monospace;
}
html,body{height:100%;overflow:hidden;background:var(--bg)}
body{color:var(--tx);font-family:var(--font);font-size:13px;line-height:1.5;-webkit-tap-highlight-color:transparent}
input,textarea,select{font-family:var(--font);font-size:12px;user-select:text}
button{font-family:var(--font);cursor:pointer}
::-webkit-scrollbar{width:5px;height:5px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:var(--bd);border-radius:9px}
::-webkit-scrollbar-thumb:hover{background:var(--tx3)}

#app{display:flex;flex-direction:column;height:100vh;height:100dvh;overflow:hidden}
#layout{flex:1;display:flex;overflow:hidden;min-height:0}
#bottom-nav{display:none;flex-shrink:0}
#sidebar{display:none}

/* Topbar */
#topbar{height:var(--th);flex-shrink:0;display:flex;align-items:center;gap:8px;padding:0 14px;background:var(--s1);border-bottom:1px solid var(--bd);z-index:30}
.tb-logo{font-size:14px;font-weight:700;color:var(--bright);flex-shrink:0}
.tb-dot{color:var(--bd);flex-shrink:0}
.tb-stat{font-size:11px;color:var(--tx2);white-space:nowrap;flex-shrink:0}
.tb-stat.on{color:var(--green)}
.tb-stat.run{color:var(--yellow)}
.tb-stat.rev{color:var(--accent)}
.tb-stat.err{color:var(--red)}
.tb-fill{flex:1}
.tb-icon-btn{width:32px;height:32px;background:var(--s2);color:var(--tx2);border:1px solid var(--bd);border-radius:var(--r);display:flex;align-items:center;justify-content:center;font-size:15px;flex-shrink:0;transition:.15s}
.tb-icon-btn:hover{background:var(--s3);color:var(--tx)}

/* Sidebar */
#sidebar{flex-direction:column;width:var(--aw);flex-shrink:0;background:var(--s1);border-right:1px solid var(--bd);overflow:hidden}
.sb-hdr{display:flex;align-items:center;justify-content:space-between;padding:10px 12px 8px;flex-shrink:0;border-bottom:1px solid var(--bd)}
.sb-title{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.7px;color:var(--tx2)}
.sb-ct{background:var(--s2);color:var(--tx2);font-size:11px;padding:1px 7px;border-radius:20px}
.sb-list{flex:1;overflow-y:auto;padding:6px}
.sb-empty{padding:20px 12px;text-align:center;color:var(--tx3);font-size:12px;line-height:1.6}

.ai{padding:8px 10px;border-radius:var(--r);cursor:pointer;transition:background .12s;border:1px solid transparent;margin-bottom:2px}
.ai:hover{background:var(--s2)}
.ai.sel{background:var(--s2);border-color:var(--bd-hi)}
.ai-r1{display:flex;align-items:center;gap:6px;margin-bottom:3px}
.ai-name{font-size:12px;font-weight:600;color:var(--bright);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ai-proj{font-size:11px;color:var(--tx2);margin-bottom:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ai-chips{display:flex;gap:4px;flex-wrap:wrap;margin-bottom:2px}
.ai-chip{font-size:10px;padding:1px 6px;border-radius:3px;background:var(--s3);color:var(--tx2)}
.ai-chip.run{background:var(--yd);color:var(--yellow)}
.ai-chip.rev{background:var(--accent-dim);color:var(--accent)}
.ai-age{font-size:10px;color:var(--tx3)}

/* Dot */
.dot{display:inline-block;width:7px;height:7px;border-radius:50%;flex-shrink:0}
.dot-on{background:var(--green)}
.dot-off{background:var(--red)}
.dot-busy{background:var(--yellow)}
.dot-idle{background:var(--tx2)}

/* Main panel */
#main-panel{flex:1;display:flex;flex-direction:column;overflow:hidden;min-width:0;min-height:0}
.empty-state{flex:1;display:flex;align-items:center;justify-content:center;padding:24px}
.es-inner{text-align:center;max-width:280px}
.es-icon{font-size:32px;opacity:.25;margin-bottom:12px}
.es-title{font-size:16px;font-weight:600;color:var(--bright);margin-bottom:6px}
.es-sub{font-size:12px;color:var(--tx2);line-height:1.6}

/* Tab bar */
.tab-bar{display:flex;align-items:center;gap:2px;background:var(--s1);border-bottom:1px solid var(--bd);flex-shrink:0;padding:0 8px;min-height:42px}
.tb2{background:none;color:var(--tx2);border:none;padding:6px 14px;font-size:13px;font-weight:500;min-height:var(--touch);border-bottom:2px solid transparent;transition:.12s;white-space:nowrap;position:relative}
.tb2:hover{color:var(--tx)}
.tb2.active{color:var(--bright);border-bottom-color:var(--accent)}
.tab-agent{margin-left:auto;display:flex;align-items:center;gap:6px;padding:0 6px;font-size:11px;color:var(--tx2);overflow:hidden;max-width:180px}
.tab-agent-nm{color:var(--tx);font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tab-back{display:none;background:none;color:var(--accent);border:none;font-size:12px;padding:6px 10px;min-height:var(--touch)}

/* Tab content */
.tab-content{flex:1;display:flex;flex-direction:column;overflow:hidden;min-height:0}
.tab-scroll{flex:1;overflow-y:auto;padding:12px;-webkit-overflow-scrolling:touch}

/* Buttons */
.btn{display:inline-flex;align-items:center;gap:5px;background:var(--s2);color:var(--tx);border:1px solid var(--bd);border-radius:var(--r);padding:7px 13px;font-size:12px;font-weight:500;min-height:var(--touch);white-space:nowrap;transition:.12s}
.btn:hover{background:var(--s3);border-color:var(--tx2);color:var(--bright)}
.btn:active{transform:scale(.97)}
.btn-sm{padding:4px 10px;min-height:30px;font-size:11px}
.btn-xs{padding:3px 7px;min-height:24px;font-size:10px}
.btn-primary{background:var(--accent-dim);color:var(--accent);border-color:var(--accent)}
.btn-primary:hover{background:var(--accent);color:#000}
.btn-success{background:var(--gd);color:var(--green);border-color:var(--green)}
.btn-success:hover{background:var(--green);color:#000}
.btn-warn{background:var(--yd);color:var(--yellow);border-color:var(--yellow)}
.btn-warn:hover{background:var(--yellow);color:#000}
.btn-danger{background:var(--rd);color:var(--red);border-color:var(--red)}
.btn-danger:hover{background:var(--red);color:#fff}
.btn[disabled],.btn:disabled{opacity:.4;pointer-events:none}

/* Inputs */
.inp{background:var(--s2);color:var(--tx);border:1px solid var(--bd);border-radius:var(--r);padding:7px 10px;font-size:12px;width:100%}
.inp:focus{border-color:var(--bd-hi);outline:none}
.sel{background:var(--s2);color:var(--tx);border:1px solid var(--bd);border-radius:var(--r);padding:6px 8px;font-size:12px;cursor:pointer}
.sel:focus{border-color:var(--bd-hi);outline:none}
.ta{background:var(--s2);color:var(--tx);border:1px solid var(--bd);border-radius:var(--r);padding:8px 10px;font-size:12px;width:100%;resize:vertical;line-height:1.5;font-family:var(--mono)}
.ta:focus{border-color:var(--bd-hi);outline:none}

/* Status tags */
.stag{display:inline-flex;align-items:center;padding:2px 8px;border-radius:20px;font-size:10px;font-weight:600;letter-spacing:.2px;flex-shrink:0}
.stag-queued,.stag-skipped,.stag-cancelled{background:var(--s3);color:var(--tx3)}
.stag-assigned{background:var(--accent-dim);color:var(--accent)}
.stag-running,.stag-completed{background:var(--gd);color:var(--green)}
.stag-reviewing,.stag-iterating{background:var(--yd);color:var(--yellow)}
.stag-needs-review{background:var(--yd);color:var(--yellow);font-weight:700}
.stag-auto-approved{background:#0a2222;color:var(--cyan)}
.stag-failed{background:var(--rd);color:var(--red)}

/* Badges */
.badge{display:inline-flex;align-items:center;background:var(--s3);color:var(--tx2);padding:1px 6px;border-radius:4px;font-size:10px;gap:2px;font-family:var(--mono)}
.badge-auto{background:var(--gd);color:var(--green)}
.badge-apply{background:#0a2222;color:var(--cyan)}
.badge-max{background:var(--yd);color:var(--yellow);font-weight:700}

/* Cards */
.card{background:var(--s1);border:1px solid var(--bd);border-radius:var(--r2);margin-bottom:4px;overflow:hidden;transition:border-color .15s}
.card:hover{border-color:var(--tx2)}
.card.exp{border-color:var(--bd-hi)}

/* Task cards */
.task-group{margin-bottom:16px}
.group-hdr{display:flex;align-items:center;gap:8px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:var(--tx2);padding:6px 0;border-bottom:1px solid var(--bd);margin-bottom:6px}
.group-ct{background:var(--s2);color:var(--tx2);font-size:10px;padding:1px 7px;border-radius:20px}

.tcard{background:var(--s1);border:1px solid var(--bd);border-radius:var(--r2);margin-bottom:4px;overflow:hidden;transition:border-color .15s}
.tcard:hover{border-color:var(--tx2)}
.tcard.exp{border-color:var(--bd-hi)}
.tc-head{display:flex;align-items:center;gap:8px;padding:10px 12px;cursor:pointer;user-select:none;min-height:42px}
.tc-head:hover{background:var(--s2)}
.tc-title{flex:1;font-size:13px;font-weight:500;color:var(--bright);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tc-chev{color:var(--tx2);font-size:11px;flex-shrink:0;transition:transform .15s}
.tcard.exp .tc-chev{transform:rotate(180deg)}
.tc-actions{display:flex;flex-wrap:wrap;gap:4px;padding:0 10px 8px}
.tc-exp{padding:12px;border-top:1px solid var(--bd);background:var(--s2)}

.tl-meta{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px;padding:8px 10px;background:var(--s1);border-radius:var(--r);border:1px solid var(--bd);font-size:11px}
.tl-meta-k{color:var(--tx2)}
.tl-meta-v{color:var(--tx);font-family:var(--mono)}
.tl-sect{margin-bottom:12px}
.tl-sh{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:var(--tx2);display:flex;align-items:center;justify-content:space-between;padding-bottom:6px;border-bottom:1px solid var(--bd);margin-bottom:6px}
.tl-prompt{font-family:var(--mono);font-size:11px;color:var(--tx);white-space:pre-wrap;word-break:break-word;max-height:140px;overflow-y:auto;background:var(--bg);border:1px solid var(--bd);border-radius:var(--r);padding:8px;line-height:1.5}
.tl-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px;padding-top:10px;border-top:1px solid var(--bd)}
.it-card{background:var(--s1);border:1px solid var(--bd);border-radius:var(--r);padding:10px;margin-bottom:8px}
.it-hdr{display:flex;align-items:center;gap:6px;margin-bottom:6px;flex-wrap:wrap}
.it-n{font-size:11px;font-weight:700;color:var(--tx2);font-family:var(--mono)}
.it-sum{font-family:var(--mono);font-size:11px;color:var(--tx);white-space:pre-wrap;max-height:80px;overflow-y:auto;margin-bottom:6px;line-height:1.45}
.it-files,.it-checks{display:flex;flex-wrap:wrap;gap:3px;margin-bottom:6px}
.it-file{background:var(--s3);color:var(--tx2);padding:1px 6px;border-radius:3px;font-family:var(--mono);font-size:10px}
.it-ck{padding:2px 8px;border-radius:20px;font-size:10px;font-weight:600}
.it-ck.pass{background:var(--gd);color:var(--green)}
.it-ck.fail{background:var(--rd);color:var(--red)}
.it-rev{padding:8px 10px;background:var(--yd);border-left:3px solid var(--yellow);border-radius:0 var(--r) var(--r) 0;font-size:11px;margin:4px 0;line-height:1.5;color:var(--tx)}
.it-next{padding:8px 10px;background:var(--accent-dim);border-left:3px solid var(--accent);border-radius:0 var(--r) var(--r) 0;font-size:11px;color:var(--accent);margin:4px 0}
.it-dec{display:inline-block;padding:1px 7px;border-radius:4px;font-size:10px;font-weight:700;margin-right:4px}
.it-dec.approve{background:var(--gd);color:var(--green)}
.it-dec.reject{background:var(--rd);color:var(--red)}
.it-dec.failed,.it-dec.changes_requested{background:var(--yd);color:var(--yellow)}
.diff-btn{background:var(--s3);color:var(--tx2);border:1px solid var(--bd);border-radius:var(--r);padding:3px 9px;font-size:10px;min-height:26px;margin-top:4px;font-family:var(--mono);display:inline-flex;align-items:center;gap:4px}
.diff-btn:hover{background:var(--s2);color:var(--tx)}
.diff-block{background:var(--bg);border:1px solid var(--bd);border-radius:var(--r);color:var(--tx);font-size:10px;padding:8px;margin-top:4px;max-height:40vh;overflow:auto;white-space:pre;overflow-x:auto;font-family:var(--mono);line-height:1.35}

/* ── Files tab ── */
.files-layout{display:flex;gap:0;flex:1;overflow:hidden;min-height:0}
.file-tree-pane{width:240px;flex-shrink:0;overflow-y:auto;background:var(--s1);border-right:1px solid var(--bd);display:flex;flex-direction:column}
.ftp-hdr{padding:4px 8px;flex-shrink:0}
.ftp-search{background:var(--s2);color:var(--tx);border:1px solid var(--bd);border-radius:var(--r);padding:4px 8px;font-family:var(--font);font-size:11px;min-height:30px;width:100%}
.ftp-search:focus{border-color:var(--bd-hi);outline:none}
.ftp-tree{flex:1;overflow-y:auto;padding:4px}
.file-preview-pane{flex:1;display:flex;flex-direction:column;overflow:hidden;min-width:0}
.fpp-hdr{display:flex;align-items:center;gap:6px;padding:4px 10px;background:var(--s1);border-bottom:1px solid var(--bd);flex-shrink:0;min-height:36px;flex-wrap:wrap}
.fpp-path{font-family:var(--mono);font-size:11px;color:var(--accent);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}
.fpp-actions{display:flex;gap:4px;flex-shrink:0}
.fpp-body{flex:1;overflow-y:auto;padding:0;min-height:0}
.fpp-empty{flex:1;display:flex;align-items:center;justify-content:center;color:var(--tx3);font-size:12px;font-style:italic}
.fpp-pre{font-family:var(--mono);font-size:11px;color:var(--tx);white-space:pre;padding:10px;line-height:1.4;overflow:auto;min-height:100%}
.fpp-ta{font-family:var(--mono);font-size:11px;color:var(--tx);background:var(--bg);border:none;resize:none;width:100%;height:100%;padding:10px;line-height:1.4}
.fpp-summary{padding:8px 10px;background:var(--s1);border-top:1px solid var(--bd);font-size:11px;color:var(--tx);line-height:1.5;flex-shrink:0}
.fpp-img-wrap{flex:1;display:flex;align-items:center;justify-content:center;overflow:auto;padding:12px;min-height:0}
.fpp-img-wrap img{border-radius:var(--r);box-shadow:0 2px 12px rgba(0,0,0,.4)}

.tree-file,.tree-folder{cursor:pointer;padding:3px 6px 3px 14px;font-size:11px;color:var(--tx);display:flex;align-items:center;gap:4px;white-space:nowrap;border-radius:3px;min-height:24px}
.tree-file:hover,.tree-folder:hover{background:var(--s2)}
.tree-file.active{background:var(--accent-dim);color:var(--accent)}
.tree-icon{font-size:11px;width:16px;text-align:center;flex-shrink:0;color:var(--tx2)}
.tree-name{overflow:hidden;text-overflow:ellipsis}
.tree-lang{font-size:9px;color:var(--tx3);margin-left:4px}
.tree-children.collapsed{display:none}

/* ── Overview tab ── */
.ov-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px;margin-bottom:12px}
.ov-card{background:var(--s1);border:1px solid var(--bd);border-radius:var(--r2);padding:12px;text-align:center}
.ov-val{font-size:20px;font-weight:700;color:var(--bright)}
.ov-lbl{font-size:9px;text-transform:uppercase;letter-spacing:.5px;color:var(--tx2);margin-top:3px}
.ov-bar{height:3px;background:var(--bd);border-radius:2px;margin-top:6px;overflow:hidden}
.ov-bar-fill{height:100%;background:var(--accent);border-radius:2px}
.ov-sect{margin-bottom:14px}
.ov-sh{font-size:11px;font-weight:600;color:var(--tx2);text-transform:uppercase;letter-spacing:.5px;padding-bottom:4px;border-bottom:1px solid var(--bd)}
.ov-summary{font-size:12px;line-height:1.6;color:var(--tx);margin-top:5px}
.lang-bar{display:flex;align-items:center;gap:6px;margin:4px 0;font-size:11px}
.lang-name{color:var(--tx);width:80px;flex-shrink:0}
.lang-track{flex:1;height:6px;border-radius:3px;background:var(--s2);overflow:hidden}
.lang-fill{height:100%;border-radius:3px;background:var(--green)}
.lang-ct{color:var(--tx2);width:40px;text-align:right;font-size:10px}
.file-row{background:var(--s1);border:1px solid var(--bd);border-radius:var(--r);padding:8px 10px;margin-bottom:3px;cursor:pointer}
.file-row:hover{background:var(--s2)}
.file-path{font-family:var(--mono);font-size:11px;color:var(--accent);margin-bottom:2px}
.file-imp{font-size:10px;color:var(--yellow);margin-left:6px}
.file-tags{display:flex;gap:3px;flex-wrap:wrap;margin:2px 0}
.ftag{font-size:9px;background:var(--s3);color:var(--tx2);padding:1px 5px;border-radius:3px}
.file-sum{font-size:10px;color:var(--tx2);line-height:1.4}

/* ── Panels (ingest/new task/policy) ── */
.ingest-panel,.new-task-panel,.pol-form{background:var(--s1);border:1px solid var(--bd-hi);border-radius:var(--r2);padding:14px;margin-bottom:12px}
.ip-title,.ntp-title{font-size:13px;font-weight:600;color:var(--bright);margin-bottom:10px}
.ip-grid,.nt-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px}
.pol-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px}
.pol-field,.ip-field,.nt-field{display:flex;flex-direction:column;gap:3px}
.pol-field label,.ip-field label,.nt-field label{font-size:10px;font-weight:600;color:var(--tx2);text-transform:uppercase;letter-spacing:.4px}
.pol-field input,.ip-field input,.nt-field input,.pol-field select,.ip-field select,.nt-field select{background:var(--s2);color:var(--tx);border:1px solid var(--bd);border-radius:var(--r);padding:6px 8px;font-size:11px;min-height:32px;font-family:var(--mono);width:100%}
.pol-field input:focus,.ip-field input:focus,.nt-field input:focus,.pol-field select:focus,.ip-field select:focus,.nt-field select:focus{border-color:var(--bd-hi);outline:none}
.ta-field textarea,.ingest-ta,.nt-ta{background:var(--s2);color:var(--tx);border:1px solid var(--bd);border-radius:var(--r);padding:8px 10px;font-family:var(--mono);font-size:11px;resize:vertical;min-height:80px;width:100%;line-height:1.5}
.ta-field textarea:focus,.ingest-ta:focus,.nt-ta:focus{border-color:var(--bd-hi);outline:none}
.ip-btns,.nt-btns{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px}
.ip-checks,.pol-checks{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:8px}
.ip-ck,.pol-ck{display:flex;align-items:center;gap:5px;font-size:11px;color:var(--tx);cursor:pointer;min-height:28px}
.ip-ck input,.pol-ck input{accent-color:var(--accent);cursor:pointer}
.ip-result{padding:8px 10px;background:var(--gd);border:1px solid var(--green);border-radius:var(--r);font-size:11px;color:var(--green)}
.ip-warn{padding:6px 10px;background:var(--yd);border-radius:var(--r);font-size:11px;color:var(--yellow);margin-top:4px}

/* ── Chat ── */
.chat-outer{flex:1;display:flex;flex-direction:column;overflow:hidden;min-height:0}
.chat-tb{display:flex;align-items:center;gap:6px;padding:8px 12px;background:var(--s1);border-bottom:1px solid var(--bd);flex-shrink:0;flex-wrap:wrap}
.ct-sel{flex:1;min-width:140px;min-height:34px;font-size:12px}
.chat-msgs{flex:1;overflow-y:auto;padding:16px 12px;-webkit-overflow-scrolling:touch;display:flex;flex-direction:column;gap:10px;min-height:0}
.chat-no-sess{flex:1;display:flex;align-items:center;justify-content:center;padding:24px;color:var(--tx2);font-size:12px;text-align:center}
.msg{display:flex;flex-direction:column;max-width:80%}
.msg.user{align-self:flex-end;align-items:flex-end}
.msg.assistant,.msg.system,.msg.patch{align-self:flex-start;align-items:flex-start}
.msg-meta{font-size:10px;color:var(--tx2);display:flex;align-items:center;gap:5px;padding:0 4px;margin-bottom:3px;flex-wrap:wrap}
.msg-role{font-weight:600}
.msg-role.user{color:var(--accent)}
.msg-role.assistant{color:var(--green)}
.msg-role.patch{color:var(--cyan)}
.msg-role.system{color:var(--tx3)}
.msg-model{background:var(--s3);padding:1px 5px;border-radius:3px;font-family:var(--mono);font-size:9px;color:var(--tx2)}
.msg-time{color:var(--tx3)}
.msg-bub{padding:10px 13px;border-radius:12px;font-size:12px;line-height:1.6;word-break:break-word}
.msg.user .msg-bub{background:var(--accent-dim);border:1px solid var(--bd-hi);border-radius:12px 12px 3px 12px;color:var(--tx)}
.msg.assistant .msg-bub,.msg.patch .msg-bub{background:var(--s1);border:1px solid var(--bd);border-radius:12px 12px 12px 3px;font-family:var(--mono);font-size:11px;color:var(--tx)}
.msg.system .msg-bub{background:var(--s2);border:1px solid var(--bd);border-radius:var(--r);font-size:11px;color:var(--tx2);max-width:100%}
.msg-bub b{color:var(--bright)}
.msg-bub em{color:var(--cyan);font-style:italic}
.msg-bub code{background:var(--s3);padding:1px 5px;border-radius:3px;font-family:var(--mono);font-size:10px;color:var(--tx)}
.msg-bub pre{background:var(--bg);border:1px solid var(--bd);border-radius:var(--r);padding:10px;margin:6px 0;overflow-x:auto;font-size:10px;font-family:var(--mono);white-space:pre;line-height:1.4;color:var(--tx)}
.msg-bub ul,.msg-bub ol{padding-left:16px;margin:4px 0}
.msg-bub li{margin-bottom:2px}

.chat-qtns{flex-shrink:0;background:var(--yd);border-top:2px solid var(--yellow);padding:10px 12px;max-height:150px;overflow-y:auto}
.cq-title{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--yellow);margin-bottom:8px}
.cq-item{margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid rgba(210,153,34,.2)}
.cq-text{font-size:12px;color:var(--tx);margin-bottom:6px;line-height:1.5}
.cq-row{display:flex;gap:6px}
.cq-inp{flex:1;background:var(--s3);color:var(--tx);border:1px solid var(--bd);border-radius:var(--r);padding:6px 8px;font-size:11px;min-height:32px}
.cq-inp:focus{border-color:var(--yellow);outline:none}

.chat-inp-area{flex-shrink:0;background:var(--s1);border-top:1px solid var(--bd);padding:10px 12px;padding-bottom:max(10px,env(safe-area-inset-bottom))}
.chat-opts{display:flex;gap:4px;margin-top:4px}
.chat-opt-sel{flex:none;min-width:90px;font-size:10px;padding:2px 4px;min-height:26px}
.chat-row{display:flex;gap:8px;align-items:flex-end}
.chat-ta{flex:1;background:var(--s2);color:var(--tx);border:1px solid var(--bd);border-radius:12px;padding:10px 14px;font-size:13px;resize:none;min-height:var(--touch);max-height:120px;line-height:1.5;font-family:var(--font);transition:border-color .15s}
.chat-ta:focus{border-color:var(--bd-hi);outline:none}
.chat-send-btn{background:var(--accent);color:#fff;border:none;border-radius:12px;width:44px;height:44px;font-size:20px;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:.15s;align-self:flex-end}
.chat-send-btn:hover{background:#79b8ff;transform:scale(1.05)}
.chat-send-btn:active{transform:scale(.93)}
.chat-send-btn:disabled{opacity:.4;transform:none}
.chat-hint{font-size:10px;color:var(--tx3);margin-top:5px;text-align:right}

.thinking{display:inline-flex;gap:3px;align-items:center}
.thinking span{display:inline-block;width:5px;height:5px;border-radius:50%;background:var(--tx2);animation:think 1.4s infinite}
.thinking span:nth-child(2){animation-delay:.2s}
.thinking span:nth-child(3){animation-delay:.4s}
@keyframes think{0%,60%,100%{opacity:.3;transform:scale(.8)}30%{opacity:1;transform:scale(1.2)}}

/* ── Modal / Toast ── */
.modal{position:fixed;inset:0;background:rgba(0,0,0,.75);display:flex;align-items:center;justify-content:center;z-index:1000;padding:20px}
.modal-box{background:var(--s2);border:1px solid var(--bd);border-radius:var(--r2);padding:20px;max-width:360px;width:100%;box-shadow:0 25px 50px rgba(0,0,0,.5)}
.modal-msg{font-size:14px;color:var(--tx);margin-bottom:16px;line-height:1.6}
.modal-btns{display:flex;gap:8px;justify-content:flex-end}
#toast{position:fixed;bottom:70px;left:50%;transform:translateX(-50%) translateY(8px);background:var(--s3);border:1px solid var(--bd);color:var(--tx);padding:8px 18px;border-radius:20px;font-size:12px;z-index:9999;max-width:90vw;text-align:center;pointer-events:none;opacity:0;transition:opacity .2s,transform .2s;white-space:nowrap}
#toast.show{opacity:1;transform:translateX(-50%) translateY(0)}
#toast.err{border-color:var(--red);color:var(--red);background:var(--rd)}

/* ── Mobile ── */
@media(max-width:767px){
  #sidebar{display:none!important}
  #bottom-nav{display:flex;background:var(--s1);border-top:1px solid var(--bd);padding-bottom:env(safe-area-inset-bottom,0);flex-shrink:0}
  .bn-btn{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;padding:8px 4px;background:none;border:none;border-top:2px solid transparent;color:var(--tx2);font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:.4px;min-height:var(--nh);cursor:pointer;transition:.1s}
  .bn-btn:hover{color:var(--tx)}
  .bn-btn.active{color:var(--accent);border-top-color:var(--accent)}
  .bn-icon{font-size:18px}
  .bn-badge{display:inline-block;background:var(--yellow);color:#000;font-size:8px;font-weight:700;padding:0 4px;border-radius:8px;margin-left:2px}
  #layout{flex-direction:column}
  #main-panel{flex:1;min-height:0}
  .tab-back{display:inline-flex}
  .tab-agent{display:none}
  .files-layout{flex-direction:column}
  .file-tree-pane{width:100%;max-height:30vh;flex-shrink:0;border-right:none;border-bottom:1px solid var(--bd)}
  #toast{bottom:calc(var(--nh) + 10px + env(safe-area-inset-bottom,0px))}
}
@media(max-width:480px){
  .ip-grid,.nt-grid,.pol-grid{grid-template-columns:1fr}
}

/* ── Desktop ── */
@media(min-width:768px){
  #layout{flex-direction:row}
  .file-tree-pane{width:210px}
}
@media(min-width:900px){
  .file-tree-pane{width:240px}
}
`
