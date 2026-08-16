'use strict';

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

const FAVICON_URL = 'https://azurehacking.com/images/favicon.svg';
const BACKGROUND_URL = 'https://blackcatwebshop.z13.web.core.windows.net/media/azure-hacking-corp.jpg';

const HEAD_ASSETS = `  <link rel="icon" type="image/svg+xml" href="${FAVICON_URL}" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=Share+Tech+Mono&display=swap" />
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.7.2/css/all.min.css" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>`;

const THEME_CSS = `
:root {
  color-scheme: dark;
  --bg:#0a0a0f; --surface:#12121a; --card:#1a1a2e; --input:#16162a;
  --accent:#00d4ff; --accent-2:#7c3aed; --success:#10b981; --danger:#ef4444; --warn:#f59e0b;
  --text:#e2e8f0; --heading:#f1f5f9; --muted:#94a3b8; --border:#2d2d44; --border-hover:#3d3d5c;
  --radius:10px; --shadow:0 4px 24px rgba(0,0,0,.45); --glow:0 0 24px rgba(0,212,255,.22);
  --ease:220ms cubic-bezier(.4,0,.2,1);
}
* { box-sizing:border-box; }
html { min-height:100%; background:var(--bg); }
body {
  margin:0; min-height:100vh; color:var(--text); line-height:1.6;
  font-family:Inter,"Segoe UI",system-ui,sans-serif;
}
.bg-layer {
  position:fixed; inset:0; z-index:0; pointer-events:none;
  background-color:var(--bg);
  background-image:
    linear-gradient(rgba(10,10,15,.55),rgba(10,10,15,.78)),
    radial-gradient(circle at 15% 8%,rgba(0,212,255,.18),transparent 34%),
    radial-gradient(circle at 85% 92%,rgba(124,58,237,.18),transparent 36%),
    url("${BACKGROUND_URL}");
  background-position:center; background-size:cover; background-repeat:no-repeat;
}
body::after {
  content:""; position:fixed; inset:0; pointer-events:none; z-index:0;
  background:repeating-linear-gradient(0deg,transparent,transparent 3px,rgba(0,212,255,.02) 3px,rgba(0,212,255,.02) 4px);
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
  background:color-mix(in srgb,var(--card) 82%,transparent); box-shadow:var(--shadow);
  backdrop-filter:blur(10px);
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
.card-header h2 i { margin-right:8px; color:var(--accent); }
.stack { display:grid; gap:14px; }
.field { display:grid; gap:6px; }
label { color:var(--muted); font-size:.88rem; }
input,select,button,.button-link { min-height:44px; border:1px solid var(--border); border-radius:8px; font:inherit; transition:all var(--ease); }
input,select { width:100%; padding:10px 12px; color:var(--text); background:var(--input); }
input:hover,select:hover { border-color:var(--border-hover); }
input:focus,button:focus-visible,a:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
button { padding:10px 16px; cursor:pointer; font-weight:700; color:#061017; background:var(--accent); }
button:hover { transform:translateY(-1px); box-shadow:var(--glow); filter:brightness(1.08); }
button i { margin-right:6px; }
.button-link { display:inline-flex; align-items:center; justify-content:center; padding:9px 16px; font-weight:700; }
.button-link i { margin-right:6px; }
.button-secondary { color:var(--text); background:transparent; }
.button-secondary:hover { color:var(--accent); border-color:var(--accent); background:rgba(0,212,255,.08); }
.button-danger { color:var(--danger); background:transparent; border-color:rgba(239,68,68,.5); }
.button-danger:hover { color:#fff; background:var(--danger); box-shadow:0 0 20px rgba(239,68,68,.45); }
.button-compact { min-height:34px; padding:4px 12px; font-size:.82rem; }
.status { min-height:24px; margin-top:14px; padding:8px 12px; border-left:3px solid var(--accent); background:var(--surface); color:var(--muted); border-radius:0 8px 8px 0; }
.status.error { border-left-color:var(--danger); color:var(--text); }
.status.success { border-left-color:var(--success); }
.result { margin-top:14px; padding:12px; border:1px solid var(--success); border-radius:8px; }
.stat-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(190px,1fr)); gap:14px; }
.stat {
  display:flex; align-items:center; gap:14px; padding:16px;
  border:1px solid var(--border); border-radius:var(--radius); background:var(--surface);
  transition:transform var(--ease),border-color var(--ease),box-shadow var(--ease);
}
.stat:hover { transform:translateY(-3px); border-color:var(--accent); box-shadow:var(--glow); }
.stat-icon {
  display:grid; place-items:center; flex:0 0 44px; width:44px; height:44px;
  border-radius:10px; font-size:1.05rem;
}
.stat-icon.cyan { background:rgba(0,212,255,.12); color:var(--accent); }
.stat-icon.purple { background:rgba(124,58,237,.14); color:#a855f7; }
.stat-icon.green { background:rgba(16,185,129,.12); color:var(--success); }
.stat-icon.red { background:rgba(239,68,68,.12); color:var(--danger); }
.stat-icon.orange { background:rgba(245,158,11,.12); color:var(--warn); }
.stat-value { display:block; font-size:1.6rem; font-weight:700; color:var(--heading); font-family:"Share Tech Mono",monospace; line-height:1.2; overflow:hidden; text-overflow:ellipsis; }
.stat-label { color:var(--muted); font-size:.78rem; text-transform:uppercase; letter-spacing:.08em; }
.analytics-chart-card { min-height:290px; }
.donut-wrap { min-height:210px; display:grid; place-items:center; align-content:center; gap:14px; }
.donut-chart {
  width:156px; aspect-ratio:1; display:grid; place-items:center; border-radius:50%;
  background:conic-gradient(var(--success) 0 var(--used-angle,0deg),rgba(239,68,68,.72) var(--used-angle,0deg) 360deg);
  box-shadow:inset 0 0 22px rgba(0,0,0,.3),0 0 24px rgba(16,185,129,.12);
}
.donut-center { width:104px; aspect-ratio:1; display:grid; place-items:center; align-content:center; border-radius:50%; background:var(--surface); }
.donut-center strong { color:var(--heading); font:700 1.7rem/1 "Share Tech Mono",monospace; }
.donut-center span { color:var(--muted); font-size:.7rem; text-transform:uppercase; }
.chart-legend { display:flex; flex-wrap:wrap; justify-content:center; gap:14px; color:var(--muted); font-size:.78rem; }
.legend-dot { display:inline-block; width:8px; height:8px; margin-right:5px; border-radius:50%; background:var(--success); }
.legend-dot.unused { background:var(--danger); }
.column-chart { height:220px; display:flex; align-items:stretch; gap:10px; padding:8px 4px 0; border-bottom:1px solid var(--border); }
.column-item { min-width:0; flex:1; display:grid; grid-template-rows:1fr auto; gap:7px; text-align:center; }
.column-track { min-height:0; display:flex; align-items:flex-end; justify-content:center; }
.column-fill { position:relative; width:min(42px,72%); min-height:3px; border-radius:5px 5px 0 0; background:linear-gradient(180deg,var(--accent),rgba(0,212,255,.3)); box-shadow:0 0 14px rgba(0,212,255,.16); }
.column-label { min-width:0; color:var(--muted); font-size:.7rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.column-count { position:absolute; top:-21px; left:50%; transform:translateX(-50%); color:var(--heading); font:700 .72rem "Share Tech Mono",monospace; }
.bar-list { display:grid; gap:10px; }
.bar-row { display:grid; grid-template-columns:minmax(80px,120px) 1fr minmax(62px,auto); align-items:center; gap:10px; font-size:.85rem; }
.bar-row span:first-child { color:var(--muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.bar-track { height:12px; border-radius:999px; background:rgba(255,255,255,.05); overflow:hidden; }
.bar-fill { height:100%; border-radius:999px; transition:width 600ms cubic-bezier(.4,0,.2,1); }
.bar-count { color:var(--muted); font-family:"Share Tech Mono",monospace; }
.analytics-filter { display:flex; align-items:end; gap:10px; }
.analytics-filter .field { min-width:min(320px,70vw); }
.location-map { width:100%; height:380px; border:1px solid var(--border); border-radius:8px; background:var(--surface); }
.location-map-empty { margin:10px 0 0; }
.leaflet-container { font-family:Inter,"Segoe UI",system-ui,sans-serif; }
.leaflet-popup-content-wrapper,.leaflet-popup-tip { color:var(--text); background:var(--surface); }
.leaflet-control-attribution { color:#334155; }
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
.key-reveal { display:grid; gap:8px; margin-top:14px; padding:14px; border:1px solid var(--warn); border-radius:8px; background:rgba(245,158,11,.06); }
.key-value { padding:10px 12px; border-radius:8px; background:var(--input); color:var(--accent); font-family:"Share Tech Mono",monospace; word-break:break-all; }
.profile-list { display:grid; gap:10px; }
.profile-row {
  display:grid; grid-template-columns:minmax(170px,.8fr) minmax(320px,1.7fr) minmax(220px,1fr); gap:18px; align-items:center;
  padding:16px; border:1px solid var(--border); border-radius:8px; background:var(--surface);
}
.profile-identity { min-width:0; display:grid; grid-template-columns:42px minmax(0,1fr); gap:11px; align-items:center; }
.profile-avatar { width:42px; height:42px; display:grid; place-items:center; border:1px solid var(--accent); border-radius:50%; color:var(--accent); background:rgba(0,212,255,.08); font-weight:800; }
.profile-name { min-width:0; }
.profile-name strong,.profile-name span { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.profile-name span { color:var(--muted); font-size:.78rem; }
.profile-meta { display:grid; grid-template-columns:repeat(4,minmax(64px,1fr)); gap:10px; }
.profile-fact { min-width:0; }
.profile-fact > span { display:block; color:var(--muted); font-size:.67rem; text-transform:uppercase; }
.profile-fact strong { display:block; margin-top:2px; color:var(--text); font-size:.8rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.profile-actions { display:flex; flex-wrap:wrap; justify-content:flex-end; gap:7px; }
.profile-actions button { margin:0; }
.section-lead { margin:-6px 0 16px; color:var(--muted); font-size:.88rem; }
[hidden] { display:none !important; }
@media (max-width:1050px) {
  .profile-row { grid-template-columns:minmax(160px,.8fr) minmax(300px,1.4fr); }
  .profile-actions { grid-column:1/-1; justify-content:flex-start; }
}
@media (max-width:780px) {
  .content-grid { grid-template-columns:1fr; }
  .app-header { flex-direction:column; align-items:flex-start; padding:14px 0; }
  .span-full { grid-column:auto; }
  .truncate { max-width:180px; }
  .bar-row { grid-template-columns:minmax(70px,90px) 1fr auto; }
  .analytics-chart-card { min-height:250px; }
  .analytics-filter { width:100%; align-items:stretch; flex-direction:column; }
  .analytics-filter .field { min-width:0; }
  .location-map { height:310px; }
  .column-chart { height:190px; gap:5px; }
  .column-fill { width:70%; }
  .profile-row { grid-template-columns:1fr; }
  .profile-meta { grid-template-columns:repeat(2,minmax(0,1fr)); }
  .profile-actions { grid-column:auto; }
}`;

