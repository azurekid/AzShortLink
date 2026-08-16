'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_INVITE_POLICY, evaluateInviteEligibility, buildInviteAncestry } = require('../src/auth/invitePolicy');

function eligibleUser(overrides = {}) {
  return {
    id: 'sponsor',
    role: 'user',
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    emailVerifiedAt: '2026-01-01T00:01:00.000Z',
    inviteDepth: 1,
    rootSponsorUserId: 'root-admin',
    ...overrides
  };
}

test('allows a verified account through either age or legitimate-use eligibility', () => {
  const result = evaluateInviteEligibility({
    user: eligibleUser(),
    legitimateUsedLinkCount: 0,
    rootDescendantCount: 10,
    now: Date.parse('2026-02-01T00:00:00.000Z')
  });

  assert.deepEqual(result, { allowed: true });
  assert.deepEqual(evaluateInviteEligibility({
    user: eligibleUser({ createdAt: '2026-01-30T00:00:00.000Z' }),
    legitimateUsedLinkCount: 3,
    rootDescendantCount: 10,
    now: Date.parse('2026-02-01T00:00:00.000Z')
  }), { allowed: true });
});

test('blocks unverified, immature and unused, deep, quota-full, and suspended branches', () => {
  const now = Date.parse('2026-02-01T00:00:00.000Z');
  const evaluate = (user, legitimateUsedLinkCount = 3, rootDescendantCount = 0) =>
    evaluateInviteEligibility({ user, legitimateUsedLinkCount, rootDescendantCount, now });

  assert.match(evaluate(eligibleUser({ emailVerifiedAt: '' })).reason, /Verify your email/);
  assert.match(evaluate(eligibleUser({ createdAt: '2026-01-30T00:00:00.000Z' }), 2).reason, /3 days old or have 3 legitimately used links/);
  assert.match(evaluate(eligibleUser({ inviteDepth: DEFAULT_INVITE_POLICY.maximumDepth })).reason, /maximum depth/);
  assert.match(evaluate(eligibleUser(), 3, DEFAULT_INVITE_POLICY.maximumRootDescendants).reason, /account quota/);
  assert.match(evaluate(eligibleUser({ branchSuspended: true })).reason, /suspended/);
});

test('derives a durable ancestry chain from the sponsor', () => {
  assert.deepEqual(buildInviteAncestry(eligibleUser()), {
    invitedByUserId: 'sponsor',
    rootSponsorUserId: 'root-admin',
    inviteDepth: 2
  });
});