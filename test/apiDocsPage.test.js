'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { renderApiDocsPage } = require('../src/pages/apiDocsPage');

test('renders Swagger UI inside the branded AzShortLink shell', () => {
  const html = renderApiDocsPage();

  assert.match(html, /class="bg-layer"/);
  assert.match(html, /class="docs-shell"/);
  assert.match(html, /href="\/assets\/css\/api-docs\.css"/);
  assert.match(html, /azurehacking\.com\/images\/favicon\.svg/);
  assert.match(html, /class="brand" href="\/">AzShortLink/);
  assert.match(html, /href="\/dashboard"/);
  assert.match(html, /id="swagger-ui"/);
  assert.match(html, /src="\/assets\/js\/api-docs\.js"/);
  const script = readFileSync(join(__dirname, '..', 'src', 'assets', 'js', 'api-docs.js'), 'utf8');
  assert.match(script, /url: '\/openapi\.json'/);
  assert.match(script, /persistAuthorization: true/);
  assert.doesNotMatch(html, /<style>/);
});