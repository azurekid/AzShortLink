'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { InMemoryStorage } = require('../src/storage/inMemoryStorage');
const { ACTIONS, AUDIT_SCHEMA_VERSION, AUDIT_RETENTION_DAYS, createAuditWriteLimiter, formatAuditEvent, recordAuditEvent } = require('../src/core/audit');

test('records and lists audit events newest first', async () => {
  const storage = new InMemoryStorage();

  await recordAuditEvent(storage, {
    action: ACTIONS.LOGIN_SUCCESS,
    actorId: 'alice',
    actorUsername: 'Alice',
    actorRole: 'user',
    sourceIp: '203.0.113.5',
    userAgent: 'Test Browser',
    channel: 'dashboard',
    authenticationMethod: 'password',
    httpMethod: 'POST',
    requestPath: '/dashboard/login',
    outcome: 'success',
    location: { country: 'United States', countryCode: 'US', region: 'CA', city: 'Los Angeles', latitude: 34.1, longitude: -118.2 }
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
  assert.equal(events[1].channel, 'dashboard');
  assert.equal(events[1].authenticationMethod, 'password');
  assert.equal(events[1].userAgent, 'Test Browser');
  assert.equal(events[1].sourceCountryCode, 'US');
  assert.equal(events[1].actorRole, 'user');
  assert.equal(events[1].schemaVersion, AUDIT_SCHEMA_VERSION);
  assert.equal(events[1].category, 'authentication');
  assert.match(events[1].eventId, /^[0-9a-f-]{36}$/);
  assert.deepEqual(JSON.parse(events[0].details), { linkCode: 'my-link', targetUrl: 'https://example.com' });
});

test('normalizes user and resource detail keys for SIEM consumers', async () => {
  const storage = new InMemoryStorage();

  await recordAuditEvent(storage, {
    action: ACTIONS.USER_DELETED,
    details: { deletedUsername: 'Alice', reason: 'administrator_request' }
  });
  await recordAuditEvent(storage, {
    action: ACTIONS.INVITE_REDEEMED,
    details: { code: 'invite-1', createdUsername: 'Bob' }
  });

  const events = await storage.listAuditEvents({ limit: 10 });
  assert.deepEqual(JSON.parse(events[0].details), { userName: 'Bob', inviteCode: 'invite-1' });
  assert.deepEqual(JSON.parse(events[1].details), { reason: 'administrator_request', userName: 'Alice' });
});

test('formats the complete public SIEM event contract', () => {
  const event = formatAuditEvent({
    schemaVersion: 1,
    eventId: '7d2b95dd-0fd6-4e74-8790-bd1357eb02db',
    timestamp: '2026-08-16T12:00:00.000Z',
    action: ACTIONS.LOGIN_SUCCESS,
    category: 'authentication',
    outcome: 'success',
    actorId: 'alice',
    actorUsername: 'Alice',
    actorRole: 'user',
    channel: 'dashboard',
    authenticationMethod: 'passkey',
    sourceIp: '203.0.113.5',
    userAgent: 'Test Browser',
    httpMethod: 'POST',
    requestPath: '/dashboard/passkeys/verify',
    sourceCountry: 'United States',
    sourceCountryCode: 'US',
    sourceRegion: 'CA',
    sourceCity: 'Los Angeles',
    sourceLatitude: 34.1,
    sourceLongitude: -118.2,
    details: '{"userName":"Alice","credentialId":"credential-1"}'
  });

  assert.equal(event.authenticationMethod, 'passkey');
  assert.equal(event.source.countryCode, 'US');
  assert.equal(event.sourceIp, '203.0.113.5');
  assert.deepEqual(event.details, { userName: 'Alice', credentialId: 'credential-1' });
});

test('bounds and sanitizes untrusted audit fields', async () => {
  const storage = new InMemoryStorage();
  const oversizedDetails = Object.fromEntries(Array.from({ length: 30 }, (_, index) => [`field${index}`, 'x'.repeat(400)]));

  await recordAuditEvent(storage, {
    action: ACTIONS.SIGNUP_FAILED,
    actorUsername: `attacker\n${'x'.repeat(200)}`,
    userAgent: 'u'.repeat(1000),
    details: oversizedDetails
  });

  const [event] = await storage.listAuditEvents({ limit: 1 });
  const details = JSON.parse(event.details);
  assert.equal(event.actorUsername.includes('\n'), false);
  assert.equal(event.actorUsername.length, 128);
  assert.equal(event.userAgent.length, 512);
  assert.equal(Object.keys(details).length, 20);
  assert.equal(details.field0.length, 256);
});

test('limits anonymous audit writes per source and resets after the window', () => {
  let now = 1000;
  const limiter = createAuditWriteLimiter({ maxEvents: 2, windowMs: 100, now: () => now });

  assert.equal(limiter.shouldRecord('203.0.113.5'), true);
  assert.equal(limiter.shouldRecord('203.0.113.5'), true);
  assert.equal(limiter.shouldRecord('203.0.113.5'), false);
  assert.equal(limiter.shouldRecord('198.51.100.8'), true);
  now += 100;
  assert.equal(limiter.shouldRecord('203.0.113.5'), true);
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
