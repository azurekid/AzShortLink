'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { hashIdentityValue } = require('../src/auth/identity');
const { InMemoryStorage } = require('../src/storage/inMemoryStorage');
const { parseQueueMessage, processPasswordResetMessage } = require('../src/services/passwordResetProcessor');

const config = { identityHashSecret: 'identity-secret', baseUrl: 'https://azhk.in' };

async function createVerifiedUser(storage, email) {
  await storage.createUser({
    username: 'azurekid',
    displayName: 'Azure Kid',
    passwordHash: 'hash',
    emailHash: hashIdentityValue(email, config.identityHashSecret),
    emailVerifiedAt: '2026-08-16T00:00:00.000Z',
    status: 'active',
    role: 'user',
    createdAt: '2026-08-16T00:00:00.000Z'
  });
}

test('parses raw JSON queue messages from string, Buffer, or object', () => {
  const payload = { username: 'azurekid', email: 'user@example.com' };
  assert.deepEqual(parseQueueMessage(JSON.stringify(payload)), payload);
  assert.deepEqual(parseQueueMessage(Buffer.from(JSON.stringify(payload))), payload);
  assert.deepEqual(parseQueueMessage(payload), payload);
});

test('sends reset email to the submitted full address after its hash matches', async () => {
  const storage = new InMemoryStorage();
  const email = 'user@example.com';
  await createVerifiedUser(storage, email);
  let delivered;

  const result = await processPasswordResetMessage({ username: 'azurekid', email }, {
    storage,
    config,
    sendEmail: async (_config, message) => { delivered = message; }
  });

  assert.equal(result.sent, true);
  assert.equal(delivered.recipient, email);
  assert.match(delivered.resetUrl, /^https:\/\/azhk\.in\/dashboard\/reset-password\?token=/);
});

test('does not send when username and submitted email hash do not match', async () => {
  const storage = new InMemoryStorage();
  await createVerifiedUser(storage, 'registered@example.com');
  let sendCount = 0;

  const result = await processPasswordResetMessage({ username: 'azurekid', email: 'other@example.com' }, {
    storage,
    config,
    sendEmail: async () => { sendCount += 1; }
  });

  assert.equal(result.sent, false);
  assert.equal(result.reason, 'account_mismatch');
  assert.equal(sendCount, 0);
});