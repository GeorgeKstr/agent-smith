export const html = `<!DOCTYPE html><html lang=en><head><meta charset=UTF-8><meta name=viewport content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"><title>Agent Smith Organizer</title><script>document.documentElement.className=localStorage.getItem('theme')||'dark';</script><link rel=stylesheet href=/dashboard/styles.css></head><body>
<div id=app>
  <header id=topbar>
    <div id=topbar-left>
      <h1>Agent Smith Organizer</h1>
      <div id=topbar-stats><span id=stat-agents>0</span> agents · <span id=stat-online>0</span> online · <span id=stat-tasks>0</span> tasks · <span id=stat-review>0</span> needs review</div>
    </div>
    <div id=topbar-right>
      <button id=refresh-btn title=Refresh onclick=fetchAll()>↻</button>
    </div>
  </header>
  <main id=main>
    <aside id=agent-panel>
      <div id=ap-header>Agents</div>
      <div id=agent-list></div>
      <div id=ap-status></div>
    </aside>
    <section id=detail-panel>
      <nav id=detail-tabs>
        <button data-tab=chat class="tab-btn active">Chat</button>
        <button data-tab=tasks class=tab-btn>Tasks</button>
        <button data-tab=reviews class=tab-btn>Reviews</button>
        <button data-tab=status class=tab-btn>Status</button>
      </nav>
      <div id=detail-content></div>
    </section>
  </main>
</div>
<div id=confirm-overlay style=display:none onclick="if(event.target===this)confirmNo()"><div class=confirm-box><p id=confirm-text></p><button class=btn-yes onclick=confirmYes()>Confirm</button><button class=btn-no onclick=confirmNo()>Cancel</button></div></div>
<div id=chat-sessions-overlay style=display:none onclick="if(event.target===this)closeSessions()"><div class=session-modal><h3>Chat Sessions</h3><div id=sessions-list></div><button class=btn onclick=createChatSession()>+ New Session</button><button class=btn onclick=closeSessions()>Close</button></div></div>
<script src=/dashboard/client.js></script>
</body></html>`;
