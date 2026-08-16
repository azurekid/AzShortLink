'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPasswordResetQueue } = require('../src/services/passwordResetQueue');

test('returns null when no queue connection is configured', () => {
  assert.equal(createPasswordResetQueue({}), null);
});

test('creates a queue service for local connection strings', () => {
  const queue = createPasswordResetQueue({ storageConnectionString: 'UseDevelopmentStorage=true' });

  assert.equal(typeof queue.enqueue, 'function');
});

test('sends the full submitted email in a raw JSON queue message', async () => {
  let sentMessage = '';
  let createCalls = 0;
  const queue = createPasswordResetQueue({}, {
    client: {
      async createIfNotExists() { createCalls += 1; },
      async sendMessage(message) { sentMessage = message; }
    }
  });

  await queue.enqueue({ username: 'azurekid', email: 'user@example.com' });

  assert.equal(createCalls, 0);
  assert.deepEqual(JSON.parse(sentMessage), { username: 'azurekid', email: 'user@example.com' });
});