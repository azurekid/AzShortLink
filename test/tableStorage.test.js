'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { TableStorage } = require('../src/storage/tableStorage');

function makeFakeClient({ entities = [], onDelete } = {}) {
  const created = [];
  const deleted = [];
  const updated = [];
  const filters = [];
  return {
    created,
    deleted,
    updated,
    filters,
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
      if (onDelete) await onDelete(partitionKey, rowKey);
    },
    async getAccessPolicy() {
      return {};
    },
    listEntities({ queryOptions } = {}) {
      const filter = (queryOptions && queryOptions.filter) || '';
      filters.push(filter);
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

test('stores, filters and responds to help requests in the users table', async () => {
  const { storage, usersClient } = makeStorage();
  const created = await storage.createHelpRequest({
    id: 'request-1',
    userId: 'alice',
    username: 'Alice',
    subject: 'Invite question',
    message: 'When can I invite someone?',
    createdAt: '2026-01-01T00:00:00.000Z'
  });

  assert.equal(created.status, 'open');
  assert.equal(created.ticketNumber, 'AZSL-REQU-EST1-0000');
  assert.equal(created.messages.length, 1);
  assert.equal(created.messages[0].role, 'user');
  assert.equal(usersClient.created[0].partitionKey, 'HELP');
  assert.deepEqual((await storage.listHelpRequests('alice')).map((request) => request.id), ['request-1']);
  assert.match(usersClient.filters.at(-1), /userId eq 'alice'/);

  const answered = await storage.respondToHelpRequest('request-1', {
    response: 'Your account must be at least seven days old.',
    respondedAt: '2026-01-02T00:00:00.000Z',
    respondedBy: 'admin'
  });

  assert.equal(answered.status, 'answered');
  assert.equal(answered.respondedBy, 'admin');
  assert.equal(answered.response, 'Your account must be at least seven days old.');
  assert.equal(answered.messages.length, 2);
  assert.equal(answered.messages[1].role, 'admin');

  const followedUp = await storage.addHelpRequestMessage('request-1', {
    userId: 'alice',
    author: 'Alice',
    role: 'user',
    text: 'I have one more question.',
    createdAt: '2026-01-02T01:00:00.000Z'
  });
  assert.equal(followedUp.status, 'open');
  assert.equal(followedUp.messages.length, 3);
  assert.equal(followedUp.messages[2].text, 'I have one more question.');

  const closed = await storage.setHelpRequestStatus('request-1', {
    userId: 'alice',
    status: 'closed',
    changedAt: '2026-01-03T00:00:00.000Z',
    changedBy: 'Alice'
  });
  assert.equal(closed.status, 'closed');
  assert.equal(closed.closedBy, 'Alice');
});

test('returns null when responding to an unknown help request', async () => {
  const { storage } = makeStorage();

  assert.equal(await storage.respondToHelpRequest('missing', {
    response: 'Reply',
    respondedAt: '2026-01-02T00:00:00.000Z',
    respondedBy: 'admin'
  }), null);
});

test('does not let a user close another users help request', async () => {
  const { storage } = makeStorage({
    usersEntities: [{ partitionKey: 'HELP', rowKey: 'request-1', userId: 'alice', status: 'open' }]
  });

  assert.equal(await storage.setHelpRequestStatus('request-1', {
    userId: 'bob',
    status: 'closed',
    changedAt: '2026-01-03T00:00:00.000Z',
    changedBy: 'bob'
  }), null);
});

test('purges expired audit rows concurrently', async () => {
  let activeDeletes = 0;
  let maximumActiveDeletes = 0;
  let releaseDeletes;
  const release = new Promise((resolve) => { releaseDeletes = resolve; });
  const auditClient = makeFakeClient({
    entities: [
      { partitionKey: 'AUDIT', rowKey: 'old-1' },
      { partitionKey: 'AUDIT', rowKey: 'old-2' },
      { partitionKey: 'AUDIT', rowKey: 'old-3' }
    ],
    onDelete: async () => {
      activeDeletes += 1;
      maximumActiveDeletes = Math.max(maximumActiveDeletes, activeDeletes);
      if (activeDeletes === 4) releaseDeletes();
      await release;
      activeDeletes -= 1;
    }
  });
  const storage = new TableStorage({ linksClient: makeFakeClient(), usersClient: makeFakeClient(), auditClient });

  await storage.appendAuditEvent({ timestamp: '2026-01-01T00:00:00.000Z', action: 'LOGIN_SUCCESS' });

  assert.equal(maximumActiveDeletes, 4);
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
      {
        partitionKey: 'AUDIT', rowKey: '1', eventTime: '2026-01-01T00:00:00.000Z', action: 'LOGIN_SUCCESS',
        actorUsername: 'admin', actorRole: 'admin', sourceIp: '203.0.113.5', userAgent: 'Browser',
        channel: 'dashboard', authenticationMethod: 'password', sourceCountryCode: 'US'
      }
    ]
  });

  const events = await storage.listAuditEvents({ limit: 10 });

  assert.equal(events.length, 1);
  assert.equal(events[0].timestamp, '2026-01-01T00:00:00.000Z');
  assert.equal(events[0].action, 'LOGIN_SUCCESS');
  assert.equal(events[0].channel, 'dashboard');
  assert.equal(events[0].authenticationMethod, 'password');
  assert.equal(events[0].sourceCountryCode, 'US');
});

test('listAuditEvents escapes single quotes in sinceIso before building the OData filter', async () => {
  const { storage, auditClient } = makeStorage();

  await storage.listAuditEvents({ limit: 10, sinceIso: "2026-01-01' or PartitionKey ne '" });

  assert.equal(auditClient.filters.length, 1);
  // Every raw single quote from the input must come through doubled (OData's escape for a
  // literal quote), so the attacker-supplied text stays trapped inside the string literal.
  assert.match(auditClient.filters[0], /eventTime ge '2026-01-01'' or PartitionKey ne '''$/);
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

test('email verification identity updates preserve the stored password hash', async () => {
  const { storage } = makeStorage({
    usersEntities: [{
      partitionKey: 'USER',
      rowKey: 'verified-user',
      username: 'verified-user',
      passwordHash: 'original-signup-hash',
      status: 'pending_email',
      riskFlags: JSON.stringify(['SHARED_SIGNUP_IP'])
    }]
  });

  await storage.updateUserIdentity('verified-user', {
    emailVerifiedAt: '2026-08-16T12:00:00.000Z',
    status: 'active'
  });

  const user = await storage.getUser('verified-user');
  assert.equal(user.passwordHash, 'original-signup-hash');
  assert.equal(user.status, 'active');
  assert.deepEqual(user.riskFlags, ['SHARED_SIGNUP_IP']);
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

test('listInvites is not scoped to a single admin - it returns invites created by every admin', async () => {
  const { storage } = makeStorage({
    usersEntities: [
      { partitionKey: 'INVITE', rowKey: 'from-admin-one', createdBy: 'admin-one', createdAt: '2026-01-01T00:00:00.000Z', redeemed: false },
      { partitionKey: 'INVITE', rowKey: 'from-admin-two', createdBy: 'admin-two', createdAt: '2026-01-02T00:00:00.000Z', redeemed: false }
    ]
  });

  const invites = await storage.listInvites();

  assert.deepEqual(invites.map((invite) => invite.createdBy).sort(), ['admin-one', 'admin-two']);
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
