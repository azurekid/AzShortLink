'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync, statSync } = require('node:fs');
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

test('signup shows a pending state while sending the verification email', () => {
  const signup = renderSignupPage({ invite: 'invite-code' });
  const script = signup.match(/<script>([\s\S]*?)<\/script>/)[1];

  assert.match(signup, /id="signup-form"/);
  assert.match(signup, /id="signup-status"/);
  assert.match(signup, /Sending verification email/);
  assert.match(signup, /button\.disabled = true/);
  assert.doesNotThrow(() => new Function(script));
});

test('first-party page sources do not embed static style blocks', () => {
  const pages = join(__dirname, '..', 'src', 'pages');
  const dashboard = join(__dirname, '..', 'src', 'dashboard');
  const sources = [
    join(__dirname, '..', 'index.html'),
    ...readdirSync(pages).filter((file) => file.endsWith('.js')).map((file) => join(pages, file)),
    ...readdirSync(dashboard).filter((file) => file.endsWith('.js')).map((file) => join(dashboard, file))
  ];

  for (const file of sources) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), /<style\b/i, file);
  }
});