export const html = `<!DOCTYPE html><html lang=en><head><meta charset=UTF-8><meta name=viewport content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"><title>Agent Smith Organizer</title><link rel=stylesheet href=/dashboard/styles.css></head><body>
<div id=app>
  <header id=topbar>
    <span id=tb-title>Agent Smith Organizer</span>
    <span id=tb-stats></span>
    <button id=refresh-btn title=Refresh>↻</button>
  </header>
  <main id=main>
    <nav id=sidebar>
      <button data-nav=overview class="nav-btn active"><span class=ni>◫</span>Overwiew</button>
      <button data-nav=agents class=nav-btn><span class=ni>◉</span>Agents</button>
      <button data-nav=tasks class=nav-btn><span class=ni>≡</span>Tasks</button>
      <button data-nav=reviews class=nav-btn><span class=ni>✓</span>Reviews</button>
      <button data-nav=activity class=nav-btn><span class=ni>☰</span>Activity</button>
      <button data-nav=import class=nav-btn><span class=ni>⇩</span>Import</button>
      <button data-nav=templates class=nav-btn><span class=ni>⚙</span>Templates</button>
      <button data-nav=settings class=nav-btn><span class=ni>⊛</span>Settings</button>
    </nav>
    <div id=content></div>
    <div id=details></div>
  </main>
  <nav id=bottomnav>
    <button data-nav=overview class="nav-btn active"><span class=ni>◫</span>Overview</button>
    <button data-nav=agents class=nav-btn><span class=ni>◉</span>Agents</button>
    <button data-nav=tasks class=nav-btn><span class=ni>≡</span>Tasks</button>
    <button data-nav=reviews class=nav-btn><span class=ni>✓</span>Reviews</button>
    <button data-nav=activity class=nav-btn><span class=ni>☰</span>Log</button>
  </nav>
</div>
<div id=confirm-overlay onclick="if(event.target===this)confirmNo()"><div class=confirm-box><p id=confirm-text></p><button class=btn btn-yes onclick=confirmYes()>Confirm</button><button class=btn btn-no onclick=confirmNo()>Cancel</button></div></div>
<script src=/dashboard/client.js></script>
</body></html>`;
