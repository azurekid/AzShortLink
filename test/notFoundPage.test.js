'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { renderNotFoundPage } = require('../src/pages/notFoundPage');

test('not found page uses the AzureHacking-style error layout and links home to login', () => {
  const html = renderNotFoundPage();

  assert.match(html, /<title>AzShortLink — 404<\/title>/);
  assert.match(html, /class="code">404<\/p>/);
  assert.match(html, /class="terminal"/);
  assert.match(html, /Resolve-ShortLink -CurrentRequest/);
  assert.match(html, /href="\/dashboard\/login">Back to home<\/a>/);
  assert.match(html, /href="\/dashboard\/login">AzShortLink/);
});
