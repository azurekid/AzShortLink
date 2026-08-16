'use strict';

const { app } = require('@azure/functions');
const bcrypt = require('bcryptjs');
const path = require('node:path');
const { readFile } = require('node:fs/promises');
const { getConfig } = require('./src/config');
const { createStorage } = require('./src/storage');
const { ShortLinkService } = require('./src/service/shortLinkService');
const { renderUserDashboard } = require('./src/dashboard/user');
const { renderAdminDashboard } = require('./src/dashboard/admin');
const { renderLoginPage } = require('./src/loginPage');
const { renderSignupPage } = require('./src/signupPage');
const { renderNotFoundPage } = require('./src/notFoundPage');
const {
  verifyCredentials,
  createSessionToken,
  buildSessionCookie,
  buildClearedSessionCookie,
  getSessionIdentity,
  generateApiKey,
  hashApiKey,
  API_KEY_PREFIX,
  timingSafeEqualString
} = require('./src/auth');
const { ACTIONS, AUDIT_RETENTION_DAYS, recordAuditEvent } = require('./src/audit');
const { createRateLimiter } = require('./src/rateLimiter');
const { buildOpenApiSpec } = require('./src/openApi');
const { renderApiDocsPage } = require('./src/apiDocsPage');
const { createQrCodePng } = require('./src/qrCode');
const { lookupGeoLocation } = require('./src/geoLocation');
const { DEFAULT_INVITE_POLICY, evaluateInviteEligibility, buildInviteAncestry } = require('./src/invitePolicy');
const {
  EMAIL_PATTERN,
  normalizeEmail,
  hashIdentityValue,
  maskEmail,
  createVerificationToken,
  verifyVerificationToken,
  buildRiskSignals
} = require('./src/identity');
const { sendVerificationEmail } = require('./src/email');
const {
  signChallengeState,
  verifyChallengeState,
  registrationOptions,
  verifyRegistration,
  authenticationOptions,
  verifyAuthentication
} = require('./src/passkeys');

const config = getConfig();
const apiRateLimiter = createRateLimiter({
  maxRequests: Number.parseInt(process.env.API_RATE_LIMIT_MAX_REQUESTS || '60', 10),
  windowMs: Number.parseInt(process.env.API_RATE_LIMIT_WINDOW_MS || '60000', 10)
});

function rateLimitedHandler(handler) {
  return async (request, context) => {
    const result = apiRateLimiter.check(getClientIp(request));
    if (!result.allowed) {
      return {
        status: 429,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'retry-after': String(result.retryAfterSeconds)
        },
        jsonBody: { error: 'Too many requests. Try again later.' }
      };
    }

    return handler(request, context);
  };
}

function registerHttp(name, options) {
  const handler = options.route.startsWith('api/') ? rateLimitedHandler(options.handler) : options.handler;
  return app.http(name, { ...options, handler });
}
const storagePromise = createStorage(config);
const servicePromise = storagePromise.then((storage) => new ShortLinkService(storage, { baseUrl: config.baseUrl }));
// Prevent an unhandled rejection from crashing the worker at cold start; real errors still
// surface normally wherever these promises are awaited inside a request handler.
storagePromise.catch(() => {});
servicePromise.catch(() => {});
const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'content-security-policy': [
    "default-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com https://unpkg.com",
    "font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com",
    "script-src 'self' 'unsafe-inline' https://unpkg.com",
    "img-src 'self' data: https://azurehacking.com https://blackcatwebshop.z13.web.core.windows.net https://tile.openstreetmap.org",
    "connect-src 'self'"
  ].join('; ')
};

const API_DOCS_SECURITY_HEADERS = {
  ...SECURITY_HEADERS,
  'content-security-policy': [
    "default-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com https://unpkg.com",
    "font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com",
    "script-src 'self' 'unsafe-inline' https://unpkg.com",
    "img-src 'self' data: https://azurehacking.com https://blackcatwebshop.z13.web.core.windows.net",
    "connect-src 'self'"
  ].join('; ')
};

function configurationErrorResponse() {
  console.error('[api] SHORTLINK_API_KEY is not configured; restart the Function App after setting it.');
  return {
    status: 503,
    jsonBody: {
      error: 'Service temporarily unavailable.'
    }
  };
}

function getApiKeyFromRequest(request) {
  const authHeader = request.headers.get('authorization') || '';
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7).trim();
  }

  return (request.headers.get('x-api-key') || '').trim();
}

function getDeploymentApiIdentity(request) {
  if (config.apiKey && timingSafeEqualString(getApiKeyFromRequest(request), config.apiKey)) {
    return {
      id: config.dashboardUsername.trim(),
      username: config.dashboardUsername.trim(),
      displayName: config.dashboardUsername.trim(),
      role: 'admin'
    };
  }

  return null;
}

async function resolveSessionIdentity(request) {
  const sessionIdentity = getSessionIdentity(request, config);
  if (!sessionIdentity) return null;

  try {
    const storage = await storagePromise;
    const user = await storage.getUser(sessionIdentity.id);
    return user && (user.status || 'active') === 'active' && !user.branchSuspended
      ? { id: user.id, username: user.username, displayName: user.displayName, role: user.role }
      : null;
  } catch {
    return null;
  }
}

// Personal keys are looked up by hash, so this needs storage and is async.
async function resolveIdentity(request) {
  const sessionIdentity = await resolveSessionIdentity(request);
  if (sessionIdentity) return sessionIdentity;

  const deploymentIdentity = getDeploymentApiIdentity(request);
  if (deploymentIdentity) return deploymentIdentity;

  const presented = getApiKeyFromRequest(request);
  if (!presented.startsWith(API_KEY_PREFIX)) {
    return null;
  }

  try {
    const storage = await storagePromise;
    const user = await storage.getUserByApiKeyHash(hashApiKey(presented));
    if (!user || (user.status || 'active') !== 'active' || user.branchSuspended) {
      return null;
    }

    return { id: user.id, username: user.username, displayName: user.displayName, role: user.role };
  } catch {
    return null;
  }
}

function unauthorizedResponse() {
  return {
    status: 401,
    jsonBody: {
      error: 'Unauthorized'
    }
  };
}

function isStorageUnavailableError(err) {
  return err && err.code === 'STORAGE_UNAVAILABLE';
}

function unavailableStorageResponse(err) {
  return {
    status: 503,
    jsonBody: {
      error: err.message
    }
  };
}

