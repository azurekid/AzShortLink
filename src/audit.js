'use strict';

const crypto = require('node:crypto');

const AUDIT_RETENTION_DAYS = 30;
const AUDIT_RETENTION_MS = AUDIT_RETENTION_DAYS * 24 * 60 * 60 * 1000;

const ACTIONS = Object.freeze({
  LOGIN_SUCCESS: 'LOGIN_SUCCESS',
  LOGIN_FAILED: 'LOGIN_FAILED',
  LOGOUT: 'LOGOUT',
  LINK_CREATED: 'LINK_CREATED',
  LINK_DELETED: 'LINK_DELETED',
  USER_CREATED: 'USER_CREATED',
  USER_DELETED: 'USER_DELETED',
  PASSWORD_CHANGED: 'PASSWORD_CHANGED',
  API_KEY_ROTATED: 'API_KEY_ROTATED'
});

function retentionCutoffIso(now = Date.now()) {
  return new Date(now - AUDIT_RETENTION_MS).toISOString();
}

// Best-effort: an audit-log failure must never block the user-facing action it describes.
async function recordAuditEvent(storage, { action, actorId = '', actorUsername = 'anonymous', ip = '', details = {} }) {
  if (!storage || typeof storage.appendAuditEvent !== 'function') {
    return;
  }

  try {
    await storage.appendAuditEvent({
      timestamp: new Date().toISOString(),
      action,
      actorId,
      actorUsername,
      ip,
      details: JSON.stringify(details || {})
    });
  } catch (err) {
    console.error('[audit] Failed to record audit event.', action, err);
  }
}

function generateAuditRowKey(timestampMs = Date.now()) {
  // Zero-padded millisecond timestamp keeps entries sortable ascending by rowKey.
  return `${String(timestampMs).padStart(15, '0')}_${crypto.randomBytes(4).toString('hex')}`;
}

module.exports = {
  ACTIONS,
  AUDIT_RETENTION_DAYS,
  retentionCutoffIso,
  recordAuditEvent,
  generateAuditRowKey
};
