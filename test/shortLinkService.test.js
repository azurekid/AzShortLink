'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { ShortLinkService } = require('../src/services/shortLinkService');
const { InMemoryStorage } = require('../src/storage/inMemoryStorage');

test('creates short link with generated alias', async () => {
  const storage = new InMemoryStorage();
  const service = new ShortLinkService(storage, {
    baseUrl: 'https://azhk.in',
    aliasGenerator: () => 'abc12345',
    now: () => '2026-01-01T00:00:00.000Z'
  });

  const result = await service.createShortLink({ url: 'https://example.com/path' });

  assert.equal(result.code, 'abc12345');
  assert.equal(result.shortUrl, 'https://azhk.in/abc12345');
});

test('creates short link with requested unique value', async () => {
  const storage = new InMemoryStorage();
  const service = new ShortLinkService(storage, {
    baseUrl: 'https://azhk.in'
  });

  const result = await service.createShortLink({
    url: 'https://microsoft.com',
    uniqueValue: 'myAlias2026'
  });

  assert.equal(result.code, 'myAlias2026');
  assert.equal(result.shortUrl, 'https://azhk.in/myAlias2026');
});

test('rejects duplicate unique value', async () => {
  const storage = new InMemoryStorage();
  const service = new ShortLinkService(storage, {
    baseUrl: 'https://azhk.in'
  });

  await service.createShortLink({
    url: 'https://one.example',
    uniqueValue: 'dupAlias'
  });

  await assert.rejects(
    () =>
      service.createShortLink({
        url: 'https://two.example',
        uniqueValue: 'dupAlias'
      }),
    (err) => err.code === 'ALIAS_EXISTS'
  );
});

test('resolves short link and increments redirect stats', async () => {
  const storage = new InMemoryStorage();
  const service = new ShortLinkService(storage, {
    baseUrl: 'https://azhk.in',
    now: () => '2026-01-01T00:05:00.000Z'
  });

  await service.createShortLink({
    url: 'https://learn.microsoft.com',
    uniqueValue: 'docs1234'
  });

  const resolved = await service.resolveShortLink('docs1234');
  assert.equal(resolved.targetUrl, 'https://learn.microsoft.com');
  assert.equal(resolved.redirectCount, 1);

  const stats = await service.getStats('docs1234');
  assert.equal(stats[0].redirectCount, 1);
  assert.equal(stats[0].lastAccessedAt, '2026-01-01T00:05:00.000Z');
});

test('returns only links owned by the active profile', async () => {
  const storage = new InMemoryStorage();
  const service = new ShortLinkService(storage, { baseUrl: 'https://azhk.in' });

  await service.createShortLink({ url: 'https://one.example', uniqueValue: 'user-one' }, 'user1');
  await service.createShortLink({ url: 'https://two.example', uniqueValue: 'user-two' }, 'user2');

  const links = await service.getStats('', 'user1');

  assert.equal(links.length, 1);
  assert.equal(links[0].code, 'user-one');
  assert.equal(links[0].ownerId, 'user1');
});

test('deletes only links owned by the caller', async () => {
  const storage = new InMemoryStorage();
  const service = new ShortLinkService(storage, { baseUrl: 'https://azhk.in' });

  await service.createShortLink({ url: 'https://one.example', uniqueValue: 'user-one' }, 'user1');
  await service.createShortLink({ url: 'https://two.example', uniqueValue: 'user-two' }, 'user2');

  await assert.rejects(() => service.deleteShortLink('user-two', 'user1'), /do not own/);

  assert.equal(await service.deleteShortLink('user-one', 'user1'), true);
  assert.equal((await service.getStats('', 'user1')).length, 0);
});

test('lets an admin delete any link', async () => {
  const storage = new InMemoryStorage();
  const service = new ShortLinkService(storage, { baseUrl: 'https://azhk.in' });

  await service.createShortLink({ url: 'https://one.example', uniqueValue: 'user-one' }, 'user1');

  assert.equal(await service.deleteShortLink('user-one', ''), true);
  assert.equal(await service.deleteShortLink('missing1', ''), false);
});

