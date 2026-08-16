'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildVerificationEmailContent, sendVerificationEmail } = require('../src/services/email');

test('builds a personalized verification email with onboarding guidance', () => {
  const content = buildVerificationEmailContent({
    username: 'User <admin>',
    verificationUrl: 'https://example.com/verify?token=a&b=c'
  });

  assert.equal(content.subject, 'Verify your AzShortLink account');
  assert.match(content.plainText, /^Hi User <admin>,/);
  assert.match(content.plainText, /before signing in/);
  assert.match(content.plainText, /passkey/);
  assert.match(content.plainText, /at least 7 days old/);
  assert.match(content.plainText, /at least 3 legitimate links/);
  assert.match(content.plainText, /Help tab/);
  assert.match(content.html, /Hi User &lt;admin&gt;,/);
  assert.match(content.html, /token=a&amp;b=c/);
  assert.match(content.html, /role="presentation"/);
  assert.match(content.html, /Verify your email address to finish setting up/);
  assert.match(content.html, /If the button does not work/);
  assert.match(content.html, /background-color:#17212b/);
  assert.doesNotMatch(content.html, /Hi User <admin>,/);
});

test('reports missing verification email configuration explicitly', async () => {
  await assert.rejects(
    () => sendVerificationEmail({}, { recipient: 'user@example.com', username: 'user', displayName: 'User', verificationUrl: 'https://example.com/verify' }),
    { code: 'EMAIL_NOT_CONFIGURED', message: 'Email verification delivery is not configured.' }
  );
});