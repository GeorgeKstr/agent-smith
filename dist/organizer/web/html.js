export const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0d1117">
<title>Agent Smith Organizer</title>
<link rel="stylesheet" href="/dashboard/styles.css">
</head>
<body>
<div id="app">
  <header id="topbar"></header>
  <div id="layout">
    <nav id="agent-panel"></nav>
    <main id="main-panel"></main>
  </div>
  <nav id="bottom-nav"></nav>
</div>
<div id="modal-root"></div>
<div id="toast" role="status" aria-live="polite"></div>
<script src="/dashboard/client.js"></script>
</body>
</html>`;