registerHttp('openApiDocument', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'openapi.json',
  handler: async (request) => {
    const identity = await resolveSessionIdentity(request);
    return {
      status: 200,
      headers: {
        'content-type': 'application/vnd.oai.openapi+json;version=3.0; charset=utf-8',
        'cache-control': 'private, no-store',
        vary: 'Cookie'
      },
      jsonBody: buildOpenApiSpec(config.baseUrl, { includeAdmin: identity?.role === 'admin' })
    };
  }
});

registerHttp('apiDocs', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'api',
  handler: async () => ({
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=300',
      ...API_DOCS_SECURITY_HEADERS
    },
    body: renderApiDocsPage()
  })
});

registerHttp('shortenUrl', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'api/shorten',
  handler: async (request) => {
    const identity = await resolveIdentity(request);
    if (!identity) {
      return unauthorizedResponse();
    }

    const service = await servicePromise;
    let payload;

    try {
      payload = await request.json();
    } catch {
      return {
        status: 400,
        jsonBody: {
          error: 'Request body must be valid JSON.'
        }
      };
    }

    try {
      const result = await service.createShortLink(payload, identity.id);
      const storage = await storagePromise;
      await recordAuditEvent(storage, {
        action: ACTIONS.LINK_CREATED,
        actorId: identity.id,
        actorUsername: identity.username,
        ip: getClientIp(request),
        details: { code: result.code, targetUrl: result.targetUrl }
      });
      return {
        status: 201,
        jsonBody: result
      };
    } catch (err) {
      if (err.code === 'ALIAS_EXISTS') {
        return { status: 409, jsonBody: { error: 'The provided unique value already exists.' } };
      }
      if (err.code === 'INVALID_URL' || err.code === 'INVALID_ALIAS') {
        return { status: 400, jsonBody: { error: err.message } };
      }
      if (isStorageUnavailableError(err)) {
        return unavailableStorageResponse(err);
      }

      return { status: 500, jsonBody: { error: 'Unable to create short URL.' } };
    }
  }
});

registerHttp('root', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: '',
  handler: async () => {
    return {
      status: 302,
      headers: {
        location: '/dashboard/login',
        'cache-control': 'no-store'
      }
    };
  }
});

registerHttp('dashboard', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'dashboard',
  handler: async (request) => {
    if (!dashboardAuthConfigured()) {
      return dashboardConfigErrorResponse();
    }

    const identity = await resolveSessionIdentity(request);
    if (!identity) {
      return {
        status: 302,
        headers: { location: '/dashboard/login', 'cache-control': 'no-store' }
      };
    }

    const renderDashboard = identity && identity.role === 'admin' ? renderAdminDashboard : renderUserDashboard;

    return {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        ...SECURITY_HEADERS
      },
      body: renderDashboard(config.baseUrl, { user: identity })
    };
  }
});

registerHttp('redirectUrl', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: '{code}',
  handler: async (request) => {
    const service = await servicePromise;
    const code = request.params.code;
    let result;

    try {
      result = await service.resolveShortLink(code, {
        userAgent: request.headers.get('user-agent'),
        referrer: request.headers.get('referer') || request.headers.get('referrer'),
        location: lookupGeoLocation(getClientIp(request))
      });
    } catch (err) {
      if (isStorageUnavailableError(err)) {
        return unavailableStorageResponse(err);
      }

      throw err;
    }

    if (!result) {
      try {
        const storage = await storagePromise;
        const invite = await storage.getInvite(code);
        if (invite && invite.redeemed) {
          return {
            status: 410,
            headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...SECURITY_HEADERS },
            body: renderSignupPage({ error: 'This invite link has already been used.' })
          };
        }
      } catch (err) {
        if (isStorageUnavailableError(err)) {
          return unavailableStorageResponse(err);
        }

        throw err;
      }

      return {
        status: 404,
        headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...SECURITY_HEADERS },
        body: renderNotFoundPage()
      };
    }

    return {
      status: 302,
      headers: {
        location: result.targetUrl,
        'cache-control': 'no-store'
      }
    };
  }
});

registerHttp('getStats', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'api/stats/{code?}',
  handler: async (request) => {
    const identity = await resolveIdentity(request);
    if (!identity) {
      return unauthorizedResponse();
    }

    const service = await servicePromise;
    const code = request.params.code;
    let links;

    try {
      links = await service.getStats(code, resolveOwnerScope(request, identity));
    } catch (err) {
      if (isStorageUnavailableError(err)) {
        return unavailableStorageResponse(err);
      }

      throw err;
    }

    return {
      status: 200,
      jsonBody: {
        baseUrl: config.baseUrl,
        total: links.length,
        links
      }
    };
  }
});

// Admins see every profile's links unless they explicitly ask for their own.
function resolveOwnerScope(request, identity) {
  if (identity.role !== 'admin') {
    return identity.id;
  }

  return new URL(request.url).searchParams.get('scope') === 'mine' ? identity.id : '';
}

registerHttp('deleteLink', {
  methods: ['DELETE'],
  authLevel: 'anonymous',
  route: 'api/links/{code}',
  handler: async (request) => {
    const identity = await resolveIdentity(request);
    if (!identity) {
      return unauthorizedResponse();
    }

    const service = await servicePromise;

    try {
      const deleted = await service.deleteShortLink(
        request.params.code,
        identity.role === 'admin' ? '' : identity.id
      );
      if (!deleted) {
        return { status: 404, jsonBody: { error: 'Short URL not found.' } };
      }

      const storage = await storagePromise;
      await recordAuditEvent(storage, {
        action: ACTIONS.LINK_DELETED,
        actorId: identity.id,
        actorUsername: identity.username,
        ip: getClientIp(request),
        details: { code: request.params.code, asAdmin: identity.role === 'admin' }
      });

      return { status: 200, jsonBody: { deleted: true, code: request.params.code } };
    } catch (err) {
      if (err.code === 'FORBIDDEN') {
        return { status: 403, jsonBody: { error: err.message } };
      }
      if (isStorageUnavailableError(err)) {
        return unavailableStorageResponse(err);
      }

      return { status: 500, jsonBody: { error: 'Unable to delete short URL.' } };
    }
  }
});

