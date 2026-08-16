'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sendVerificationEmail } = require('../src/services/email');

test('reports missing verification email configuration explicitly', async () => {
  await assert.rejects(
    () => sendVerificationEmail({}, { recipient: 'user@example.com', displayName: 'User', verificationUrl: 'https://example.com/verify' }),
    { code: 'EMAIL_NOT_CONFIGURED', message: 'Email verification delivery is not configured.' }
  );
});