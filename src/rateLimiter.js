'use strict';

function createRateLimiter({ maxRequests = 60, windowMs = 60 * 1000, now = () => Date.now() } = {}) {
  const clients = new Map();

  return {
    check(key) {
      const currentTime = now();
      const entry = clients.get(key);

      if (!entry || currentTime - entry.windowStartedAt >= windowMs) {
        clients.set(key, { windowStartedAt: currentTime, requestCount: 1 });
        return { allowed: true, retryAfterSeconds: 0 };
      }

      if (entry.requestCount >= maxRequests) {
        return {
          allowed: false,
          retryAfterSeconds: Math.max(1, Math.ceil((entry.windowStartedAt + windowMs - currentTime) / 1000))
        };
      }

      entry.requestCount += 1;
      return { allowed: true, retryAfterSeconds: 0 };
    }
  };
}

module.exports = { createRateLimiter };