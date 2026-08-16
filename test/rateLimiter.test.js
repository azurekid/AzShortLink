'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createRateLimiter } = require('../src/core/rateLimiter');

test('limits each client independently and resets after the window', () => {
  let currentTime = 1000;
  const limiter = createRateLimiter({ maxRequests: 2, windowMs: 1000, now: () => currentTime });

  assert.deepEqual(limiter.check('client-a'), { allowed: true, retryAfterSeconds: 0 });
  assert.deepEqual(limiter.check('client-a'), { allowed: true, retryAfterSeconds: 0 });
  assert.deepEqual(limiter.check('client-a'), { allowed: false, retryAfterSeconds: 1 });
  assert.deepEqual(limiter.check('client-b'), { allowed: true, retryAfterSeconds: 0 });

  currentTime += 1000;
  assert.deepEqual(limiter.check('client-a'), { allowed: true, retryAfterSeconds: 0 });
});