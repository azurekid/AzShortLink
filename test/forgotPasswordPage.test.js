'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { renderForgotPasswordPage } = require('../src/pages/forgotPasswordPage');

test('renders username and email reset fields with a pending state', () => {
  const html = renderForgotPasswordPage();
  const script = readFileSync(join(__dirname, '..', 'src', 'assets', 'js', 'forgot-password.js'), 'utf8');

  assert.match(html, /name="username"/);
  assert.match(html, /name="email"/);
  assert.match(html, /Send reset link/);
  assert.match(html, /src="\/assets\/js\/forgot-password\.js"/);
  assert.match(script, /Sending reset link/);
  assert.doesNotThrow(() => new Function(script));
});

test('renders a choose-new-password form for a valid reset token', () => {
  const html = renderForgotPasswordPage({ resetToken: 'signed-token' });

  assert.match(html, /action="\/dashboard\/reset-password"/);
  assert.match(html, /name="token" value="signed-token"/);
  assert.match(html, /name="newPassword"/);
  assert.match(html, /name="confirmPassword"/);
});

test('renders an escaped non-enumerating confirmation', () => {
  const html = renderForgotPasswordPage({ message: 'If the account matches, email <sent>.' });

  assert.match(html, /If the account matches, email &lt;sent&gt;\./);
  assert.doesNotMatch(html, /email <sent>/);
});