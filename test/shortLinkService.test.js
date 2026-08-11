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
