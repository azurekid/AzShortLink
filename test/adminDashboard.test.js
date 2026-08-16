'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { renderAdminDashboard } = require('../src/dashboard/admin');

test('splits admin management into focused profile, invite, and operations tabs', () => {
  const html = renderAdminDashboard('https://azhk.in', {
    user: { username: 'Admin', displayName: 'Admin', role: 'admin' }
  });

  assert.match(html, /data-panel="panel-profiles"/);
  assert.match(html, /data-panel="panel-invites"/);
  assert.match(html, /data-panel="panel-operations"/);
  assert.match(html, /id="users-body"/);
  assert.match(html, /class="profile-list"/);
  assert.match(html, /id="health-body"/);
  assert.match(html, /All links/);
  assert.match(html, /<th>Owner<\/th>/);
  assert.match(html, /id="download-qr"/);
  assert.match(html, /azshortlink-' \+ code \+ '-qr\.png/);
  assert.match(html, /href="\/api"/);
  assert.match(html, /Open API reference/);
});

test('shows an invite links panel to admins listing every invite, not just their own', () => {
  const html = renderAdminDashboard('https://azhk.in', {
    user: { username: 'Admin', displayName: 'Admin', role: 'admin' }
  });

  assert.match(html, /id="invites-body"/);
  assert.match(html, /id="create-invite"/);
  assert.match(html, /<th>Created by<\/th>/);
  // The invite list is fetched with no owner/scope filter, so every admin's invites are shown.
  assert.match(html, /apiRequest\('\/api\/invites'\)/);
});

test('provides a help tab for reviewing and responding to user requests', () => {
  const html = renderAdminDashboard('https://azhk.in', {
    user: { username: 'Admin', displayName: 'Admin', role: 'admin' }
  });

  assert.match(html, /data-panel="panel-help"/);
  assert.match(html, /id="help-requests"/);
  assert.match(html, /apiRequest\('\/api\/admin\/help'/);
  assert.match(html, /method: 'PATCH'/);
  assert.match(html, /Send response/);
  assert.match(html, /item\.ticketNumber/);
  assert.match(html, /item\.messages/);
  assert.match(html, /formatDateTime\(message\.createdAt\)/);
  assert.match(html, /Add response/);
  assert.match(html, /data-help-status/);
  assert.match(html, /Reopen/);
  assert.doesNotMatch(html, /id="help-form"/);
});

test('does not show the self-service invite card, since admins use the full invites panel instead', () => {
  const html = renderAdminDashboard('https://azhk.in', {
    user: { username: 'Admin', displayName: 'Admin', role: 'admin' }
  });

  assert.doesNotMatch(html, /id="my-invite-body"/);
});

test('gives admins an audit trail tab with filters and CSV export', () => {
  const html = renderAdminDashboard('https://azhk.in', {
    user: { username: 'Admin', displayName: 'Admin', role: 'admin' }
  });

  assert.match(html, /data-panel="panel-audit"/);
  assert.match(html, /id="audit-filter-action"/);
  assert.match(html, /id="audit-filter-actor"/);
  assert.match(html, /id="audit-filter-channel"/);
  assert.match(html, /id="audit-filter-outcome"/);
  assert.match(html, /id="audit-filter-since"/);
  assert.match(html, /id="export-audit-csv"/);
  assert.match(html, /id="audit-body"/);
  assert.match(html, /authenticationMethod/);
  assert.match(html, /sourceCountryCode/);
  assert.match(html, /userAgent/);
});

test('inline dashboard script is syntactically valid JavaScript', () => {
  const html = renderAdminDashboard('https://azhk.in', { user: { username: 'x', displayName: 'X', role: 'admin' } });
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

  // Throws a SyntaxError if a template-literal escaping bug (e.g. a bare \n or \r\n)
  // broke a nested string/regex literal across a real line break.
  assert.doesNotThrow(() => new Function(script), 'inline script is invalid');
});

test('escapes the signed-in display name', () => {
  const html = renderAdminDashboard('https://azhk.in', {
    user: { username: 'x', displayName: '<img src=x onerror=alert(1)>', role: 'admin' }
  });

  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;img src=x/);
});

test('uses the azurehacking favicon and background artwork', () => {
  const html = renderAdminDashboard('https://azhk.in');

  assert.match(html, /azurehacking\.com\/images\/favicon\.svg/);
  assert.match(html, /href="\/assets\/css\/dashboard\.css"/);
  assert.match(html, /font-awesome/);
  assert.match(html, /class="bg-layer"/);
});

test('renders visual statistics charts', () => {
  const html = renderAdminDashboard('https://azhk.in');

  assert.match(html, /id="usage-donut"/);
  assert.match(html, /id="columns-links"/);
  assert.match(html, /renderUsageDonut/);
  assert.match(html, /renderColumns/);
  assert.match(html, /id="analytics-link-select"/);
  assert.match(html, /id="bars-countries"/);
  assert.match(html, /id="location-map"/);
  assert.match(html, /L\.circleMarker/);
});
