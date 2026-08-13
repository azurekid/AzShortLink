'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createSessionToken, verifySessionToken, verifyCredentials } = require('../src/auth');
const { InMemoryStorage } = require('../src/storage/inMemoryStorage');
const bcrypt = require('bcryptjs');

test('round trips a signed user identity', () => {
  const user = { id: 'alice', username: 'Alice', displayName: 'Alice Example', role: 'user' };
  const token = createSessionToken(user, 'test-secret');

  assert.deepEqual(verifySessionToken(token, 'test-secret'), user);
  assert.equal(verifySessionToken(token, 'wrong-secret'), null);
});

test('verifies credentials against a stored user profile', async () => {
  const storage = new InMemoryStorage();
  await storage.createUser({
    username: 'Alice',
    passwordHash: await bcrypt.hash('correct horse battery staple', 4),
    displayName: 'Alice Example',
    role: 'user',
    createdAt: new Date().toISOString()
  });

  const identity = await verifyCredentials('Alice', 'correct horse battery staple', storage, '');

  assert.equal(identity.id, 'Alice');
  assert.equal(await verifyCredentials('Alice', 'wrong password', storage, ''), null);
  assert.equal(await verifyCredentials('alice', 'correct horse battery staple', storage, ''), null);
});