test('aggregates analytics for the requested scope', async () => {
  const storage = new InMemoryStorage();
  const service = new ShortLinkService(storage, {
    baseUrl: 'https://azhk.in',
    now: () => '2026-01-01T00:00:00.000Z'
  });

  await service.createShortLink({ url: 'https://one.example', uniqueValue: 'link-one' }, 'user1');
  await service.createShortLink({ url: 'https://two.example', uniqueValue: 'link-two' }, 'user1');
  await service.resolveShortLink('link-one');

  const analytics = await service.getAnalytics('user1');

  assert.equal(analytics.totalLinks, 2);
  assert.equal(analytics.totalRedirects, 1);
  assert.equal(analytics.usedLinks, 1);
  assert.equal(analytics.unusedLinks, 1);
  assert.equal(analytics.topLinks[0].code, 'link-one');
});

test('keeps usernames case-sensitive', async () => {
  const storage = new InMemoryStorage();

  await storage.createUser({ username: 'Alice', passwordHash: 'hash-a', displayName: 'Alice' });
  await storage.createUser({ username: 'alice', passwordHash: 'hash-b', displayName: 'alice' });

  assert.equal((await storage.getUser('Alice')).passwordHash, 'hash-a');
  assert.equal((await storage.getUser('alice')).passwordHash, 'hash-b');
  assert.equal(await storage.getUser('ALICE'), null);
  assert.equal((await storage.listUsers()).length, 2);
});

test('records browser, device, referrer and aggregate location breakdowns on redirect', async () => {
  const storage = new InMemoryStorage();
  const service = new ShortLinkService(storage, { baseUrl: 'https://azhk.in' });

  await service.createShortLink({ url: 'https://one.example', uniqueValue: 'link-one' }, 'user1');
  await service.resolveShortLink('link-one', {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
    referrer: 'https://news.example/article',
    location: { countryCode: 'GB', country: 'United Kingdom', region: 'ENG', city: 'London', latitude: 51.5, longitude: -0.1 }
  });
  await service.resolveShortLink('link-one', {
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit/605.1 Mobile Safari/604.1'
  });

  const { breakdowns, mostViewed } = await service.getAnalytics('user1');
  const labels = (rows) => rows.map((row) => row.label);

  assert.equal(mostViewed, 'link-one');
  assert.ok(labels(breakdowns.browsers).includes('Chrome'));
  assert.ok(labels(breakdowns.os).includes('Windows'));
  assert.ok(labels(breakdowns.os).includes('iOS'));
  assert.deepEqual(labels(breakdowns.devices).sort(), ['desktop', 'mobile']);
  assert.ok(labels(breakdowns.referrers).includes('news.example'));
  assert.ok(labels(breakdowns.referrers).includes('direct'));
  assert.ok(labels(breakdowns.countries).includes('United Kingdom'));
  assert.deepEqual(breakdowns.locations[0], {
    countryCode: 'GB', country: 'United Kingdom', region: 'ENG', city: 'London', latitude: 51.5, longitude: -0.1, count: 1
  });
});

test('scopes analytics to one owned short link', async () => {
  const storage = new InMemoryStorage();
  const service = new ShortLinkService(storage, { baseUrl: 'https://azhk.in' });
  await service.createShortLink({ url: 'https://one.example', uniqueValue: 'link-one' }, 'user1');
  await service.createShortLink({ url: 'https://two.example', uniqueValue: 'link-two' }, 'user1');
  await service.resolveShortLink('link-one');

  const analytics = await service.getAnalytics('user1', 'link-one');

  assert.equal(analytics.totalLinks, 1);
  assert.equal(analytics.totalRedirects, 1);
  assert.equal(analytics.selectedCode, 'link-one');
  await assert.rejects(() => service.getAnalytics('user2', 'link-one'), { code: 'LINK_NOT_FOUND' });
});

test('issues personal API keys that resolve back to their owner', async () => {
  const { generateApiKey, hashApiKey } = require('../src/auth/auth');
  const storage = new InMemoryStorage();

  await storage.createUser({ username: 'Alice', passwordHash: 'hash', displayName: 'Alice' });

  const first = generateApiKey();
  await storage.setUserApiKey('Alice', { hash: first.hash, displayPrefix: first.displayPrefix, createdAt: 'now' });

  assert.match(first.key, /^azsl_/);
  assert.equal((await storage.getUserByApiKeyHash(hashApiKey(first.key))).id, 'Alice');

  const second = generateApiKey();
  await storage.setUserApiKey('Alice', { hash: second.hash, displayPrefix: second.displayPrefix, createdAt: 'now' });

  assert.equal(await storage.getUserByApiKeyHash(hashApiKey(first.key)), null);
  assert.equal((await storage.getUserByApiKeyHash(hashApiKey(second.key))).id, 'Alice');
});

