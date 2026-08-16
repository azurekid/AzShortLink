'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
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
  assert.match(html, /url: '\/openapi\.json'/);
  assert.match(html, /persistAuthorization: true/);
  assert.doesNotMatch(html, /<style>/);
});