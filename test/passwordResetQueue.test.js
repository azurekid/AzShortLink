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