registerHttp('downloadLinkQrCode', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'api/links/{code}/qr',
  handler: async (request) => {
    const identity = await resolveIdentity(request);
    if (!identity) {
      return unauthorizedResponse();
    }

    const code = decodeURIComponent(request.params.code || '').trim();
    const service = await servicePromise;

    try {
      const links = await service.getStats(code, identity.role === 'admin' ? '' : identity.id);
      if (!links.length) {
        return { status: 404, jsonBody: { error: 'Short URL not found.' } };
      }

      return {
        status: 200,
        headers: {
          'content-type': 'image/png',
          'content-disposition': `attachment; filename="azshortlink-${code}-qr.png"`,
          'cache-control': 'private, no-store'
        },
        body: await createQrCodePng(`${config.baseUrl}/${code}`)
      };
    } catch (err) {
      if (isStorageUnavailableError(err)) {
        return unavailableStorageResponse(err);
      }

      return { status: 500, jsonBody: { error: 'Unable to generate QR code.' } };
    }
  }
});

registerHttp('getAnalytics', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'api/analytics',
  handler: async (request) => {
    const identity = await resolveIdentity(request);
    if (!identity) {
      return unauthorizedResponse();
    }

    const service = await servicePromise;

    try {
      const analytics = await service.getAnalytics(resolveOwnerScope(request, identity), request.query.get('code') || '');
      return { status: 200, jsonBody: { baseUrl: config.baseUrl, scope: identity.role === 'admin' ? 'all' : 'mine', ...analytics } };
    } catch (err) {
      if (err.code === 'LINK_NOT_FOUND') {
        return { status: 404, jsonBody: { error: err.message } };
      }
      if (isStorageUnavailableError(err)) {
        return unavailableStorageResponse(err);
      }

      throw err;
    }
  }
});

registerHttp('listUsers', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'api/users',
  handler: async (request) => {
    const identity = await resolveIdentity(request);
    if (!identity || identity.role !== 'admin') {
      return unauthorizedResponse();
    }

    try {
      const storage = await storagePromise;
      const [users, links] = await Promise.all([storage.listUsers(), storage.listLinks(1000, '')]);
      const linkCounts = links.reduce((acc, link) => {
        acc[link.ownerId] = (acc[link.ownerId] || 0) + 1;
        return acc;
      }, {});

      return {
        status: 200,
        jsonBody: {
          total: users.length,
          users: users.map((user) => ({ ...user, linkCount: linkCounts[user.id] || 0 }))
        }
      };
    } catch (err) {
      if (isStorageUnavailableError(err)) {
        return unavailableStorageResponse(err);
      }

      throw err;
    }
  }
});

registerHttp('changePassword', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'api/profile/password',
  handler: async (request) => {
    const identity = await resolveSessionIdentity(request);
    if (!identity) {
      return unauthorizedResponse();
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return { status: 400, jsonBody: { error: 'Request body must be valid JSON.' } };
    }

    const currentPassword = typeof payload.currentPassword === 'string' ? payload.currentPassword : '';
    const newPassword = typeof payload.newPassword === 'string' ? payload.newPassword : '';
    if (newPassword.length < 12) {
      return { status: 400, jsonBody: { error: 'New password must be at least 12 characters.' } };
    }

    try {
      const storage = await storagePromise;
      const user = await verifyCredentials(identity.username, currentPassword, storage, config.dashboardPasswordHash);
      if (!user) {
        return { status: 401, jsonBody: { error: 'Current password is incorrect.' } };
      }

      await storage.updateUserPassword(identity.id, await bcrypt.hash(newPassword, 12));
      await recordAuditEvent(storage, {
        action: ACTIONS.PASSWORD_CHANGED,
        actorId: identity.id,
        actorUsername: identity.username,
        ip: getClientIp(request)
      });
      return {
        status: 200,
        headers: { 'set-cookie': buildClearedSessionCookie(request) },
        jsonBody: { updated: true, message: 'Password updated. Please sign in again.' }
      };
    } catch (err) {
      if (isStorageUnavailableError(err)) {
        return unavailableStorageResponse(err);
      }

      return { status: 500, jsonBody: { error: 'Unable to update password.' } };
    }
  }
});

function dashboardAuthConfigured() {
  return Boolean(config.dashboardUsername && config.dashboardPasswordHash && config.dashboardSessionSecret);
}

function dashboardConfigErrorResponse() {
  console.error('[dashboard] Login is not configured: set DASHBOARD_USERNAME and DASHBOARD_PASSWORD_HASH app settings.');
  return {
    status: 503,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
    body: 'Service temporarily unavailable.'
  };
}

// Best-effort brute-force throttle per client IP (resets on cold start; not a substitute for a WAF).
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000;

function getClientIp(request) {
  return request.headers.get('x-azure-clientip') || (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
}

// Separate trackers per endpoint so guessing invite codes can't lock a shared account out of
// login, and vice versa; each still shares the same cap/window shape.
function createAttemptThrottle(maxAttempts = LOGIN_MAX_ATTEMPTS, lockoutMs = LOGIN_LOCKOUT_MS) {
  const attempts = new Map();

  return {
    isLockedOut(ip) {
      const entry = attempts.get(ip);
      if (!entry) {
        return false;
      }

      if (entry.count < maxAttempts) {
        return false;
      }

      if (Date.now() - entry.firstAttemptAt > lockoutMs) {
        attempts.delete(ip);
        return false;
      }

      return true;
    },
    recordFailedAttempt(ip) {
      const entry = attempts.get(ip);
      if (!entry || Date.now() - entry.firstAttemptAt > lockoutMs) {
        attempts.set(ip, { count: 1, firstAttemptAt: Date.now() });
        return;
      }

      entry.count += 1;
    },
    clearAttempts(ip) {
      attempts.delete(ip);
    }
  };
}

const loginThrottle = createAttemptThrottle();
// Invite codes are bearer tokens for account creation, so guessing them is throttled too.
const signupThrottle = createAttemptThrottle();

registerHttp('dashboardLoginPage', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'dashboard/login',
  handler: async (request) => {
    if (!dashboardAuthConfigured()) {
      return dashboardConfigErrorResponse();
    }

    if (await resolveSessionIdentity(request)) {
      return { status: 302, headers: { location: '/dashboard', 'cache-control': 'no-store' } };
    }

    return {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...SECURITY_HEADERS },
      body: renderLoginPage()
    };
  }
});

registerHttp('passkeyAuthenticationOptions', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'dashboard/passkeys/options',
  handler: async () => {
    const options = await authenticationOptions(config);
    return { status: 200, jsonBody: { options, state: signChallengeState({ purpose: 'authentication', challenge: options.challenge }, config.identityHashSecret) } };
  }
});

