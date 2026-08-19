'use strict';

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

// Quotas are expressed per day because every redirect is a Function invocation plus a table
// write, so daily volume - not concurrency - is what a plan actually pays for.
const PLANS = Object.freeze({
  free: Object.freeze({
    id: 'free',
    name: 'Free',
    priceEurPerMonth: 0,
    linksPerDay: 25,
    redirectsPerDay: 1000,
    apiRequestsPerMinute: 60,
    highlights: Object.freeze(['25 new short links per day', '1,000 redirects per day', 'Full analytics and QR codes'])
  }),
  pro: Object.freeze({
    id: 'pro',
    name: 'Pro',
    priceEurPerMonth: 4.99,
    linksPerDay: 100,
    redirectsPerDay: 10000,
    apiRequestsPerMinute: 600,
    highlights: Object.freeze(['100 new short links per day', '10,000 redirects per day', '600 API requests per minute'])
  }),
  business: Object.freeze({
    id: 'business',
    name: 'Business',
    priceEurPerMonth: 12.99,
    linksPerDay: 1000,
    redirectsPerDay: 50000,
    apiRequestsPerMinute: 3000,
    highlights: Object.freeze(['1,000 new short links per day', '50,000 redirects per day', '3,000 API requests per minute'])
  })
});

const DEFAULT_PLAN_ID = 'free';
const PLAN_IDS = Object.freeze(Object.keys(PLANS));

function getPlan(planId) {
  return PLANS[String(planId || '').trim().toLowerCase()] || PLANS[DEFAULT_PLAN_ID];
}

function isPlanId(value) {
  return Object.hasOwn(PLANS, String(value || '').trim().toLowerCase());
}

// A lapsed paid subscription silently falls back to Free rather than blocking the account.
function resolveUserPlan(user, now = Date.now()) {
  if (!user) return PLANS[DEFAULT_PLAN_ID];
  const plan = getPlan(user.plan);
  if (plan.id === DEFAULT_PLAN_ID) return plan;
  const expiresAt = Date.parse(user.planExpiresAt || '');
  return Number.isFinite(expiresAt) && expiresAt <= now ? PLANS[DEFAULT_PLAN_ID] : plan;
}

function listPlans() {
  return PLAN_IDS.map((id) => ({ ...PLANS[id], highlights: [...PLANS[id].highlights] }));
}

function startOfDayMs(now = Date.now()) {
  return Math.floor(now / DAY_MS) * DAY_MS;
}

function dailyQuotaReset(now = Date.now()) {
  return new Date(startOfDayMs(now) + DAY_MS).toISOString();
}

module.exports = {
  DAY_MS,
  MINUTE_MS,
  PLANS,
  PLAN_IDS,
  DEFAULT_PLAN_ID,
  getPlan,
  isPlanId,
  resolveUserPlan,
  listPlans,
  dailyQuotaReset
};
