'use strict';

const MAX_HELP_MESSAGES = 12;

function formatTicketNumber(id) {
  const compact = String(id).replaceAll('-', '').slice(0, 12).toUpperCase().padEnd(12, '0');
  return `AZSL-${compact.slice(0, 4)}-${compact.slice(4, 8)}-${compact.slice(8, 12)}`;
}

function parseMessages(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function getHelpMessages(request) {
  const stored = parseMessages(request.messages);
  if (stored.length) return stored;

  const messages = [];
  if (request.message) {
    messages.push({ role: 'user', author: request.username || request.userId || 'User', text: request.message, createdAt: request.createdAt || '' });
  }
  if (request.response) {
    messages.push({ role: 'admin', author: request.respondedBy || 'Administrator', text: request.response, createdAt: request.respondedAt || '' });
  }
  return messages;
}

function appendHelpMessage(request, message) {
  const messages = getHelpMessages(request);
  if (messages.length >= MAX_HELP_MESSAGES) {
    const err = new Error(`A help request can contain at most ${MAX_HELP_MESSAGES} messages.`);
    err.code = 'HELP_THREAD_FULL';
    throw err;
  }
  return [...messages, message];
}

module.exports = { MAX_HELP_MESSAGES, appendHelpMessage, formatTicketNumber, getHelpMessages };