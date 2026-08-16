'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { InMemoryStorage } = require('../src/storage/inMemoryStorage');
const { resetPasswordAndSendEmail } = require('../src/services/passwordReset');

async function createUser(storage) {
  await storage.createUser({
    username: 'ResetUser',
    displayName: 'Reset User',
    passwordHash: 'previous-hash',
    role: 'user',
    createdAt: new Date().toISOString()
  });
  return storage.getUser('ResetUser');
}

test('stores a hash of the same temporary password that is emailed', async () => {
  const storage = new InMemoryStorage();
  const user = await createUser(storage);
  let deliveredPassword = '';

  const result = await resetPasswordAndSendEmail({
    storage,
    user,
    email: 'user@example.com',
    config: {},
    generatePassword: () => 'TemporaryPassword!9aA',
    hashPassword: (password) => bcrypt.hash(password, 4),
    sendEmail: async (_config, message) => { deliveredPassword = message.temporaryPassword; }
  });

  assert.equal(result, true);
  assert.equal(deliveredPassword, 'TemporaryPassword!9aA');
  assert.equal(await bcrypt.compare(deliveredPassword, (await storage.getUser('ResetUser')).passwordHash), true);
});

test('restores the previous hash when reset email delivery fails', async () => {
  const storage = new InMemoryStorage();
  const user = await createUser(storage);

  await assert.rejects(() => resetPasswordAndSendEmail({
    storage,
    user,
    email: 'user@example.com',
    config: {},
    generatePassword: () => 'TemporaryPassword!9aA',
    hashPassword: async () => 'new-hash',
    sendEmail: async () => { throw new Error('delivery failed'); }
  }), /delivery failed/);

  assert.equal((await storage.getUser('ResetUser')).passwordHash, 'previous-hash');
});