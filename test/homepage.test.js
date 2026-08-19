'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { renderHomePage } = require('../src/pages/homePage');

test('static index.html mirrors the landing page instead of redirecting', () => {
  const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

  assert.doesNotMatch(html, /http-equiv="refresh"/);
  assert.match(html, /href="\/dashboard\/login"/);
  assert.match(html, /href="\/assets\/css\/home\.css"/);
  assert.doesNotMatch(html, /<style\b|style\s*=/);
  assert.match(html, /AzShortLink/);
});

test('landing page explains the service and offers an invite request form', () => {
  const html = renderHomePage();

  assert.match(html, /Ad-free/i);
  assert.match(html, /No third-party trackers/i);
  assert.match(html, /<form method="post" action="\/home" class="request-form">/);
  assert.match(html, /name="email"/);
  assert.match(html, /name="reason"/);
  assert.match(html, /href="\/dashboard\/login"/);
  assert.match(html, /href="\/assets\/css\/home\.css"/);
  assert.doesNotMatch(html, /<style\b|style\s*=/);
  assert.doesNotMatch(html, /<script/);
});

test('landing page shows notices and escapes submitted values', () => {
  const withMessage = renderHomePage({ message: 'Request received.' });
  assert.match(withMessage, /<p class="form-notice" role="status">Request received\.<\/p>/);

  const withError = renderHomePage({ error: 'Enter a valid email address.', email: '"><script>alert(1)</script>' });
  assert.match(withError, /class="form-notice error"/);
  assert.doesNotMatch(withError, /<script>alert\(1\)<\/script>/);
  assert.match(withError, /&quot;&gt;&lt;script&gt;/);
});