registerHttp('passkeyAuthenticationVerify', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'dashboard/passkeys/verify',
  handler: async (request) => {
    const payload = await request.json().catch(() => ({}));
    const state = verifyChallengeState(payload.state, config.identityHashSecret, 'authentication');
    if (!state || !payload.response || !payload.response.id) return { status: 400, jsonBody: { error: 'Invalid or expired passkey request.' } };
    const storage = await storagePromise;
    const credential = await storage.getPasskey(payload.response.id);
    if (!credential) return unauthorizedResponse();
    const user = await storage.getUser(credential.userId);
    if (!user || (user.status || 'active') !== 'active') return unauthorizedResponse();
    try {
      const result = await verifyAuthentication(config, payload.response, state.challenge, credential);
      if (!result.verified) return unauthorizedResponse();
      await storage.updatePasskeyCounter(credential.id, result.authenticationInfo.newCounter);
      const token = createSessionToken(user, config.dashboardSessionSecret);
      return { status: 200, headers: { 'set-cookie': buildSessionCookie(token, request) }, jsonBody: { authenticated: true } };
    } catch {
      return unauthorizedResponse();
    }
  }
});

registerHttp('dashboardLoginSubmit', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'dashboard/login',
  handler: async (request) => {
    if (!dashboardAuthConfigured()) {
      return dashboardConfigErrorResponse();
    }

    const ip = getClientIp(request);
    if (loginThrottle.isLockedOut(ip)) {
      return {
        status: 429,
        headers: { 'content-type': 'text/html; charset=utf-8', ...SECURITY_HEADERS },
        body: renderLoginPage({ error: 'Too many failed attempts. Try again later.' })
      };
    }

    const contentType = request.headers.get('content-type') || '';
    let username = '';
    let password = '';

    try {
      if (contentType.includes('application/json')) {
        const body = await request.json();
        username = body.username || '';
        password = body.password || '';
      } else {
        const form = new URLSearchParams(await request.text());
        username = form.get('username') || '';
        password = form.get('password') || '';
      }
    } catch {
      return {
        status: 400,
        headers: { 'content-type': 'text/html; charset=utf-8', ...SECURITY_HEADERS },
        body: renderLoginPage({ error: 'Invalid request body.' })
      };
    }

    const storage = await storagePromise;
    const user = await verifyCredentials(username, password, storage, config.dashboardPasswordHash);
    if (!user) {
      loginThrottle.recordFailedAttempt(ip);
      await recordAuditEvent(storage, {
        action: ACTIONS.LOGIN_FAILED,
        actorUsername: username || 'unknown',
        ip
      });
      return {
        status: 401,
        headers: { 'content-type': 'text/html; charset=utf-8', ...SECURITY_HEADERS },
        body: renderLoginPage({ error: 'Invalid username or password.' })
      };
    }

    loginThrottle.clearAttempts(ip);
    await recordAuditEvent(storage, {
      action: ACTIONS.LOGIN_SUCCESS,
      actorId: user.id,
      actorUsername: user.username,
      ip
    });
    const token = createSessionToken(user, config.dashboardSessionSecret);
    return {
      status: 302,
      headers: {
        location: '/dashboard',
        'cache-control': 'no-store',
        'set-cookie': buildSessionCookie(token, request)
      }
    };
  }
});

registerHttp('dashboardLogout', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'dashboard/logout',
  handler: async (request) => {
    const identity = getSessionIdentity(request, config);
    if (identity) {
      const storage = await storagePromise;
      await recordAuditEvent(storage, {
        action: ACTIONS.LOGOUT,
        actorId: identity.id,
        actorUsername: identity.username,
        ip: getClientIp(request)
      });
    }

    return {
      status: 302,
      headers: {
        location: '/dashboard/login',
        'cache-control': 'no-store',
        'set-cookie': buildClearedSessionCookie(request)
      }
    };
  }
});

registerHttp('dashboardSignupPage', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'dashboard/signup',
  handler: async (request) => {
    const inviteCode = new URL(request.url).searchParams.get('invite') || '';
    const ip = getClientIp(request);
    if (signupThrottle.isLockedOut(ip)) {
      return {
        status: 429,
        headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...SECURITY_HEADERS },
        body: renderSignupPage({ error: 'Too many attempts. Try again later.' })
      };
    }

    try {
      const storage = await storagePromise;
      const invite = inviteCode ? await storage.getInvite(inviteCode) : null;
      if (!invite || invite.redeemed) {
        // Counts toward the same throttle as POST failures - this GET is the main way to
        // brute-force/enumerate invite codes, since it directly reveals valid vs. invalid.
        signupThrottle.recordFailedAttempt(ip);
        return {
          status: invite ? 410 : 404,
          headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...SECURITY_HEADERS },
          body: renderSignupPage({
            error: invite ? 'This invite link has already been used.' : 'This invite link is invalid or has expired.'
          })
        };
      }

      return {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...SECURITY_HEADERS },
        body: renderSignupPage({ invite: inviteCode })
      };
    } catch (err) {
      if (isStorageUnavailableError(err)) {
        return unavailableStorageResponse(err);
      }
      throw err;
    }
  }
});

