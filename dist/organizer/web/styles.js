export const styles = `*,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
:root{
  --bg:#030603;--panel:#071007;--panel2:#0b160b;--panel3:#102010;
  --border:#1d3a1d;--borderS:#3a3;--text:#a7f7a7;--muted:#5f8f5f;
  --bright:#53ff53;--accent:#34d6d6;--warn:#ffbf4d;--danger:#ff5c5c;
  --shadow:rgba(83,255,83,.12);--font:ui-monospace,"Cascadia Code","Fira Code",monospace;
  --r:6px;--touch:44px;
}
html,body,#app{min-height:100%}
body{overflow-x:hidden;background:var(--bg);color:var(--text);font-family:var(--font);font-size:12px;line-height:1.4;-webkit-tap-highlight-color:transparent}
.app-shell{display:grid;grid-template-rows:auto 1fr auto;grid-template-areas:"topbar" "content" "bottomnav";min-height:100dvh}

#topbar{grid-area:topbar;display:flex;align-items:center;justify-content:space-between;gap:8px;background:var(--panel);border-bottom:1px solid var(--border);padding:0 10px;min-height:var(--touch);position:sticky;top:0;z-index:20;flex-shrink:0}
#topbar .tb-title{font-size:12px;font-weight:700;color:var(--bright);white-space:nowrap}
#topbar .tb-stats{font-size:10px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#topbar .tb-btn{width:32px;height:32px;background:var(--panel2);color:var(--text);border:1px solid var(--border);border-radius:var(--r);cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
#topbar .tb-btn:hover{background:var(--bright);color:#000}
#topbar .tb-btn:active{transform:scale(.92)}

#sidebar{display:none}
#content{grid-area:content;overflow-y:auto;padding:8px;-webkit-overflow-scrolling:touch}
#detail{display:none}
#bottomnav{grid-area:bottomnav;display:flex;background:var(--panel);border-top:1px solid var(--border);position:sticky;bottom:0;z-index:20;flex-shrink:0}

@media(min-width:900px){
  .app-shell{grid-template-columns:190px 1fr 0;grid-template-rows:auto 1fr;grid-template-areas:"topbar topbar" "sidebar content"}
  #sidebar{display:flex;flex-direction:column;background:var(--panel);border-right:1px solid var(--border);padding:6px;gap:2px;overflow-y:auto}
  #content{padding:12px}
  #bottomnav{display:none}
}
@media(min-width:1100px){
  .app-shell{grid-template-areas:"topbar topbar topbar" "sidebar content detail"}
  #detail{display:block;overflow-y:auto;padding:12px;background:var(--panel);border-left:1px solid var(--border);width:380px;flex-shrink:0}
  .app-shell{grid-template-columns:190px 1fr 380px}
}

/* Nav buttons */
.nbtn{display:flex;align-items:center;gap:8px;background:transparent;color:var(--muted);border:none;border-radius:var(--r);padding:10px 12px;cursor:pointer;font-family:var(--font);font-size:11px;text-align:left;min-height:var(--touch);transition:background .15s,color .15s}
.nbtn:hover,.nbtn:active{background:var(--panel2);color:var(--text)}
.nbtn.active{background:var(--panel2);color:var(--bright)}
.nbtn .ic{font-size:15px;width:20px;text-align:center;flex-shrink:0}
#bottomnav .nbtn{flex:1;flex-direction:column;align-items:center;gap:2px;padding:6px 2px;border-radius:0;min-height:52px;font-size:9px;letter-spacing:.2px}
#bottomnav .nbtn.active{border-top:2px solid var(--bright);background:transparent;color:var(--bright)}

/* Scrollbar */
::-webkit-scrollbar{width:5px;height:5px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:var(--border);border-radius:3px}
::-webkit-scrollbar-thumb:hover{background:var(--muted)}

/* Grid cards */
.grid2{display:grid;grid-template-columns:repeat(2,1fr);gap:6px;margin-bottom:10px}
.grid4{display:grid;grid-template-columns:repeat(2,1fr);gap:6px;margin-bottom:10px}
@media(min-width:500px){.grid4{grid-template-columns:repeat(4,1fr)}}
@media(min-width:900px){.grid2{grid-template-columns:repeat(4,1fr)}}

/* Stat card */
.scard{background:var(--panel);border:1px solid var(--border);border-radius:var(--r);padding:10px;text-align:center;cursor:pointer;transition:border-color .15s,background .15s}
.scard:hover{border-color:var(--muted);background:var(--panel2)}
.scard .n{font-size:20px;color:var(--bright);font-weight:700}
.scard .l{font-size:9px;color:var(--muted);text-transform:uppercase;margin-top:2px;letter-spacing:.5px}
.scard.warn .n{color:var(--warn)}
.scard.danger .n{color:var(--danger)}

/* Card */
.card{background:var(--panel);border:1px solid var(--border);border-radius:var(--r);padding:8px 10px;margin-bottom:4px;cursor:pointer;transition:border-color .1s,background .1s;overflow:hidden}
.card:hover{border-color:var(--muted);background:var(--panel2)}
.card.selected{border-color:var(--bright);background:#0a1a0a}
.card .ctitle{color:var(--bright);font-weight:600;font-size:11px;word-break:break-word}
.card .cmeta{color:var(--muted);font-size:10px;margin-top:2px}
.card .csub{color:#557;font-size:9px;margin-top:1px}

/* Dot */
.dot{display:inline-block;width:7px;height:7px;border-radius:50%;flex-shrink:0}
.dot-on{background:var(--bright);box-shadow:0 0 5px var(--bright)}
.dot-off{background:var(--danger)}
.dot-busy{background:var(--warn);box-shadow:0 0 4px var(--warn)}
.dot-idle{background:var(--text);box-shadow:0 0 3px var(--text)}

/* Tags */
.tag{display:inline-block;padding:1px 6px;border-radius:3px;font-size:9px;font-weight:600;line-height:16px;margin:1px;text-transform:uppercase;letter-spacing:.3px}
.tag-queued,.tag-skipped,.tag-cancelled{background:#1a1a1a;color:#666}
.tag-assigned{background:#0a0a2a;color:#66f}
.tag-running,.tag-completed{background:#0a2a0a;color:var(--text)}
.tag-reviewing,.tag-iterating{background:#2a2a0a;color:#ee0}
.tag-needs_review{background:#2a1500;color:var(--warn)}
.tag-auto_approved{background:#002a2a;color:var(--accent)}
.tag-failed{background:#2a0000;color:var(--danger)}

/* Badges */
.badge{display:inline-block;background:var(--panel2);color:var(--muted);padding:1px 6px;border-radius:3px;font-size:9px;margin:1px}
.badge-on{background:#0a2a0a;color:var(--text)}
.badge-warn{background:#2a1500;color:var(--warn)}
.badge-info{background:#0a0a2a;color:#88f}

/* Section */
.sect{margin-bottom:12px}
.sect-title{font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.8px;padding:6px 0;border-bottom:1px solid var(--border);margin-bottom:6px}

/* Group header */
.gh{color:var(--muted);font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.4px;padding:6px 0 3px;margin-top:8px;border-bottom:1px solid var(--border)}

/* Empty/loading/error */
.empty{color:#446;font-style:italic;padding:14px 10px;font-size:11px;text-align:center}
.loading{color:var(--muted);padding:14px 10px;text-align:center;font-size:11px}
.err-msg{color:var(--danger);background:#2a0000;border:1px solid var(--danger);border-radius:var(--r);padding:8px 10px;margin:8px 0;font-size:10px;white-space:pre-wrap}
.warn-msg{color:var(--warn);background:#2a2000;border:1px solid var(--warn);border-radius:var(--r);padding:8px 10px;margin:6px 0;font-size:10px}

/* Filter bar */
.fbar{display:flex;flex-wrap:wrap;gap:3px;margin-bottom:8px}
.fbar .btn{font-size:9px;padding:4px 8px;min-height:26px}

/* Buttons */
.btns{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px}
.btn{background:var(--panel2);color:var(--text);border:1px solid var(--border);border-radius:var(--r);padding:7px 12px;cursor:pointer;font-family:var(--font);font-size:10px;min-height:var(--touch);white-space:nowrap;transition:background .1s;display:inline-flex;align-items:center;justify-content:center;gap:4px}
.btn:hover{background:var(--bright);color:#000;border-color:var(--bright)}
.btn:active{transform:scale(.96)}
.btn-sm{font-size:9px;padding:4px 8px;min-height:28px}
.btn-accent{background:var(--borderS);color:#000;border-color:var(--borderS);font-weight:600}
.btn-accent:hover{background:var(--bright)}
.btn-warn{background:#2a1500;color:var(--warn);border-color:var(--warn)}
.btn-warn:hover{background:var(--warn);color:#000}
.btn-danger{background:#2a0000;color:var(--danger);border-color:var(--danger)}
.btn-danger:hover{background:var(--danger);color:#000}
.btn[disabled],.btn:disabled{opacity:.4;pointer-events:none}

/* Forms */
.form{background:var(--panel);border:1px solid var(--border);border-radius:var(--r);padding:10px;margin-bottom:8px}
.form label{display:block;color:var(--muted);font-size:9px;margin:5px 0 2px;text-transform:uppercase;letter-spacing:.3px}
.form input,.form select,.form textarea{background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:4px;padding:7px;font-family:var(--font);font-size:10px;width:100%;margin-bottom:2px;min-height:36px}
.form input[type=checkbox]{width:auto;min-height:auto;margin-right:4px}
.form textarea{resize:vertical;min-height:80px}
.form .btn{margin-top:4px}
.form-row{display:grid;grid-template-columns:1fr 1fr;gap:4px}

/* Detail rows */
.dr{margin-bottom:6px}
.drl{color:var(--muted);font-size:9px;text-transform:uppercase;letter-spacing:.4px;display:block;margin-bottom:2px}
.drv{color:#bbb;font-size:10px;white-space:pre-wrap;max-height:120px;overflow:auto;background:var(--bg);border:1px solid var(--border);border-radius:var(--r);padding:6px;margin-top:2px;word-break:break-word}

/* Collapsible */
.col-h{cursor:pointer;color:var(--text);padding:7px 0;border-bottom:1px solid var(--border);font-size:11px;font-weight:600;display:flex;justify-content:space-between;min-height:36px;user-select:none}
.col-h:hover{color:var(--bright)}
.col-b{padding:4px 0}

/* Task detail header (sticky on mobile) */
.tdh{position:sticky;top:0;background:var(--panel);z-index:5;padding:8px;margin:-8px -8px 8px;border-bottom:1px solid var(--border)}
@media(min-width:900px){.tdh{position:static;margin:0 0 8px;padding:0}}

/* Iteration card */
.itc{background:var(--panel);border:1px solid var(--border);border-radius:var(--r);padding:8px;margin-bottom:6px}
.itc-hdr{color:var(--accent);font-size:11px;font-weight:600;margin-bottom:4px}
.itc-sum{color:#bbb;font-size:10px;margin-bottom:4px;white-space:pre-wrap;max-height:100px;overflow:auto}
.itc-files{margin-bottom:4px;display:flex;flex-wrap:wrap;gap:2px}
.itc-file{display:inline-block;background:var(--panel2);color:#999;padding:2px 6px;border-radius:3px;font-size:9px}
.itc-checks{margin-bottom:4px;display:flex;flex-wrap:wrap;gap:2px}
.itc-ck{padding:2px 6px;border-radius:3px;font-size:9px;font-weight:600}
.itc-ck.pass{background:#0a2a0a;color:var(--text)}.itc-ck.fail{background:#2a0000;color:var(--danger)}
.itc-rev{margin:4px 0;padding:6px;background:#1a1a0a;border-left:2px solid #ee0;border-radius:0 var(--r) var(--r) 0;font-size:10px;word-break:break-word}
.itc-next{margin:4px 0;padding:6px;background:#0a1a1a;border-left:2px solid var(--accent);border-radius:0 var(--r) var(--r) 0;font-size:10px;color:var(--accent);word-break:break-word}
.itc-dec{display:inline-block;padding:2px 6px;border-radius:3px;font-size:9px;font-weight:700;margin-right:4px}
.itc-dec.approve{background:#0a2a0a;color:var(--text)}.itc-dec.reject{background:#2a0000;color:var(--danger)}.itc-dec.failed{background:#2a2a00;color:#e80}.itc-dec.changes_requested{background:#2a2a0a;color:#ee0}

/* Warning */
.wrn{padding:6px 10px;background:#2a2000;border-left:3px solid var(--warn);color:var(--warn);font-size:10px;margin:6px 0;border-radius:0 var(--r) var(--r) 0}

/* Diff */
.diff-btn{background:var(--panel2);color:var(--muted);border:1px solid var(--border);border-radius:var(--r);padding:4px 8px;cursor:pointer;font-family:var(--font);font-size:9px;margin-top:4px;min-height:28px}
.diff-btn:hover{background:var(--text);color:#000}
.diff-block{background:var(--bg);border:1px solid var(--border);border-radius:var(--r);color:var(--text);font-size:9px;padding:6px;margin-top:4px;max-height:50vh;overflow:auto;white-space:pre;overflow-x:auto;font-family:var(--font);line-height:1.35}

/* Event row */
.ev{font-size:10px;color:var(--muted);padding:4px 0;border-bottom:1px solid var(--border);word-break:break-word}
.ev-time{color:#555;margin-right:6px}

/* Model chips */
.models{display:flex;flex-wrap:wrap;gap:4px;margin:6px 0}
.mchip{background:var(--panel2);border:1px solid var(--border);border-radius:4px;padding:3px 8px;font-size:9px;color:var(--muted)}
.mchip .mn{color:var(--text);font-weight:600}

/* Chat */
.chat-msgs{max-height:350px;overflow-y:auto;padding:4px 0}
.cmsg{margin-bottom:8px;max-width:88%}
.cmsg.user{margin-left:auto}
.cmsg.user .cbub{background:#0a1a0a;border-color:var(--text)}
.cbub{background:var(--panel);border:1px solid var(--border);border-radius:var(--r);padding:8px;font-size:10px;line-height:1.5;white-space:pre-wrap;word-break:break-word}
.cmeta{font-size:8px;color:var(--muted);margin-bottom:2px}
.chat-inp{display:flex;flex-direction:column;gap:4px;padding:8px;border-top:1px solid var(--border);background:var(--panel)}
.chat-inp textarea{flex:1;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:var(--r);padding:8px;font-family:var(--font);font-size:10px;min-height:50px;resize:vertical}
.chat-tb{display:flex;align-items:center;flex-wrap:wrap;gap:4px;padding:6px 0;margin-bottom:4px}
.chat-tb select{background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:4px;padding:4px;font-family:var(--font);font-size:9px;min-height:30px}
.chat-row{display:flex;gap:4px;flex-shrink:0}
.chat-row select{background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:4px;padding:4px;font-family:var(--font);font-size:9px;min-height:28px}

/* Sessions */
.sess-item{padding:8px;border:1px solid var(--border);border-radius:var(--r);margin-bottom:4px;cursor:pointer}
.sess-item:hover{border-color:var(--muted);background:var(--panel2)}
.sess-item.sel{border-color:var(--bright);background:#0a1a0a}

/* Toast */
#toast{position:fixed;bottom:70px;left:50%;transform:translateX(-50%);background:var(--panel3);border:1px solid var(--borderS);color:var(--bright);padding:8px 16px;border-radius:var(--r);font-size:10px;z-index:200;max-width:90vw;text-align:center;pointer-events:none;opacity:0;transition:opacity .2s}
#toast.visible{opacity:1}
#toast.error{border-color:var(--danger);color:var(--danger)}

/* Modal overlay */
.modal{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.85);display:flex;align-items:center;justify-content:center;z-index:100}
.modal-box{background:var(--panel);border:2px solid var(--borderS);border-radius:var(--r);padding:16px;max-width:360px;width:90vw;max-height:80vh;overflow-y:auto}
.modal-box.warn{border-color:var(--warn)}
.modal-box p{color:var(--text);margin-bottom:12px;font-size:12px;line-height:1.5}
.modal-box .btns{justify-content:center}

/* More screen on mobile */
#more-screen{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;padding:12px}
#more-screen .mcard{background:var(--panel);border:1px solid var(--border);border-radius:var(--r);padding:16px 12px;text-align:center;cursor:pointer;min-height:80px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;transition:border-color .15s,background .15s}
#more-screen .mcard:hover{border-color:var(--muted);background:var(--panel2)}
#more-screen .mic{font-size:24px}
#more-screen .ml{font-size:11px;color:var(--text);font-weight:600}
#more-screen .ms{font-size:9px;color:var(--muted)}

/* Back button for mobile task detail */
.m-back{display:flex;align-items:center;gap:4px;color:var(--accent);font-size:10px;cursor:pointer;padding:4px 0;margin-bottom:6px}
.m-back:hover{color:var(--bright)}
@media(min-width:1100px){.m-back{display:none}}

/* Resize handle for detail pane */
@media(min-width:1100px){}

/* Scrollable sections */
.scroll-y{overflow-y:auto;-webkit-overflow-scrolling:touch}

/* Animation */
@keyframes spin{to{transform:rotate(360deg)}}
.spin{animation:spin .6s linear;pointer-events:none;opacity:.6}
@keyframes fadein{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
.fadein{animation:fadein .2s ease}
`;
