'use strict';

const crypto = require('node:crypto');
const { parseUserAgent, parseReferrer } = require('../analytics/userAgent');

const ALIAS_PATTERN = /^[A-Za-z0-9_-]{4,32}$/;
const MAX_GENERATION_ATTEMPTS = 8;

function increment(counters, key) {
  const next = { ...(counters || {}) };
  next[key] = (next[key] || 0) + 1;
  return next;
}

function incrementLocation(locations, location) {
  const next = { ...(locations || {}) };
  if (!location || !Number.isFinite(location.latitude) || !Number.isFinite(location.longitude)) return next;

  const key = `${location.latitude},${location.longitude}|${location.city}|${location.countryCode}`;
  const previous = next[key] || {};
  next[key] = { ...location, count: (Number(previous.count) || 0) + 1 };
  return next;
}

function mergeCounters(target, source) {
  for (const [key, value] of Object.entries(source || {})) {
    target[key] = (target[key] || 0) + (Number(value) || 0);
  }

  return target;
}

function toSortedList(counters, limit = 8) {
  return Object.entries(counters)
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

function mergeLocations(target, source) {
  for (const [key, location] of Object.entries(source || {})) {
    const previous = target[key] || {};
    target[key] = { ...location, count: (Number(previous.count) || 0) + (Number(location.count) || 0) };
  }
}

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
  // Invite codes reuse this generator as bearer tokens for account creation, so it must be
  // unpredictable - Math.random() is not a CSPRNG and its output can be reconstructed.
  return crypto.randomBytes(6).toString('base64url');
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

  async resolveShortLink(code, meta = {}) {
    const normalizedCode = normalizeAlias(code);
    if (!normalizedCode) {
      return null;
    }

    const link = await this.storage.getLink(normalizedCode);
    if (!link) {
      return null;
    }

    // Checked before the stats write so an over-quota owner costs one read, not a write too.
    if (typeof meta.quotaCheck === 'function') {
      const quota = await meta.quotaCheck(link);
      if (quota && quota.allowed === false) {
        return { code: normalizedCode, ownerId: link.ownerId || '', quotaExceeded: true, quota };
      }
    }

    const nextCount = (Number(link.redirectCount) || 0) + 1;
    const lastAccessedAt = this.now();
    const agent = parseUserAgent(meta.userAgent);
    const previous = link.agentStats || {};
    const agentStats = {
      browsers: increment(previous.browsers, agent.browser),
      os: increment(previous.os, agent.os),
      devices: increment(previous.devices, agent.device),
      referrers: increment(previous.referrers, parseReferrer(meta.referrer)),
      countries: increment(previous.countries, meta.location?.country || 'Unknown'),
      locations: incrementLocation(previous.locations, meta.location)
    };

    await this.storage.updateRedirectStats(normalizedCode, nextCount, lastAccessedAt, agentStats);

    return {
      code: normalizedCode,
      ownerId: link.ownerId || '',
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

  async deleteShortLink(code, ownerId = '') {
    const normalizedCode = normalizeAlias(code);
    if (!normalizedCode) {
      return false;
    }

    const link = await this.storage.getLink(normalizedCode);
    if (!link) {
      return false;
    }

    // An empty ownerId means an admin caller, who may delete any link.
    if (ownerId && link.ownerId !== ownerId) {
      const err = new Error('You do not own this short link.');
      err.code = 'FORBIDDEN';
      throw err;
    }

    await this.storage.deleteLink(normalizedCode);
    return true;
  }

  // An invite link is a regular shortlink whose code doubles as the invite's identity, so
  // creating one reuses the same alias-generation/retry logic as createShortLink.
  async createInviteLink(createdBy = '') {
    const createdAt = this.now();

    for (let i = 0; i < MAX_GENERATION_ATTEMPTS; i += 1) {
      const code = this.aliasGenerator();
      const targetUrl = `${this.baseUrl}/dashboard/signup?invite=${code}`;

      try {
        await this.storage.createLink({ code, targetUrl, createdAt, ownerId: createdBy });
      } catch (err) {
        if (err && err.code === 'ALIAS_EXISTS') {
          continue;
        }
        throw err;
      }

      await this.storage.createInvite({ code, createdBy, createdAt });
      return { code, inviteUrl: `${this.baseUrl}/${code}`, createdAt };
    }

    const err = new Error('Unable to generate a unique invite link, please retry.');
    err.code = 'GENERATION_FAILED';
    throw err;
  }

  async revokeInviteLink(code) {
    const normalizedCode = normalizeAlias(code);
    if (!normalizedCode) {
      return false;
    }

    const invite = await this.storage.getInvite(normalizedCode);
    if (!invite) {
      return false;
    }

    if (invite.redeemed) {
      const err = new Error('This invite link has already been redeemed.');
      err.code = 'INVITE_REDEEMED';
      throw err;
    }

    await this.storage.deleteInvite(normalizedCode);
    await this.storage.deleteLink(normalizedCode);
    return true;
  }

  async getAnalytics(ownerId = '', code = '') {
    const normalizedCode = normalizeAlias(code);
    let links;
    if (normalizedCode) {
      const link = await this.storage.getLink(normalizedCode);
      if (!link || (ownerId && link.ownerId !== ownerId)) {
        const err = new Error('Short link not found.');
        err.code = 'LINK_NOT_FOUND';
        throw err;
      }
      links = [link];
    } else {
      links = await this.storage.listLinks(1000, ownerId);
    }
    const totalRedirects = links.reduce((sum, link) => sum + (Number(link.redirectCount) || 0), 0);
    const withRedirects = links.filter((link) => (Number(link.redirectCount) || 0) > 0);
    const browsers = {};
    const os = {};
    const devices = {};
    const referrers = {};
    const countries = {};
    const locations = {};
    const owners = {};

    for (const link of links) {
      const stats = link.agentStats || {};
      mergeCounters(browsers, stats.browsers);
      mergeCounters(os, stats.os);
      mergeCounters(devices, stats.devices);
      mergeCounters(referrers, stats.referrers);
      mergeCounters(countries, stats.countries);
      mergeLocations(locations, stats.locations);
      const owner = link.ownerId || 'unassigned';
      owners[owner] = (owners[owner] || 0) + (Number(link.redirectCount) || 0);
    }

    const topLinks = [...links]
      .sort((a, b) => (Number(b.redirectCount) || 0) - (Number(a.redirectCount) || 0))
      .slice(0, 10);
    const recentLinks = [...links]
      .filter((link) => link.lastAccessedAt)
      .sort((a, b) => String(b.lastAccessedAt).localeCompare(String(a.lastAccessedAt)))
      .slice(0, 10);

    return {
      totalLinks: links.length,
      totalRedirects,
      usedLinks: withRedirects.length,
      unusedLinks: links.length - withRedirects.length,
      averageRedirects: links.length ? Number((totalRedirects / links.length).toFixed(2)) : 0,
      mostViewed: topLinks.length && topLinks[0].redirectCount ? topLinks[0].code : '-',
      selectedCode: normalizedCode,
      topLinks,
      recentLinks,
      breakdowns: {
        browsers: toSortedList(browsers),
        os: toSortedList(os),
        devices: toSortedList(devices),
        referrers: toSortedList(referrers),
        countries: toSortedList(countries),
        locations: Object.values(locations).sort((a, b) => b.count - a.count),
        owners: toSortedList(owners),
        links: topLinks.map((link) => ({ label: link.code, count: Number(link.redirectCount) || 0 }))
      }
    };
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
