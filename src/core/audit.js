'use strict';

const crypto = require('node:crypto');

const AUDIT_RETENTION_DAYS = 30;
const AUDIT_RETENTION_MS = AUDIT_RETENTION_DAYS * 24 * 60 * 60 * 1000;
const AUDIT_SCHEMA_VERSION = 1;
const MAX_DETAIL_KEYS = 20;
let lastAuditTimestampMs = 0;

const ACTIONS = Object.freeze({
  LOGIN_SUCCESS: 'LOGIN_SUCCESS',
  LOGIN_FAILED: 'LOGIN_FAILED',
  LOGOUT: 'LOGOUT',
  LINK_CREATED: 'LINK_CREATED',
  LINK_DELETED: 'LINK_DELETED',
  LINK_DELETE_DENIED: 'LINK_DELETE_DENIED',
  SIGNUP_SUCCESS: 'SIGNUP_SUCCESS',
  SIGNUP_FAILED: 'SIGNUP_FAILED',
  USER_CREATED: 'USER_CREATED',
  USER_DELETED: 'USER_DELETED',
  PASSWORD_CHANGED: 'PASSWORD_CHANGED',
  PASSWORD_RESET_BY_ADMIN: 'PASSWORD_RESET_BY_ADMIN',
  PASSWORD_RESET_SELF_SERVICE: 'PASSWORD_RESET_SELF_SERVICE',
  API_KEY_ROTATED: 'API_KEY_ROTATED',
  INVITE_CREATED: 'INVITE_CREATED',
  INVITE_CREATION_DENIED: 'INVITE_CREATION_DENIED',
  INVITE_REVOKED: 'INVITE_REVOKED',
  INVITE_REDEEMED: 'INVITE_REDEEMED',
  USER_ACCESS_CHANGED: 'USER_ACCESS_CHANGED',
  BRANCH_SUSPENSION_CHANGED: 'BRANCH_SUSPENSION_CHANGED',
  EMAIL_VERIFIED: 'EMAIL_VERIFIED',
  PASSKEY_REGISTERED: 'PASSKEY_REGISTERED',
  PASSKEY_REGISTRATION_FAILED: 'PASSKEY_REGISTRATION_FAILED',
  RATE_LIMITED: 'RATE_LIMITED'
});

function retentionCutoffIso(now = Date.now()) {
  return new Date(now - AUDIT_RETENTION_MS).toISOString();
}

function createAuditWriteLimiter({ maxEvents = 5, windowMs = 15 * 60 * 1000, now = Date.now } = {}) {
  const windows = new Map();
  return {
    shouldRecord(key) {
      const currentTime = now();
      const current = windows.get(key);
      if (!current || currentTime - current.startedAt >= windowMs) {
        windows.set(key, { count: 1, startedAt: currentTime });
        return true;
      }
      if (current.count >= maxEvents) return false;
      current.count += 1;
      return true;
    }
  };
}

function sanitizeString(value, maxLength = 256) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, maxLength);
}

function sanitizeDetailValue(value, depth = 0) {
  if (typeof value === 'string') return sanitizeString(value);
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean' || value === null) return value;
  if (depth >= 2) return sanitizeString(value);
  if (Array.isArray(value)) return value.slice(0, 10).map((item) => sanitizeDetailValue(item, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).slice(0, MAX_DETAIL_KEYS).map(([key, item]) => [
      sanitizeString(key, 64), sanitizeDetailValue(item, depth + 1)
    ]));
  }
  return sanitizeString(value);
}

function getEventCategory(action) {
  if (action === ACTIONS.RATE_LIMITED) return 'security';
  if (action.startsWith('LOGIN_') || action === ACTIONS.LOGOUT || action.startsWith('PASSKEY_') || action.includes('PASSWORD') || action === ACTIONS.API_KEY_ROTATED) return 'authentication';
  if (action.startsWith('USER_') || action.startsWith('SIGNUP_') || action === ACTIONS.BRANCH_SUSPENSION_CHANGED || action === ACTIONS.EMAIL_VERIFIED) return 'identity';
  if (action.startsWith('LINK_')) return 'link';
  if (action.startsWith('INVITE_')) return 'invite';
  return 'application';
}

function normalizeAuditDetails(action, details = {}) {
  const normalized = sanitizeDetailValue(details || {});
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

function formatAuditEvent(event) {
  let details = {};
  try {
    details = typeof event.details === 'string' ? JSON.parse(event.details || '{}') : (event.details || {});
  } catch {
    details = {};
  }

  return {
    schemaVersion: event.schemaVersion || AUDIT_SCHEMA_VERSION,
    eventId: event.eventId || '',
    timestamp: event.timestamp,
    action: event.action,
    category: event.category || 'application',
    outcome: event.outcome || 'success',
    actorId: event.actorId || '',
    actorUsername: event.actorUsername || 'anonymous',
    actorRole: event.actorRole || '',
    channel: event.channel || 'unknown',
    authenticationMethod: event.authenticationMethod || 'unknown',
    sourceIp: event.sourceIp || event.ip || '',
    ip: event.sourceIp || event.ip || '',
    userAgent: event.userAgent || '',
    httpMethod: event.httpMethod || '',
    requestPath: event.requestPath || '',
    source: {
      country: event.sourceCountry || '',
      countryCode: event.sourceCountryCode || '',
      region: event.sourceRegion || '',
      city: event.sourceCity || '',
      latitude: event.sourceLatitude ?? null,
      longitude: event.sourceLongitude ?? null
    },
    details
  };
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
      action: sanitizeString(action, 64),
      category: getEventCategory(action),
      actorId: sanitizeString(actorId, 128),
      actorUsername: sanitizeString(actorUsername, 128),
      actorRole: sanitizeString(actorRole, 32),
      ip: sanitizeString(sourceIp, 64),
      sourceIp: sanitizeString(sourceIp, 64),
      userAgent: sanitizeString(userAgent, 512),
      channel: sanitizeString(channel, 32),
      authenticationMethod: sanitizeString(authenticationMethod, 64),
      httpMethod: sanitizeString(httpMethod, 16),
      requestPath: sanitizeString(requestPath, 512),
      outcome: sanitizeString(outcome, 32),
      sourceCountry: sanitizeString(location.country || '', 128),
      sourceCountryCode: sanitizeString(location.countryCode || '', 2),
      sourceRegion: sanitizeString(location.region || '', 128),
      sourceCity: sanitizeString(location.city || '', 128),
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
  createAuditWriteLimiter,
  formatAuditEvent,
  normalizeAuditDetails,
  sanitizeString,
  retentionCutoffIso,
  recordAuditEvent,
  generateAuditRowKey
};
