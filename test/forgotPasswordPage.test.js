'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { renderForgotPasswordPage } = require('../src/pages/forgotPasswordPage');

test('renders username and email reset fields with a pending state', () => {
  const html = renderForgotPasswordPage();
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

  assert.match(html, /name="username"/);
  assert.match(html, /name="email"/);
  assert.match(html, /Send temporary password/);
  assert.match(html, /Sending temporary password/);
  assert.doesNotThrow(() => new Function(script));
});

test('renders an escaped non-enumerating confirmation', () => {
  const html = renderForgotPasswordPage({ message: 'If the account matches, email <sent>.' });

  assert.match(html, /If the account matches, email &lt;sent&gt;\./);
  assert.doesNotMatch(html, /email <sent>/);
});