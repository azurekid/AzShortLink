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

test('escapes the signed-in display name', () => {
  const html = renderDashboard('https://azhk.in', {
    user: { username: 'x', displayName: '<img src=x onerror=alert(1)>', role: 'user' }
  });

  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;img src=x/);
});
