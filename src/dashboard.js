'use strict';

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

const THEME_CSS = `
:root {
  color-scheme: dark;
  --bg:#0a0a0f; --surface:#12121a; --card:#1a1a2e; --input:#16162a;
  --accent:#00d4ff; --accent-2:#7c3aed; --success:#10b981; --danger:#ef4444;
  --text:#e2e8f0; --heading:#f1f5f9; --muted:#94a3b8; --border:#2d2d44; --border-hover:#3d3d5c;
  --radius:10px; --shadow:0 4px 24px rgba(0,0,0,.45); --glow:0 0 24px rgba(0,212,255,.22);
  --ease:220ms cubic-bezier(.4,0,.2,1);
}
* { box-sizing:border-box; }
html { min-height:100%; background:var(--bg); }
body {
  margin:0; min-height:100vh; color:var(--text); line-height:1.6;
  font-family:Inter,"Segoe UI",system-ui,sans-serif;
  background:
    linear-gradient(rgba(10,10,15,.86),rgba(10,10,15,.95)),
    radial-gradient(circle at 15% 8%,rgba(0,212,255,.20),transparent 34%),
    radial-gradient(circle at 85% 92%,rgba(124,58,237,.20),transparent 36%),
    var(--bg);
  background-attachment:fixed;
}
body::after {
  content:""; position:fixed; inset:0; pointer-events:none; z-index:0;
  background:repeating-linear-gradient(0deg,transparent,transparent 3px,rgba(0,212,255,.018) 3px,rgba(0,212,255,.018) 4px);
}
a { color:var(--accent); text-decoration:none; transition:color var(--ease),text-shadow var(--ease); }
a:hover { color:#7fe9ff; text-shadow:0 0 10px rgba(0,212,255,.55); }
h1,h2,h3 { margin:0; color:var(--heading); line-height:1.2; }
h1 { font-size:clamp(1.6rem,3.6vw,2.4rem); }
h2 { font-size:1.05rem; transition:color var(--ease),text-shadow var(--ease); }
.card:hover h2 { color:var(--accent); text-shadow:0 0 12px rgba(0,212,255,.45); }
p { color:var(--muted); }
.mono,.brand,.eyebrow { font-family:"Share Tech Mono","Cascadia Mono",ui-monospace,monospace; }
.eyebrow { color:var(--accent); font-size:.78rem; text-transform:uppercase; letter-spacing:.14em; }
.app-shell { position:relative; z-index:1; width:min(1180px,calc(100% - 32px)); margin:0 auto; padding:24px 0 56px; }
.app-header { min-height:70px; display:flex; align-items:center; justify-content:space-between; gap:20px; border-bottom:1px solid var(--border); margin-bottom:22px; }
.brand { color:var(--accent); font-size:1.25rem; font-weight:700; transition:text-shadow var(--ease); }
.brand:hover { text-shadow:0 0 16px rgba(0,212,255,.7); }
.header-actions,.actions { display:flex; flex-wrap:wrap; align-items:center; gap:10px; }
.header-actions { color:var(--muted); font-size:.9rem; }
.role-chip { padding:2px 10px; border:1px solid var(--accent); border-radius:999px; color:var(--accent); font-size:.72rem; text-transform:uppercase; letter-spacing:.08em; }
.tabs { display:flex; flex-wrap:wrap; gap:6px; border-bottom:1px solid var(--border); margin-bottom:24px; }
.tab {
  min-height:42px; padding:8px 18px; cursor:pointer; background:transparent; color:var(--muted);
  border:1px solid transparent; border-bottom:2px solid transparent; border-radius:8px 8px 0 0;
  font:inherit; font-weight:600; transition:all var(--ease);
}
.tab:hover { color:var(--accent); background:rgba(0,212,255,.06); }
.tab[aria-selected="true"] { color:var(--accent); border-bottom-color:var(--accent); background:rgba(0,212,255,.09); text-shadow:0 0 10px rgba(0,212,255,.4); }
.page-intro { display:grid; gap:6px; margin-bottom:22px; }
.page-intro p { margin:0; }
.content-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:18px; }
.span-full { grid-column:1/-1; }
.card {
  position:relative; padding:20px; border:1px solid var(--border); border-radius:var(--radius);
  background:color-mix(in srgb,var(--card) 92%,transparent); box-shadow:var(--shadow);
  transition:transform var(--ease),border-color var(--ease),box-shadow var(--ease);
}
.card::before {
  content:""; position:absolute; inset:0; border-radius:var(--radius); pointer-events:none; opacity:0;
  background:linear-gradient(135deg,rgba(0,212,255,.10),transparent 45%,rgba(124,58,237,.10));
  transition:opacity var(--ease);
}
.card:hover { transform:translateY(-3px); border-color:var(--border-hover); box-shadow:var(--shadow),var(--glow); }
.card:hover::before { opacity:1; }
.card > * { position:relative; z-index:1; }
.card-header { display:flex; justify-content:space-between; align-items:center; gap:12px; margin-bottom:16px; }
.stack { display:grid; gap:14px; }
.field { display:grid; gap:6px; }
label { color:var(--muted); font-size:.88rem; }
input,button { min-height:44px; border:1px solid var(--border); border-radius:8px; font:inherit; transition:all var(--ease); }
input { width:100%; padding:10px 12px; color:var(--text); background:var(--input); }
input:hover { border-color:var(--border-hover); }
input:focus,button:focus-visible,a:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
button { padding:10px 16px; cursor:pointer; font-weight:700; color:#061017; background:var(--accent); }
button:hover { transform:translateY(-1px); box-shadow:var(--glow); filter:brightness(1.08); }
.button-secondary { color:var(--text); background:transparent; }
.button-secondary:hover { color:var(--accent); border-color:var(--accent); background:rgba(0,212,255,.08); }
.button-danger { color:var(--danger); background:transparent; border-color:rgba(239,68,68,.5); }
.button-danger:hover { color:#fff; background:var(--danger); box-shadow:0 0 20px rgba(239,68,68,.45); }
.button-compact { min-height:34px; padding:4px 12px; font-size:.82rem; }
.status { min-height:24px; margin-top:14px; padding:8px 12px; border-left:3px solid var(--accent); background:var(--surface); color:var(--muted); border-radius:0 8px 8px 0; }
.status.error { border-left-color:var(--danger); color:var(--text); }
.status.success { border-left-color:var(--success); }
.result { margin-top:14px; padding:12px; border:1px solid var(--success); border-radius:8px; }
.stat-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(170px,1fr)); gap:14px; }
.stat {
  padding:16px; border:1px solid var(--border); border-radius:var(--radius); background:var(--surface);
  transition:transform var(--ease),border-color var(--ease),box-shadow var(--ease);
}
.stat:hover { transform:translateY(-3px); border-color:var(--accent); box-shadow:var(--glow); }
.stat-value { display:block; font-size:1.9rem; font-weight:700; color:var(--accent); font-family:"Share Tech Mono",monospace; }
.stat-label { color:var(--muted); font-size:.8rem; text-transform:uppercase; letter-spacing:.08em; }
.table-wrap { overflow-x:auto; }
table { width:100%; border-collapse:collapse; font-size:.92rem; }
th,td { padding:11px 10px; border-bottom:1px solid var(--border); text-align:left; vertical-align:top; }
th { color:var(--heading); font-size:.76rem; text-transform:uppercase; letter-spacing:.08em; }
tbody tr { transition:background var(--ease); }
tbody tr:hover { background:rgba(0,212,255,.05); }
.truncate { max-width:320px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.pill { padding:2px 9px; border-radius:999px; font-size:.72rem; border:1px solid var(--border); color:var(--muted); }
.pill.up { color:var(--success); border-color:var(--success); }
.pill.down { color:var(--danger); border-color:var(--danger); }
.pill.admin { color:var(--accent-2); border-color:var(--accent-2); }
[hidden] { display:none !important; }
@media (max-width:780px) {
  .content-grid { grid-template-columns:1fr; }
  .app-header { flex-direction:column; align-items:flex-start; padding:14px 0; }
  .span-full { grid-column:auto; }
  .truncate { max-width:180px; }
}`;

