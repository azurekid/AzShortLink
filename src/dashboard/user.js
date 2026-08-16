'use strict';

const {
  escapeHtml,
  renderDocumentHead,
  renderAppHeader,
  renderTabsNav,
  coreClientScript
} = require('./shared');

// The regular-user dashboard: Links (with a personal invite-link card), Statistics and
// Account only. It never includes admin markup, endpoints or script - a non-admin's page
// source has no trace of user/audit/invite-management features they can't use anyway.
function renderUserDashboard(baseUrl, options = {}) {
  const user = options.user || { displayName: 'User', username: 'user', role: 'user' };
  const safeBaseUrl = escapeHtml(baseUrl);
  const safeDisplayName = escapeHtml(user.displayName || user.username || 'User');
  const safeUsername = escapeHtml(user.username || '');
  const safeRole = escapeHtml(user.role || 'user');
  const legacyConfigWarning = options.apiKeyConfigured === false
    ? '<p class="status">SHORTLINK_API_KEY is not configured</p>'
    : '';

  return `<!doctype html>
<html lang="en">
<head>
${renderDocumentHead('AzShortLink Dashboard')}
</head>
<body>
  <div class="bg-layer"></div>
  <main class="app-shell">
    ${renderAppHeader({ safeDisplayName, safeRole })}
    <section class="page-intro"><p class="eyebrow">Link operations</p><h1>Short links, without the busywork.</h1><p>Managing links for <span class="mono">${safeBaseUrl}</span>.</p>${legacyConfigWarning}</section>
    ${renderTabsNav([
      { panel: 'panel-links', label: 'Links', icon: 'link' },
      { panel: 'panel-analytics', label: 'Statistics', icon: 'chart-bar' },
      { panel: 'panel-account', label: 'Account', icon: 'user' },
      { panel: 'panel-help', label: 'Help', icon: 'circle-question' }
    ])}

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
          <div class="actions">
            <button id="copy-result" class="button-secondary" type="button" hidden><i class="fas fa-copy"></i>Copy result</button>
            <a id="download-qr" class="button-link button-secondary" hidden><i class="fas fa-qrcode"></i>Download QR code</a>
          </div>
        </section>
        <section class="card">
          <div class="card-header"><h2>API reference</h2></div>
          <p class="mono">POST /api/shorten</p>
          <p class="mono">GET /api/stats</p>
          <p class="mono">GET /api/analytics</p>
          <p class="mono">DELETE /api/links/{code}</p>
          <p>An API key is required to call these endpoints. Create one from the Account tab.</p>
          <a class="button-link button-secondary" href="/api"><i class="fas fa-book-open"></i>Open API reference</a>
        </section>
        <section class="card span-full">
          <div class="card-header"><h2>Your links</h2><button id="load-stats" class="button-secondary button-compact" type="button">Refresh</button></div>
          <div class="table-wrap"><table>
            <thead><tr><th>Short URL</th><th>Target URL</th><th>Redirects</th><th>Last redirect</th><th></th></tr></thead>
            <tbody id="stats-body"><tr><td colspan="5">No data loaded yet.</td></tr></tbody>
          </table></div>
        </section>
        <section class="card span-full">
          <div class="card-header"><h2><i class="fas fa-user-plus"></i>Invite link</h2></div>
          <p>Create your personal invite link to let someone else sign up. You can only create one.</p>
          <div id="my-invite-body"><p>Loading...</p></div>
          <div id="my-invite-status" class="status" role="status" aria-live="polite"></div>
        </section>
      </div>
    </section>

    <section id="panel-analytics" class="tab-panel" role="tabpanel" hidden>
      <div class="content-grid">
        <section class="card span-full">
          <div class="card-header"><h2><i class="fas fa-chart-bar"></i>Overview</h2><div class="analytics-filter"><div class="field"><label for="analytics-link-select">Statistics for</label><select id="analytics-link-select"><option value="">All links</option></select></div><button id="load-analytics" class="button-secondary button-compact" type="button"><i class="fas fa-sync-alt"></i>Refresh</button></div></div>
          <div class="stat-grid">
            <div class="stat"><div class="stat-icon cyan"><i class="fas fa-link"></i></div><div><span class="stat-value" id="stat-links">-</span><span class="stat-label">Total links</span></div></div>
            <div class="stat"><div class="stat-icon purple"><i class="fas fa-eye"></i></div><div><span class="stat-value" id="stat-redirects">-</span><span class="stat-label">Total redirects</span></div></div>
            <div class="stat"><div class="stat-icon green"><i class="fas fa-bolt"></i></div><div><span class="stat-value" id="stat-used">-</span><span class="stat-label">Used links</span></div></div>
            <div class="stat"><div class="stat-icon red"><i class="fas fa-ghost"></i></div><div><span class="stat-value" id="stat-unused">-</span><span class="stat-label">Never used</span></div></div>
            <div class="stat"><div class="stat-icon orange"><i class="fas fa-fire"></i></div><div><span class="stat-value" id="stat-most-viewed">-</span><span class="stat-label">Most viewed</span></div></div>
          </div>
          <div id="analytics-status" class="status" role="status" aria-live="polite"></div>
        </section>
        <section class="card analytics-chart-card">
          <div class="card-header"><h2><i class="fas fa-chart-pie"></i>Link utilization</h2></div>
          <div class="donut-wrap">
            <div id="usage-donut" class="donut-chart"><div class="donut-center"><strong id="usage-percentage">0%</strong><span>used</span></div></div>
            <div class="chart-legend"><span><i class="legend-dot"></i><strong id="usage-used">0</strong> used</span><span><i class="legend-dot unused"></i><strong id="usage-unused">0</strong> unused</span></div>
          </div>
        </section>
        <section class="card analytics-chart-card">
          <div class="card-header"><h2><i class="fas fa-chart-column"></i>Redirects by top link</h2></div>
          <div id="columns-links" class="column-chart"><p>No redirect data yet.</p></div>
        </section>
        <section class="card span-full">
          <div class="card-header"><h2><i class="fas fa-earth-americas"></i>Click map</h2></div>
          <div id="location-map" class="location-map" aria-label="Map of approximate click locations"></div>
          <p id="location-map-empty" class="location-map-empty">No location data yet.</p>
        </section>
        <section class="card">
          <div class="card-header"><h2><i class="fas fa-ranking-star"></i>Top links</h2></div>
          <div class="bar-list" id="bars-links"><p>No data yet.</p></div>
        </section>
        <section class="card">
          <div class="card-header"><h2><i class="fas fa-window-maximize"></i>Browsers</h2></div>
          <div class="bar-list" id="bars-browsers"><p>No data yet.</p></div>
        </section>
        <section class="card">
          <div class="card-header"><h2><i class="fas fa-laptop"></i>Operating systems</h2></div>
          <div class="bar-list" id="bars-os"><p>No data yet.</p></div>
        </section>
        <section class="card">
          <div class="card-header"><h2><i class="fas fa-mobile-alt"></i>Device types</h2></div>
          <div class="bar-list" id="bars-devices"><p>No data yet.</p></div>
        </section>
        <section class="card">
          <div class="card-header"><h2><i class="fas fa-external-link-alt"></i>Referrers</h2></div>
          <div class="bar-list" id="bars-referrers"><p>No data yet.</p></div>
        </section>
        <section class="card">
          <div class="card-header"><h2><i class="fas fa-flag"></i>Countries</h2></div>
          <div class="bar-list" id="bars-countries"><p>No data yet.</p></div>
        </section>
        <section class="card">
          <div class="card-header"><h2><i class="fas fa-clock"></i>Recent activity</h2></div>
          <div class="table-wrap"><table><thead><tr><th>Code</th><th>Last redirect</th></tr></thead><tbody id="recent-links-body"><tr><td colspan="2">No data yet.</td></tr></tbody></table></div>
        </section>
      </div>
    </section>

    <section id="panel-account" class="tab-panel" role="tabpanel" hidden>
      <div class="content-grid">
        <section class="card">
          <div class="card-header"><h2><i class="fas fa-user-circle"></i>Profile</h2></div>
          <p>Signed in as <span class="mono">${safeUsername}</span>.</p>
          <p>Usernames are case-sensitive.</p>
        </section>
        <section class="card">
          <div class="card-header"><h2><i class="fas fa-key"></i>Change password</h2></div>
          <form id="password-form" class="stack">
            <div class="field"><label for="current-password">Current password</label><input id="current-password" type="password" autocomplete="current-password" required /></div>
            <div class="field"><label for="new-account-password">New password (min 12 characters)</label><input id="new-account-password" type="password" minlength="12" autocomplete="new-password" required /></div>
            <button type="submit"><i class="fas fa-save"></i>Update password</button>
          </form>
          <div id="password-status" class="status" role="status" aria-live="polite"></div>
        </section>
        <section class="card span-full">
          <div class="card-header"><h2><i class="fas fa-code"></i>Personal API key</h2><button id="generate-api-key" class="button-secondary button-compact" type="button"><i class="fas fa-rotate"></i>Generate new key</button></div>
          <p>Use a personal API key to call the API from scripts or CI. The key inherits your profile's permissions, so links you create with it belong to you.</p>
          <p>Current key: <span class="mono" id="api-key-prefix">none</span> <span class="mono" id="api-key-created"></span></p>
          <div id="api-key-reveal" class="key-reveal" hidden>
            <strong><i class="fas fa-triangle-exclamation"></i> Copy this key now &mdash; it is shown only once.</strong>
            <div class="key-value" id="api-key-value"></div>
            <div class="actions"><button id="copy-api-key" class="button-secondary button-compact" type="button"><i class="fas fa-copy"></i>Copy key</button></div>
          </div>
          <div id="api-key-status" class="status" role="status" aria-live="polite"></div>
        </section>
        <section class="card span-full">
          <div class="card-header"><h2><i class="fas fa-fingerprint"></i>Passkeys</h2><button id="register-passkey" class="button-secondary button-compact" type="button">Add passkey</button></div>
          <p>Use a device passkey for passwordless sign-in. Your password remains available for recovery.</p>
          <div id="passkey-status" class="status" role="status" aria-live="polite"></div>
        </section>
      </div>
    </section>

    <section id="panel-help" class="tab-panel" role="tabpanel" hidden>
      <div class="content-grid">
        <section class="card">
          <div class="card-header"><h2><i class="fas fa-paper-plane"></i>Send a help request</h2></div>
          <form id="help-form" class="stack">
            <div class="field"><label for="help-subject">Subject</label><input id="help-subject" maxlength="120" required /></div>
            <div class="field"><label for="help-message">How can we help?</label><textarea id="help-message" maxlength="4000" rows="8" required></textarea></div>
            <button type="submit"><i class="fas fa-paper-plane"></i>Send request</button>
          </form>
          <div id="help-status" class="status" role="status" aria-live="polite"></div>
        </section>
        <section class="card span-full">
          <div class="card-header"><h2><i class="fas fa-comments"></i>Your requests</h2><button id="load-help" class="button-secondary button-compact" type="button">Refresh</button></div>
          <div id="help-requests" class="stack"><p>No help requests loaded yet.</p></div>
        </section>
      </div>
    </section>
  </main>
  <script src="/passkeys.js"></script>
  <script>${coreClientScript({
    safeUsername,
    safeBaseUrl,
    colspan: 5,
    ownerColumnScript: "const owner = '';",
    tabDispatch: `if (tab.dataset.panel === 'panel-analytics') loadAnalytics();
        if (tab.dataset.panel === 'panel-account') loadProfile();
        if (tab.dataset.panel === 'panel-help') loadHelpRequests();`
  })}
    async function loadHelpRequests() {
      const container = document.getElementById('help-requests');
      try {
        const data = await apiRequest('/api/help');
        const requests = data.requests || [];
        if (!requests.length) { container.innerHTML = '<p>No help requests yet.</p>'; return; }
        container.innerHTML = requests.map((item) => '<article class="result"><div class="card-header"><strong>' + escapeHtml(item.subject) + '</strong><span class="pill ' + (item.status === 'answered' ? 'up' : '') + '">' + escapeHtml(item.status) + '</span></div>' +
          '<p>' + escapeHtml(item.message) + '</p><p class="mono">Sent ' + escapeHtml(item.createdAt) + '</p>' +
          (item.response ? '<div class="status success"><strong>Administrator response</strong><p>' + escapeHtml(item.response) + '</p><span class="mono">' + escapeHtml(item.respondedAt) + '</span></div>' : '<p>Awaiting an administrator response.</p>') + '</article>').join('');
      } catch (error) { container.innerHTML = '<p class="status error">' + escapeHtml(error.message) + '</p>'; }
    }
    document.getElementById('load-help').addEventListener('click', loadHelpRequests);
    document.getElementById('help-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      setPanelStatus('help-status', 'Sending request...');
      try {
        await apiRequest('/api/help', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ subject: document.getElementById('help-subject').value, message: document.getElementById('help-message').value }) });
        event.currentTarget.reset();
        setPanelStatus('help-status', 'Help request sent.', 'success');
        await loadHelpRequests();
      } catch (error) { setPanelStatus('help-status', error.message, 'error'); }
    });
    async function loadMyInvite() {
      const body = document.getElementById('my-invite-body');
      if (!body) return;
      try {
        const data = await apiRequest('/api/invites/mine');
        if (!data.invite) {
          body.innerHTML = '<button id="create-my-invite" class="button-secondary button-compact" type="button">Create invite link</button>';
          document.getElementById('create-my-invite').addEventListener('click', async () => {
            setPanelStatus('my-invite-status', 'Creating invite link...');
            try {
              await apiRequest('/api/invites', { method: 'POST' });
              await loadMyInvite();
              setPanelStatus('my-invite-status', 'Invite link created.', 'success');
            } catch (error) { setPanelStatus('my-invite-status', error.message, 'error'); }
          });
          return;
        }

        const status = data.invite.redeemed
          ? 'Redeemed by ' + escapeHtml(data.invite.redeemedBy || '-')
          : 'Active - not used yet';
        body.innerHTML = '<p class="mono">' + escapeHtml(data.invite.inviteUrl) + '</p><p>' + status + '</p>';
      } catch (error) { body.innerHTML = '<p class="status error">' + escapeHtml(error.message) + '</p>'; }
    }
    loadStats();
    loadMyInvite();
  </script>
</body>
</html>`;
}

module.exports = { renderUserDashboard };
