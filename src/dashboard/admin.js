'use strict';

const {
  escapeHtml,
  renderDocumentHead,
  renderAppHeader,
  renderTabsNav,
  renderPlanCard,
  coreClientScript
} = require('./shared');

// The admin dashboard: everything the user dashboard has, plus Profiles/Invites/Health
// management and the Audit trail. Kept as its own template/script so a regular user's
// browser never receives any of this markup or code (see src/dashboard/user.js).
function renderAdminDashboard(baseUrl, options = {}) {
  const user = options.user || { displayName: 'Admin', username: 'admin', role: 'admin' };
  const safeBaseUrl = escapeHtml(baseUrl);
  const safeDisplayName = escapeHtml(user.displayName || user.username || 'Admin');
  const safeUsername = escapeHtml(user.username || '');
  const safeRole = escapeHtml(user.role || 'admin');
  const cspNonce = escapeHtml(options.cspNonce || '');
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
    <section class="page-intro"><p class="eyebrow">Link operations</p><h1>Short links, without the busywork.</h1><p>Managing links for <span class="mono">${safeBaseUrl}</span> across all profiles.</p>${legacyConfigWarning}</section>
    <div id="admin-alerts" class="alert-banner" role="status" aria-live="polite" hidden></div>
    ${renderTabsNav([
      { panel: 'panel-links', label: 'Links', icon: 'link' },
      { panel: 'panel-analytics', label: 'Statistics', icon: 'chart-bar' },
      { panel: 'panel-account', label: 'Account', icon: 'user' },
      { panel: 'panel-profiles', label: 'Profiles', icon: 'users' },
      { panel: 'panel-invites', label: 'Invites', icon: 'user-plus' },
      { panel: 'panel-help', label: 'Help', icon: 'circle-question' },
      { panel: 'panel-operations', label: 'Operations', icon: 'gauge-high' },
      { panel: 'panel-audit', label: 'Audit trail', icon: 'shield-halved' }
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
          <div class="card-header"><h2>All links</h2><button id="load-stats" class="button-secondary button-compact" type="button">Refresh</button></div>
          <div class="table-wrap"><table>
            <thead><tr><th>Short URL</th><th>Target URL</th><th>Owner</th><th>Redirects</th><th>Last redirect</th><th></th></tr></thead>
            <tbody id="stats-body"><tr><td colspan="6">No data loaded yet.</td></tr></tbody>
          </table></div>
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
          <div class="card-header"><h2><i class="fas fa-users"></i>Redirects by profile</h2></div>
          <div class="bar-list" id="bars-owners"><p>No data yet.</p></div>
        </section>
        <section class="card span-full">
          <div class="card-header"><h2><i class="fas fa-stream"></i>Recent activity</h2></div>
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
        ${renderPlanCard()}
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

    <section id="panel-profiles" class="tab-panel" role="tabpanel" hidden>
      <div class="content-grid">
        <section class="card span-full">
          <div class="card-header"><h2>Profiles</h2><button id="load-users" class="button-secondary button-compact" type="button">Refresh</button></div>
          <p class="section-lead">Review identity state, invitation ancestry, activity, and account access.</p>
          <div id="users-body" class="profile-list"><p>No profiles loaded yet.</p></div>
        </section>
        <section class="card" id="user-panel">
          <div class="card-header"><h2>Add user</h2></div>
          <form id="user-form" class="stack">
            <div class="field"><label for="new-username">Username (case-sensitive)</label><input id="new-username" name="username" autocomplete="off" required pattern="[A-Za-z0-9._-]{3,64}" /></div>
            <div class="field"><label for="new-display-name">Display name</label><input id="new-display-name" name="displayName" required /></div>
            <div class="field"><label for="new-role">Role</label><select id="new-role" name="role"><option value="user">User</option><option value="admin">Administrator</option></select></div>
            <div class="field"><label for="new-password">Temporary password</label><input id="new-password" name="password" type="password" minlength="12" autocomplete="new-password" required /></div>
            <button type="submit">Create user</button>
          </form>
          <div id="user-status" class="status" role="status" aria-live="polite"></div>
        </section>
        <section class="card" id="reset-password-panel" hidden>
          <div class="card-header"><h2>Reset password</h2></div>
          <form id="reset-password-form" class="stack">
            <p>Resetting password for <span class="mono" id="reset-password-target"></span>.</p>
            <div class="field"><label for="reset-password-value">New password (min 12 characters)</label><input id="reset-password-value" type="password" minlength="12" autocomplete="new-password" required /></div>
            <div class="actions">
              <button type="submit">Reset password</button>
              <button id="cancel-reset-password" class="button-secondary" type="button">Cancel</button>
            </div>
          </form>
          <div id="reset-password-status" class="status" role="status" aria-live="polite"></div>
        </section>
      </div>
    </section>

    <section id="panel-invites" class="tab-panel" role="tabpanel" hidden>
      <div class="content-grid">
        <section class="card span-full">
          <div class="card-header"><h2>Invite links</h2><button id="create-invite" class="button-secondary button-compact" type="button">Create invite link</button></div>
          <p class="section-lead">Track active and redeemed invitations across every sponsor.</p>
          <div id="invite-status" class="status" role="status" aria-live="polite"></div>
          <div class="table-wrap"><table>
            <thead><tr><th>Invite URL</th><th>Created by</th><th>Created</th><th>Status</th><th></th></tr></thead>
            <tbody id="invites-body"><tr><td colspan="5">No invite links loaded yet.</td></tr></tbody>
          </table></div>
        </section>
      </div>
    </section>

    <section id="panel-operations" class="tab-panel" role="tabpanel" hidden>
      <div class="content-grid">
        <section class="card span-full">
          <div class="card-header"><h2>Service health</h2><button id="load-health" class="button-secondary button-compact" type="button">Check</button></div>
          <p class="section-lead">Inspect runtime storage and configuration readiness.</p>
          <div id="health-body" class="stack"><p>Run a health check to view storage and configuration state.</p></div>
        </section>
      </div>
    </section>

    <section id="panel-help" class="tab-panel" role="tabpanel" hidden>
      <div class="content-grid">
        <section class="card span-full">
          <div class="card-header"><h2><i class="fas fa-comments"></i>Help requests</h2><button id="load-help" class="button-secondary button-compact" type="button">Refresh</button></div>
          <p class="section-lead">Review user questions and send responses that appear in their dashboard.</p>
          <div id="help-status" class="status" role="status" aria-live="polite"></div>
          <div id="help-requests" class="stack"><p>No help requests loaded yet.</p></div>
        </section>
      </div>
    </section>

    <section id="panel-audit" class="tab-panel" role="tabpanel" hidden>
      <div class="content-grid">
        <section class="card span-full">
          <div class="card-header"><h2><i class="fas fa-shield-halved"></i>Audit trail (30-day retention)</h2>
            <div class="actions">
              <button id="load-audit" class="button-secondary button-compact" type="button"><i class="fas fa-sync-alt"></i>Refresh</button>
              <button id="export-audit-csv" class="button-secondary button-compact" type="button"><i class="fas fa-file-csv"></i>Export CSV</button>
            </div>
          </div>
          <div class="stack audit-filters">
            <div class="field"><label for="audit-filter-action">Action</label>
              <select id="audit-filter-action">
                <option value="">All actions</option>
                <option value="LOGIN_SUCCESS">Login success</option>
                <option value="LOGIN_FAILED">Login failed</option>
                <option value="LOGOUT">Logout</option>
                <option value="LINK_CREATED">Link created</option>
                <option value="LINK_DELETED">Link deleted</option>
                <option value="LINK_DELETE_DENIED">Link delete denied</option>
                <option value="SIGNUP_SUCCESS">Signup success</option>
                <option value="SIGNUP_FAILED">Signup failed</option>
                <option value="USER_CREATED">User created</option>
                <option value="USER_DELETED">User deleted</option>
                <option value="PASSWORD_CHANGED">Password changed</option>
                <option value="PASSWORD_RESET_BY_ADMIN">Password reset by admin</option>
                <option value="PASSWORD_RESET_SELF_SERVICE">Self-service password reset</option>
                <option value="API_KEY_ROTATED">API key rotated</option>
                <option value="INVITE_CREATED">Invite created</option>
                <option value="INVITE_CREATION_DENIED">Invite creation denied</option>
                <option value="INVITE_REVOKED">Invite revoked</option>
                <option value="INVITE_REDEEMED">Invite redeemed</option>
                <option value="USER_ACCESS_CHANGED">User access changed</option>
                <option value="BRANCH_SUSPENSION_CHANGED">Branch suspension changed</option>
                <option value="EMAIL_VERIFIED">Email verified</option>
                <option value="PASSKEY_REGISTERED">Passkey registered</option>
                <option value="PASSKEY_REGISTRATION_FAILED">Passkey registration failed</option>
                <option value="RATE_LIMITED">Rate limited</option>
                <option value="QUOTA_EXCEEDED">Daily quota exceeded</option>
                <option value="PLAN_UPGRADE_REQUESTED">Plan upgrade requested</option>
                <option value="PLAN_CHANGED">Plan changed</option>
              </select>
            </div>
            <div class="field"><label for="audit-filter-actor">Actor (username)</label><input id="audit-filter-actor" type="text" placeholder="e.g. admin" /></div>
            <div class="field"><label for="audit-filter-channel">Channel</label><select id="audit-filter-channel"><option value="">All channels</option><option value="dashboard">Dashboard</option><option value="api">API</option></select></div>
            <div class="field"><label for="audit-filter-outcome">Outcome</label><select id="audit-filter-outcome"><option value="">All outcomes</option><option value="success">Success</option><option value="failure">Failure</option></select></div>
            <div class="field"><label for="audit-filter-since">Since</label><input id="audit-filter-since" type="datetime-local" /></div>
          </div>
          <div id="audit-status" class="status" role="status" aria-live="polite"></div>
          <div class="table-wrap"><table>
            <thead><tr><th>Time (UTC)</th><th>Action</th><th>Outcome</th><th>Actor</th><th>Channel / auth</th><th>Source</th><th>Request</th><th>User agent</th><th>Details</th></tr></thead>
            <tbody id="audit-body"><tr><td colspan="9">No audit events loaded yet.</td></tr></tbody>
          </table></div>
        </section>
      </div>
    </section>
  </main>
  <script src="/passkeys.js"></script>
  <script nonce="${cspNonce}">${coreClientScript({
    safeUsername,
    safeBaseUrl,
    colspan: 6,
    ownerColumnScript: "const owner = '<td>' + escapeHtml(item.ownerId || '-') + '</td>';",
    tabDispatch: `if (tab.dataset.panel === 'panel-analytics') loadAnalytics();
      if (tab.dataset.panel === 'panel-profiles') loadUsers();
      if (tab.dataset.panel === 'panel-invites') loadInvites();
        if (tab.dataset.panel === 'panel-help') loadHelpRequests();
        if (tab.dataset.panel === 'panel-audit') loadAuditLog();
        if (tab.dataset.panel === 'panel-account') loadProfile();`
  })}
    async function loadHelpRequests() {
      const container = document.getElementById('help-requests');
      setPanelStatus('help-status', 'Loading help requests...');
      try {
        const data = await apiRequest('/api/admin/help');
        const requests = data.requests || [];
        if (!requests.length) { container.innerHTML = '<p>No help requests found.</p>'; setPanelStatus('help-status', 'No requests.', 'success'); return; }
        container.innerHTML = requests.map((item) => {
          const thread = (item.messages || []).map((message) => '<div class="status ' + (message.role === 'admin' ? 'success' : '') + '"><strong>' + escapeHtml(message.role === 'admin' ? message.author + ' (administrator)' : message.author) + '</strong><p>' + escapeHtml(message.text) + '</p><span class="mono">' + escapeHtml(formatDateTime(message.createdAt)) + '</span></div>').join('');
          return '<article class="result"><div class="card-header"><div><strong>' + escapeHtml(item.subject) + '</strong><p class="mono">Ticket ' + escapeHtml(item.ticketNumber) + ' / ' + escapeHtml(item.username) + ' / Opened ' + escapeHtml(formatDateTime(item.createdAt)) + '</p></div><span class="pill ' + (item.status === 'answered' ? 'up' : '') + '">' + escapeHtml(item.status) + '</span></div>' + thread +
          '<form class="stack help-response-form" data-help-id="' + escapeHtml(item.id) + '"><div class="field"><label>Add response</label><textarea maxlength="2000" rows="5" required></textarea></div><div class="actions"><button type="submit">Send response</button>' +
          (item.status === 'closed' ? '<button class="button-secondary" type="button" data-help-status="open" data-help-id="' + escapeHtml(item.id) + '">Reopen</button>' : '<button class="button-secondary" type="button" data-help-status="closed" data-help-id="' + escapeHtml(item.id) + '">Close</button>') + '</div></form></article>';
        }).join('');
        setPanelStatus('help-status', 'Loaded ' + requests.length + ' request(s).', 'success');
      } catch (error) { container.innerHTML = '<p class="status error">' + escapeHtml(error.message) + '</p>'; setPanelStatus('help-status', error.message, 'error'); }
    }
    document.getElementById('load-help').addEventListener('click', loadHelpRequests);
    document.getElementById('help-requests').addEventListener('click', async (event) => {
      const button = event.target.closest('[data-help-status]');
      if (!button) return;
      try {
        await apiRequest('/api/admin/help/' + encodeURIComponent(button.dataset.helpId), { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: button.dataset.helpStatus }) });
        await loadHelpRequests();
        await loadNotifications();
      } catch (error) { setPanelStatus('help-status', error.message, 'error'); }
    });
    document.getElementById('help-requests').addEventListener('submit', async (event) => {
      const form = event.target.closest('.help-response-form');
      if (!form) return;
      event.preventDefault();
      setPanelStatus('help-status', 'Sending response...');
      try {
        await apiRequest('/api/admin/help/' + encodeURIComponent(form.dataset.helpId), { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ response: form.querySelector('textarea').value }) });
        await loadHelpRequests();
        await loadNotifications();
      } catch (error) { setPanelStatus('help-status', error.message, 'error'); }
    });
    // Pending plan requests, help requests and approvals are only actionable if an admin sees
    // them without opening every tab first.
    async function loadNotifications() {
      const banner = document.getElementById('admin-alerts');
      if (!banner) return;
      try {
        const data = await apiRequest('/api/admin/notifications');
        const items = [];
        for (const planRequest of data.planRequests || []) {
          items.push('<li><i class="fas fa-gem"></i><span><strong>' + escapeHtml(planRequest.displayName) + '</strong> requested the ' +
            escapeHtml(planRequest.requestedPlan) + ' plan' + (planRequest.requestedAt ? ' on ' + escapeHtml(formatDateTime(planRequest.requestedAt)) : '') + '.</span>' +
            '<button class="button-compact" type="button" data-activate-plan="' + escapeHtml(planRequest.username) + '" data-plan="' + escapeHtml(planRequest.requestedPlan) + '">Activate</button>' +
            '<button class="button-secondary button-compact" type="button" data-goto-panel="panel-profiles">Open profiles</button></li>');
        }
        if (data.openHelpRequests) {
          items.push('<li><i class="fas fa-comments"></i><span>' + data.openHelpRequests + ' open help request(s).</span>' +
            '<button class="button-secondary button-compact" type="button" data-goto-panel="panel-help">Open help</button></li>');
        }
        if (data.pendingApprovals) {
          items.push('<li><i class="fas fa-user-check"></i><span>' + data.pendingApprovals + ' profile(s) awaiting approval.</span>' +
            '<button class="button-secondary button-compact" type="button" data-goto-panel="panel-profiles">Open profiles</button></li>');
        }
        banner.hidden = !items.length;
        banner.innerHTML = items.length ? '<ul class="alert-list">' + items.join('') + '</ul>' : '';
      } catch { banner.hidden = true; }
    }
    const alertsEl = document.getElementById('admin-alerts');
    if (alertsEl) alertsEl.addEventListener('click', async (event) => {
      const gotoButton = event.target.closest('[data-goto-panel]');
      if (gotoButton) {
        const tab = document.querySelector('.tab[data-panel="' + gotoButton.dataset.gotoPanel + '"]');
        if (tab) tab.click();
        return;
      }
      const activateButton = event.target.closest('[data-activate-plan]');
      if (!activateButton) return;
      activateButton.disabled = true;
      try { await setUserPlan(activateButton.dataset.activatePlan, activateButton.dataset.plan); }
      catch (error) { setPanelStatus('users-status', error.message, 'error'); activateButton.disabled = false; }
    });
    loadNotifications();
    async function loadUsers() {
      const body = document.getElementById('users-body');
      if (!body) return;
      try {
        const data = await apiRequest('/api/users');
        if (!data.users.length) { body.innerHTML = '<p>No profiles found.</p>'; return; }
        body.innerHTML = data.users.map((item) => {
          const isSelf = item.username === CURRENT_USERNAME;
          const currentPlan = item.plan || 'free';
          const approveAction = item.status === 'pending_approval'
            ? '<button class="button-secondary button-compact" type="button" data-approve-user="' + escapeHtml(item.username) + '">Approve</button>'
            : '';
          const planRequestAction = item.pendingPlan
            ? '<button class="button-compact" type="button" data-plan-user="' + escapeHtml(item.username) + '" data-plan-value="' + escapeHtml(item.pendingPlan) + '">Activate ' + escapeHtml(item.pendingPlan) + '</button>'
            : '';
          // Everything else lives behind one menu so a row stays readable at a glance.
          const menuItems = (!isSelf
            ? '<button class="button-secondary button-compact" type="button" data-role-user="' + escapeHtml(item.username) + '" data-next-role="' + (item.role === 'admin' ? 'user' : 'admin') + '">' + (item.role === 'admin' ? 'Make user' : 'Make admin') + '</button>'
            : '') +
            '<button class="button-secondary button-compact" type="button" data-branch-user="' + escapeHtml(item.username) + '" data-suspended="' + (!item.branchSuspended) + '">' + (item.branchSuspended ? 'Restore branch' : 'Suspend branch') + '</button>' +
            '<label class="profile-menu-field"><span>Plan</span><select aria-label="Plan for ' + escapeHtml(item.username) + '" data-plan-user="' + escapeHtml(item.username) + '">' +
              ['free', 'pro', 'business'].map((plan) => '<option value="' + plan + '"' + (plan === currentPlan ? ' selected' : '') + '>' + plan + '</option>').join('') +
            '</select></label>' +
            '<button class="button-secondary button-compact" type="button" data-reset-user="' + escapeHtml(item.username) + '">Reset password</button>' +
            (isSelf ? '' : '<button class="button-danger button-compact" type="button" data-delete-user="' + escapeHtml(item.username) + '">Delete</button>');
          const actions = approveAction + planRequestAction +
            '<details class="profile-menu"><summary class="button-secondary button-compact">Manage</summary><div class="profile-menu-items">' + menuItems + '</div></details>';
          const initial = escapeHtml((item.displayName || item.username || '?').slice(0, 1).toUpperCase());
          const joined = item.createdAt ? String(item.createdAt).slice(0, 10) : '-';
          const riskSummary = (item.riskFlags || []).length ? ' / ' + item.riskFlags.join(', ') : '';
          const trustState = (item.branchSuspended ? 'branch suspended' : (item.status || 'active')) + riskSummary;
          const planState = escapeHtml(currentPlan) + (item.pendingPlan ? ' <span class="pill warn">wants ' + escapeHtml(item.pendingPlan) + '</span>' : '');
          return '<article class="profile-row">' +
            '<div class="profile-identity"><span class="profile-avatar">' + initial + '</span><div class="profile-name"><strong>' + escapeHtml(item.displayName || item.username) + '</strong><span class="mono">' + escapeHtml(item.username) + '</span></div></div>' +
            '<div class="profile-meta">' +
              '<div class="profile-fact"><span>Access</span><strong><span class="pill ' + (item.role === 'admin' ? 'admin' : '') + '">' + escapeHtml(item.role) + '</span></strong></div>' +
              '<div class="profile-fact"><span>Trust</span><strong>' + escapeHtml(trustState) + '</strong></div>' +
              '<div class="profile-fact"><span>Plan</span><strong>' + planState + '</strong></div>' +
              '<div class="profile-fact"><span>Sponsor / depth</span><strong title="' + escapeHtml(item.invitedByUserId || 'Root profile') + '">' + escapeHtml(item.invitedByUserId || 'root') + ' / ' + escapeHtml(item.inviteDepth || 0) + '</strong></div>' +
              '<div class="profile-fact"><span>Activity / joined</span><strong>' + escapeHtml(item.linkCount ?? 0) + ' links / ' + escapeHtml(joined) + '</strong></div>' +
            '</div><div class="profile-actions">' + actions + '</div></article>';
        }).join('');
      } catch (error) { body.innerHTML = '<p class="status error">' + escapeHtml(error.message) + '</p>'; }
    }
    const loadUsersButton = document.getElementById('load-users');
    if (loadUsersButton) loadUsersButton.addEventListener('click', loadUsers);
    const usersBodyEl = document.getElementById('users-body');
    async function setUserPlan(username, plan) {
      await apiRequest('/api/users/' + encodeURIComponent(username) + '/plan', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ plan }) });
      await loadUsers();
      await loadNotifications();
    }
    if (usersBodyEl) usersBodyEl.addEventListener('change', async (event) => {
      const planSelect = event.target.closest('select[data-plan-user]');
      if (!planSelect) return;
      try { await setUserPlan(planSelect.dataset.planUser, planSelect.value); }
      catch (error) { setPanelStatus('users-status', error.message, 'error'); }
    });
    if (usersBodyEl) usersBodyEl.addEventListener('click', async (event) => {
      const planButton = event.target.closest('button[data-plan-user]');
      if (planButton) {
        try { await setUserPlan(planButton.dataset.planUser, planButton.dataset.planValue); }
        catch (error) { setPanelStatus('users-status', error.message, 'error'); }
        return;
      }
      const approveButton = event.target.closest('[data-approve-user]');
      if (approveButton) {
        await apiRequest('/api/users/' + encodeURIComponent(approveButton.dataset.approveUser) + '/access', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'active' }) });
        await loadUsers(); await loadNotifications(); return;
      }
      const roleButton = event.target.closest('[data-role-user]');
      if (roleButton) {
        await apiRequest('/api/users/' + encodeURIComponent(roleButton.dataset.roleUser) + '/access', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ role: roleButton.dataset.nextRole }) });
        await loadUsers(); return;
      }
      const branchButton = event.target.closest('[data-branch-user]');
      if (branchButton) {
        await apiRequest('/api/users/' + encodeURIComponent(branchButton.dataset.branchUser) + '/branch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ suspended: branchButton.dataset.suspended === 'true' }) });
        await loadUsers(); return;
      }
      const deleteButton = event.target.closest('[data-delete-user]');
      if (deleteButton) {
        const username = deleteButton.dataset.deleteUser;
        if (!window.confirm('Delete profile "' + username + '"? This cannot be undone.')) return;
        try {
          await apiRequest('/api/users/' + encodeURIComponent(username), { method: 'DELETE' });
          await loadUsers();
        } catch (error) { window.alert(error.message); }
        return;
      }

      const resetButton = event.target.closest('[data-reset-user]');
      if (resetButton) {
        const username = resetButton.dataset.resetUser;
        document.getElementById('reset-password-target').textContent = username;
        document.getElementById('reset-password-form').dataset.username = username;
        document.getElementById('reset-password-value').value = '';
        setPanelStatus('reset-password-status', '');
        document.getElementById('reset-password-panel').hidden = false;
        document.getElementById('reset-password-panel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });
    document.getElementById('cancel-reset-password').addEventListener('click', () => {
      document.getElementById('reset-password-panel').hidden = true;
    });
    document.getElementById('reset-password-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const username = form.dataset.username;
      const newPassword = document.getElementById('reset-password-value').value;
      setPanelStatus('reset-password-status', 'Resetting password...');
      try {
        await apiRequest('/api/users/' + encodeURIComponent(username) + '/password', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ newPassword })
        });
        setPanelStatus('reset-password-status', 'Password reset for "' + username + '".', 'success');
        setTimeout(() => { document.getElementById('reset-password-panel').hidden = true; }, 1200);
      } catch (error) { setPanelStatus('reset-password-status', error.message, 'error'); }
    });

    let latestAuditEvents = [];
    function buildAuditQuery() {
      const params = new URLSearchParams();
      const action = document.getElementById('audit-filter-action').value;
      const actor = document.getElementById('audit-filter-actor').value.trim();
      const channel = document.getElementById('audit-filter-channel').value;
      const outcome = document.getElementById('audit-filter-outcome').value;
      const since = document.getElementById('audit-filter-since').value;
      if (action) params.set('action', action);
      if (actor) params.set('actor', actor);
      if (channel) params.set('channel', channel);
      if (outcome) params.set('outcome', outcome);
      if (since) params.set('since', new Date(since).toISOString());
      params.set('limit', '1000');
      return params.toString();
    }
    async function loadAuditLog() {
      const body = document.getElementById('audit-body');
      if (!body) return;
      setPanelStatus('audit-status', 'Loading audit trail...');
      try {
        const data = await apiRequest('/api/audit?' + buildAuditQuery());
        latestAuditEvents = data.events || [];
        if (!latestAuditEvents.length) { body.innerHTML = '<tr><td colspan="9">No audit events in range.</td></tr>'; }
        else {
          body.innerHTML = latestAuditEvents.map((event) => {
            const source = event.source || {};
            const location = [source.city, source.region, source.countryCode || source.country].filter(Boolean).join(', ');
            const details = JSON.stringify(event.details || {});
            return '<tr><td class="mono">' + escapeHtml(event.timestamp) + '</td>' +
              '<td><span class="pill">' + escapeHtml(event.action) + '</span><br><span class="audit-secondary">' + escapeHtml(event.category || 'application') + '</span></td>' +
              '<td><span class="pill ' + (event.outcome === 'failure' ? 'down' : 'up') + '">' + escapeHtml(event.outcome || 'success') + '</span></td>' +
              '<td class="mono">' + escapeHtml(event.actorUsername || 'anonymous') + '<br><span class="audit-secondary">' + escapeHtml(event.actorRole || '-') + '</span></td>' +
              '<td>' + escapeHtml(event.channel || 'unknown') + '<br><span class="audit-secondary">' + escapeHtml(event.authenticationMethod || 'unknown') + '</span></td>' +
              '<td class="mono">' + escapeHtml(event.sourceIp || event.ip || '-') + '<br><span class="audit-secondary">' + escapeHtml(location || 'unknown') + '</span></td>' +
              '<td class="mono">' + escapeHtml((event.httpMethod || '') + ' ' + (event.requestPath || '')) + '</td>' +
              '<td class="audit-user-agent" title="' + escapeHtml(event.userAgent || '') + '">' + escapeHtml(event.userAgent || '-') + '</td>' +
              '<td class="truncate" title="' + escapeHtml(details) + '">' + escapeHtml(details) + '</td></tr>';
          }).join('');
        }
        setPanelStatus('audit-status', 'Loaded ' + latestAuditEvents.length + ' event(s) (retention: ' + data.retentionDays + ' days).', 'success');
      } catch (error) { setPanelStatus('audit-status', error.message, 'error'); }
    }
    const loadAuditButton = document.getElementById('load-audit');
    if (loadAuditButton) loadAuditButton.addEventListener('click', loadAuditLog);
    ['audit-filter-action', 'audit-filter-actor', 'audit-filter-channel', 'audit-filter-outcome', 'audit-filter-since'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', loadAuditLog);
    });
    function csvEscape(value) {
      const str = String(value ?? '');
      return /[",\\n]/.test(str) ? '"' + str.replaceAll('"', '""') + '"' : str;
    }
    const exportAuditButton = document.getElementById('export-audit-csv');
    if (exportAuditButton) exportAuditButton.addEventListener('click', () => {
      if (!latestAuditEvents.length) { setPanelStatus('audit-status', 'Nothing to export \u2014 load the audit trail first.', 'error'); return; }
      const header = [
        'schemaVersion', 'eventId', 'timestamp', 'action', 'category', 'outcome',
        'actorId', 'actorUsername', 'actorRole', 'channel', 'authenticationMethod',
        'sourceIp', 'sourceCountry', 'sourceCountryCode', 'sourceRegion', 'sourceCity',
        'sourceLatitude', 'sourceLongitude', 'httpMethod', 'requestPath', 'userAgent', 'details'
      ];
      const rows = latestAuditEvents.map((event) => {
        const source = event.source || {};
        const values = {
          ...event,
          sourceCountry: source.country,
          sourceCountryCode: source.countryCode,
          sourceRegion: source.region,
          sourceCity: source.city,
          sourceLatitude: source.latitude,
          sourceLongitude: source.longitude,
          details: JSON.stringify(event.details || {})
        };
        return header.map((key) => csvEscape(values[key])).join(',');
      });
      const csv = [header.join(','), ...rows].join('\\r\\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'azshortlink-audit-' + new Date().toISOString().slice(0, 10) + '.csv';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setPanelStatus('audit-status', 'Exported ' + latestAuditEvents.length + ' event(s) to CSV.', 'success');
    });

    const loadHealthButton = document.getElementById('load-health');
    if (loadHealthButton) loadHealthButton.addEventListener('click', async () => {
      const body = document.getElementById('health-body');
      body.innerHTML = '<p>Checking...</p>';
      try {
        const response = await fetch('/api/health', { headers: { accept: 'application/json' } });
        const data = await response.json();
        const storage = data.storage || {};
        const pill = (status) => '<span class="pill ' + (status === 'up' ? 'up' : 'down') + '">' + escapeHtml(status || 'unknown') + '</span>';
        body.innerHTML = '<div class="stat-grid">' +
          '<div class="stat"><span class="stat-value">' + escapeHtml(data.status || 'unknown') + '</span><span class="stat-label">Overall</span></div>' +
          '<div class="stat"><span class="stat-value">' + pill((storage.table || {}).status) + '</span><span class="stat-label">Links table</span></div>' +
          '<div class="stat"><span class="stat-value">' + pill((storage.usersTable || {}).status) + '</span><span class="stat-label">Users table</span></div>' +
          '<div class="stat"><span class="stat-value">' + pill((storage.auditTable || {}).status) + '</span><span class="stat-label">Audit table</span></div>' +
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
    async function loadInvites() {
      const body = document.getElementById('invites-body');
      if (!body) return;
      try {
        const data = await apiRequest('/api/invites');
        if (!data.invites.length) { body.innerHTML = '<tr><td colspan="5">No invite links yet.</td></tr>'; return; }
        body.innerHTML = data.invites.map((invite) => {
          const status = invite.redeemed
            ? '<span class="pill">Redeemed by ' + escapeHtml(invite.redeemedBy || '-') + '</span>'
            : '<span class="pill up">Active</span>';
          const actions = invite.redeemed ? '' :
            '<button class="button-danger button-compact" type="button" data-revoke-invite="' + escapeHtml(invite.code) + '">Revoke</button>';
          return '<tr><td class="mono">' + escapeHtml(invite.inviteUrl) + '</td><td class="mono">' + escapeHtml(invite.createdBy || '-') + '</td>' +
            '<td>' + escapeHtml(invite.createdAt || '-') + '</td><td>' + status + '</td><td class="actions">' + actions + '</td></tr>';
        }).join('');
      } catch (error) { body.innerHTML = '<tr><td colspan="5">' + escapeHtml(error.message) + '</td></tr>'; }
    }
    const createInviteButton = document.getElementById('create-invite');
    if (createInviteButton) createInviteButton.addEventListener('click', async () => {
      setPanelStatus('invite-status', 'Creating invite link...');
      try {
        const invite = await apiRequest('/api/invites', { method: 'POST' });
        try { await navigator.clipboard.writeText(invite.inviteUrl); setPanelStatus('invite-status', 'Invite link created and copied: ' + invite.inviteUrl, 'success'); }
        catch { setPanelStatus('invite-status', 'Invite link created: ' + invite.inviteUrl, 'success'); }
        await loadInvites();
      } catch (error) { setPanelStatus('invite-status', error.message, 'error'); }
    });
    const invitesBodyEl = document.getElementById('invites-body');
    if (invitesBodyEl) invitesBodyEl.addEventListener('click', async (event) => {
      const revokeButton = event.target.closest('[data-revoke-invite]');
      if (!revokeButton) return;
      const code = revokeButton.dataset.revokeInvite;
      if (!window.confirm('Revoke this invite link? It can no longer be used to sign up.')) return;
      try {
        await apiRequest('/api/invites/' + encodeURIComponent(code), { method: 'DELETE' });
        await loadInvites();
      } catch (error) { window.alert(error.message); }
    });
    loadStats();
  </script>
</body>
</html>`;
}

module.exports = { renderAdminDashboard };
