'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeEmail, hashIdentityValue, maskEmail, createPasswordResetToken, createVerificationToken, verifyPasswordResetToken, verifyVerificationToken } = require('../src/auth/identity');

test('normalizes, masks, and hashes an email without retaining its plaintext identity', () => {
  assert.equal(normalizeEmail(' Alice@Example.COM '), 'alice@example.com');
  assert.equal(maskEmail('alice@example.com'), 'al***@example.com');
  assert.equal(hashIdentityValue('alice@example.com', 'secret'), hashIdentityValue('alice@example.com', 'secret'));
  assert.notEqual(hashIdentityValue('alice@example.com', 'secret'), hashIdentityValue('alice@example.com', 'other'));
});

test('round trips a signed verification token and rejects expiry or tampering', () => {
  const token = createVerificationToken({ userId: 'alice', emailHash: 'hash' }, 'secret', 1000);
  assert.equal(verifyVerificationToken(token, 'secret', 2000).userId, 'alice');
  assert.equal(verifyVerificationToken(token, 'secret', 1000 + 24 * 60 * 60 * 1000 + 1), null);
  assert.equal(verifyVerificationToken(`${token}x`, 'secret', 2000), null);
});

test('creates random one-time password reset claims with a 30-minute expiry', () => {
  const input = { userId: 'alice', emailHash: 'hash', sessionVersion: 3 };
  const token = createPasswordResetToken(input, 'secret', 1000);
  const secondToken = createPasswordResetToken(input, 'secret', 1000);
  const claims = verifyPasswordResetToken(token, 'secret', 2000);

  assert.notEqual(token, secondToken);
  assert.equal(claims.userId, 'alice');
  assert.equal(claims.sessionVersion, 3);
  assert.equal(verifyPasswordResetToken(token, 'secret', 1000 + 30 * 60 * 1000 + 1), null);
  assert.equal(verifyPasswordResetToken(`${token}x`, 'secret', 2000), null);
});