'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { DAY_MS, getPlan, isPlanId, listPlans, resolveUserPlan, dailyQuotaReset } = require('../src/core/plans');
const { ShortLinkService } = require('../src/services/shortLinkService');
const { InMemoryStorage } = require('../src/storage/inMemoryStorage');
const { renderPricingPage } = require('../src/pages/pricingPage');

test('plans increase every limit as the price goes up', () => {
  const plans = listPlans();

  assert.deepEqual(plans.map((plan) => plan.id), ['free', 'pro', 'business']);
  for (let index = 1; index < plans.length; index += 1) {
    const previous = plans[index - 1];
    const current = plans[index];
    assert.ok(current.priceEurPerMonth > previous.priceEurPerMonth, current.id);
    assert.ok(current.linksPerDay > previous.linksPerDay, current.id);
    assert.ok(current.redirectsPerDay > previous.redirectsPerDay, current.id);
    assert.ok(current.apiRequestsPerMinute > previous.apiRequestsPerMinute, current.id);
  }
});

test('unknown or missing plan identifiers fall back to free', () => {
  assert.equal(getPlan('enterprise').id, 'free');
  assert.equal(getPlan('').id, 'free');
  assert.equal(getPlan('PRO').id, 'pro');
  assert.equal(isPlanId('pro'), true);
  assert.equal(isPlanId('enterprise'), false);
});

test('an expired paid plan degrades to free instead of blocking the account', () => {
  const now = Date.parse('2026-08-17T00:00:00.000Z');

  assert.equal(resolveUserPlan({ plan: 'pro', planExpiresAt: '2026-09-01T00:00:00.000Z' }, now).id, 'pro');
  assert.equal(resolveUserPlan({ plan: 'pro', planExpiresAt: '2026-08-01T00:00:00.000Z' }, now).id, 'free');
  assert.equal(resolveUserPlan({ plan: 'business', planExpiresAt: '' }, now).id, 'business');
  assert.equal(resolveUserPlan(null, now).id, 'free');
});

test('daily quota windows reset at the next UTC midnight', () => {
  const now = Date.parse('2026-08-17T13:45:00.000Z');

  assert.equal(dailyQuotaReset(now), '2026-08-18T00:00:00.000Z');
  assert.equal(DAY_MS, 24 * 60 * 60 * 1000);
});

test('redirects are not counted or recorded once the owner quota check fails', async () => {
  const storage = new InMemoryStorage();
  const service = new ShortLinkService(storage, { baseUrl: 'https://azhk.in', aliasGenerator: () => 'abc12345' });
  await service.createShortLink({ url: 'https://example.com' }, 'alice');

  const allowed = await service.resolveShortLink('abc12345', { quotaCheck: async () => ({ allowed: true }) });
  assert.equal(allowed.targetUrl, 'https://example.com');
  assert.equal(allowed.redirectCount, 1);
  assert.equal(allowed.ownerId, 'alice');

  const blocked = await service.resolveShortLink('abc12345', { quotaCheck: async () => ({ allowed: false, retryAfterSeconds: 60 }) });
  assert.equal(blocked.quotaExceeded, true);
  assert.equal(blocked.targetUrl, undefined);
  assert.equal(blocked.ownerId, 'alice');
  // The stats write is skipped entirely, so an over-quota link costs a read and nothing else.
  assert.equal((await storage.getLink('abc12345')).redirectCount, 1);
});

test('the daily quota counter is shared per owner and enforced against the plan limit', async () => {
  const storage = new InMemoryStorage();
  const now = Date.parse('2026-08-17T10:00:00.000Z');

  assert.equal((await storage.consumeRateLimit('quota:links:alice', 2, DAY_MS, now)).allowed, true);
  assert.equal((await storage.consumeRateLimit('quota:links:alice', 2, DAY_MS, now)).allowed, true);
  assert.equal((await storage.consumeRateLimit('quota:links:alice', 2, DAY_MS, now)).allowed, false);
  assert.equal((await storage.consumeRateLimit('quota:links:bob', 2, DAY_MS, now)).allowed, true);
  assert.equal(await storage.peekRateLimit('quota:links:alice', DAY_MS, now), 3);

  // A new UTC day starts a fresh bucket.
  assert.equal((await storage.consumeRateLimit('quota:links:alice', 2, DAY_MS, now + DAY_MS)).allowed, true);
});

test('the pricing page lists every plan and marks the current one', () => {
  const page = renderPricingPage({ currentPlanId: 'pro', signedIn: true });

  for (const plan of listPlans()) {
    assert.match(page, new RegExp(`id="plan-${plan.id}"`));
  }
  assert.match(page, /Your current plan/);
  assert.doesNotMatch(page, /data-plan="pro"/);
  assert.match(page, /data-plan="business"/);
  assert.doesNotMatch(page, /<style\b/i);
  assert.match(renderPricingPage(), /Sign in to change your plan\./);
});
