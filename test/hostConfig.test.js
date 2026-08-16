'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const host = require('../host.json');

test('loads Storage Queue triggers and decodes SDK messages as raw JSON', () => {
  assert.equal(host.extensionBundle.id, 'Microsoft.Azure.Functions.ExtensionBundle');
  assert.match(host.extensionBundle.version, /^\[4\.\*/);
  assert.equal(host.extensions.queues.messageEncoding, 'none');
  assert.equal(host.extensions.queues.maxDequeueCount, 5);
});