// Shared building blocks so the "look and feel" stays consistent between the user and admin
// dashboards, while each of those keeps its own template/script - see src/dashboard/user.js
// and src/dashboard/admin.js. Nothing here is role-specific, so it's safe for either to use.

function renderDocumentHead(safeTitle) {
  return `<meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${safeTitle}</title>
${HEAD_ASSETS}
  <style>${THEME_CSS}</style>
  <link rel="stylesheet" href="/custom.css" />`;
}

function renderAppHeader({ safeDisplayName, safeRole }) {
  return `<header class="app-header">
      <a class="brand" href="/">AzShortLink</a>
      <div class="header-actions">
        <span class="mono">${safeDisplayName}</span>
        <span class="role-chip">${safeRole}</span>
        <form method="POST" action="/dashboard/logout"><button class="button-secondary" type="submit">Sign out</button></form>
      </div>
    </header>`;
}

// tabs: [{ panel, label, icon }]. The first tab is selected by default.
function renderTabsNav(tabs) {
  return `<nav class="tabs" role="tablist">
      ${tabs
        .map(
          (tab, index) =>
            `<button class="tab" type="button" role="tab" data-panel="${tab.panel}" aria-selected="${index === 0}"><i class="fas fa-${tab.icon}"></i> ${tab.label}</button>`
        )
        .join('\n      ')}
    </nav>`;
}