function renderDashboard(baseUrl, options = {}) {
  const user = options.user || { displayName: 'User', username: 'user', role: 'user' };
  const isAdmin = user.role === 'admin';
  const safeBaseUrl = escapeHtml(baseUrl);
  const safeDisplayName = escapeHtml(user.displayName || user.username || 'User');
  const safeUsername = escapeHtml(user.username || '');
  const legacyConfigWarning = options.apiKeyConfigured === false
    ? '<p class="status">SHORTLINK_API_KEY is not configured</p>'
    : '';
  const adminTabButton = isAdmin
    ? '<button class="tab" type="button" role="tab" data-panel="panel-admin" aria-selected="false">Admin</button>'
    : '';
  const adminPanel = isAdmin ? `
    <section id="panel-admin" class="tab-panel" role="tabpanel" hidden>
      <div class="content-grid">
        <section class="card span-full">
          <div class="card-header"><h2>Profiles</h2><button id="load-users" class="button-secondary button-compact" type="button">Refresh</button></div>
          <div class="table-wrap"><table>
            <thead><tr><th>Username</th><th>Display name</th><th>Role</th><th>Links</th><th>Created</th></tr></thead>
            <tbody id="users-body"><tr><td colspan="5">No profiles loaded yet.</td></tr></tbody>
          </table></div>
        </section>
        <section class="card" id="user-panel">
          <div class="card-header"><h2>Add user</h2></div>
          <form id="user-form" class="stack">
            <div class="field"><label for="new-username">Username (case-sensitive)</label><input id="new-username" name="username" autocomplete="off" required pattern="[A-Za-z0-9._-]{3,64}" /></div>
            <div class="field"><label for="new-display-name">Display name</label><input id="new-display-name" name="displayName" required /></div>
            <div class="field"><label for="new-password">Temporary password</label><input id="new-password" name="password" type="password" minlength="12" autocomplete="new-password" required /></div>
            <button type="submit">Create user</button>
          </form>
          <div id="user-status" class="status" role="status" aria-live="polite"></div>
        </section>
        <section class="card">
          <div class="card-header"><h2>Service health</h2><button id="load-health" class="button-secondary button-compact" type="button">Check</button></div>
          <div id="health-body" class="stack"><p>Run a health check to view storage and configuration state.</p></div>
        </section>
      </div>
    </section>` : '';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>AzShortLink Dashboard</title>
  <style>${THEME_CSS}</style>
  <link rel="stylesheet" href="/custom.css" />
</head>
<body>
  <main class="app-shell">
    <header class="app-header">
      <a class="brand" href="/">AzShortLink</a>
      <div class="header-actions">
        <span class="mono">${safeDisplayName}</span>
        <span class="role-chip">${escapeHtml(user.role || 'user')}</span>
        <form method="POST" action="/dashboard/logout"><button class="button-secondary" type="submit">Sign out</button></form>
      </div>
    </header>
    <section class="page-intro"><p class="eyebrow">Link operations</p><h1>Short links, without the busywork.</h1><p>Managing links for <span class="mono">${safeBaseUrl}</span>${isAdmin ? ' across all profiles' : ''}.</p>${legacyConfigWarning}</section>
    <nav class="tabs" role="tablist">
      <button class="tab" type="button" role="tab" data-panel="panel-links" aria-selected="true">Links</button>
      <button class="tab" type="button" role="tab" data-panel="panel-analytics" aria-selected="false">Statistics</button>
      <button class="tab" type="button" role="tab" data-panel="panel-account" aria-selected="false">Account</button>
      ${adminTabButton}
    </nav>

    <section id="panel-links" class="tab-panel" role="tabpanel">
      <div class="content-grid">
        <section class="card">
          <div class="card-header"><h2>Create short link</h2></div>
          <form id="create-form" class="stack">
            <div class="field"><label for="url">Original URL</label><input id="url" type="url" placeholder="https://example.com/resource" required /></div>
            <div class="field"><label for="alias">Custom alias (optional)</label><input id="alias" type="text" maxlength="32" placeholder="my-link" /></div>
            <button type="submit">Create link</button>
          </form>
          <div id="status" class="status" role="status" aria-live="polite">Ready.</div>
          <div id="result" class="result" hidden></div>
          <button id="copy-result" class="button-secondary" type="button" hidden>Copy result</button>
        </section>
        <section class="card">
          <div class="card-header"><h2>API reference</h2></div>
          <p class="mono">POST /api/shorten</p>
          <p class="mono">GET /api/stats</p>
          <p class="mono">GET /api/analytics</p>
          <p class="mono">DELETE /api/links/{code}</p>
          <p>Browser requests are authenticated with your session cookie, so no API key is needed here.</p>
        </section>
        <section class="card span-full">
          <div class="card-header"><h2>${isAdmin ? 'All links' : 'Your links'}</h2><button id="load-stats" class="button-secondary button-compact" type="button">Refresh</button></div>
          <div class="table-wrap"><table>
            <thead><tr><th>Short URL</th><th>Target URL</th>${isAdmin ? '<th>Owner</th>' : ''}<th>Redirects</th><th>Last redirect</th><th></th></tr></thead>
            <tbody id="stats-body"><tr><td colspan="${isAdmin ? 6 : 5}">No data loaded yet.</td></tr></tbody>
          </table></div>
        </section>
      </div>
    </section>

    <section id="panel-analytics" class="tab-panel" role="tabpanel" hidden>
      <div class="content-grid">
        <section class="card span-full">
          <div class="card-header"><h2>Overview</h2><button id="load-analytics" class="button-secondary button-compact" type="button">Refresh</button></div>
          <div class="stat-grid">
            <div class="stat"><span class="stat-value" id="stat-links">-</span><span class="stat-label">Total links</span></div>
            <div class="stat"><span class="stat-value" id="stat-redirects">-</span><span class="stat-label">Total redirects</span></div>
            <div class="stat"><span class="stat-value" id="stat-used">-</span><span class="stat-label">Used links</span></div>
            <div class="stat"><span class="stat-value" id="stat-unused">-</span><span class="stat-label">Never used</span></div>
            <div class="stat"><span class="stat-value" id="stat-average">-</span><span class="stat-label">Avg redirects</span></div>
          </div>
          <div id="analytics-status" class="status" role="status" aria-live="polite"></div>
        </section>
        <section class="card">
          <div class="card-header"><h2>Top links</h2></div>
          <div class="table-wrap"><table><thead><tr><th>Code</th><th>Redirects</th></tr></thead><tbody id="top-links-body"><tr><td colspan="2">No data yet.</td></tr></tbody></table></div>
        </section>
        <section class="card">
          <div class="card-header"><h2>Recent activity</h2></div>
          <div class="table-wrap"><table><thead><tr><th>Code</th><th>Last redirect</th></tr></thead><tbody id="recent-links-body"><tr><td colspan="2">No data yet.</td></tr></tbody></table></div>
        </section>
      </div>
    </section>

    <section id="panel-account" class="tab-panel" role="tabpanel" hidden>
      <div class="content-grid">
        <section class="card">
          <div class="card-header"><h2>Profile</h2></div>
          <p>Signed in as <span class="mono">${safeUsername}</span>.</p>
          <p>Usernames are case-sensitive.</p>
        </section>
        <section class="card">
          <div class="card-header"><h2>Change password</h2></div>
          <form id="password-form" class="stack">
            <div class="field"><label for="current-password">Current password</label><input id="current-password" type="password" autocomplete="current-password" required /></div>
            <div class="field"><label for="new-account-password">New password (min 12 characters)</label><input id="new-account-password" type="password" minlength="12" autocomplete="new-password" required /></div>
            <button type="submit">Update password</button>
          </form>
          <div id="password-status" class="status" role="status" aria-live="polite"></div>
        </section>
      </div>
    </section>

    ${adminPanel}
  </main>
  <script>
    const IS_ADMIN = ${isAdmin ? 'true' : 'false'};
    const BASE_URL = '${safeBaseUrl}';
    const COLSPAN = IS_ADMIN ? 6 : 5;
    const statusEl = document.getElementById('status');
    const resultEl = document.getElementById('result');
    const statsBodyEl = document.getElementById('stats-body');
    const createForm = document.getElementById('create-form');
    const copyResultButton = document.getElementById('copy-result');
    const escapeHtml = (value) => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
    const setStatus = (message, kind = '') => { statusEl.textContent = message; statusEl.className = kind ? 'status ' + kind : 'status'; };
    const setPanelStatus = (id, message, kind = '') => { const el = document.getElementById(id); if (el) { el.textContent = message; el.className = kind ? 'status ' + kind : 'status'; } };
    async function apiRequest(path, options = {}) {
      const response = await fetch(path, { ...options, headers: { ...(options.headers || {}), accept: 'application/json' } });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Request failed.');
      return body;
    }
    document.querySelectorAll('.tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
        document.querySelectorAll('.tab-panel').forEach((panel) => { panel.hidden = panel.id !== tab.dataset.panel; });
        if (tab.dataset.panel === 'panel-analytics') loadAnalytics();
        if (tab.dataset.panel === 'panel-admin') loadUsers();
      });
    });
    function renderLinks(links) {
      if (!links.length) { statsBodyEl.innerHTML = '<tr><td colspan="' + COLSPAN + '">No links found.</td></tr>'; return; }
      statsBodyEl.innerHTML = links.map((item) => {
        const code = escapeHtml(item.code || '');
        const shortUrl = escapeHtml(item.shortUrl || BASE_URL + '/' + (item.code || ''));
        const target = escapeHtml(item.targetUrl || '');
        const owner = IS_ADMIN ? '<td>' + escapeHtml(item.ownerId || '-') + '</td>' : '';
        return '<tr><td><a href="' + shortUrl + '" target="_blank" rel="noopener noreferrer">' + shortUrl + '</a></td>' +
          '<td class="truncate" title="' + target + '">' + target + '</td>' + owner +
          '<td>' + escapeHtml(item.redirectCount || 0) + '</td><td>' + escapeHtml(item.lastAccessedAt || '-') + '</td>' +
          '<td><button class="button-danger button-compact" type="button" data-delete="' + code + '">Delete</button></td></tr>';
      }).join('');
    }
    async function loadStats() {
      setStatus('Loading links...');
      try { const result = await apiRequest('/api/stats'); renderLinks(result.links || []); setStatus('Loaded ' + (result.total || 0) + ' link(s).', 'success'); }
      catch (error) { setStatus(error.message, 'error'); }
    }
    statsBodyEl.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-delete]');
      if (!button) return;
      const code = button.dataset.delete;
      if (!window.confirm('Delete short link "' + code + '"? This cannot be undone.')) return;
      setStatus('Deleting ' + code + '...');
      try { await apiRequest('/api/links/' + encodeURIComponent(code), { method: 'DELETE' }); setStatus('Deleted ' + code + '.', 'success'); await loadStats(); }
      catch (error) { setStatus(error.message, 'error'); }
    });
    let latestShortUrl = '';
    createForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      setStatus('Creating link...');
      resultEl.hidden = true; copyResultButton.hidden = true;
      const payload = { url: document.getElementById('url').value.trim() };
      const alias = document.getElementById('alias').value.trim();
      if (alias) payload.uniqueValue = alias;
      try {
        const result = await apiRequest('/api/shorten', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(payload) });
        latestShortUrl = result.shortUrl;
        const safeUrl = escapeHtml(latestShortUrl);
        resultEl.innerHTML = 'Created: <a href="' + safeUrl + '" target="_blank" rel="noopener noreferrer">' + safeUrl + '</a>';
        resultEl.hidden = false; copyResultButton.hidden = false;
        setStatus('Short link created.', 'success');
        createForm.reset();
        await loadStats();
      } catch (error) { setStatus(error.message, 'error'); }
    });
    copyResultButton.addEventListener('click', async () => {
      if (!latestShortUrl) return;
      try { await navigator.clipboard.writeText(latestShortUrl); setStatus('Short URL copied.', 'success'); }
      catch { setStatus('Clipboard copy failed. Copy manually.', 'error'); }
    });
    document.getElementById('load-stats').addEventListener('click', loadStats);
    function renderSimpleRows(bodyId, rows, valueKey) {
      const body = document.getElementById(bodyId);
      if (!rows.length) { body.innerHTML = '<tr><td colspan="2">No data yet.</td></tr>'; return; }
      body.innerHTML = rows.map((item) => '<tr><td class="mono">' + escapeHtml(item.code || '') + '</td><td>' + escapeHtml(item[valueKey] ?? '-') + '</td></tr>').join('');
    }
    async function loadAnalytics() {
      setPanelStatus('analytics-status', 'Loading statistics...');
      try {
        const data = await apiRequest('/api/analytics');
        document.getElementById('stat-links').textContent = data.totalLinks;
        document.getElementById('stat-redirects').textContent = data.totalRedirects;
        document.getElementById('stat-used').textContent = data.usedLinks;
        document.getElementById('stat-unused').textContent = data.unusedLinks;
        document.getElementById('stat-average').textContent = data.averageRedirects;
        renderSimpleRows('top-links-body', data.topLinks || [], 'redirectCount');
        renderSimpleRows('recent-links-body', data.recentLinks || [], 'lastAccessedAt');
        setPanelStatus('analytics-status', 'Statistics updated (' + data.scope + ' scope).', 'success');
      } catch (error) { setPanelStatus('analytics-status', error.message, 'error'); }
    }
    document.getElementById('load-analytics').addEventListener('click', loadAnalytics);
    document.getElementById('password-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      setPanelStatus('password-status', 'Updating password...');
      try {
        const result = await apiRequest('/api/profile/password', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            currentPassword: document.getElementById('current-password').value,
            newPassword: document.getElementById('new-account-password').value
          })
        });
        setPanelStatus('password-status', result.message || 'Password updated.', 'success');
        setTimeout(() => { window.location.href = '/dashboard/login'; }, 1500);
      } catch (error) { setPanelStatus('password-status', error.message, 'error'); }
    });
    async function loadUsers() {
      const body = document.getElementById('users-body');
      if (!body) return;
      try {
        const data = await apiRequest('/api/users');
        if (!data.users.length) { body.innerHTML = '<tr><td colspan="5">No profiles found.</td></tr>'; return; }
        body.innerHTML = data.users.map((item) =>
          '<tr><td class="mono">' + escapeHtml(item.username) + '</td><td>' + escapeHtml(item.displayName || '-') + '</td>' +
          '<td><span class="pill ' + (item.role === 'admin' ? 'admin' : '') + '">' + escapeHtml(item.role) + '</span></td>' +
          '<td>' + escapeHtml(item.linkCount ?? 0) + '</td><td>' + escapeHtml(item.createdAt || '-') + '</td></tr>'
        ).join('');
      } catch (error) { body.innerHTML = '<tr><td colspan="5">' + escapeHtml(error.message) + '</td></tr>'; }
    }
    const loadUsersButton = document.getElementById('load-users');
    if (loadUsersButton) loadUsersButton.addEventListener('click', loadUsers);
    const loadHealthButton = document.getElementById('load-health');
    if (loadHealthButton) loadHealthButton.addEventListener('click', async () => {
      const body = document.getElementById('health-body');
      body.innerHTML = '<p>Checking...</p>';
      try {
        const response = await fetch('/api/health', { headers: { accept: 'application/json' } });
        const data = await response.json();
        const tableStatus = (data.storage && data.storage.table && data.storage.table.status) || 'unknown';
        body.innerHTML = '<div class="stat-grid">' +
          '<div class="stat"><span class="stat-value">' + escapeHtml(data.status || 'unknown') + '</span><span class="stat-label">Overall</span></div>' +
          '<div class="stat"><span class="stat-value"><span class="pill ' + (tableStatus === 'up' ? 'up' : 'down') + '">' + escapeHtml(tableStatus) + '</span></span><span class="stat-label">Table storage</span></div>' +
          '</div><p class="mono">Checked at ' + escapeHtml(data.checkedAt || '-') + '</p>';
      } catch (error) { body.innerHTML = '<p class="status error">' + escapeHtml(error.message) + '</p>'; }
    });
    const userForm = document.getElementById('user-form');
    if (userForm) userForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = new FormData(userForm);
      try {
        await apiRequest('/api/users', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(Object.fromEntries(form)) });
        setPanelStatus('user-status', 'User created.', 'success');
        userForm.reset();
        await loadUsers();
      } catch (error) { setPanelStatus('user-status', error.message, 'error'); }
    });
    loadStats();
  </script>
</body>
</html>`;
}

module.exports = { renderDashboard };
