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
const HEAD_ASSETS = `  <link rel="icon" type="image/svg+xml" href="${FAVICON_URL}" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=Share+Tech+Mono&display=swap" />
  <link rel="stylesheet" href="/vendor/css/fontawesome.min.css" />
  <link rel="stylesheet" href="/vendor/leaflet/leaflet.css" />
  <script src="/vendor/leaflet/leaflet.js"></script>`;

// Shared building blocks so the "look and feel" stays consistent between the user and admin
// dashboards, while each of those keeps its own template/script - see src/dashboard/user.js
// and src/dashboard/admin.js. Nothing here is role-specific, so it's safe for either to use.

function renderDocumentHead(safeTitle) {
  return `<meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${safeTitle}</title>
${HEAD_ASSETS}
  <link rel="stylesheet" href="/assets/css/dashboard.css" />
  <link rel="stylesheet" href="/assets/css/custom.css" />`;
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

// Shown on the Account tab of both dashboards so the current plan, today's usage and the
// upgrade path live where the rest of the account settings are.
function renderPlanCard() {
  return `<section class="card span-full" id="plan-card">
          <div class="card-header"><h2><i class="fas fa-gem"></i>Plan and limits</h2><a class="button-link button-secondary button-compact" href="/pricing" target="_blank" rel="noopener"><i class="fas fa-tags"></i>Compare plans</a></div>
          <p>Current plan: <strong id="plan-name">-</strong> <span class="pill" id="plan-pending" hidden></span></p>
          <div class="plan-usage" id="plan-usage"></div>
          <div class="actions" id="plan-upgrade-actions"></div>
          <div id="plan-status" class="status" role="status" aria-live="polite"></div>
        </section>`;
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
    const formatDateTime = (value) => {
      if (!value) return '-';
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return String(value);
      return new Intl.DateTimeFormat(undefined, { dateStyle:'medium', timeStyle:'short' }).format(date);
    };
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
      await loadPlan();
    }
    let availablePlans = [];
    function renderPlanUsage(account) {
      const rows = [
        { label: 'New links today', used: account.usage.linksToday, limit: account.limits.linksPerDay },
        { label: 'Redirects today', used: account.usage.redirectsToday, limit: account.limits.redirectsPerDay },
        { label: 'API requests per minute', used: null, limit: account.limits.apiRequestsPerMinute }
      ];
      return rows.map((row) => {
        const percentage = row.used === null ? 0 : Math.min(100, Math.round((row.used / row.limit) * 100));
        const value = row.used === null ? row.limit.toLocaleString() : row.used.toLocaleString() + ' / ' + row.limit.toLocaleString();
        return '<div class="plan-usage-row"><span>' + escapeHtml(row.label) + '</span><div class="plan-bar"><i style="width:' + percentage + '%"></i></div><strong>' + escapeHtml(value) + '</strong></div>';
      }).join('');
    }
    async function loadPlan() {
      const card = document.getElementById('plan-card');
      if (!card) return;
      try {
        if (!availablePlans.length) availablePlans = (await apiRequest('/api/plans')).plans || [];
        const account = await apiRequest('/api/account/plan');
        document.getElementById('plan-name').textContent = account.planName + (account.planExpiresAt ? ' (until ' + formatDateTime(account.planExpiresAt) + ')' : '');
        const pending = document.getElementById('plan-pending');
        pending.hidden = !account.pendingPlan;
        pending.textContent = account.pendingPlan ? 'Upgrade to ' + account.pendingPlan + ' awaiting activation' : '';
        document.getElementById('plan-usage').innerHTML = renderPlanUsage(account) +
          '<p class="plan-reset mono">Daily counters reset ' + escapeHtml(formatDateTime(account.usage.resetAt)) + '</p>';
        document.getElementById('plan-upgrade-actions').innerHTML = availablePlans
          .filter((plan) => plan.id !== account.plan)
          .map((plan) => '<button class="button-secondary button-compact" type="button" data-request-plan="' + escapeHtml(plan.id) + '">' +
            (plan.priceEurPerMonth === 0 ? 'Switch to ' : 'Request ') + escapeHtml(plan.name) + '</button>')
          .join('');
      } catch (error) { setPanelStatus('plan-status', error.message, 'error'); }
    }
    const planActionsEl = document.getElementById('plan-upgrade-actions');
    if (planActionsEl) planActionsEl.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-request-plan]');
      if (!button) return;
      setPanelStatus('plan-status', 'Submitting plan request...');
      try {
        const result = await apiRequest('/api/account/plan', {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ plan: button.dataset.requestPlan })
        });
        setPanelStatus('plan-status', result.message || 'Plan request submitted.', 'success');
        await loadPlan();
      } catch (error) { setPanelStatus('plan-status', error.message, 'error'); }
    });`;
}

module.exports = {
  escapeHtml,
  HEAD_ASSETS,
  renderDocumentHead,
  renderAppHeader,
  renderTabsNav,
  renderPlanCard,
  coreClientScript
};
