'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeEmail, hashIdentityValue, maskEmail, createVerificationToken, verifyVerificationToken } = require('../src/auth/identity');

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