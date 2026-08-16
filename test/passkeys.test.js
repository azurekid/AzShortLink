'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { signChallengeState, verifyChallengeState } = require('../src/auth/passkeys');

test('signs short-lived passkey challenge state for one purpose', () => {
  const state = signChallengeState({ purpose: 'registration', challenge: 'abc', userId: 'alice' }, 'secret', 1000);
  assert.equal(verifyChallengeState(state, 'secret', 'registration', 2000).challenge, 'abc');
  assert.equal(verifyChallengeState(state, 'secret', 'authentication', 2000), null);
  assert.equal(verifyChallengeState(state, 'secret', 'registration', 302001), null);
  assert.equal(verifyChallengeState(`${state}x`, 'secret', 'registration', 2000), null);
});