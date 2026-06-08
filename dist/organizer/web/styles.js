export const styles = `*{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#0a0a0a;--fg:#0f0;--dim:#333;--card:#111;--hover:#1a1a1a;--accent:#0ff;--warn:#f80}
body{background:var(--bg);color:var(--fg);font-family:monospace;font-size:13px;min-height:100vh;overflow-x:hidden}
#topbar{background:#111;border-bottom:1px solid var(--fg);padding:6px 12px;display:flex;align-items:center;justify-content:space-between;height:36px;position:sticky;top:0;z-index:10}
#topbar h1{font-size:14px;color:var(--fg);text-shadow:0 0 6px var(--fg);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#topbar .status{color:#888;font-size:10px;display:none}
#topbar button{background:#111;color:var(--fg);border:1px solid var(--fg);padding:2px 10px;cursor:pointer;font-family:monospace;font-size:11px;min-height:30px}
#topbar button:hover{background:#0a0;color:#000}
#main{display:flex;flex-direction:column;min-height:calc(100vh - 36px)}
#left,#center,#right{width:100%;overflow-y:auto;padding:8px}
#left{border-bottom:1px solid var(--dim)}
#right{border-top:1px solid var(--dim)}
#bottom-nav{display:flex;background:#111;border-top:1px solid var(--dim);position:sticky;bottom:0;z-index:10}
#bottom-nav button{flex:1;background:transparent;color:var(--fg);border:none;padding:8px 4px;cursor:pointer;font-family:monospace;font-size:10px;min-height:44px;display:flex;flex-direction:column;align-items:center;justify-content:center}
#bottom-nav button.active{background:#1a1a1a;color:var(--fg);border-bottom:2px solid var(--fg)}
#bottom-nav button .nav-icon{font-size:16px}

@media(min-width:700px){
  body{overflow:hidden}
  #topbar .status{display:block}
  #main{flex-direction:row;height:calc(100vh - 36px)}
  #left{width:260px;border-right:1px solid var(--dim);border-bottom:none}
  #center{flex:1;border-right:1px solid var(--dim)}
  #right{width:400px;border-top:none}
  #bottom-nav{display:none}
}

.panel{margin-bottom:12px}
.panel h3{font-size:12px;color:var(--fg);border-bottom:1px solid var(--dim);padding-bottom:4px;margin-bottom:6px}
.card{background:var(--card);border:1px solid var(--dim);padding:8px;margin-bottom:4px;cursor:pointer;font-size:12px;min-height:44px;display:flex;flex-direction:column;justify-content:center;overflow:hidden}
.card:hover{background:var(--hover);border-color:var(--fg)}
.card.selected{border-color:var(--fg);background:#0a1a0a}
.card .name{color:var(--fg);font-weight:bold;font-size:12px;word-break:break-word}
.card .meta{color:#666;font-size:10px;margin-top:1px}
.tag{display:inline-block;padding:2px 6px;border-radius:3px;font-size:10px;margin:1px;min-height:18px;line-height:14px}
.tag-queued{background:#222;color:#888}.tag-assigned{background:#113;color:#66f}
.tag-running{background:#131;color:var(--fg)}.tag-reviewing{background:#331;color:#ff0}
.tag-iterating{background:#331;color:#ff0}.tag-needs-review{background:#310;color:var(--warn)}
.tag-auto-approved{background:#013;color:var(--accent)}.tag-completed{background:#131;color:var(--fg)}
.tag-failed{background:#300;color:#f00}.tag-skipped{background:#222;color:#666}
.status-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:4px;flex-shrink:0}
.dot-online{background:var(--fg);box-shadow:0 0 6px var(--fg)}.dot-offline{background:#f00}.dot-busy{background:#ff0}
.agent-card .name{display:flex;align-items:center;gap:6px}
.badge{display:inline-block;background:#222;color:#888;padding:2px 6px;border-radius:3px;font-size:10px;margin:1px}
.badge-on{background:#131;color:var(--fg)}.badge-warn{background:#310;color:var(--warn)}
.group-header{color:var(--fg);font-size:11px;padding:4px 0;margin-top:8px;border-bottom:1px solid #444}
.empty{color:#444;font-style:italic;padding:8px;font-size:12px}
.event-row{font-size:10px;color:#666;padding:2px 0;border-bottom:1px solid #1a1a1a;word-break:break-word}
#detail-empty{color:#444;text-align:center;margin-top:40px;font-size:14px}
.detail-row{margin-bottom:6px}
.detail-label{color:var(--fg);font-size:10px;text-transform:uppercase;display:block}
.detail-value{color:#ccc;font-size:12px;white-space:pre-wrap;max-height:120px;overflow:auto;background:var(--bg);padding:4px;margin-top:2px;word-break:break-word}
.btn-row{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:4px}
.btn-row button{background:var(--card);color:var(--fg);border:1px solid var(--fg);padding:6px 10px;cursor:pointer;font-family:monospace;font-size:11px;min-height:36px;white-space:nowrap}
.btn-row button:hover{background:#0a0;color:#000}
.btn-row button:active{background:#0a0}
.btn-sm{font-size:10px!important;padding:4px 8px!important;min-height:30px!important}
.warn{background:#310;color:var(--warn);padding:6px 10px;border-left:3px solid var(--warn);font-size:10px;margin:4px 0}
.edit-form{background:var(--card);border:1px solid var(--dim);padding:8px;margin-top:6px}
.edit-form label{display:block;color:var(--fg);font-size:10px;margin-bottom:4px}
.edit-form input{background:var(--bg);color:var(--fg);border:1px solid var(--dim);padding:6px 4px;font-family:monospace;font-size:11px;width:100%;margin-bottom:4px;min-height:32px}
.edit-form button{margin-top:6px;background:#131;color:var(--fg);border:1px solid var(--fg);padding:6px 12px;cursor:pointer;font-family:monospace;font-size:11px;min-height:36px}
.edit-form button:hover{background:#0a0;color:#000}
.collapsible-header{cursor:pointer;color:var(--fg);padding:6px 0;border-bottom:1px solid var(--dim);font-size:12px;display:flex;justify-content:space-between;align-items:center;min-height:44px}
.collapsible-header:hover{color:var(--accent)}
.collapsible-body{padding:4px 0}
.iter-card{background:var(--card);border:1px solid var(--dim);padding:8px;margin-bottom:8px;overflow-x:auto}
.iter-header{color:var(--accent);font-size:12px;margin-bottom:4px}
.iter-summary{color:#ccc;font-size:11px;margin-bottom:4px;white-space:pre-wrap;max-height:100px;overflow:auto}
.iter-files{margin-bottom:4px;display:flex;flex-wrap:wrap;gap:2px}
.iter-file{display:inline-block;background:#1a1a1a;color:#aaa;padding:2px 6px;border-radius:3px;font-size:10px}
.iter-checks{margin-bottom:4px;display:flex;flex-wrap:wrap;gap:2px}
.iter-check{display:inline-block;padding:2px 6px;border-radius:3px;font-size:10px}
.iter-check.pass{background:#131;color:var(--fg)}.iter-check.fail{background:#300;color:#f00}
.iter-review{margin:4px 0;padding:6px;background:#1a1a0a;border-left:2px solid #ff0;font-size:11px;word-break:break-word}
.iter-next{margin:4px 0;padding:6px;background:#0a1a1a;border-left:2px solid var(--accent);font-size:11px;color:var(--accent);word-break:break-word}
.iter-dec{display:inline-block;padding:2px 6px;border-radius:3px;font-size:10px;font-weight:bold;margin-right:4px}
.iter-dec.approve{background:#131;color:var(--fg)}.iter-dec.reject{background:#300;color:#f00}
.iter-dec.failed{background:#330;color:#f60}.iter-dec.changes_requested{background:#331;color:#ff0}
.diff-toggle{background:var(--card);color:var(--fg);border:1px solid var(--dim);padding:4px 8px;cursor:pointer;font-family:monospace;font-size:10px;margin-top:4px;min-height:36px}
.diff-toggle:hover{background:#0a0;color:#000}
.diff-preview{background:var(--bg);border:1px solid var(--dim);color:var(--fg);font-size:10px;padding:6px;margin-top:4px;max-height:50vh;overflow:auto;white-space:pre;overflow-x:auto}
.stats-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:4px;margin-bottom:12px}
.stat-card{background:var(--card);border:1px solid var(--dim);padding:8px;text-align:center}
.stat-num{font-size:24px;color:var(--fg);font-weight:bold}
.stat-label{font-size:9px;color:#888;text-transform:uppercase;margin-top:2px}
.stat-card.warn .stat-num{color:var(--warn)}
.stat-card.good .stat-num{color:var(--fg)}
.confirm-overlay{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.85);display:flex;align-items:center;justify-content:center;z-index:100}
.confirm-box{background:#111;border:2px solid var(--warn);padding:16px;max-width:320px;text-align:center}
.confirm-box p{color:var(--warn);margin-bottom:12px;font-size:13px}
.confirm-box button{margin:4px 8px;padding:8px 16px;font-family:monospace;font-size:12px;cursor:pointer;min-height:44px}
.confirm-box .btn-yes{background:#300;color:#f00;border:1px solid #f00}
.confirm-box .btn-no{background:#111;color:var(--fg);border:1px solid var(--fg)}
`;
