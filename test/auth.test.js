'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createSessionToken, generateTemporaryPassword, verifySessionToken, verifyCredentials } = require('../src/auth/auth');
const { InMemoryStorage } = require('../src/storage/inMemoryStorage');
const { renderLoginPage } = require('../src/pages/loginPage');
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

test('preserves the signup password when email verification activates the profile', async () => {
  const storage = new InMemoryStorage();
  const password = 'verified account password';
  await storage.createUser({
    username: 'VerifiedUser',
    passwordHash: await bcrypt.hash(password, 4),
    displayName: 'Verified User',
    role: 'user',
    status: 'pending_email',
    riskFlags: ['SHARED_SIGNUP_IP', 'SHARED_DEVICE_SIGNAL'],
    createdAt: new Date().toISOString()
  });

  await storage.updateUserIdentity('VerifiedUser', {
    emailVerifiedAt: new Date().toISOString(),
    status: 'active'
  });

  const identity = await verifyCredentials('VerifiedUser', password, storage, '');
  assert.equal(identity.username, 'VerifiedUser');
  assert.deepEqual(identity.riskFlags, ['SHARED_SIGNUP_IP', 'SHARED_DEVICE_SIGNAL']);
});

test('generates strong URL-safe temporary passwords', () => {
  const passwords = new Set(Array.from({ length: 20 }, () => generateTemporaryPassword()));

  assert.equal(passwords.size, 20);
  for (const password of passwords) {
    assert.match(password, /^[A-Za-z0-9_-]{20}!9aA$/);
  }
});

test('login page links to self-service password reset', () => {
  assert.match(renderLoginPage(), /href="\/dashboard\/forgot-password">Forgot password\?<\/a>/);
});