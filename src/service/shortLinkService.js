'use strict';

const ALIAS_PATTERN = /^[A-Za-z0-9_-]{4,32}$/;
const MAX_GENERATION_ATTEMPTS = 8;

function isValidHttpUrl(value) {
  if (!value || typeof value !== 'string') {
    return false;
  }

  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function normalizeAlias(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function generateAlias() {
  return Math.random().toString(36).slice(2, 10);
}

class ShortLinkService {
  constructor(storage, options = {}) {
    this.storage = storage;
    this.baseUrl = (options.baseUrl || 'https://azhk.in').replace(/\/$/, '');
    this.now = options.now || (() => new Date().toISOString());
    this.aliasGenerator = options.aliasGenerator || generateAlias;
  }

  async createShortLink(payload = {}, ownerId = '') {
    const targetUrl = typeof payload.url === 'string' ? payload.url.trim() : '';
    const requestedAlias = normalizeAlias(payload.uniqueValue || payload.alias || payload.code);

    if (!isValidHttpUrl(targetUrl)) {
      const err = new Error('A valid http/https URL is required.');
      err.code = 'INVALID_URL';
      throw err;
    }

    if (requestedAlias && !ALIAS_PATTERN.test(requestedAlias)) {
      const err = new Error('Custom alias must be 4-32 chars with letters, numbers, _ or -.');
      err.code = 'INVALID_ALIAS';
      throw err;
    }

    const createdAt = this.now();

    if (requestedAlias) {
      await this.storage.createLink({ code: requestedAlias, targetUrl, createdAt, ownerId });
      return { code: requestedAlias, shortUrl: `${this.baseUrl}/${requestedAlias}`, targetUrl };
    }

    for (let i = 0; i < MAX_GENERATION_ATTEMPTS; i += 1) {
      const code = this.aliasGenerator();
      try {
        await this.storage.createLink({ code, targetUrl, createdAt, ownerId });
        return { code, shortUrl: `${this.baseUrl}/${code}`, targetUrl };
      } catch (err) {
        if (err && err.code === 'ALIAS_EXISTS') {
          continue;
        }
        throw err;
      }
    }

    const err = new Error('Unable to generate a unique short URL, please retry.');
    err.code = 'GENERATION_FAILED';
    throw err;
  }

  async resolveShortLink(code) {
    const normalizedCode = normalizeAlias(code);
    if (!normalizedCode) {
      return null;
    }

    const link = await this.storage.getLink(normalizedCode);
    if (!link) {
      return null;
    }

    const nextCount = (Number(link.redirectCount) || 0) + 1;
    const lastAccessedAt = this.now();

    await this.storage.updateRedirectStats(normalizedCode, nextCount, lastAccessedAt);

    return {
      code: normalizedCode,
      targetUrl: link.targetUrl,
      redirectCount: nextCount,
      lastAccessedAt
    };
  }

  async getStats(code, ownerId = '') {
    const normalizedCode = normalizeAlias(code);
    if (normalizedCode) {
      const link = await this.storage.getLink(normalizedCode);
      return link && (!ownerId || link.ownerId === ownerId) ? [link] : [];
    }

    return this.storage.listLinks(250, ownerId);
  }

  async getHealth() {
    const details = this.storage.getHealthDetails
      ? await this.storage.getHealthDetails()
      : {
          type: 'unknown',
          table: {
            name: '',
            status: (await this.storage.ping()) ? 'up' : 'down',
            message: 'Health details unavailable.'
          },
          queue: {
            status: 'unknown',
            names: [],
            message: 'Health details unavailable.'
          }
        };

    return {
      status: details.table.status === 'up' ? 'healthy' : 'degraded',
      storage: details,
      checkedAt: this.now()
    };
  }
}

module.exports = {
  ShortLinkService,
  ALIAS_PATTERN,
  isValidHttpUrl
};
