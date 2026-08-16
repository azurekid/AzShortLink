'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { renderUserDashboard } = require('../src/dashboard/user');

test('renders terminal dashboard form and API hooks', () => {
  const html = renderUserDashboard('https://azhk.in');

  assert.match(html, /AzShortLink/);
  assert.match(html, /Create short link/);
  assert.match(html, /POST \/api\/shorten/);
  assert.match(html, /id="create-form"/);
  assert.match(html, /id="load-stats"/);
  assert.match(html, /Copy result/);
  assert.match(html, /id="download-qr"/);
  assert.match(html, /Download QR code/);
  assert.match(html, /encodeURIComponent\(result\.code\) \+ '\/qr'/);
  assert.match(html, /href="\/api"/);
  assert.match(html, /Open API reference/);
});

test('renders configuration warning when API key is missing', () => {
  const html = renderUserDashboard('https://azhk.in', { apiKeyConfigured: false });

  assert.match(html, /SHORTLINK_API_KEY is not configured/);
});

test('renders statistics, account and delete controls', () => {
  const html = renderUserDashboard('https://azhk.in', {
    user: { username: 'Alice', displayName: 'Alice', role: 'user' }
  });

  assert.match(html, /data-panel="panel-analytics"/);
  assert.match(html, /data-panel="panel-account"/);
  assert.match(html, /id="password-form"/);
  assert.match(html, /data-delete/);
  assert.match(html, /azshortlink-' \+ code \+ '-qr\.png/);
  assert.match(html, /title="Download QR code"/);
});

test('does not show the admin invites-management panel', () => {
  const html = renderUserDashboard('https://azhk.in', {
    user: { username: 'Alice', displayName: 'Alice', role: 'user' }
  });

  assert.doesNotMatch(html, /id="invites-body"/);
});

test('lets a user create their own single invite link from the links tab', () => {
  const html = renderUserDashboard('https://azhk.in', {
    user: { username: 'Alice', displayName: 'Alice', role: 'user' }
  });

  assert.match(html, /id="my-invite-body"/);
  assert.match(html, /apiRequest\('\/api\/invites\/mine'\)/);

  // The invite card must live inside the Links panel, not the Account panel.
  const linksPanel = html.slice(html.indexOf('id="panel-links"'), html.indexOf('id="panel-analytics"'));
  const accountPanel = html.slice(html.indexOf('id="panel-account"'), html.indexOf('<script>'));
  assert.match(linksPanel, /id="my-invite-body"/);
  assert.doesNotMatch(accountPanel, /id="my-invite-body"/);
});

test('does not expose any admin-only markup or script to a non-admin user', () => {
  const html = renderUserDashboard('https://azhk.in', {
    user: { username: 'Alice', displayName: 'Alice', role: 'user' }
  });

  assert.doesNotMatch(html, /data-panel="panel-admin"/);
  assert.doesNotMatch(html, /data-panel="panel-profiles"/);
  assert.doesNotMatch(html, /data-panel="panel-invites"/);
  assert.doesNotMatch(html, /data-panel="panel-operations"/);
  assert.doesNotMatch(html, /data-panel="panel-audit"/);
  assert.doesNotMatch(html, /loadUsers/);
  assert.doesNotMatch(html, /loadInvites/);
  assert.doesNotMatch(html, /loadAuditLog/);
  assert.doesNotMatch(html, /export-audit-csv/);
  assert.doesNotMatch(html, /reset-password/);
  assert.doesNotMatch(html, /id="user-form"/);
  assert.doesNotMatch(html, /id="health-body"/);
  assert.doesNotMatch(html, /IS_ADMIN/);
  assert.doesNotMatch(html, /<th>Owner<\/th>/);
});

test('inline dashboard script is syntactically valid JavaScript', () => {
  const html = renderUserDashboard('https://azhk.in', { user: { username: 'x', displayName: 'X', role: 'user' } });
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

  // Throws a SyntaxError if a template-literal escaping bug (e.g. a bare \n or \r\n)
  // broke a nested string/regex literal across a real line break.
  assert.doesNotThrow(() => new Function(script), 'inline script is invalid');
});

test('escapes the signed-in display name', () => {
  const html = renderUserDashboard('https://azhk.in', {
    user: { username: 'x', displayName: '<img src=x onerror=alert(1)>', role: 'user' }
  });

  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;img src=x/);
});

test('uses the azurehacking favicon and background artwork', () => {
  const html = renderUserDashboard('https://azhk.in');

  assert.match(html, /azurehacking\.com\/images\/favicon\.svg/);
  assert.match(html, /azure-hacking-corp\.jpg/);
  assert.match(html, /font-awesome/);
  assert.match(html, /class="bg-layer"/);
});

test('exposes personal API key controls and graphical breakdowns', () => {
  const html = renderUserDashboard('https://azhk.in', {
    user: { username: 'Alice', displayName: 'Alice', role: 'user' }
  });

  assert.match(html, /id="generate-api-key"/);
  assert.match(html, /id="api-key-reveal"/);
  assert.match(html, /id="bars-browsers"/);
  assert.match(html, /id="bars-devices"/);
  assert.match(html, /id="bars-referrers"/);
  assert.match(html, /id="usage-donut"/);
  assert.match(html, /id="columns-links"/);
});
