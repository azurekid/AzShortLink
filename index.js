'use strict';

const { app } = require('@azure/functions');
const bcrypt = require('bcryptjs');
const path = require('node:path');
const { readFile } = require('node:fs/promises');
const { getConfig } = require('./src/config');
const { createStorage } = require('./src/storage');
const { ShortLinkService } = require('./src/service/shortLinkService');
const { renderDashboard } = require('./src/dashboard');
const { renderLoginPage } = require('./src/loginPage');
const { renderSignupPage } = require('./src/signupPage');
const {
  verifyCredentials,
  createSessionToken,
  buildSessionCookie,
  buildClearedSessionCookie,
  isDashboardSessionValid,
  getSessionIdentity,
  generateApiKey,
  hashApiKey,
  API_KEY_PREFIX,
  timingSafeEqualString
} = require('./src/auth');
const { ACTIONS, AUDIT_RETENTION_DAYS, recordAuditEvent } = require('./src/audit');

const config = getConfig();
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
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com",
    "font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com",
    "script-src 'self' 'unsafe-inline'",
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

function getRequestIdentity(request) {
  const sessionIdentity = getSessionIdentity(request, config);
  if (sessionIdentity) {
    return sessionIdentity;
  }

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

// Personal keys are looked up by hash, so this needs storage and is async.
async function resolveIdentity(request) {
  const identity = getRequestIdentity(request);
  if (identity) {
    return identity;
  }

  const presented = getApiKeyFromRequest(request);
  if (!presented.startsWith(API_KEY_PREFIX)) {
    return null;
  }

  try {
    const storage = await storagePromise;
    const user = await storage.getUserByApiKeyHash(hashApiKey(presented));
    if (!user) {
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

app.http('shortenUrl', {
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

app.http('root', {
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

app.http('dashboard', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'dashboard',
  handler: async (request) => {
    if (!dashboardAuthConfigured()) {
      return dashboardConfigErrorResponse();
    }

    if (!isDashboardSessionValid(request, config)) {
      return {
        status: 302,
        headers: { location: '/dashboard/login', 'cache-control': 'no-store' }
      };
    }

    return {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        ...SECURITY_HEADERS
      },
      body: renderDashboard(config.baseUrl, {
        user: getSessionIdentity(request, config)
      })
    };
  }
});

app.http('redirectUrl', {
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
        referrer: request.headers.get('referer') || request.headers.get('referrer')
      });
    } catch (err) {
      if (isStorageUnavailableError(err)) {
        return unavailableStorageResponse(err);
      }

      throw err;
    }

    if (!result) {
      return {
        status: 404,
        jsonBody: {
          error: 'Short URL not found.'
        }
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

app.http('getStats', {
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

app.http('deleteLink', {
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

app.http('getAnalytics', {
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
      const analytics = await service.getAnalytics(resolveOwnerScope(request, identity));
      return { status: 200, jsonBody: { baseUrl: config.baseUrl, scope: identity.role === 'admin' ? 'all' : 'mine', ...analytics } };
    } catch (err) {
      if (isStorageUnavailableError(err)) {
        return unavailableStorageResponse(err);
      }

      throw err;
    }
  }
});

app.http('listUsers', {
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

app.http('changePassword', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'api/profile/password',
  handler: async (request) => {
    const identity = getSessionIdentity(request, config);
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
const loginAttempts = new Map();
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000;

function getClientIp(request) {
  return (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
}

function isLockedOut(ip) {
  const entry = loginAttempts.get(ip);
  if (!entry) {
    return false;
  }

  if (entry.count < LOGIN_MAX_ATTEMPTS) {
    return false;
  }

  if (Date.now() - entry.firstAttemptAt > LOGIN_LOCKOUT_MS) {
    loginAttempts.delete(ip);
    return false;
  }

  return true;
}

function recordFailedAttempt(ip) {
  const entry = loginAttempts.get(ip);
  if (!entry || Date.now() - entry.firstAttemptAt > LOGIN_LOCKOUT_MS) {
    loginAttempts.set(ip, { count: 1, firstAttemptAt: Date.now() });
    return;
  }

  entry.count += 1;
}

function clearAttempts(ip) {
  loginAttempts.delete(ip);
}

app.http('dashboardLoginPage', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'dashboard/login',
  handler: async (request) => {
    if (!dashboardAuthConfigured()) {
      return dashboardConfigErrorResponse();
    }

    if (isDashboardSessionValid(request, config)) {
      return { status: 302, headers: { location: '/dashboard', 'cache-control': 'no-store' } };
    }

    return {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...SECURITY_HEADERS },
      body: renderLoginPage()
    };
  }
});

app.http('dashboardLoginSubmit', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'dashboard/login',
  handler: async (request) => {
    if (!dashboardAuthConfigured()) {
      return dashboardConfigErrorResponse();
    }

    const ip = getClientIp(request);
    if (isLockedOut(ip)) {
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
      recordFailedAttempt(ip);
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

    clearAttempts(ip);
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

app.http('dashboardLogout', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'dashboard/logout',
  handler: async (request) => {
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

app.http('dashboardSignupPage', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'dashboard/signup',
  handler: async (request) => {
    const inviteCode = new URL(request.url).searchParams.get('invite') || '';

    try {
      const storage = await storagePromise;
      const invite = inviteCode ? await storage.getInvite(inviteCode) : null;
      if (!invite || invite.redeemed) {
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

app.http('dashboardSignupSubmit', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'dashboard/signup',
  handler: async (request) => {
    const contentType = request.headers.get('content-type') || '';
    let inviteCode = '';
    let username = '';
    let displayName = '';
    let password = '';

    try {
      if (contentType.includes('application/json')) {
        const body = await request.json();
        inviteCode = body.invite || '';
        username = body.username || '';
        displayName = body.displayName || '';
        password = body.password || '';
      } else {
        const form = new URLSearchParams(await request.text());
        inviteCode = form.get('invite') || '';
        username = form.get('username') || '';
        displayName = form.get('displayName') || '';
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
      return {
        status: invite ? 410 : 404,
        headers: { 'content-type': 'text/html; charset=utf-8', ...SECURITY_HEADERS },
        body: renderSignupPage({
          error: invite ? 'This invite link has already been used.' : 'This invite link is invalid or has expired.'
        })
      };
    }

    if (!/^[A-Za-z0-9._-]{3,64}$/.test(username) || !displayName || password.length < 12) {
      return {
        status: 400,
        headers: { 'content-type': 'text/html; charset=utf-8', ...SECURITY_HEADERS },
        body: renderSignupPage({
          invite: inviteCode,
          error: 'Username must be 3-64 safe characters and password must be at least 12 characters.'
        })
      };
    }

    try {
      const createdAt = new Date().toISOString();
      const user = await storage.createUser({
        username,
        displayName,
        passwordHash: await bcrypt.hash(password, 12),
        role: 'user',
        createdAt
      });

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

      const token = createSessionToken(user, config.dashboardSessionSecret);
      return {
        status: 302,
        headers: {
          location: '/dashboard',
          'cache-control': 'no-store',
          'set-cookie': buildSessionCookie(token, request)
        }
      };
    } catch (err) {
      if (err.code === 'USER_EXISTS') {
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

app.http('createUser', {
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
        role: 'user',
        createdAt: new Date().toISOString()
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

app.http('createInvite', {
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

app.http('getMyInvite', {
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

app.http('listInvites', {
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

app.http('revokeInvite', {
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

app.http('deleteUser', {
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

app.http('resetUserPassword', {
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

app.http('rotateApiKey', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'api/profile/apikey',
  handler: async (request) => {
    const identity = getSessionIdentity(request, config);
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

app.http('getProfile', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'api/profile',
  handler: async (request) => {
    const identity = getSessionIdentity(request, config);
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

app.http('getAuditLog', {
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
    const sinceIso = params.get('since') || '';
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

app.http('customCss', {
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

app.http('health', {
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
