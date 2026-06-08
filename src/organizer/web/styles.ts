export const styles = `*,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#080c08;--surface:#0d120d;--surface2:#111811;--border:#1a2a1a;--fg:#3a3;--fg-dim:#263626;--fg-bright:#4b4;--accent:#0cc;--warn:#e80;--danger:#f44;--font:ui-monospace,'Cascadia Code','Fira Code','JetBrains Mono',monospace;--radius:6px;--shadow:0 1px 3px rgba(0,0,0,.4)}
html,body{height:100%;overflow:hidden}
body{background:var(--bg);color:var(--fg);font-family:var(--font);font-size:12px;line-height:1.4;-webkit-tap-highlight-color:transparent;user-select:none}
#app{display:flex;flex-direction:column;height:100%}

/* Top bar */
#topbar{display:flex;align-items:center;justify-content:space-between;background:var(--surface);border-bottom:1px solid var(--border);padding:0 10px;min-height:44px;flex-shrink:0;z-index:20}
#topbar-left{display:flex;align-items:baseline;gap:12px;overflow:hidden}
#topbar h1{font-size:12px;font-weight:700;color:var(--fg-bright);white-space:nowrap;letter-spacing:.5px}
#topbar-stats{font-size:10px;color:var(--fg-dim);white-space:nowrap}
#topbar-stats span{color:var(--fg);font-weight:600}
#topbar-right{display:flex;align-items:center;gap:8px}
#tb-tasks{font-size:10px;color:var(--fg-dim);display:none}
#refresh-btn{width:32px;height:32px;background:var(--surface2);color:var(--fg);border:1px solid var(--border);border-radius:var(--radius);cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
#refresh-btn:hover{background:var(--fg);color:#000}
#refresh-btn:active{transform:scale(.92)}

/* Main layout */
#main{display:flex;flex-direction:column;flex:1;overflow:hidden}

/* Sidebar */
#sidebar{display:none;flex-direction:column;background:var(--surface);border-right:1px solid var(--border);padding:6px;gap:2px;overflow-y:auto;flex-shrink:0}
.nav-btn{display:flex;align-items:center;gap:8px;background:transparent;color:var(--fg-dim);border:none;border-radius:var(--radius);padding:8px 10px;cursor:pointer;font-family:var(--font);font-size:11px;text-align:left;min-height:36px;transition:background .1s,color .1s}
.nav-btn:hover{background:var(--surface2);color:var(--fg)}
.nav-btn.active{background:var(--surface2);color:var(--fg-bright)}
.nav-btn .nav-icon{font-size:14px;width:18px;text-align:center;flex-shrink:0}
.nav-btn .nav-label{white-space:nowrap}

/* Content panel */
#content{flex:1;overflow-y:auto;padding:8px;-webkit-overflow-scrolling:touch}

/* Details panel */
#details{display:none;overflow-y:auto;padding:8px;background:var(--surface);border-top:1px solid var(--border)}
#detail-empty{color:var(--fg-dim);text-align:center;margin-top:32px;font-size:12px;font-style:italic}

/* Bottom nav (mobile) */
#bottomnav{display:flex;background:var(--surface);border-top:1px solid var(--border);flex-shrink:0;z-index:20}
#bottomnav .nav-btn{flex:1;flex-direction:column;align-items:center;justify-content:center;gap:2px;padding:6px 2px;border-radius:0;min-height:50px;font-size:9px}
#bottomnav .nav-btn .nav-icon{font-size:16px}
#bottomnav .nav-btn.active{border-top:2px solid var(--fg-bright);background:transparent}
.bn-badge{position:absolute;top:2px;margin-left:18px;background:var(--warn);color:#000;font-size:9px;font-weight:700;padding:0 4px;border-radius:8px;min-width:16px;height:15px;line-height:15px;text-align:center}
#bn-review-badge{position:relative}

/* Desktop layout */
@media(min-width:768px){
  #topbar{padding:0 14px;min-height:42px}
  #topbar h1{font-size:13px}
  #topbar-stats{font-size:11px}
  #tb-tasks{display:inline}
  #main{flex-direction:row}
  #sidebar{display:flex;width:170px;padding:8px}
  #sidebar .nav-btn{padding:7px 10px;min-height:34px}
  #content{border-right:1px solid var(--border)}
  #details{display:block;width:380px;flex-shrink:0;border-top:none}
  #bottomnav{display:none}
}

@media(min-width:1024px){
  #sidebar{width:190px}
  #sidebar .nav-btn{padding:8px 12px}
  #details{width:420px}
}

/* Stats cards */
.stats-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:6px;margin-bottom:12px}
.stat-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:10px;text-align:center}
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

/* Agent card */
.agent-card .name{display:flex;align-items:center;gap:6px}

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
.tag-accepted{background:#0a2a0a;color:var(--fg)}

/* Badges */
.badge{display:inline-block;background:var(--surface2);color:var(--fg-dim);padding:1px 6px;border-radius:3px;font-size:9px;margin:1px;font-weight:500}
.badge-on{background:#0a2a0a;color:var(--fg)}
.badge-warn{background:#2a1500;color:var(--warn)}
.badge-info{background:#0a0a2a;color:#88f}

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

/* Edit form */
.edit-form{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:8px;margin-top:6px}
.edit-form label{display:block;color:var(--fg-dim);font-size:10px;margin-bottom:4px}
.edit-form input,.edit-form select{background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:4px;padding:6px;font-family:var(--font);font-size:11px;width:100%;margin-bottom:4px;min-height:32px}
.edit-form input[type=checkbox]{width:auto;min-height:auto;margin-right:4px}
.edit-form .btn{margin-top:4px}

/* Confirm overlay */
.confirm-overlay{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.85);display:flex;align-items:center;justify-content:center;z-index:100}
.confirm-box{background:var(--surface);border:2px solid var(--warn);border-radius:var(--radius);padding:16px;max-width:320px;text-align:center}
.confirm-box p{color:var(--warn);margin-bottom:12px;font-size:12px}
.confirm-box button{margin:4px 8px;padding:8px 16px;font-family:var(--font);font-size:12px;cursor:pointer;min-height:40px;border-radius:var(--radius)}
.confirm-box .btn-yes{background:#2a0000;color:var(--danger);border:1px solid var(--danger)}
.confirm-box .btn-no{background:var(--surface2);color:var(--fg);border:1px solid var(--border)}

/* Settings panel */
.settings-section{margin-bottom:12px}
.settings-section h3{font-size:11px;color:var(--fg-bright);border-bottom:1px solid var(--border);padding-bottom:4px;margin-bottom:6px}

/* Scrollbar */
::-webkit-scrollbar{width:5px;height:5px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:var(--border);border-radius:3px}
::-webkit-scrollbar-thumb:hover{background:var(--fg-dim)}

/* Pulse animation for refresh */
@keyframes spin{to{transform:rotate(360deg)}}
.spinning{animation:spin .6s linear;pointer-events:none;opacity:.6}
`
