'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { InMemoryStorage } = require('../src/storage/inMemoryStorage');
const { ACTIONS, AUDIT_RETENTION_DAYS, recordAuditEvent } = require('../src/core/audit');

test('records and lists audit events newest first', async () => {
  const storage = new InMemoryStorage();

  await recordAuditEvent(storage, {
    action: ACTIONS.LOGIN_SUCCESS,
    actorId: 'alice',
    actorUsername: 'Alice',
    ip: '203.0.113.5'
  });
  await recordAuditEvent(storage, {
    action: ACTIONS.LINK_CREATED,
    actorId: 'alice',
    actorUsername: 'Alice',
    ip: '203.0.113.5',
    details: { code: 'my-link', targetUrl: 'https://example.com' }
  });

  const events = await storage.listAuditEvents({ limit: 10 });

  assert.equal(events.length, 2);
  assert.equal(events[0].action, ACTIONS.LINK_CREATED);
  assert.equal(events[1].action, ACTIONS.LOGIN_SUCCESS);
  assert.deepEqual(JSON.parse(events[0].details), { code: 'my-link', targetUrl: 'https://example.com' });
});

test('excludes audit events older than the retention window', async () => {
  const storage = new InMemoryStorage();
  const old = new Date(Date.now() - (AUDIT_RETENTION_DAYS + 1) * 24 * 60 * 60 * 1000).toISOString();
  const recent = new Date().toISOString();

  await storage.appendAuditEvent({ timestamp: old, action: ACTIONS.LOGIN_FAILED, actorUsername: 'old-attempt', ip: '', details: '{}' });
  await storage.appendAuditEvent({ timestamp: recent, action: ACTIONS.LOGIN_FAILED, actorUsername: 'recent-attempt', ip: '', details: '{}' });

  const events = await storage.listAuditEvents({ limit: 50 });

  assert.equal(events.length, 1);
  assert.equal(events[0].actorUsername, 'recent-attempt');
});

test('does not throw when the audit write itself fails', async () => {
  const storage = {
    async appendAuditEvent() {
      throw new Error('boom');
    }
  };

  await assert.doesNotReject(() => recordAuditEvent(storage, { action: ACTIONS.LOGIN_FAILED, actorUsername: 'x', ip: '' }));
});

test('is a no-op when the storage adapter has no audit support', async () => {
  await assert.doesNotReject(() => recordAuditEvent({}, { action: ACTIONS.LOGIN_FAILED }));
  await assert.doesNotReject(() => recordAuditEvent(null, { action: ACTIONS.LOGIN_FAILED }));
});
