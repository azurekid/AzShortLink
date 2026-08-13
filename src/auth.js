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

function createSessionToken(username, sessionSecret) {
  const expiresAt = Date.now() + SESSION_TTL_SECONDS * 1000;
  const payload = `${Buffer.from(username).toString('base64url')}.${expiresAt}`;
  const signature = sign(payload, sessionSecret);
  return `${payload}.${signature}`;
}

function verifySessionToken(token, username, sessionSecret) {
  if (!token) {
    return false;
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    return false;
  }

  const [encodedUsername, expiresAtRaw, signature] = parts;
  const payload = `${encodedUsername}.${expiresAtRaw}`;
  const expectedSignature = sign(payload, sessionSecret);

  if (!timingSafeEqualString(signature, expectedSignature)) {
    return false;
  }

  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) {
    return false;
  }

  const decodedUsername = Buffer.from(encodedUsername, 'base64url').toString('utf8');
  return timingSafeEqualString(decodedUsername, username);
}

async function verifyCredentials(username, password, config) {
  if (!config.dashboardUsername || !config.dashboardPasswordHash) {
    return false;
  }

  if (!timingSafeEqualString(username || '', config.dashboardUsername)) {
    // Still hash to keep response time consistent regardless of username validity.
    await bcrypt.compare(password || '', config.dashboardPasswordHash);
    return false;
  }

  return bcrypt.compare(password || '', config.dashboardPasswordHash);
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

function isDashboardSessionValid(request, config) {
  if (!config.dashboardUsername || !config.dashboardSessionSecret) {
    return false;
  }

  const cookies = parseCookies(request.headers.get('cookie'));
  return verifySessionToken(cookies[SESSION_COOKIE_NAME], config.dashboardUsername, config.dashboardSessionSecret);
}

module.exports = {
  SESSION_COOKIE_NAME,
  parseCookies,
  createSessionToken,
  verifyCredentials,
  buildSessionCookie,
  buildClearedSessionCookie,
  isDashboardSessionValid,
  timingSafeEqualString
};
