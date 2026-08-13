'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { renderDashboard } = require('../src/dashboard');

test('renders terminal dashboard form and API hooks', () => {
  const html = renderDashboard('https://azhk.in');

  assert.match(html, /AzShortLink/);
  assert.match(html, /Create short link/);
  assert.match(html, /POST \/api\/shorten/);
  assert.match(html, /id="create-form"/);
  assert.match(html, /id="load-stats"/);
  assert.match(html, /Copy result/);
});

test('renders configuration warning when API key is missing', () => {
  const html = renderDashboard('https://azhk.in', { apiKeyConfigured: false });

  assert.match(html, /SHORTLINK_API_KEY is not configured/);
});

test('renders statistics, account and delete controls for every profile', () => {
  const html = renderDashboard('https://azhk.in', {
    user: { username: 'Alice', displayName: 'Alice', role: 'user' }
  });

  assert.match(html, /data-panel="panel-analytics"/);
  assert.match(html, /data-panel="panel-account"/);
  assert.match(html, /id="password-form"/);
  assert.match(html, /data-delete/);
  assert.doesNotMatch(html, /data-panel="panel-admin"/);
});

test('shows admin-only profile and health panels for admins', () => {
  const html = renderDashboard('https://azhk.in', {
    user: { username: 'Admin', displayName: 'Admin', role: 'admin' }
  });

  assert.match(html, /data-panel="panel-admin"/);
  assert.match(html, /id="users-body"/);
  assert.match(html, /id="health-body"/);
  assert.match(html, /All links/);
  assert.match(html, /<th>Owner<\/th>/);
});

test('gives admins an audit trail tab with filters and CSV export', () => {
  const html = renderDashboard('https://azhk.in', {
    user: { username: 'Admin', displayName: 'Admin', role: 'admin' }
  });

  assert.match(html, /data-panel="panel-audit"/);
  assert.match(html, /id="audit-filter-action"/);
  assert.match(html, /id="audit-filter-actor"/);
  assert.match(html, /id="audit-filter-since"/);
  assert.match(html, /id="export-audit-csv"/);
  assert.match(html, /id="audit-body"/);
});

test('does not show the audit trail tab to non-admin users', () => {
  const html = renderDashboard('https://azhk.in', {
    user: { username: 'Alice', displayName: 'Alice', role: 'user' }
  });

  assert.doesNotMatch(html, /data-panel="panel-audit"/);
});

test('inline dashboard script is syntactically valid JavaScript', () => {
  for (const role of ['user', 'admin']) {
    const html = renderDashboard('https://azhk.in', { user: { username: 'x', displayName: 'X', role } });
    const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

    // Throws a SyntaxError if a template-literal escaping bug (e.g. a bare \n or \r\n)
    // broke a nested string/regex literal across a real line break.
    assert.doesNotThrow(() => new Function(script), `inline script is invalid for role "${role}"`);
  }
});

test('escapes the signed-in display name', () => {
  const html = renderDashboard('https://azhk.in', {
    user: { username: 'x', displayName: '<img src=x onerror=alert(1)>', role: 'user' }
  });

  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;img src=x/);
});

test('uses the azurehacking favicon and background artwork', () => {
  const html = renderDashboard('https://azhk.in');

  assert.match(html, /azurehacking\.com\/images\/favicon\.svg/);
  assert.match(html, /azure-hacking-corp\.jpg/);
  assert.match(html, /font-awesome/);
  assert.match(html, /class="bg-layer"/);
});

test('exposes personal API key controls and graphical breakdowns', () => {
  const html = renderDashboard('https://azhk.in', {
    user: { username: 'Alice', displayName: 'Alice', role: 'user' }
  });

  assert.match(html, /id="generate-api-key"/);
  assert.match(html, /id="api-key-reveal"/);
  assert.match(html, /id="bars-browsers"/);
  assert.match(html, /id="bars-devices"/);
  assert.match(html, /id="bars-referrers"/);
});