test('reports detailed healthy storage diagnostics', async () => {
  const storage = {
    async getHealthDetails() {
      return {
        type: 'table',
        table: {
          name: 'AzShortLinks',
          status: 'up',
          message: 'Azure Table Storage is reachable.'
        },
        queue: {
          status: 'not-required',
          names: [],
          message: 'This app does not use Azure Storage Queues.'
        }
      };
    }
  };

  const service = new ShortLinkService(storage, {
    now: () => '2026-01-01T00:05:00.000Z'
  });

  const health = await service.getHealth();

  assert.equal(health.status, 'healthy');
  assert.equal(health.storage.table.name, 'AzShortLinks');
  assert.equal(health.storage.queue.status, 'not-required');
});

test('reports degraded storage diagnostics when storage is unavailable', async () => {
  const storage = {
    async getHealthDetails() {
      return {
        type: 'unavailable',
        table: {
          name: 'AzShortLinks',
          status: 'down',
          message: 'Storage initialization failed.'
        },
        queue: {
          status: 'not-required',
          names: [],
          message: 'This app does not use Azure Storage Queues.'
        }
      };
    }
  };

  const service = new ShortLinkService(storage, {
    now: () => '2026-01-01T00:05:00.000Z'
  });

  const health = await service.getHealth();

  assert.equal(health.status, 'degraded');
  assert.equal(health.storage.table.status, 'down');
});

test('creates an invite link as a shortlink pointing at the signup page', async () => {
  const storage = new InMemoryStorage();
  const service = new ShortLinkService(storage, {
    baseUrl: 'https://azhk.in',
    aliasGenerator: () => 'invite01',
    now: () => '2026-01-01T00:00:00.000Z'
  });

  const invite = await service.createInviteLink('admin');

  assert.equal(invite.code, 'invite01');
  assert.equal(invite.inviteUrl, 'https://azhk.in/invite01');

  const link = await storage.getLink('invite01');
  assert.equal(link.targetUrl, 'https://azhk.in/dashboard/signup?invite=invite01');

  const storedInvite = await storage.getInvite('invite01');
  assert.equal(storedInvite.createdBy, 'admin');
  assert.equal(storedInvite.redeemed, false);
});

test('retries invite alias generation on collision', async () => {
  const storage = new InMemoryStorage();
  let attempt = 0;
  const service = new ShortLinkService(storage, {
    baseUrl: 'https://azhk.in',
    aliasGenerator: () => (attempt++ === 0 ? 'taken' : 'free01'),
    now: () => '2026-01-01T00:00:00.000Z'
  });
  await storage.createLink({ code: 'taken', targetUrl: 'https://example.com', createdAt: '2026-01-01T00:00:00.000Z' });

  const invite = await service.createInviteLink('admin');

  assert.equal(invite.code, 'free01');
});

test('revokes an unredeemed invite link and removes its shortlink', async () => {
  const storage = new InMemoryStorage();
  const service = new ShortLinkService(storage, {
    baseUrl: 'https://azhk.in',
    aliasGenerator: () => 'invite01',
    now: () => '2026-01-01T00:00:00.000Z'
  });
  await service.createInviteLink('admin');

  const revoked = await service.revokeInviteLink('invite01');

  assert.equal(revoked, true);
  assert.equal(await storage.getInvite('invite01'), null);
  assert.equal(await storage.getLink('invite01'), null);
});

test('rejects revoking an already-redeemed invite link', async () => {
  const storage = new InMemoryStorage();
  const service = new ShortLinkService(storage, {
    baseUrl: 'https://azhk.in',
    aliasGenerator: () => 'invite01',
    now: () => '2026-01-01T00:00:00.000Z'
  });
  await service.createInviteLink('admin');
  await storage.redeemInvite('invite01', 'bob', '2026-01-02T00:00:00.000Z');

  await assert.rejects(
    () => service.revokeInviteLink('invite01'),
    (err) => err.code === 'INVITE_REDEEMED'
  );
});

test('revokeInviteLink returns false for an unknown code', async () => {
  const storage = new InMemoryStorage();
  const service = new ShortLinkService(storage, { baseUrl: 'https://azhk.in' });

  assert.equal(await service.revokeInviteLink('missing'), false);
});