registerHttp('dashboardSignupSubmit', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'dashboard/signup',
  handler: async (request) => {
    const ip = getClientIp(request);
    if (signupThrottle.isLockedOut(ip)) {
      return {
        status: 429,
        headers: { 'content-type': 'text/html; charset=utf-8', ...SECURITY_HEADERS },
        body: renderSignupPage({ error: 'Too many attempts. Try again later.' })
      };
    }

    const contentType = request.headers.get('content-type') || '';
    let inviteCode = '';
    let username = '';
    let displayName = '';
    let email = '';
    let password = '';

    try {
      if (contentType.includes('application/json')) {
        const body = await request.json();
        inviteCode = body.invite || '';
        username = body.username || '';
        displayName = body.displayName || '';
        email = body.email || '';
        password = body.password || '';
      } else {
        const form = new URLSearchParams(await request.text());
        inviteCode = form.get('invite') || '';
        username = form.get('username') || '';
        displayName = form.get('displayName') || '';
        email = form.get('email') || '';
        password = form.get('password') || '';
      }
    } catch {
      return {
        status: 400,
        headers: { 'content-type': 'text/html; charset=utf-8', ...SECURITY_HEADERS },
        body: renderSignupPage({ invite: inviteCode, error: 'Invalid request body.' })
      };
    }

    inviteCode = String(inviteCode).trim();
    username = String(username).trim();
    displayName = (String(displayName).trim() || username);
    email = normalizeEmail(email);

    const storage = await storagePromise;
    let invite;
    try {
      invite = await storage.getInvite(inviteCode);
    } catch (err) {
      if (isStorageUnavailableError(err)) {
        return unavailableStorageResponse(err);
      }
      throw err;
    }

    if (!invite || invite.redeemed) {
      signupThrottle.recordFailedAttempt(ip);
      return {
        status: invite ? 410 : 404,
        headers: { 'content-type': 'text/html; charset=utf-8', ...SECURITY_HEADERS },
        body: renderSignupPage({
          error: invite ? 'This invite link has already been used.' : 'This invite link is invalid or has expired.'
        })
      };
    }

    if (!/^[A-Za-z0-9._-]{3,64}$/.test(username) || !displayName || !EMAIL_PATTERN.test(email) || password.length < 12) {
      signupThrottle.recordFailedAttempt(ip);
      return {
        status: 400,
        headers: { 'content-type': 'text/html; charset=utf-8', ...SECURITY_HEADERS },
        body: renderSignupPage({
          invite: inviteCode,
          error: 'Enter a valid email; username must be 3-64 safe characters and password at least 12 characters.'
        })
      };
    }

    try {
      const createdAt = new Date().toISOString();
      const emailHash = hashIdentityValue(email, config.identityHashSecret);
      if (await storage.getUserByEmailHash(emailHash)) {
        signupThrottle.recordFailedAttempt(ip);
        return {
          status: 409,
          headers: { 'content-type': 'text/html; charset=utf-8', ...SECURITY_HEADERS },
          body: renderSignupPage({ invite: inviteCode, error: 'That email address is already registered.' })
        };
      }

      const sponsor = await storage.getUser(invite.createdBy);
      if (!sponsor || sponsor.status === 'suspended' || sponsor.branchSuspended) {
        return {
          status: 403,
          headers: { 'content-type': 'text/html; charset=utf-8', ...SECURITY_HEADERS },
          body: renderSignupPage({ error: 'This invitation branch is unavailable.' })
        };
      }

      const ancestry = buildInviteAncestry(sponsor);
      if (ancestry.inviteDepth > DEFAULT_INVITE_POLICY.maximumDepth) {
        return {
          status: 403,
          headers: { 'content-type': 'text/html; charset=utf-8', ...SECURITY_HEADERS },
          body: renderSignupPage({ error: 'This invitation chain has reached its maximum depth.' })
        };
      }

      const riskSignals = buildRiskSignals(request, config.identityHashSecret);
      const relatedProfiles = await storage.findUsersByRiskSignal(riskSignals);
      const riskFlags = [];
      if (relatedProfiles.some((profile) => profile.signupIpHash === riskSignals.signupIpHash)) riskFlags.push('SHARED_SIGNUP_IP');
      if (relatedProfiles.some((profile) => profile.signupDeviceHash === riskSignals.signupDeviceHash)) riskFlags.push('SHARED_DEVICE_SIGNAL');
      const user = await storage.createUser({
        username,
        displayName,
        passwordHash: await bcrypt.hash(password, 12),
        role: 'user',
        createdAt,
        status: 'pending_email',
        emailHash,
        emailMasked: maskEmail(email),
        ...ancestry,
        ...riskSignals,
        riskFlags
      });

      const verificationToken = createVerificationToken({ userId: user.id, emailHash }, config.identityHashSecret);
      try {
        await sendVerificationEmail(config, {
          recipient: email,
          displayName,
          verificationUrl: `${config.baseUrl}/dashboard/verify-email?token=${encodeURIComponent(verificationToken)}`
        });
      } catch (err) {
        await storage.deleteUser(user.id);
        throw err;
      }

      const redeemed = await storage.redeemInvite(inviteCode, user.id, createdAt);
      if (!redeemed) {
        // Lost a race with another signup using the same invite; undo the just-created account.
        await storage.deleteUser(user.id);
        return {
          status: 409,
          headers: { 'content-type': 'text/html; charset=utf-8', ...SECURITY_HEADERS },
          body: renderSignupPage({ error: 'This invite link has already been used.' })
        };
      }

      // The invite code doubles as a real shortlink code; deleting it here means the URL
      // itself stops resolving once redeemed, instead of redirecting forever to a dead end.
      await storage.deleteLink(inviteCode);
      signupThrottle.clearAttempts(ip);

      await recordAuditEvent(storage, {
        action: ACTIONS.USER_CREATED,
        actorId: user.id,
        actorUsername: user.username,
        ip: getClientIp(request),
        details: { createdUsername: username, viaInvite: inviteCode }
      });
      await recordAuditEvent(storage, {
        action: ACTIONS.INVITE_REDEEMED,
        actorId: user.id,
        actorUsername: user.username,
        ip: getClientIp(request),
        details: { code: inviteCode }
      });

      return {
        status: 200,
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
          ...SECURITY_HEADERS
        },
        body: renderSignupPage({ message: `Check ${maskEmail(email)} for a verification link.` })
      };
    } catch (err) {
      if (err.code === 'USER_EXISTS') {
        signupThrottle.recordFailedAttempt(ip);
        return {
          status: 409,
          headers: { 'content-type': 'text/html; charset=utf-8', ...SECURITY_HEADERS },
          body: renderSignupPage({ invite: inviteCode, error: 'That username is already taken.' })
        };
      }
      if (isStorageUnavailableError(err)) {
        return unavailableStorageResponse(err);
      }
      return {
        status: 500,
        headers: { 'content-type': 'text/html; charset=utf-8', ...SECURITY_HEADERS },
        body: renderSignupPage({ invite: inviteCode, error: 'Unable to create your account.' })
      };
    }
  }
});

registerHttp('dashboardVerifyEmail', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'dashboard/verify-email',
  handler: async (request) => {
    const token = new URL(request.url).searchParams.get('token') || '';
    const claims = verifyVerificationToken(token, config.identityHashSecret);
    if (!claims) {
      return { status: 400, headers: { 'content-type': 'text/html; charset=utf-8', ...SECURITY_HEADERS }, body: renderSignupPage({ error: 'This verification link is invalid or expired.' }) };
    }
    const storage = await storagePromise;
    const user = await storage.getUser(claims.userId);
    if (!user || user.emailHash !== claims.emailHash) {
      return { status: 400, headers: { 'content-type': 'text/html; charset=utf-8', ...SECURITY_HEADERS }, body: renderSignupPage({ error: 'This verification link is invalid.' }) };
    }
    const status = user.riskFlags && user.riskFlags.length ? 'pending_approval' : 'active';
    await storage.updateUserIdentity(user.id, { emailVerifiedAt: new Date().toISOString(), status });
    await recordAuditEvent(storage, { action: ACTIONS.EMAIL_VERIFIED, actorId: user.id, actorUsername: user.username, ip: getClientIp(request), details: { status } });
    return {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...SECURITY_HEADERS },
      body: renderSignupPage({ message: status === 'active' ? 'Email verified. You can now sign in.' : 'Email verified. An administrator must approve this account.' })
    };
  }
});

