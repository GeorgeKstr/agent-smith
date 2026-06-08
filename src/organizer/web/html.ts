export const html = `<!DOCTYPE html><html lang=en><head><meta charset=UTF-8><meta name=viewport content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"><title>Agent Smith Organizer</title><script>document.documentElement.className=localStorage.getItem('theme')||'dark';</script><link rel=stylesheet href=/dashboard/styles.css></head><body>
<div id=app>
  <header id=topbar>
    <div id=topbar-left>
      <h1>Agent Smith Organizer</h1>
      <div id=topbar-stats><span id=stat-online>0</span> online · <span id=stat-review>0</span> needs review</div>
    </div>
    <div id=topbar-right>
      <span id=tb-tasks></span>
      <button id=refresh-btn title=Refresh onclick=fetchAll()>↻</button>
    </div>
  </header>
  <main id=main>
    <nav id=sidebar>
      <button data-nav=overview class="active nav-btn"><span class=nav-icon>◫</span><span class=nav-label>Overview</span></button>
      <button data-nav=agents class=nav-btn><span class=nav-icon>◉</span><span class=nav-label>Agents</span></button>
      <button data-nav=tasks class=nav-btn><span class=nav-icon>≡</span><span class=nav-label>Tasks</span></button>
      <button data-nav=reviews class=nav-btn><span class=nav-icon>✓</span><span class=nav-label>Reviews</span></button>
      <button data-nav=activity class=nav-btn><span class=nav-icon>☰</span><span class=nav-label>Activity</span></button>
      <button data-nav=settings class=nav-btn><span class=nav-icon>⚙</span><span class=nav-label>Settings</span></button>
    </nav>
    <div id=content></div>
    <div id=details><div id=detail-empty>Select an agent or task to view details</div></div>
  </main>
  <nav id=bottomnav>
    <button data-nav=overview class="active nav-btn"><span class=nav-icon>◫</span><span class=nav-label>Overview</span></button>
    <button data-nav=agents class=nav-btn><span class=nav-icon>◉</span><span class=nav-label>Agent</span></button>
    <button data-nav=tasks class=nav-btn><span class=nav-icon>≡</span><span class=nav-label>Tasks</span></button>
    <button data-nav=reviews class=nav-btn id=bn-review-badge><span class=nav-icon>✓</span><span class=nav-label>Review</span><span id=bn-review-count class=bn-badge style=display:none>0</span></button>
    <button data-nav=activity class=nav-btn><span class=nav-icon>☰</span><span class=nav-label>Log</span></button>
  </nav>
</div>
<div id=confirm-overlay style=display:none onclick="if(event.target===this)confirmNo()"><div class=confirm-box><p id=confirm-text></p><button class=btn-yes onclick=confirmYes()>Confirm</button><button class=btn-no onclick=confirmNo()>Cancel</button></div></div>
<script src=/dashboard/client.js></script>
</body></html>`
