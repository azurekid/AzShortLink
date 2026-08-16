'use strict';

const crypto = require('node:crypto');
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function hashIdentityValue(value, secret) {
  return crypto.createHmac('sha256', secret).update(String(value)).digest('hex');
}

function maskEmail(email) {
  const [local, domain] = normalizeEmail(email).split('@');
  if (!local || !domain) return '';
  return `${local.slice(0, 2)}${'*'.repeat(Math.max(local.length - 2, 1))}@${domain}`;
}

function createVerificationToken({ userId, emailHash }, secret, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ userId, emailHash, expiresAt: now + 24 * 60 * 60 * 1000 })).toString('base64url');
  const signature = hashIdentityValue(payload, secret);
  return `${payload}.${signature}`;
}

function verifyVerificationToken(token, secret, now = Date.now()) {
  const [payload, signature] = String(token || '').split('.');
  if (!payload || !signature) return null;
  const expected = hashIdentityValue(payload, secret);
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return claims.userId && claims.emailHash && claims.expiresAt >= now ? claims : null;
  } catch {
    return null;
  }
}

function buildRiskSignals(request, secret) {
  const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
  const userAgent = request.headers.get('user-agent') || 'unknown';
  const language = request.headers.get('accept-language') || '';
  return {
    signupIpHash: hashIdentityValue(`ip:${ip}`, secret),
    signupDeviceHash: hashIdentityValue(`device:${userAgent}|${language}`, secret)
  };
}

module.exports = {
  EMAIL_PATTERN,
  normalizeEmail,
  hashIdentityValue,
  maskEmail,
  createVerificationToken,
  verifyVerificationToken,
  buildRiskSignals
};