// The shared core client script: DOM handles, status helpers, apiRequest, the create-link
// form, the links table, and the statistics/account tabs. Role-specific behavior (which tabs
// exist, the owner column, admin-only management panels) is layered on by each caller.
function coreClientScript({ safeUsername, safeBaseUrl, colspan, ownerColumnScript, tabDispatch }) {
  return `
    const CURRENT_USERNAME = '${safeUsername}';
    const BASE_URL = '${safeBaseUrl}';
    const COLSPAN = ${colspan};
    const statusEl = document.getElementById('status');
    const resultEl = document.getElementById('result');
    const statsBodyEl = document.getElementById('stats-body');
    const createForm = document.getElementById('create-form');
    const copyResultButton = document.getElementById('copy-result');
    const downloadQrLink = document.getElementById('download-qr');
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
        ${tabDispatch}
      });
    });
    function renderLinks(links) {
      if (!links.length) { statsBodyEl.innerHTML = '<tr><td colspan="' + COLSPAN + '">No links found.</td></tr>'; return; }
      statsBodyEl.innerHTML = links.map((item) => {
        const code = escapeHtml(item.code || '');
        const shortUrl = escapeHtml(item.shortUrl || BASE_URL + '/' + (item.code || ''));
        const target = escapeHtml(item.targetUrl || '');
        ${ownerColumnScript}
        const qrUrl = '/api/links/' + encodeURIComponent(item.code || '') + '/qr';
        return '<tr><td><a href="' + shortUrl + '" target="_blank" rel="noopener noreferrer">' + shortUrl + '</a></td>' +
          '<td class="truncate" title="' + target + '">' + target + '</td>' + owner +
          '<td>' + escapeHtml(item.redirectCount || 0) + '</td><td>' + escapeHtml(item.lastAccessedAt || '-') + '</td>' +
          '<td><div class="actions"><a class="button-link button-secondary button-compact" href="' + qrUrl + '" download="azshortlink-' + code + '-qr.png" title="Download QR code"><i class="fas fa-qrcode"></i><span>QR</span></a>' +
          '<button class="button-danger button-compact" type="button" data-delete="' + code + '">Delete</button></div></td></tr>';
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
      resultEl.hidden = true; copyResultButton.hidden = true; downloadQrLink.hidden = true;
      const payload = { url: document.getElementById('url').value.trim() };
      const alias = document.getElementById('alias').value.trim();
      if (alias) payload.uniqueValue = alias;
      try {
        const result = await apiRequest('/api/shorten', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(payload) });
        latestShortUrl = result.shortUrl;
        const safeUrl = escapeHtml(latestShortUrl);
        resultEl.innerHTML = 'Created: <a href="' + safeUrl + '" target="_blank" rel="noopener noreferrer">' + safeUrl + '</a>';
        downloadQrLink.href = '/api/links/' + encodeURIComponent(result.code) + '/qr';
        downloadQrLink.download = 'azshortlink-' + result.code + '-qr.png';
        resultEl.hidden = false; copyResultButton.hidden = false; downloadQrLink.hidden = false;
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
      if (!body) return;
      if (!rows.length) { body.innerHTML = '<tr><td colspan="2">No data yet.</td></tr>'; return; }
      body.innerHTML = rows.map((item) => '<tr><td class="mono">' + escapeHtml(item.code || '') + '</td><td>' + escapeHtml(item[valueKey] ?? '-') + '</td></tr>').join('');
    }
    const BAR_COLORS = ['#00d4ff','#a855f7','#10b981','#f59e0b','#ef4444','#38bdf8','#c084fc','#34d399'];
    function renderBars(containerId, rows) {
      const container = document.getElementById(containerId);
      if (!container) return;
      if (!rows || !rows.length) { container.innerHTML = '<p>No data yet.</p>'; return; }
      const max = Math.max(...rows.map((row) => row.count), 1);
      const total = Math.max(rows.reduce((sum, row) => sum + Number(row.count || 0), 0), 1);
      container.innerHTML = rows.map((row, index) => {
        const width = Math.max((row.count / max) * 100, 2);
        const percentage = Math.round((row.count / total) * 100);
        const color = BAR_COLORS[index % BAR_COLORS.length];
        return '<div class="bar-row"><span title="' + escapeHtml(row.label) + '">' + escapeHtml(row.label) + '</span>' +
          '<span class="bar-track"><span class="bar-fill" style="width:' + width + '%;background:' + color + '"></span></span>' +
          '<span class="bar-count">' + escapeHtml(row.count) + ' &middot; ' + percentage + '%</span></div>';
      }).join('');
    }
    function renderUsageDonut(used, unused) {
      const total = Math.max(Number(used || 0) + Number(unused || 0), 1);
      const percentage = Math.round((Number(used || 0) / total) * 100);
      document.getElementById('usage-donut').style.setProperty('--used-angle', (percentage * 3.6) + 'deg');
      document.getElementById('usage-percentage').textContent = percentage + '%';
      document.getElementById('usage-used').textContent = used || 0;
      document.getElementById('usage-unused').textContent = unused || 0;
    }
    function renderColumns(containerId, rows) {
      const container = document.getElementById(containerId);
      if (!container) return;
      if (!rows || !rows.length) { container.innerHTML = '<p>No redirect data yet.</p>'; return; }
      const visible = rows.slice(0, 8);
      const max = Math.max(...visible.map((row) => Number(row.count || 0)), 1);
      container.innerHTML = visible.map((row, index) => {
        const height = Math.max((Number(row.count || 0) / max) * 100, 2);
        return '<div class="column-item" title="' + escapeHtml(row.label) + ': ' + escapeHtml(row.count) + '">' +
          '<div class="column-track"><div class="column-fill" style="height:' + height + '%;filter:hue-rotate(' + (index * 16) + 'deg)"><span class="column-count">' + escapeHtml(row.count) + '</span></div></div>' +
          '<span class="column-label">' + escapeHtml(row.label) + '</span></div>';
      }).join('');
    }
    let analyticsMap;
    let locationLayer;
    function renderLocationMap(locations) {
      const empty = document.getElementById('location-map-empty');
      if (!window.L) { empty.textContent = 'Map resources could not be loaded.'; return; }
      if (!analyticsMap) {
        analyticsMap = L.map('location-map', { worldCopyJump:true }).setView([20, 0], 2);
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 12,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        }).addTo(analyticsMap);
        locationLayer = L.layerGroup().addTo(analyticsMap);
      }
      locationLayer.clearLayers();
      const bounds = [];
      (locations || []).forEach((location) => {
        const latitude = Number(location.latitude);
        const longitude = Number(location.longitude);
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
        const label = [location.city, location.region, location.country].filter(Boolean).map(escapeHtml).join(', ');
        L.circleMarker([latitude, longitude], {
          radius:Math.min(22, 6 + Math.sqrt(Number(location.count) || 1) * 2),
          color:'#00d4ff', fillColor:'#10b981', fillOpacity:.65, weight:2
        }).bindPopup('<strong>' + (label || 'Approximate location') + '</strong><br>' + escapeHtml(location.count || 0) + ' click(s)').addTo(locationLayer);
        bounds.push([latitude, longitude]);
      });
      empty.textContent = bounds.length ? 'Locations are approximate and aggregated; visitor IP addresses are not stored.' : 'No location data recorded for this selection yet.';
      if (bounds.length) analyticsMap.fitBounds(bounds, { padding:[30,30], maxZoom:5 });
      else analyticsMap.setView([20, 0], 2);
      setTimeout(() => analyticsMap.invalidateSize(), 0);
    }
    let analyticsLinksLoaded = false;
    async function loadAnalyticsLinks() {
      if (analyticsLinksLoaded) return;
      const result = await apiRequest('/api/stats');
      const select = document.getElementById('analytics-link-select');
      select.innerHTML = '<option value="">All links</option>' + (result.links || []).map((link) =>
        '<option value="' + escapeHtml(link.code) + '">' + escapeHtml(link.code) + '</option>'
      ).join('');
      analyticsLinksLoaded = true;
    }
    async function loadAnalytics() {
      setPanelStatus('analytics-status', 'Loading statistics...');
      try {
        await loadAnalyticsLinks();
        const selectedCode = document.getElementById('analytics-link-select').value;
        const data = await apiRequest('/api/analytics' + (selectedCode ? '?code=' + encodeURIComponent(selectedCode) : ''));
        document.getElementById('stat-links').textContent = data.totalLinks;
        document.getElementById('stat-redirects').textContent = data.totalRedirects;
        document.getElementById('stat-used').textContent = data.usedLinks;
        document.getElementById('stat-unused').textContent = data.unusedLinks;
        document.getElementById('stat-most-viewed').textContent = data.mostViewed || '-';
        const breakdowns = data.breakdowns || {};
        renderUsageDonut(data.usedLinks, data.unusedLinks);
        renderColumns('columns-links', breakdowns.links);
        renderBars('bars-links', breakdowns.links);
        renderBars('bars-browsers', breakdowns.browsers);
        renderBars('bars-os', breakdowns.os);
        renderBars('bars-devices', breakdowns.devices);
        renderBars('bars-referrers', breakdowns.referrers);
        renderBars('bars-countries', breakdowns.countries);
        renderBars('bars-owners', breakdowns.owners);
        renderLocationMap(breakdowns.locations);
        renderSimpleRows('recent-links-body', data.recentLinks || [], 'lastAccessedAt');
        setPanelStatus('analytics-status', 'Statistics updated (' + data.scope + ' scope, avg ' + data.averageRedirects + ' redirects per link).', 'success');
      } catch (error) { setPanelStatus('analytics-status', error.message, 'error'); }
    }
    document.getElementById('load-analytics').addEventListener('click', loadAnalytics);
    document.getElementById('analytics-link-select').addEventListener('change', loadAnalytics);
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
    let generatedApiKey = '';
    document.getElementById('generate-api-key').addEventListener('click', async () => {
      if (!window.confirm('Generate a new API key? Your existing key stops working immediately.')) return;
      setPanelStatus('api-key-status', 'Generating key...');
      try {
        const result = await apiRequest('/api/profile/apikey', { method: 'POST' });
        generatedApiKey = result.apiKey;
        document.getElementById('api-key-value').textContent = generatedApiKey;
        document.getElementById('api-key-reveal').hidden = false;
        setPanelStatus('api-key-status', 'New API key generated.', 'success');
        await loadProfile();
      } catch (error) { setPanelStatus('api-key-status', error.message, 'error'); }
    });
    document.getElementById('copy-api-key').addEventListener('click', async () => {
      if (!generatedApiKey) return;
      try { await navigator.clipboard.writeText(generatedApiKey); setPanelStatus('api-key-status', 'API key copied.', 'success'); }
      catch { setPanelStatus('api-key-status', 'Clipboard copy failed. Copy manually.', 'error'); }
    });
    document.getElementById('register-passkey').addEventListener('click', async () => {
      setPanelStatus('passkey-status', 'Waiting for your authenticator...');
      try {
        const payload = await apiRequest('/api/profile/passkeys/options', { method: 'POST' });
        const response = await SimpleWebAuthnBrowser.startRegistration({ optionsJSON: payload.options });
        await apiRequest('/api/profile/passkeys/verify', {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ response, state: payload.state })
        });
        setPanelStatus('passkey-status', 'Passkey added.', 'success');
      } catch (error) { setPanelStatus('passkey-status', error.message || 'Passkey registration failed.', 'error'); }
    });
    async function loadProfile() {
      try {
        const profile = await apiRequest('/api/profile');
        document.getElementById('api-key-prefix').textContent = profile.apiKeyPrefix ? profile.apiKeyPrefix + '\u2026' : 'none';
        document.getElementById('api-key-created').textContent = profile.apiKeyCreatedAt ? '(created ' + profile.apiKeyCreatedAt + ')' : '';
      } catch (error) { setPanelStatus('api-key-status', error.message, 'error'); }
    }`;
}

module.exports = {
  escapeHtml,
  HEAD_ASSETS,
  THEME_CSS,
  renderDocumentHead,
  renderAppHeader,
  renderTabsNav,
  coreClientScript
};
