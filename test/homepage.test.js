'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

test('root homepage redirects visitors to the dashboard login page', () => {
  const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

  assert.match(html, /meta http-equiv="refresh" content="0; url=\/dashboard\/login"/);
  assert.match(html, /href="\/dashboard\/login"/);
  assert.match(html, /AzShortLink/);
});
