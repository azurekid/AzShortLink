'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { appendHelpMessage, formatTicketNumber, getHelpMessages } = require('../src/services/helpRequests');

test('formats UUIDs as short readable ticket numbers', () => {
  assert.equal(formatTicketNumber('550e8400-e29b-41d4-a716-446655440000'), 'AZSL-550E-8400-E29B');
});

test('synthesizes a conversation for legacy help requests', () => {
  const messages = getHelpMessages({
    username: 'CyberChef',
    message: 'Original question',
    createdAt: '2026-08-16T12:00:00.000Z',
    response: 'Administrator answer',
    respondedBy: 'admin',
    respondedAt: '2026-08-16T12:30:00.000Z'
  });

  assert.deepEqual(messages.map(({ role, author, text }) => ({ role, author, text })), [
    { role: 'user', author: 'CyberChef', text: 'Original question' },
    { role: 'admin', author: 'admin', text: 'Administrator answer' }
  ]);
});

test('appends messages without replacing conversation history', () => {
  const messages = appendHelpMessage({
    messages: [{ role: 'user', author: 'CyberChef', text: 'First', createdAt: '2026-08-16T12:00:00.000Z' }]
  }, { role: 'admin', author: 'admin', text: 'Second', createdAt: '2026-08-16T12:30:00.000Z' });

  assert.equal(messages.length, 2);
  assert.equal(messages[0].text, 'First');
  assert.equal(messages[1].text, 'Second');
});