registerHttp('createUser', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'api/users',
  handler: async (request) => {
    const identity = await resolveIdentity(request);
    if (!identity || identity.role !== 'admin') {
      return unauthorizedResponse();
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return { status: 400, jsonBody: { error: 'Request body must be valid JSON.' } };
    }

    const username = typeof payload.username === 'string' ? payload.username.trim() : '';
    const displayName = typeof payload.displayName === 'string' ? payload.displayName.trim() : username;
    const role = payload.role === 'admin' ? 'admin' : 'user';
    const password = typeof payload.password === 'string' ? payload.password : '';
    if (!/^[A-Za-z0-9._-]{3,64}$/.test(username) || !displayName || password.length < 12) {
      return {
        status: 400,
        jsonBody: { error: 'Username must be 3-64 safe characters and password must be at least 12 characters.' }
      };
    }

    try {
      const storage = await storagePromise;
      const user = await storage.createUser({
        username,
        displayName,
        passwordHash: await bcrypt.hash(password, 12),
        role,
        createdAt: new Date().toISOString(),
        status: 'active',
        emailVerifiedAt: role === 'admin' ? new Date().toISOString() : '',
        rootSponsorUserId: identity.id,
        invitedByUserId: identity.id,
        inviteDepth: 1
      });
      await recordAuditEvent(storage, {
        action: ACTIONS.USER_CREATED,
        actorId: identity.id,
        actorUsername: identity.username,
        ip: getClientIp(request),
        details: { createdUsername: username }
      });
      return { status: 201, jsonBody: user };
    } catch (err) {
      if (err.code === 'USER_EXISTS') {
        return { status: 409, jsonBody: { error: 'Username already exists.' } };
      }
      if (isStorageUnavailableError(err)) {
        return unavailableStorageResponse(err);
      }
      return { status: 500, jsonBody: { error: 'Unable to create user.' } };
    }
  }
});

registerHttp('createInvite', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'api/invites',
  handler: async (request) => {
    const identity = await resolveIdentity(request);
    if (!identity) {
      return unauthorizedResponse();
    }

    try {
      const storage = await storagePromise;

      const sponsor = await storage.getUser(identity.id);
      const ownedLinks = await storage.listLinks(1000, identity.id);
      const rootSponsorUserId = (sponsor && sponsor.rootSponsorUserId) || identity.id;
      const rootDescendantCount = await storage.countRootDescendants(rootSponsorUserId);
      const eligibility = evaluateInviteEligibility({ user: sponsor, ownedLinkCount: ownedLinks.length, rootDescendantCount });
      if (!eligibility.allowed) {
        return { status: 403, jsonBody: { error: eligibility.reason } };
      }

      // Admins can mint as many invite links as they need; everyone else gets exactly one.
      if (identity.role !== 'admin') {
        const invites = await storage.listInvites();
        if (invites.some((invite) => invite.createdBy === identity.id)) {
          return { status: 409, jsonBody: { error: 'You have already created an invite link.' } };
        }
      }

      const service = await servicePromise;
      const invite = await service.createInviteLink(identity.id);
      await recordAuditEvent(storage, {
        action: ACTIONS.INVITE_CREATED,
        actorId: identity.id,
        actorUsername: identity.username,
        ip: getClientIp(request),
        details: { code: invite.code }
      });
      return { status: 201, jsonBody: invite };
    } catch (err) {
      if (isStorageUnavailableError(err)) {
        return unavailableStorageResponse(err);
      }
      return { status: 500, jsonBody: { error: 'Unable to create invite link.' } };
    }
  }
});

registerHttp('updateUserAccess', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  route: 'api/users/{username}/access',
  handler: async (request) => {
    const identity = await resolveIdentity(request);
    if (!identity || identity.role !== 'admin') return unauthorizedResponse();
    const username = decodeURIComponent(request.params.username || '').trim();
    const payload = await request.json().catch(() => ({}));
    const changes = {};
    if (['user', 'admin'].includes(payload.role)) changes.role = payload.role;
    if (['active', 'pending_approval', 'suspended'].includes(payload.status)) changes.status = payload.status;
    if (!Object.keys(changes).length) return { status: 400, jsonBody: { error: 'A valid role or status is required.' } };

    const storage = await storagePromise;
    const target = await storage.getUser(username);
    if (!target) return { status: 404, jsonBody: { error: 'Profile not found.' } };
    if (target.id === identity.id && (changes.role === 'user' || changes.status === 'suspended')) {
      return { status: 400, jsonBody: { error: 'You cannot remove your own administrator access.' } };
    }
    if (target.role === 'admin' && changes.role === 'user') {
      const admins = (await storage.listUsers()).filter((user) => user.role === 'admin');
      if (admins.length <= 1) return { status: 409, jsonBody: { error: 'At least one administrator is required.' } };
    }
    await storage.updateUserIdentity(target.id, changes);
    await recordAuditEvent(storage, { action: ACTIONS.USER_ACCESS_CHANGED, actorId: identity.id, actorUsername: identity.username, ip: getClientIp(request), details: { targetUsername: username, ...changes } });
    return { status: 200, jsonBody: { updated: true, username, ...changes } };
  }
});

registerHttp('setBranchSuspension', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'api/users/{username}/branch',
  handler: async (request) => {
    const identity = await resolveIdentity(request);
    if (!identity || identity.role !== 'admin') return unauthorizedResponse();
    const username = decodeURIComponent(request.params.username || '').trim();
    const payload = await request.json().catch(() => ({}));
    const suspended = payload.suspended !== false;
    const storage = await storagePromise;
    const target = await storage.getUser(username);
    if (!target) return { status: 404, jsonBody: { error: 'Profile not found.' } };
    const users = await storage.listUsers();
    const branchIds = new Set([target.id]);
    let foundDescendant = true;
    while (foundDescendant) {
      foundDescendant = false;
      for (const user of users) {
        if (!branchIds.has(user.id) && branchIds.has(user.invitedByUserId)) {
          branchIds.add(user.id);
          foundDescendant = true;
        }
      }
    }
    const branch = users.filter((user) => branchIds.has(user.id));
    await Promise.all(branch.map((user) => storage.updateUserIdentity(user.id, { branchSuspended: suspended })));
    await recordAuditEvent(storage, { action: ACTIONS.BRANCH_SUSPENSION_CHANGED, actorId: identity.id, actorUsername: identity.username, ip: getClientIp(request), details: { targetUsername: username, suspended, profiles: branch.length } });
    return { status: 200, jsonBody: { updated: branch.length, suspended } };
  }
});

