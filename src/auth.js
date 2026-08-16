'use strict';

const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');

const SESSION_COOKIE_NAME = 'azsl_session';
const SESSION_TTL_SECONDS = 8 * 60 * 60; // 8 hours

function timingSafeEqualString(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) {
    // Still run a comparison of equal-length buffers so both branches take similar time.
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }

  return crypto.timingSafeEqual(bufA, bufB);
}

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) {
    return cookies;
  }

  for (const part of cookieHeader.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) {
      continue;
    }

    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name) {
      cookies[name] = decodeURIComponent(value);
    }
  }

  return cookies;
}

function sign(payload, sessionSecret) {
  return crypto.createHmac('sha256', sessionSecret).update(payload).digest('base64url');
}

function createSessionToken(user, sessionSecret) {
  const expiresAt = Date.now() + SESSION_TTL_SECONDS * 1000;
  const claims = Buffer.from(
    JSON.stringify({ id: user.id, username: user.username, displayName: user.displayName, role: user.role })
  ).toString('base64url');
  const payload = `${claims}.${expiresAt}`;
  const signature = sign(payload, sessionSecret);
  return `${payload}.${signature}`;
}

function verifySessionToken(token, sessionSecret) {
  if (!token) {
    return false;
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    return false;
  }

  const [encodedClaims, expiresAtRaw, signature] = parts;
  const payload = `${encodedClaims}.${expiresAtRaw}`;
  const expectedSignature = sign(payload, sessionSecret);

  if (!timingSafeEqualString(signature, expectedSignature)) {
    return null;
  }

  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) {
    return null;
  }

  try {
    const identity = JSON.parse(Buffer.from(encodedClaims, 'base64url').toString('utf8'));
    return identity.id && identity.username && identity.role ? identity : null;
  } catch {
    return null;
  }
}

async function verifyCredentials(username, password, storage, fallbackHash) {
  const user = await storage.getUser(username);
  const passwordHash = user ? user.passwordHash : fallbackHash;
  if (!passwordHash || !(await bcrypt.compare(password || '', passwordHash))) {
    return null;
  }

  if (user && (user.status || 'active') !== 'active') {
    return null;
  }

  return user;
}

function buildSessionCookie(token, request) {
  const isHttps = (request.headers.get('x-forwarded-proto') || request.url.split(':')[0]) === 'https';
  const attributes = [
    `${SESSION_COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${SESSION_TTL_SECONDS}`
  ];
  if (isHttps) {
    attributes.push('Secure');
  }

  return attributes.join('; ');
}

function buildClearedSessionCookie(request) {
  const isHttps = (request.headers.get('x-forwarded-proto') || request.url.split(':')[0]) === 'https';
  const attributes = [`${SESSION_COOKIE_NAME}=`, 'Path=/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=0'];
  if (isHttps) {
    attributes.push('Secure');
  }

  return attributes.join('; ');
}

function getSessionIdentity(request, config) {
  if (!config.dashboardSessionSecret) {
    return null;
  }

  const cookies = parseCookies(request.headers.get('cookie'));
  return verifySessionToken(cookies[SESSION_COOKIE_NAME], config.dashboardSessionSecret);
}

function isDashboardSessionValid(request, config) {
  return Boolean(getSessionIdentity(request, config));
}

const API_KEY_PREFIX = 'azsl_';

function generateApiKey() {
  const secret = crypto.randomBytes(32).toString('base64url');
  const key = `${API_KEY_PREFIX}${secret}`;
  return { key, hash: hashApiKey(key), displayPrefix: key.slice(0, 12) };
}

function hashApiKey(key) {
  return crypto.createHash('sha256').update(String(key)).digest('hex');
}

module.exports = {
  SESSION_COOKIE_NAME,
  API_KEY_PREFIX,
  parseCookies,
  createSessionToken,
  verifySessionToken,
  verifyCredentials,
  buildSessionCookie,
  buildClearedSessionCookie,
  getSessionIdentity,
  isDashboardSessionValid,
  generateApiKey,
  hashApiKey,
  timingSafeEqualString
};
