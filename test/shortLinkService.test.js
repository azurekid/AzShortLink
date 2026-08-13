'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { ShortLinkService } = require('../src/service/shortLinkService');
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