registerHttp('getMyInvite', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'api/invites/mine',
  handler: async (request) => {
    const identity = await resolveIdentity(request);
    if (!identity) {
      return unauthorizedResponse();
    }

    try {
      const storage = await storagePromise;
      const invites = await storage.listInvites();
      const mine = invites.find((invite) => invite.createdBy === identity.id) || null;
      return {
        status: 200,
        jsonBody: { invite: mine ? { ...mine, inviteUrl: `${config.baseUrl}/${mine.code}` } : null }
      };
    } catch (err) {
      if (isStorageUnavailableError(err)) {
        return unavailableStorageResponse(err);
      }
      throw err;
    }
  }
});

registerHttp('listInvites', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'api/invites',
  handler: async (request) => {
    const identity = await resolveIdentity(request);
    if (!identity || identity.role !== 'admin') {
      return unauthorizedResponse();
    }

    try {
      const storage = await storagePromise;
      const invites = await storage.listInvites();
      return {
        status: 200,
        jsonBody: {
          total: invites.length,
          invites: invites.map((invite) => ({ ...invite, inviteUrl: `${config.baseUrl}/${invite.code}` }))
        }
      };
    } catch (err) {
      if (isStorageUnavailableError(err)) {
        return unavailableStorageResponse(err);
      }
      throw err;
    }
  }
});

registerHttp('revokeInvite', {
  methods: ['DELETE'],
  authLevel: 'anonymous',
  route: 'api/invites/{code}',
  handler: async (request) => {
    const identity = await resolveIdentity(request);
    if (!identity || identity.role !== 'admin') {
      return unauthorizedResponse();
    }

    const code = decodeURIComponent(request.params.code || '').trim();

    try {
      const service = await servicePromise;
      const revoked = await service.revokeInviteLink(code);
      if (!revoked) {
        return { status: 404, jsonBody: { error: 'Invite link not found.' } };
      }

      const storage = await storagePromise;
      await recordAuditEvent(storage, {
        action: ACTIONS.INVITE_REVOKED,
        actorId: identity.id,
        actorUsername: identity.username,
        ip: getClientIp(request),
        details: { code }
      });
      return { status: 204 };
    } catch (err) {
      if (err.code === 'INVITE_REDEEMED') {
        return { status: 409, jsonBody: { error: err.message } };
      }
      if (isStorageUnavailableError(err)) {
        return unavailableStorageResponse(err);
      }
      return { status: 500, jsonBody: { error: 'Unable to revoke invite link.' } };
    }
  }
});

registerHttp('deleteUser', {
  methods: ['DELETE'],
  authLevel: 'anonymous',
  route: 'api/users/{username}',
  handler: async (request) => {
    const identity = await resolveIdentity(request);
    if (!identity || identity.role !== 'admin') {
      return unauthorizedResponse();
    }

    const username = decodeURIComponent(request.params.username || '').trim();
    if (!username) {
      return { status: 400, jsonBody: { error: 'Username is required.' } };
    }
    if (username === identity.username) {
      return { status: 400, jsonBody: { error: 'You cannot delete your own profile.' } };
    }
    if (username === config.dashboardUsername.trim()) {
      return { status: 400, jsonBody: { error: 'The primary admin profile cannot be deleted.' } };
    }

    try {
      const storage = await storagePromise;
      const deleted = await storage.deleteUser(username);
      if (!deleted) {
        return { status: 404, jsonBody: { error: 'Profile not found.' } };
      }

      await recordAuditEvent(storage, {
        action: ACTIONS.USER_DELETED,
        actorId: identity.id,
        actorUsername: identity.username,
        ip: getClientIp(request),
        details: { deletedUsername: username }
      });
      return { status: 204 };
    } catch (err) {
      if (isStorageUnavailableError(err)) {
        return unavailableStorageResponse(err);
      }
      return { status: 500, jsonBody: { error: 'Unable to delete user.' } };
    }
  }
});

registerHttp('resetUserPassword', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'api/users/{username}/password',
  handler: async (request) => {
    const identity = await resolveIdentity(request);
    if (!identity || identity.role !== 'admin') {
      return unauthorizedResponse();
    }

    const username = decodeURIComponent(request.params.username || '').trim();
    if (!username) {
      return { status: 400, jsonBody: { error: 'Username is required.' } };
    }
    if (username === identity.username) {
      return { status: 400, jsonBody: { error: 'Use the Account tab to change your own password.' } };
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return { status: 400, jsonBody: { error: 'Request body must be valid JSON.' } };
    }

    const newPassword = typeof payload.newPassword === 'string' ? payload.newPassword : '';
    if (newPassword.length < 12) {
      return { status: 400, jsonBody: { error: 'New password must be at least 12 characters.' } };
    }

    try {
      const storage = await storagePromise;
      const updated = await storage.updateUserPassword(username, await bcrypt.hash(newPassword, 12));
      if (!updated) {
        return { status: 404, jsonBody: { error: 'Profile not found.' } };
      }

      await recordAuditEvent(storage, {
        action: ACTIONS.PASSWORD_RESET_BY_ADMIN,
        actorId: identity.id,
        actorUsername: identity.username,
        ip: getClientIp(request),
        details: { targetUsername: username }
      });
      return { status: 200, jsonBody: { updated: true, message: 'Password reset.' } };
    } catch (err) {
      if (isStorageUnavailableError(err)) {
        return unavailableStorageResponse(err);
      }
      return { status: 500, jsonBody: { error: 'Unable to reset password.' } };
    }
  }
});

