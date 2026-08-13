'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { TableStorage } = require('../src/storage/tableStorage');

function makeFakeClient({ entities = [] } = {}) {
  const created = [];
  const deleted = [];
  const updated = [];
  return {
    created,
    deleted,
    updated,
    async createEntity(entity) {
      created.push(entity);
      entities.push(entity);
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
    async updateEntity(entity) {
      updated.push(entity);
      const index = entities.findIndex((item) => item.partitionKey === entity.partitionKey && item.rowKey === entity.rowKey);
      if (index === -1) {
        const err = new Error('not found');
        err.statusCode = 404;
        throw err;
      }
      entities[index] = { ...entities[index], ...entity };
    },
    async deleteEntity(partitionKey, rowKey) {
      deleted.push({ partitionKey, rowKey });
    },
    async getAccessPolicy() {
      return {};
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

function makeStorage({ usersEntities = [], auditEntities = [] } = {}) {
  const linksClient = makeFakeClient();
  const usersClient = makeFakeClient({ entities: usersEntities });
  const auditClient = makeFakeClient({ entities: auditEntities });
  const storage = new TableStorage(
    { linksClient, usersClient, auditClient },
    { linksTableName: 'Links', usersTableName: 'Users', auditTableName: 'Audit' }
  );
  return { storage, linksClient, usersClient, auditClient };
}

test('users, links and audit entities are written to separate table clients', async () => {
  const { storage, usersClient, auditClient } = makeStorage();

  await storage.createUser({ username: 'alice', passwordHash: 'hash', displayName: 'Alice', createdAt: '2026-01-01T00:00:00.000Z' });
  await storage.appendAuditEvent({ timestamp: '2026-01-01T00:00:00.000Z', action: 'LOGIN_SUCCESS', actorUsername: 'alice', ip: '', details: '{}' });

  assert.equal(usersClient.created.length, 1);
  assert.equal(auditClient.created.length, 1);
});

test('appendAuditEvent stores the event time under eventTime, not the reserved timestamp property', async () => {
  const { storage, auditClient } = makeStorage();

  await storage.appendAuditEvent({
    timestamp: '2026-01-01T00:00:00.000Z',
    action: 'LOGIN_SUCCESS',
    actorId: 'admin',
    actorUsername: 'admin',
    ip: '',
    details: '{}'
  });

  assert.equal(auditClient.created.length, 1);
  assert.equal(auditClient.created[0].eventTime, '2026-01-01T00:00:00.000Z');
  assert.equal('timestamp' in auditClient.created[0], false);
});

test('listAuditEvents maps the stored eventTime back onto timestamp', async () => {
  const { storage } = makeStorage({
    auditEntities: [
      { partitionKey: 'AUDIT', rowKey: '1', eventTime: '2026-01-01T00:00:00.000Z', action: 'LOGIN_SUCCESS', actorUsername: 'admin' }
    ]
  });

  const events = await storage.listAuditEvents({ limit: 10 });

  assert.equal(events.length, 1);
  assert.equal(events[0].timestamp, '2026-01-01T00:00:00.000Z');
  assert.equal(events[0].action, 'LOGIN_SUCCESS');
});

test('deleteUser removes the user entity and any associated API key entity from the users table', async () => {
  const { storage, usersClient } = makeStorage({
    usersEntities: [
      { partitionKey: 'USER', rowKey: 'alice', username: 'alice', displayName: 'Alice', role: 'user', apiKeyHash: 'hash123' }
    ]
  });

  const result = await storage.deleteUser('alice');

  assert.equal(result, true);
  assert.deepEqual(usersClient.deleted, [
    { partitionKey: 'APIKEY', rowKey: 'hash123' },
    { partitionKey: 'USER', rowKey: 'alice' }
  ]);
});

test('deleteUser returns false when the profile does not exist', async () => {
  const { storage, usersClient } = makeStorage();

  assert.equal(await storage.deleteUser('missing'), false);
  assert.equal(usersClient.deleted.length, 0);
});

test('getHealthDetails reports each table independently', async () => {
  const { storage, auditClient } = makeStorage();
  auditClient.getAccessPolicy = async () => {
    throw new Error('down');
  };

  const health = await storage.getHealthDetails();

  assert.equal(health.table.status, 'up');
  assert.equal(health.usersTable.status, 'up');
  assert.equal(health.auditTable.status, 'down');
  assert.equal(health.table.name, 'Links');
  assert.equal(health.usersTable.name, 'Users');
  assert.equal(health.auditTable.name, 'Audit');
});

test('createInvite and getInvite round trip an unredeemed invite', async () => {
  const { storage, usersClient } = makeStorage();

  await storage.createInvite({ code: 'abc123', createdBy: 'admin', createdAt: '2026-01-01T00:00:00.000Z' });
  const invite = await storage.getInvite('abc123');

  assert.equal(usersClient.created[0].partitionKey, 'INVITE');
  assert.deepEqual(invite, {
    code: 'abc123',
    createdBy: 'admin',
    createdAt: '2026-01-01T00:00:00.000Z',
    redeemed: false,
    redeemedBy: '',
    redeemedAt: ''
  });
});

test('listInvites returns every invite regardless of redeemed state', async () => {
  const { storage } = makeStorage({
    usersEntities: [
      { partitionKey: 'INVITE', rowKey: 'one', createdBy: 'admin', createdAt: '2026-01-01T00:00:00.000Z', redeemed: false },
      { partitionKey: 'INVITE', rowKey: 'two', createdBy: 'admin', createdAt: '2026-01-02T00:00:00.000Z', redeemed: true, redeemedBy: 'bob' }
    ]
  });

  const invites = await storage.listInvites();

  assert.equal(invites.length, 2);
  assert.equal(invites.find((invite) => invite.code === 'two').redeemedBy, 'bob');
});

test('redeemInvite marks an unredeemed invite as used and rejects a second redemption', async () => {
  const { storage } = makeStorage({
    usersEntities: [{ partitionKey: 'INVITE', rowKey: 'abc123', createdBy: 'admin', createdAt: '2026-01-01T00:00:00.000Z', redeemed: false }]
  });

  const firstAttempt = await storage.redeemInvite('abc123', 'bob', '2026-01-02T00:00:00.000Z');
  const secondAttempt = await storage.redeemInvite('abc123', 'carol', '2026-01-03T00:00:00.000Z');
  const invite = await storage.getInvite('abc123');

  assert.equal(firstAttempt, true);
  assert.equal(secondAttempt, false);
  assert.equal(invite.redeemed, true);
  assert.equal(invite.redeemedBy, 'bob');
});

test('deleteInvite removes the invite entity from the users table', async () => {
  const { storage, usersClient } = makeStorage({
    usersEntities: [{ partitionKey: 'INVITE', rowKey: 'abc123', createdBy: 'admin', createdAt: '2026-01-01T00:00:00.000Z', redeemed: false }]
  });

  await storage.deleteInvite('abc123');

  assert.deepEqual(usersClient.deleted, [{ partitionKey: 'INVITE', rowKey: 'abc123' }]);
});
