'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, statSync } = require('node:fs');
const { join } = require('node:path');
const { renderLoginPage } = require('../src/pages/loginPage');
const { renderSignupPage } = require('../src/pages/signupPage');

const assets = join(__dirname, '..', 'src', 'assets');

test('page styles live in CSS assets instead of template style blocks', () => {
  const login = renderLoginPage();
  const signup = renderSignupPage({ error: 'expired' });

  assert.match(login, /href="\/assets\/css\/auth\.css"/);
  assert.match(signup, /class="auth-panel"/);
  assert.doesNotMatch(login, /<style>/);
  assert.doesNotMatch(signup, /<style>|style="/);
});

test('stylesheets reference the local background image', () => {
  for (const file of ['dashboard.css', 'auth.css', 'not-found.css', 'api-docs.css']) {
    const css = readFileSync(join(assets, 'css', file), 'utf8');
    assert.match(css, /\/assets\/images\/background\.jpg/);
    assert.doesNotMatch(css, /blackcatwebshop|BACKGROUND_URL/);
  }

  assert.ok(statSync(join(assets, 'images', 'background.jpg')).size > 0);
});