'use strict';

const crypto = require('node:crypto');

const AUDIT_RETENTION_DAYS = 30;
const AUDIT_RETENTION_MS = AUDIT_RETENTION_DAYS * 24 * 60 * 60 * 1000;
const AUDIT_SCHEMA_VERSION = 1;
let lastAuditTimestampMs = 0;

const ACTIONS = Object.freeze({
  LOGIN_SUCCESS: 'LOGIN_SUCCESS',
  LOGIN_FAILED: 'LOGIN_FAILED',
  LOGOUT: 'LOGOUT',
  LINK_CREATED: 'LINK_CREATED',
  LINK_DELETED: 'LINK_DELETED',
  USER_CREATED: 'USER_CREATED',
  USER_DELETED: 'USER_DELETED',
  PASSWORD_CHANGED: 'PASSWORD_CHANGED',
  PASSWORD_RESET_BY_ADMIN: 'PASSWORD_RESET_BY_ADMIN',
  API_KEY_ROTATED: 'API_KEY_ROTATED',
  INVITE_CREATED: 'INVITE_CREATED',
  INVITE_REVOKED: 'INVITE_REVOKED',
  INVITE_REDEEMED: 'INVITE_REDEEMED',
  USER_ACCESS_CHANGED: 'USER_ACCESS_CHANGED',
  BRANCH_SUSPENSION_CHANGED: 'BRANCH_SUSPENSION_CHANGED',
  EMAIL_VERIFIED: 'EMAIL_VERIFIED',
  PASSKEY_REGISTERED: 'PASSKEY_REGISTERED'
});

function retentionCutoffIso(now = Date.now()) {
  return new Date(now - AUDIT_RETENTION_MS).toISOString();
}

function getEventCategory(action) {
  if (action.startsWith('LOGIN_') || action === ACTIONS.LOGOUT || action.startsWith('PASSKEY_') || action.includes('PASSWORD') || action === ACTIONS.API_KEY_ROTATED) return 'authentication';
  if (action.startsWith('USER_') || action === ACTIONS.BRANCH_SUSPENSION_CHANGED || action === ACTIONS.EMAIL_VERIFIED) return 'identity';
  if (action.startsWith('LINK_')) return 'link';
  if (action.startsWith('INVITE_')) return 'invite';
  return 'application';
}

function normalizeAuditDetails(action, details = {}) {
  const normalized = { ...(details || {}) };
  const userName = normalized.userName || normalized.targetUsername || normalized.createdUsername || normalized.deletedUsername || normalized.username;
  if (userName) normalized.userName = userName;
  delete normalized.targetUsername;
  delete normalized.createdUsername;
  delete normalized.deletedUsername;
  delete normalized.username;

  if (normalized.viaInvite && !normalized.inviteCode) normalized.inviteCode = normalized.viaInvite;
  delete normalized.viaInvite;
  if (normalized.code) {
    if (action.startsWith('INVITE_') && !normalized.inviteCode) normalized.inviteCode = normalized.code;
    if (action.startsWith('LINK_') && !normalized.linkCode) normalized.linkCode = normalized.code;
    delete normalized.code;
  }
  return normalized;
}

// Best-effort: an audit-log failure must never block the user-facing action it describes.
async function recordAuditEvent(storage, {
  action,
  actorId = '',
  actorUsername = 'anonymous',
  actorRole = '',
  ip = '',
  sourceIp = ip,
  userAgent = '',
  channel = 'unknown',
  authenticationMethod = 'unknown',
  httpMethod = '',
  requestPath = '',
  outcome = 'success',
  location = {},
  details = {}
}) {
  if (!storage || typeof storage.appendAuditEvent !== 'function') {
    return;
  }

  try {
    const timestampMs = Math.max(Date.now(), lastAuditTimestampMs + 1);
    lastAuditTimestampMs = timestampMs;
    await storage.appendAuditEvent({
      schemaVersion: AUDIT_SCHEMA_VERSION,
      eventId: crypto.randomUUID(),
      timestamp: new Date(timestampMs).toISOString(),
      action,
      category: getEventCategory(action),
      actorId,
      actorUsername,
      actorRole,
      ip: sourceIp,
      sourceIp,
      userAgent,
      channel,
      authenticationMethod,
      httpMethod,
      requestPath,
      outcome,
      sourceCountry: location.country || '',
      sourceCountryCode: location.countryCode || '',
      sourceRegion: location.region || '',
      sourceCity: location.city || '',
      sourceLatitude: Number.isFinite(location.latitude) ? location.latitude : null,
      sourceLongitude: Number.isFinite(location.longitude) ? location.longitude : null,
      details: JSON.stringify(normalizeAuditDetails(action, details))
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
  AUDIT_SCHEMA_VERSION,
  AUDIT_RETENTION_DAYS,
  normalizeAuditDetails,
  retentionCutoffIso,
  recordAuditEvent,
  generateAuditRowKey
};
