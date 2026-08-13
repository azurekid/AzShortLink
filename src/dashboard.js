'use strict';

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function renderDashboard(baseUrl, options = {}) {
  const user = options.user || { displayName: 'User', role: 'user' };
  const isAdmin = user.role === 'admin';
  const safeBaseUrl = escapeHtml(baseUrl);
  const safeDisplayName = escapeHtml(user.displayName || user.username || 'User');
  const legacyConfigWarning = options.apiKeyConfigured === false
    ? '<p class="status">SHORTLINK_API_KEY is not configured</p>'
    : '';
  const adminPanel = isAdmin ? `
      <section class="card" id="user-panel">
        <div class="card-header"><h2>Add user</h2></div>
        <form id="user-form" class="stack">
          <div class="field"><label for="new-username">Username</label><input id="new-username" name="username" autocomplete="off" required pattern="[A-Za-z0-9._-]{3,64}" /></div>
          <div class="field"><label for="new-display-name">Display name</label><input id="new-display-name" name="displayName" required /></div>
          <div class="field"><label for="new-password">Temporary password</label><input id="new-password" name="password" type="password" minlength="12" autocomplete="new-password" required /></div>
          <button type="submit">Create user</button>
        </form>
        <div id="user-status" class="status" role="status" aria-live="polite"></div>
      </section>` : '';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>AzShortLink Dashboard</title>
  <style>
    :root { color-scheme: dark; --bg:#0a0a0f; --surface:#12121a; --card:#1a1a2e; --input:#16162a; --accent:#00d4ff; --success:#10b981; --danger:#ef4444; --text:#e2e8f0; --heading:#f1f5f9; --muted:#94a3b8; --border:#2d2d44; }
    * { box-sizing: border-box; } body { margin:0; min-height:100vh; color:var(--text); font-family:Inter,"Segoe UI",sans-serif; line-height:1.6; background:linear-gradient(rgba(10,10,15,.84),rgba(10,10,15,.94)),radial-gradient(circle at 15% 10%,rgba(0,212,255,.18),transparent 34%),radial-gradient(circle at 85% 90%,rgba(124,58,237,.18),transparent 36%),var(--bg); }
    a { color:var(--accent); } h1,h2 { margin:0; color:var(--heading); line-height:1.2; } h1 { font-size:clamp(1.7rem,4vw,2.6rem); } h2 { font-size:1.05rem; } p { color:var(--muted); } .mono,.brand,.eyebrow { font-family:"Share Tech Mono","Cascadia Mono",monospace; }
    .app-shell { width:min(1180px,calc(100% - 32px)); margin:0 auto; padding:28px 0 48px; } .app-header { min-height:70px; display:flex; align-items:center; justify-content:space-between; gap:20px; border-bottom:1px solid var(--border); margin-bottom:28px; } .brand { color:var(--accent); font-size:1.25rem; font-weight:700; } .header-actions,.actions { display:flex; flex-wrap:wrap; align-items:center; gap:10px; } .header-actions { color:var(--muted); }
    .page-intro { display:grid; gap:6px; margin-bottom:24px; } .page-intro p { margin:0; } .content-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:18px; } .span-full { grid-column:1/-1; }
    .card { background:color-mix(in srgb,var(--card) 92%,transparent); border:1px solid var(--border); border-radius:8px; padding:20px; box-shadow:0 4px 24px rgba(0,0,0,.4); } .card-header { display:flex; justify-content:space-between; align-items:center; gap:12px; margin-bottom:18px; } .stack { display:grid; gap:14px; } .field { display:grid; gap:6px; } label { color:var(--muted); font-size:.88rem; }
    input,button { min-height:44px; border:1px solid var(--border); border-radius:6px; font:inherit; } input { width:100%; padding:10px 12px; color:var(--text); background:var(--input); } input:focus,button:focus,a:focus { outline:2px solid var(--accent); outline-offset:2px; } button { padding:10px 16px; cursor:pointer; font-weight:700; color:#061017; background:var(--accent); } button:hover { filter:brightness(1.1); } .button-secondary { color:var(--text); background:transparent; }
    .status { min-height:24px; margin-top:14px; border-left:3px solid var(--accent); padding:8px 12px; background:var(--surface); color:var(--muted); } .status.error { border-left-color:var(--danger); color:var(--text); } .result { margin-top:14px; padding:12px; border:1px solid var(--success); border-radius:6px; } .table-wrap { overflow-x:auto; } table { width:100%; border-collapse:collapse; font-size:.92rem; } th,td { padding:11px 10px; border-bottom:1px solid var(--border); text-align:left; vertical-align:top; } th { color:var(--heading); font-size:.78rem; text-transform:uppercase; }
    @media (max-width:780px) { .content-grid { grid-template-columns:1fr; } .app-header { align-items:flex-start; padding:14px 0; } .header-actions { align-items:flex-end; flex-direction:column; } .span-full { grid-column:auto; } }
  </style>
</head>
<body>
  <main class="app-shell">
    <header class="app-header"><a class="brand" href="/">AzShortLink</a><div class="header-actions"><span>${safeDisplayName}</span><form method="POST" action="/dashboard/logout"><button class="button-secondary" type="submit">Sign out</button></form></div></header>
    <section class="page-intro"><p class="eyebrow">Link operations</p><h1>Short links, without the busywork.</h1><p>Manage your links for <span class="mono">${safeBaseUrl}</span>.</p>${legacyConfigWarning}</section>
    <div class="content-grid">
      <section class="card"><div class="card-header"><h2>Create short link</h2></div><form id="create-form" class="stack"><div class="field"><label for="url">Original URL</label><input id="url" type="url" placeholder="https://example.com/resource" required /></div><div class="field"><label for="alias">Custom alias (optional)</label><input id="alias" type="text" maxlength="32" placeholder="my-link" /></div><button type="submit">Create link</button></form><div id="status" class="status" role="status" aria-live="polite">Ready.</div><div id="result" class="result" hidden></div><button id="copy-result" class="button-secondary" type="button" hidden>Copy result</button></section>
      ${adminPanel}
      <section class="card span-full"><div class="card-header"><h2>Your links</h2><button id="load-stats" class="button-secondary" type="button">Refresh</button></div><p class="mono">POST /api/shorten</p><div class="table-wrap"><table><thead><tr><th>Short URL</th><th>Target URL</th><th>Redirects</th><th>Last redirect</th></tr></thead><tbody id="stats-body"><tr><td colspan="4">No data loaded yet.</td></tr></tbody></table></div></section>
    </div>
  </main>
  <script>
    const statusEl = document.getElementById('status');
    const resultEl = document.getElementById('result');
    const statsBodyEl = document.getElementById('stats-body');
    const createForm = document.getElementById('create-form');
    const loadStatsButton = document.getElementById('load-stats');
    const copyResultButton = document.getElementById('copy-result');
    const escapeHtml = (value) => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
    const setStatus = (message, error = false) => { statusEl.textContent = message; statusEl.className = error ? 'status error' : 'status'; };
    async function apiRequest(path, options = {}) {
      const response = await fetch(path, { ...options, headers: { ...(options.headers || {}), accept: 'application/json' } });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Request failed.');
      return body;
    }
    function renderLinks(links) {
      if (!links.length) { statsBodyEl.innerHTML = '<tr><td colspan="4">No links found.</td></tr>'; return; }
      statsBodyEl.innerHTML = links.map((item) => { const shortUrl = escapeHtml(item.shortUrl || '${safeBaseUrl}/' + item.code); return '<tr><td><a href="' + shortUrl + '" target="_blank" rel="noopener noreferrer">' + shortUrl + '</a></td><td>' + escapeHtml(item.targetUrl || '') + '</td><td>' + escapeHtml(item.redirectCount || 0) + '</td><td>' + escapeHtml(item.lastAccessedAt || '-') + '</td></tr>'; }).join('');
    }
    async function loadStats() { setStatus('Loading links...'); try { const result = await apiRequest('/api/stats'); renderLinks(result.links || []); setStatus('Links loaded.'); } catch (error) { setStatus(error.message, true); } }
    let latestShortUrl = '';
    createForm.addEventListener('submit', async (event) => { event.preventDefault(); setStatus('Creating link...'); resultEl.hidden = true; copyResultButton.hidden = true; const payload = { url: document.getElementById('url').value.trim() }; const alias = document.getElementById('alias').value.trim(); if (alias) payload.uniqueValue = alias; try { const result = await apiRequest('/api/shorten', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(payload) }); latestShortUrl = result.shortUrl; const safeUrl = escapeHtml(latestShortUrl); resultEl.innerHTML = 'Created: <a href="' + safeUrl + '" target="_blank" rel="noopener noreferrer">' + safeUrl + '</a>'; resultEl.hidden = false; copyResultButton.hidden = false; setStatus('Short link created.'); await loadStats(); } catch (error) { setStatus(error.message, true); } });
    copyResultButton.addEventListener('click', async () => { if (!latestShortUrl) return; await navigator.clipboard.writeText(latestShortUrl); setStatus('Short URL copied.'); });
    loadStatsButton.addEventListener('click', loadStats);
    const userForm = document.getElementById('user-form');
    if (userForm) userForm.addEventListener('submit', async (event) => { event.preventDefault(); const form = new FormData(userForm); const status = document.getElementById('user-status'); try { await apiRequest('/api/users', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(Object.fromEntries(form)) }); status.textContent = 'User created.'; userForm.reset(); } catch (error) { status.textContent = error.message; status.className = 'status error'; } });
    loadStats();
  </script>
</body>
</html>`;
}

module.exports = { renderDashboard };
