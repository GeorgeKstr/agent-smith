export const html = `<!DOCTYPE html><html lang=en><head><meta charset=UTF-8><meta name=viewport content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"><title>Agent Smith Organizer</title><link rel=stylesheet href=/dashboard/styles.css></head><body>
<div id=topbar>
  <h1>▸ Organizer</h1>
  <div class=status><span id=api-url>—</span> · agents: <span id=agent-count>0</span> · tasks: <span id=task-count>0</span></div>
  <button onclick=fetchAll()>↻</button>
</div>
<div id=main>
  <div id=left></div>
  <div id=center></div>
  <div id=right><div id=detail-empty>Select an agent or task</div></div>
</div>
<nav id=bottom-nav>
  <button data-tab=overview class=active onclick="setTab('overview')"><span class=nav-icon>📊</span>Overview</button>
  <button data-tab=agents onclick="setTab('agents')"><span class=nav-icon>🖥</span>Agents</button>
  <button data-tab=tasks onclick="setTab('tasks')"><span class=nav-icon>📋</span>Tasks</button>
  <button data-tab=reviews onclick="setTab('reviews')"><span class=nav-icon>🔍</span>Reviews</button>
  <button data-tab=templates onclick="setTab('templates')"><span class=nav-icon>📝</span>Templates</button>
  <button data-tab=activity onclick="setTab('activity')"><span class=nav-icon>📜</span>Log</button>
</nav>
<div id=confirm-overlay style=display:none onclick="if(event.target===this)confirmNo()"><div class=confirm-box><p id=confirm-text></p><button class=btn-yes onclick=confirmYes()>Confirm</button><button class=btn-no onclick=confirmNo()>Cancel</button></div></div>
<script>window._lt=(new Date()).toISOString();</script>
<script src=/dashboard/client.js></script>
</body></html>`
