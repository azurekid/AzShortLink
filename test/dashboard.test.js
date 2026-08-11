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
