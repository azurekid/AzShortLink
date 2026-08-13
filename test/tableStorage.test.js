'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { TableStorage } = require('../src/storage/tableStorage');

function makeFakeClient({ entities = [] } = {}) {
  const created = [];
  const deleted = [];
  return {
    created,
    deleted,
    async createEntity(entity) {
      created.push(entity);
    },
    async getEntity(partitionKey, rowKey) {
      const found = entities.find((item) => item.partitionKey === partitionKey && item.rowKey === rowKey);
      if (!found) {
        const err = new Error('not found');
        err.statusCode = 404;
        throw err;
      }
      return found;
    },
    async deleteEntity(partitionKey, rowKey) {
      deleted.push({ partitionKey, rowKey });
    },
    listEntities({ queryOptions } = {}) {
      const filter = (queryOptions && queryOptions.filter) || '';
      const matches = entities.filter((item) => filter.includes(`'${item.partitionKey}'`));
      return (async function* () {
        for (const item of matches) {
          yield item;
        }
      })();
    }
  };
}

test('appendAuditEvent stores the event time under eventTime, not the reserved timestamp property', async () => {
  const client = makeFakeClient();
  const storage = new TableStorage(client, { tableName: 'test' });

  await storage.appendAuditEvent({
    timestamp: '2026-01-01T00:00:00.000Z',
    action: 'LOGIN_SUCCESS',
    actorId: 'admin',
    actorUsername: 'admin',
    ip: '',
    details: '{}'
  });

  assert.equal(client.created.length, 1);
  assert.equal(client.created[0].eventTime, '2026-01-01T00:00:00.000Z');
  assert.equal('timestamp' in client.created[0], false);
});

test('listAuditEvents maps the stored eventTime back onto timestamp', async () => {
  const client = makeFakeClient({
    entities: [
      { partitionKey: 'AUDIT', rowKey: '1', eventTime: '2026-01-01T00:00:00.000Z', action: 'LOGIN_SUCCESS', actorUsername: 'admin' }
    ]
  });
  const storage = new TableStorage(client, { tableName: 'test' });

  const events = await storage.listAuditEvents({ limit: 10 });

  assert.equal(events.length, 1);
  assert.equal(events[0].timestamp, '2026-01-01T00:00:00.000Z');
  assert.equal(events[0].action, 'LOGIN_SUCCESS');
});

test('deleteUser removes the user entity and any associated API key entity', async () => {
  const client = makeFakeClient({
    entities: [
      { partitionKey: 'USER', rowKey: 'alice', username: 'alice', displayName: 'Alice', role: 'user', apiKeyHash: 'hash123' }
    ]
  });
  const storage = new TableStorage(client, { tableName: 'test' });

  const result = await storage.deleteUser('alice');

  assert.equal(result, true);
  assert.deepEqual(client.deleted, [
    { partitionKey: 'APIKEY', rowKey: 'hash123' },
    { partitionKey: 'USER', rowKey: 'alice' }
  ]);
});

test('deleteUser returns false when the profile does not exist', async () => {
  const client = makeFakeClient();
  const storage = new TableStorage(client, { tableName: 'test' });

  assert.equal(await storage.deleteUser('missing'), false);
  assert.equal(client.deleted.length, 0);
});