registerHttp('rotateApiKey', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'api/profile/apikey',
  handler: async (request) => {
    const identity = await resolveSessionIdentity(request);
    if (!identity) {
      return unauthorizedResponse();
    }

    try {
      const storage = await storagePromise;
      const { key, hash, displayPrefix } = generateApiKey();
      const createdAt = new Date().toISOString();
      const saved = await storage.setUserApiKey(identity.id, { hash, displayPrefix, createdAt });
      if (!saved) {
        return { status: 404, jsonBody: { error: 'Profile not found.' } };
      }

      await recordAuditEvent(storage, {
        action: ACTIONS.API_KEY_ROTATED,
        actorId: identity.id,
        actorUsername: identity.username,
        ip: getClientIp(request),
        details: { displayPrefix }
      });

      // The plaintext key is returned once and never stored.
      return { status: 201, jsonBody: { apiKey: key, displayPrefix, createdAt } };
    } catch (err) {
      if (isStorageUnavailableError(err)) {
        return unavailableStorageResponse(err);
      }

      return { status: 500, jsonBody: { error: 'Unable to generate an API key.' } };
    }
  }
});

registerHttp('passkeyRegistrationOptions', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'api/profile/passkeys/options',
  handler: async (request) => {
    const identity = await resolveSessionIdentity(request);
    if (!identity) return unauthorizedResponse();
    const storage = await storagePromise;
    const user = await storage.getUser(identity.id);
    const existing = await storage.listPasskeys(identity.id);
    const options = await registrationOptions(config, user, existing);
    return {
      status: 200,
      jsonBody: { options, state: signChallengeState({ purpose: 'registration', challenge: options.challenge, userId: identity.id }, config.identityHashSecret) }
    };
  }
});

registerHttp('passkeyRegistrationVerify', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'api/profile/passkeys/verify',
  handler: async (request) => {
    const identity = await resolveSessionIdentity(request);
    if (!identity) return unauthorizedResponse();
    const payload = await request.json().catch(() => ({}));
    const state = verifyChallengeState(payload.state, config.identityHashSecret, 'registration');
    if (!state || state.userId !== identity.id || !payload.response) return { status: 400, jsonBody: { error: 'Invalid or expired passkey request.' } };
    try {
      const result = await verifyRegistration(config, payload.response, state.challenge);
      if (!result.verified) return { status: 400, jsonBody: { error: 'Passkey verification failed.' } };
      const info = result.registrationInfo;
      const storage = await storagePromise;
      await storage.savePasskey(identity.id, {
        ...info.credential,
        transports: payload.response.response.transports || [],
        deviceType: info.credentialDeviceType,
        backedUp: info.credentialBackedUp,
        createdAt: new Date().toISOString()
      });
      await recordAuditEvent(storage, { action: ACTIONS.PASSKEY_REGISTERED, actorId: identity.id, actorUsername: identity.username, ip: getClientIp(request), details: { credentialId: info.credential.id } });
      return { status: 201, jsonBody: { registered: true, credentialId: info.credential.id } };
    } catch {
      return { status: 400, jsonBody: { error: 'Passkey verification failed.' } };
    }
  }
});

registerHttp('getProfile', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'api/profile',
  handler: async (request) => {
    const identity = await resolveSessionIdentity(request);
    if (!identity) {
      return unauthorizedResponse();
    }

    try {
      const storage = await storagePromise;
      const user = await storage.getUser(identity.username);
      return {
        status: 200,
        jsonBody: {
          username: identity.username,
          displayName: identity.displayName,
          role: identity.role,
          apiKeyPrefix: (user && user.apiKeyPrefix) || '',
          apiKeyCreatedAt: (user && user.apiKeyCreatedAt) || ''
        }
      };
    } catch (err) {
      if (isStorageUnavailableError(err)) {
        return unavailableStorageResponse(err);
      }

      throw err;
    }
  }
});

registerHttp('getAuditLog', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'api/audit',
  handler: async (request) => {
    const identity = await resolveIdentity(request);
    if (!identity || identity.role !== 'admin') {
      return unauthorizedResponse();
    }

    const params = new URL(request.url).searchParams;
    const limit = Math.min(Math.max(Number(params.get('limit')) || 200, 1), 1000);
    // Strictly validated because it's interpolated into an OData filter string in TableStorage;
    // anything not matching this shape is dropped rather than passed through.
    const sinceParam = params.get('since') || '';
    const sinceIso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(sinceParam) ? sinceParam : '';
    const actionFilter = params.get('action') || '';
    const actorFilter = params.get('actor') || '';

    try {
      const storage = await storagePromise;
      let events = await storage.listAuditEvents({ limit: Math.min(limit * 4, 1000), sinceIso });

      if (actionFilter) {
        events = events.filter((event) => event.action === actionFilter);
      }
      if (actorFilter) {
        events = events.filter((event) => event.actorUsername === actorFilter);
      }

      return {
        status: 200,
        jsonBody: {
          retentionDays: AUDIT_RETENTION_DAYS,
          total: events.length,
          events: events.slice(0, limit).map((event) => {
            let details = {};
            try {
              details = JSON.parse(event.details || '{}');
            } catch {
              details = {};
            }

            return {
              timestamp: event.timestamp,
              action: event.action,
              actorId: event.actorId,
              actorUsername: event.actorUsername,
              ip: event.ip,
              details
            };
          })
        }
      };
    } catch (err) {
      if (isStorageUnavailableError(err)) {
        return unavailableStorageResponse(err);
      }

      throw err;
    }
  }
});

registerHttp('customCss', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'custom.css',
  handler: async () => {
    let css = '';
    try {
      css = await readFile(path.join(__dirname, 'src', 'custom.css'), 'utf8');
    } catch {
      css = '';
    }

    return {
      status: 200,
      headers: { 'content-type': 'text/css; charset=utf-8', 'cache-control': 'public, max-age=300' },
      body: css
    };
  }
});

registerHttp('passkeyBrowserScript', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'passkeys.js',
  handler: async () => ({
    status: 200,
    headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'public, max-age=86400' },
    body: await readFile(path.join(__dirname, 'node_modules', '@simplewebauthn', 'browser', 'dist', 'bundle', 'index.umd.min.js'), 'utf8')
  })
});

registerHttp('health', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'api/health',
  handler: async () => {
    const service = await servicePromise;
    const health = await service.getHealth();
    const missingAppSettings = [];

    if (!config.apiKey) {
      missingAppSettings.push('SHORTLINK_API_KEY');
    }

    if (!config.storageConnectionString) {
      missingAppSettings.push('AzureWebJobsStorage/AZURE_STORAGE_CONNECTION_STRING');
    }

    return {
      status: health.status === 'healthy' && missingAppSettings.length === 0 ? 200 : 503,
      jsonBody: {
        ...health,
        config: {
          baseUrl: config.baseUrl,
          apiKeyConfigured: Boolean(config.apiKey),
          storageConnectionConfigured: Boolean(config.storageConnectionString),
          missingAppSettings
        }
      }
    };
  }
});
