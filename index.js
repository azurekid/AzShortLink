'use strict';

const { app } = require('@azure/functions');
const bcrypt = require('bcryptjs');
const crypto = require('node:crypto');
const path = require('node:path');
const { readFile } = require('node:fs/promises');
const { getConfig } = require('./src/core/config');
const { createStorage } = require('./src/storage');
const { ShortLinkService } = require('./src/services/shortLinkService');
const { renderUserDashboard } = require('./src/dashboard/user');
const { renderAdminDashboard } = require('./src/dashboard/admin');
const { renderLoginPage } = require('./src/pages/loginPage');
const { renderForgotPasswordPage } = require('./src/pages/forgotPasswordPage');
const { renderSignupPage } = require('./src/pages/signupPage');
const { renderNotFoundPage } = require('./src/pages/notFoundPage');
const { renderPricingPage } = require('./src/pages/pricingPage');
const { renderHomePage } = require('./src/pages/homePage');
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
} = require('./src/auth/auth');
const { ACTIONS, AUDIT_RETENTION_DAYS, createAuditWriteLimiter, formatAuditEvent, recordAuditEvent } = require('./src/core/audit');
const { isAllowedRequestOrigin } = require('./src/core/requestSecurity');
const { buildOpenApiSpec } = require('./src/api/openApi');
const { renderApiDocsPage } = require('./src/pages/apiDocsPage');
const { createQrCodePng } = require('./src/services/qrCode');
const { lookupGeoLocation } = require('./src/analytics/geoLocation');
const { DEFAULT_INVITE_POLICY, evaluateInviteEligibility, buildInviteAncestry } = require('./src/auth/invitePolicy');
const {
  EMAIL_PATTERN,
  normalizeEmail,
  hashIdentityValue,
  maskEmail,
  createVerificationToken,
  verifyPasswordResetToken,
  verifyVerificationToken,
  buildRiskSignals
} = require('./src/auth/identity');
const { sendVerificationEmail } = require('./src/services/email');
const { canonicalizeEmail, evaluateEmailPolicy } = require('./src/auth/emailPolicy');
const { DAY_MS, getPlan, isPlanId, listPlans, resolveUserPlan, dailyQuotaReset } = require('./src/core/plans');
const { createPasswordResetQueue } = require('./src/services/passwordResetQueue');
const { processPasswordResetMessage } = require('./src/services/passwordResetProcessor');
const {
  signChallengeState,
  verifyChallengeState,
  registrationOptions,
  verifyRegistration,
  authenticationOptions,
  verifyAuthentication
} = require('./src/auth/passkeys');

const config = getConfig();
const passwordResetQueue = createPasswordResetQueue(config);
const apiRateLimitMaxRequests = Number.parseInt(process.env.API_RATE_LIMIT_MAX_REQUESTS || '60', 10);
const apiRateLimitWindowMs = Number.parseInt(process.env.API_RATE_LIMIT_WINDOW_MS || '60000', 10);

function rateLimitedHandler(handler) {
  return async (request, context) => {
    const storage = await storagePromise;
    const sourceIp = getClientIp(request);
    const rateKey = hashIdentityValue(`rate-limit:api:${sourceIp}`, config.identityHashSecret);
    const requestContext = buildRateLimitContext(request, 'api');
    const result = await storage.consumeRateLimit(rateKey, apiRateLimitMaxRequests, apiRateLimitWindowMs, Date.now(), requestContext);
    if (!result.allowed) {
      // The shared IP ceiling is only the free-tier baseline: a paid caller gets a second,
      // higher allowance keyed to their account, so identity is resolved only once it matters.
      const identity = await resolveIdentity(request);
      const plan = resolveUserPlan(identity);
      if (identity && plan.apiRequestsPerMinute > apiRateLimitMaxRequests) {
        const planKey = hashIdentityValue(`rate-limit:api-plan:${identity.id}`, config.identityHashSecret);
        const planResult = await storage.consumeRateLimit(
          planKey,
          plan.apiRequestsPerMinute,
          apiRateLimitWindowMs,
          Date.now(),
          { ...requestContext, scope: `api-plan:${plan.id}`, actorUsername: identity.username }
        );
        if (planResult.allowed) return handler(request, context);
        return tooManyRequestsResponse(request, storage, planResult, {
          scope: 'api',
          plan: plan.id,
          limit: plan.apiRequestsPerMinute,
          actorId: identity.id,
          actorUsername: identity.username,
          actorRole: identity.role
        });
      }

      return tooManyRequestsResponse(request, storage, result, {
        scope: 'api',
        plan: plan.id,
        limit: apiRateLimitMaxRequests,
        actorId: identity ? identity.id : '',
        actorUsername: identity ? identity.username : 'anonymous',
        actorRole: identity ? identity.role : ''
      });
    }

    return handler(request, context);
  };
}

async function tooManyRequestsResponse(request, storage, result, { scope, plan, limit, actorId = '', actorUsername = 'anonymous', actorRole = '' }) {
  // Throttled so a sustained flood cannot fill the audit table, while still capturing who it was.
  if (rateLimitAuditLimiter.shouldRecord(`${scope}:${actorId || getClientIp(request)}`)) {
    await recordAuditEvent(storage, {
      action: ACTIONS.RATE_LIMITED,
      actorId,
      actorUsername,
      actorRole,
      ...buildAuditContext(request, { outcome: 'failure' }),
      details: { scope, plan, limit, windowMs: apiRateLimitWindowMs, retryAfterSeconds: result.retryAfterSeconds }
    });
  }

  return {
    status: 429,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'retry-after': String(result.retryAfterSeconds)
    },
    jsonBody: {
      error: 'Too many requests. Try again later.',
      plan,
      limit,
      upgradeUrl: `${config.baseUrl}/pricing`
    }
  };
}

function registerHttp(name, { crossOriginAllowlist = [], ...options }) {
  const routedHandler = options.route.startsWith('api/') ? rateLimitedHandler(options.handler) : options.handler;
  const handler = async (request, context) => {
    const method = String(request.method || 'GET').toUpperCase();
    // crossOriginAllowlist is only for public, side-effect-light endpoints (e.g. the invite
    // request form used by a separately hosted static landing page); it carries no
    // session/cookie, is IP-throttled, and only origins on the explicit allowlist are accepted.
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && !isAllowedRequestOrigin(request, config.baseUrl, crossOriginAllowlist)) {
      return { status: 403, headers: { ...SECURITY_HEADERS }, jsonBody: { error: 'Cross-origin request denied.' } };
    }
    const response = await routedHandler(request, context);
    return { ...response, headers: { ...SECURITY_HEADERS, ...(response.headers || {}) } };
  };
  return app.http(name, { ...options, handler });
}
const storagePromise = createStorage(config);
const servicePromise = storagePromise.then((storage) => new ShortLinkService(storage, { baseUrl: config.baseUrl }));
// Prevent an unhandled rejection from crashing the worker at cold start; real errors still
// surface normally wherever these promises are awaited inside a request handler.
storagePromise.catch(() => {});
servicePromise.catch(() => {});
function createSecurityHeaders(scriptNonce = '') {
  const nonceSource = scriptNonce ? ` 'nonce-${scriptNonce}'` : '';
  return {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'strict-transport-security': 'max-age=63072000; includeSubDomains; preload',
  'permissions-policy': 'camera=(), geolocation=(), microphone=(), payment=(), usb=()',
  'cross-origin-opener-policy': 'same-origin',
  'content-security-policy': [
    "default-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    `script-src 'self'${nonceSource}`,
    "img-src 'self' data: https://azurehacking.com https://tile.openstreetmap.org",
    "connect-src 'self'"
  ].join('; ')
  };
}

const SECURITY_HEADERS = createSecurityHeaders();

const API_DOCS_SECURITY_HEADERS = {
  ...SECURITY_HEADERS,
  'content-security-policy': [
    "default-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "script-src 'self'",
    "img-src 'self' data: https://azurehacking.com",
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

// Invite requests are filed as help requests under a synthetic owner so administrators see them
// in the existing queue without an account having to exist yet.
const ACCESS_REQUEST_USER_ID = 'access-request';

function landingPageResponse({ status = 200, message = '', error = '', email = '', reason = '' } = {}) {
  return {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...SECURITY_HEADERS },
    body: renderHomePage({ message, error, email, reason })
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
      role: 'admin',
      // The deployment key belongs to the operator, so it is never held back by plan quotas.
      plan: 'business',
      planExpiresAt: ''
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
    return user && (user.status || 'active') === 'active' && !user.branchSuspended && (Number(user.sessionVersion) || 1) === (Number(sessionIdentity.sessionVersion) || 1)
      ? { id: user.id, username: user.username, displayName: user.displayName, role: user.role, plan: user.plan || 'free', planExpiresAt: user.planExpiresAt || '' }
      : null;
  } catch {
    return null;
  }
}

// Personal keys are looked up by hash, so this needs storage and is async.
async function resolveIdentity(request) {
  if (identityCache.has(request)) return identityCache.get(request);
  const identity = await lookupIdentity(request);
  identityCache.set(request, identity);
  return identity;
}

// Rate limiting and the handler itself both need the caller, so the lookup is cached for the
// lifetime of the request object rather than repeated per consumer.
const identityCache = new WeakMap();

async function lookupIdentity(request) {
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

    return { id: user.id, username: user.username, displayName: user.displayName, role: user.role, plan: user.plan || 'free', planExpiresAt: user.planExpiresAt || '' };
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
      const storage = await storagePromise;
      const plan = resolveUserPlan(identity);
      const quota = await consumeDailyQuota(storage, {
        scope: 'links',
        ownerId: identity.id,
        limit: plan.linksPerDay,
        context: buildRateLimitContext(request, 'quota:links')
      });
      if (!quota.allowed) {
        await recordQuotaExceeded(storage, request, {
          scope: 'links',
          plan: plan.id,
          limit: plan.linksPerDay,
          actorId: identity.id,
          actorUsername: identity.username,
          actorRole: identity.role
        });
        return {
          status: 429,
          headers: { 'retry-after': String(quota.retryAfterSeconds) },
          jsonBody: {
            error: `Daily limit of ${plan.linksPerDay} new short links reached for the ${plan.name} plan.`,
            plan: plan.id,
            limit: plan.linksPerDay,
            resetAt: quota.resetAt,
            upgradeUrl: `${config.baseUrl}/pricing`
          }
        };
      }

      const result = await service.createShortLink(payload, identity.id);
      await recordAuditEvent(storage, {
        action: ACTIONS.LINK_CREATED,
        actorId: identity.id,
        actorUsername: identity.username,
        actorRole: identity.role,
        ...buildAuditContext(request),
        details: { linkCode: result.code, targetUrl: result.targetUrl, plan: plan.id }
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

// The Functions host's homepage middleware answers the bare `/` itself (204 when
// AzureWebJobsDisableHomepage=true, otherwise the built-in splash) and never routes it to a
// function, so the landing page lives on a real path and `/` has to be redirected at the edge.
const LANDING_PATH = 'home';

// Deliberately a separate trigger from `redirectUrl`: the landing page must never run
// short-link resolution, quota accounting or click tracking.
registerHttp('landingPage', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: LANDING_PATH,
  handler: async () => landingPageResponse()
});

registerHttp('accessRequestSubmit', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: LANDING_PATH,
  handler: async (request) => {
    const result = await processAccessRequest(request);
    return landingPageResponse(result);
  }
});

// A separately hosted static landing page (e.g. Storage static website on another domain)
// cannot use the HTML form above, so it submits here as JSON instead. Only origins on the
// explicit allowlist may call this cross-site, and only as JSON: browsers can't send a JSON
// body from a plain HTML form, so this forces a CORS preflight and rules out blind CSRF
// submissions from arbitrary third-party pages.
registerHttp('accessRequestApi', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'api/access-requests',
  crossOriginAllowlist: config.accessRequestAllowedOrigins,
  handler: async (request) => {
    const result = await processAccessRequest(request, { requireJson: true });
    return {
      status: result.status,
      jsonBody: result.error ? { error: result.error } : { message: result.message }
    };
  }
});

async function processAccessRequest(request, { requireJson = false } = {}) {
  const genericMessage = 'Thanks. Your request has been received; an administrator will email you an invite link if it is approved.';
  const ip = getClientIp(request);
  if (await accessRequestThrottle.isLockedOut(ip)) {
    await accessRequestThrottle.recordLockout(request, { endpoint: requireJson ? 'api' : 'form' });
    return { status: 429, error: 'Too many requests. Please try again later.' };
  }

  const contentType = request.headers.get('content-type') || '';
  if (requireJson && !contentType.includes('application/json')) {
    return { status: 400, error: 'Requests must be sent as JSON.' };
  }

  let email = '';
  let reason = '';
  try {
    if (contentType.includes('application/json')) {
      const body = await request.json();
      email = normalizeEmail(body.email);
      reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    } else {
      const form = new URLSearchParams(await request.text());
      email = normalizeEmail(form.get('email'));
      reason = (form.get('reason') || '').trim();
    }
  } catch {
    return { status: 400, error: 'Unable to read the request. Please try again.' };
  }

  if (!email || !EMAIL_PATTERN.test(email) || email.length > 254) {
    return { status: 400, error: 'Enter a valid email address.', reason };
  }
  if (reason.length > 1000) {
    return { status: 400, error: 'Keep the note under 1000 characters.', email };
  }

  // Every submission counts toward the throttle; there is no "success" that clears it.
  await accessRequestThrottle.recordFailedAttempt(ip, request);

  const storage = await storagePromise;

  try {
    // Sub-addressed and dotted variants resolve to the same mailbox as at signup; matched
    // against both hashes so an already-registered user can't be re-invited or enumerated
    // through response timing/content differences.
    const emailHash = hashIdentityValue(email, config.identityHashSecret);
    const emailCanonicalHash = hashIdentityValue(canonicalizeEmail(email), config.identityHashSecret);
    const alreadyRegistered = Boolean(
      (await storage.getUserByEmailHash(emailHash)) || (await storage.getUserByCanonicalEmailHash(emailCanonicalHash))
    );

    if (alreadyRegistered) {
      if (accessRequestAuditLimiter.shouldRecord(ip)) {
        await recordAuditEvent(storage, {
          action: ACTIONS.ACCESS_REQUEST_IGNORED,
          ...buildAuditContext(request, { outcome: 'success' }),
          details: { reason: 'already_registered' }
        });
      }
      // Identical response to a fresh request: the caller can't tell an account already exists.
      return { status: 200, message: genericMessage };
    }

    await storage.createHelpRequest({
      id: crypto.randomUUID(),
      userId: ACCESS_REQUEST_USER_ID,
      username: ACCESS_REQUEST_USER_ID,
      subject: `Invite request from ${maskEmail(email)}`,
      message: `Email: ${email}\n\n${reason || 'No additional details provided.'}`,
      createdAt: new Date().toISOString()
    });

    if (accessRequestAuditLimiter.shouldRecord(ip)) {
      await recordAuditEvent(storage, {
        action: ACTIONS.ACCESS_REQUEST_SUBMITTED,
        ...buildAuditContext(request, { outcome: 'success' }),
        details: { maskedEmail: maskEmail(email), hasReason: Boolean(reason) }
      });
    }
  } catch (err) {
    if (isStorageUnavailableError(err)) {
      return { status: 503, error: 'The service is temporarily unavailable. Please try again later.', email, reason };
    }
    console.error('[signup] Unable to store the access request.', { code: err.code, message: err.message });
    return { status: 500, error: 'Unable to submit the request. Please try again later.', email, reason };
  }

  return { status: 200, message: genericMessage };
}

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
    const cspNonce = crypto.randomBytes(16).toString('base64url');

    return {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        ...createSecurityHeaders(cspNonce)
      },
      body: renderDashboard(config.baseUrl, { user: identity, cspNonce })
    };
  }
});

registerHttp('redirectUrl', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: '{code}',
  handler: async (request) => {
    const service = await servicePromise;
    const storage = await storagePromise;
    const code = request.params.code;
    if (!code) {
      return { status: 302, headers: { location: `/${LANDING_PATH}`, 'cache-control': 'no-store' } };
    }
    const location = lookupGeoLocation(getClientIp(request));
    let result;

    try {
      result = await service.resolveShortLink(code, {
        userAgent: request.headers.get('user-agent'),
        referrer: request.headers.get('referer') || request.headers.get('referrer'),
        location,
        quotaCheck: async (link) => {
          if (!link.ownerId) return { allowed: true };
          const plan = await getOwnerPlan(storage, link.ownerId);
          return consumeDailyQuota(storage, {
            scope: 'redirects',
            ownerId: link.ownerId,
            limit: plan.redirectsPerDay,
            context: {
              sourceIp: getClientIp(request),
              userAgent: request.headers.get('user-agent') || '',
              httpMethod: 'GET',
              requestPath: `/${code}`,
              actorUsername: link.ownerId,
              location: location || {}
            }
          });
        }
      });
    } catch (err) {
      if (isStorageUnavailableError(err)) {
        return unavailableStorageResponse(err);
      }

      throw err;
    }

    if (result && result.quotaExceeded) {
      const plan = await getOwnerPlan(storage, result.ownerId);
      await recordQuotaExceeded(storage, request, {
        scope: 'redirects',
        plan: plan.id,
        limit: plan.redirectsPerDay,
        actorId: result.ownerId,
        actorUsername: result.ownerId,
        details: { linkCode: result.code }
      });
      return {
        status: 429,
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
          'retry-after': String(result.quota.retryAfterSeconds),
          ...SECURITY_HEADERS
        },
        body: renderNotFoundPage({
          code: '429',
          title: 'Daily redirect limit reached',
          description: 'This short link has reached the redirect limit of its plan for today. It will start working again after the daily reset.',
          output: `ERROR: Daily redirect quota exhausted for the ${plan.name} plan.`
        })
      };
    }

    if (!result) {
      try {
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
        actorRole: identity.role,
        ...buildAuditContext(request),
        details: { linkCode: request.params.code, administratorAction: identity.role === 'admin' }
      });

      return { status: 200, jsonBody: { deleted: true, code: request.params.code } };
    } catch (err) {
      if (err.code === 'FORBIDDEN') {
        const storage = await storagePromise;
        await recordAuditEvent(storage, {
          action: ACTIONS.LINK_DELETE_DENIED,
          actorId: identity.id,
          actorUsername: identity.username,
          actorRole: identity.role,
          ...buildAuditContext(request, { outcome: 'failure' }),
          details: { linkCode: request.params.code, reason: 'ownership_violation' }
        });
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
    if (newPassword === currentPassword) {
      return { status: 400, jsonBody: { error: 'New password must be different from the current password.' } };
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
        actorRole: identity.role,
        ...buildAuditContext(request),
        details: { userName: identity.username }
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
// Bounds ACCESS_REQUEST_* audit writes so a flood of anonymous submissions can't fill the table.
const accessRequestAuditLimiter = createAuditWriteLimiter({ maxEvents: LOGIN_MAX_ATTEMPTS, windowMs: LOGIN_LOCKOUT_MS });

function getClientIp(request) {
  return request.headers.get('x-azure-clientip') || (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
}

function buildAuditContext(request, overrides = {}) {
  const sourceIp = getClientIp(request);
  const requestPath = new URL(request.url).pathname;
  const sessionIdentity = getSessionIdentity(request, config);
  const presentedKey = getApiKeyFromRequest(request);
  let authenticationMethod = 'anonymous';

  if (sessionIdentity) authenticationMethod = 'session';
  else if (config.apiKey && timingSafeEqualString(presentedKey, config.apiKey)) authenticationMethod = 'deployment_api_key';
  else if (presentedKey.startsWith(API_KEY_PREFIX)) authenticationMethod = 'personal_api_key';

  return {
    sourceIp,
    userAgent: request.headers.get('user-agent') || '',
    channel: requestPath.startsWith('/dashboard') || sessionIdentity ? 'dashboard' : 'api',
    authenticationMethod,
    httpMethod: request.method || '',
    requestPath,
    outcome: 'success',
    location: lookupGeoLocation(sourceIp) || {},
    ...overrides
  };
}

// Stored next to the rate-limit counters, which are keyed by an opaque hash on their own.
function buildRateLimitContext(request, scope) {
  const sourceIp = getClientIp(request);
  const sessionIdentity = getSessionIdentity(request, config);
  return {
    scope,
    sourceIp,
    userAgent: request.headers.get('user-agent') || '',
    httpMethod: request.method || '',
    requestPath: new URL(request.url).pathname,
    actorUsername: sessionIdentity ? sessionIdentity.username : 'anonymous',
    location: lookupGeoLocation(sourceIp) || {}
  };
}

// Daily plan quotas reuse the storage rate limiter with a 24h window, so the counters expire
// and get purged on the same path as every other throttle row.
async function consumeDailyQuota(storage, { scope, ownerId, limit, context = {} }) {
  if (!Number.isFinite(limit) || limit <= 0) {
    return { allowed: true, retryAfterSeconds: 0, resetAt: dailyQuotaReset() };
  }

  const quotaKey = hashIdentityValue(`quota:${scope}:${ownerId}`, config.identityHashSecret);
  const result = await storage.consumeRateLimit(quotaKey, limit, DAY_MS, Date.now(), {
    actorUsername: ownerId,
    ...context,
    scope: `quota:${scope}`
  });
  return { ...result, resetAt: dailyQuotaReset() };
}

const quotaAuditLimiter = createAuditWriteLimiter({ maxEvents: 3, windowMs: 60 * 60 * 1000 });

// The redirect path would otherwise read the owner profile on every hit; a short TTL keeps a
// plan change visible within a minute without paying for a lookup per redirect.
const OWNER_PLAN_CACHE_TTL_MS = 60 * 1000;
const ownerPlanCache = new Map();

async function getOwnerPlan(storage, ownerId) {
  const cached = ownerPlanCache.get(ownerId);
  if (cached && cached.expiresAt > Date.now()) return cached.plan;

  let plan = getPlan('free');
  try {
    plan = resolveUserPlan(await storage.getUser(ownerId));
  } catch {
    // Fall back to the free plan rather than failing the redirect.
  }
  ownerPlanCache.set(ownerId, { plan, expiresAt: Date.now() + OWNER_PLAN_CACHE_TTL_MS });
  return plan;
}

async function recordQuotaExceeded(storage, request, { scope, plan, limit, actorId = '', actorUsername = 'anonymous', actorRole = '', details = {} }) {
  if (!quotaAuditLimiter.shouldRecord(`${scope}:${actorId || getClientIp(request)}`)) return;
  await recordAuditEvent(storage, {
    action: ACTIONS.QUOTA_EXCEEDED,
    actorId,
    actorUsername,
    actorRole,
    ...buildAuditContext(request, { outcome: 'failure' }),
    details: { scope, plan, limit, period: 'day', ...details }
  });
}

// Separate trackers per endpoint so guessing invite codes can't lock a shared account out of
// login, and vice versa; each still shares the same cap/window shape.
function createAttemptThrottle(scope, maxAttempts = LOGIN_MAX_ATTEMPTS, lockoutMs = LOGIN_LOCKOUT_MS) {
  const rateKey = (ip) => hashIdentityValue(`rate-limit:${scope}:${ip}`, config.identityHashSecret);
  return {
    async isLockedOut(ip) {
      const storage = await storagePromise;
      const sinceIso = new Date(Date.now() - lockoutMs).toISOString();
      return (await storage.countRecentRateLimitAttempts(rateKey(ip), sinceIso)) >= maxAttempts;
    },
    async recordFailedAttempt(ip, request = null) {
      const storage = await storagePromise;
      await storage.recordRateLimitAttempt(
        rateKey(ip),
        new Date().toISOString(),
        request ? buildRateLimitContext(request, scope) : { scope, sourceIp: ip, location: lookupGeoLocation(ip) || {} }
      );
    },
    async clearAttempts(ip) {
      const storage = await storagePromise;
      await storage.clearRateLimitAttempts(rateKey(ip));
    },
    // Records who hit the lockout so a throttled client is identifiable from the audit trail.
    async recordLockout(request, details = {}) {
      const storage = await storagePromise;
      if (!rateLimitAuditLimiter.shouldRecord(`${scope}:${getClientIp(request)}`)) return;
      await recordAuditEvent(storage, {
        action: ACTIONS.RATE_LIMITED,
        ...buildAuditContext(request, { outcome: 'failure' }),
        details: { scope, limit: maxAttempts, windowMs: lockoutMs, ...details }
      });
    }
  };
}

const loginThrottle = createAttemptThrottle('login');
const passwordResetThrottle = createAttemptThrottle('password-reset');
const passkeyThrottle = createAttemptThrottle('passkey');
// Invite codes are bearer tokens for account creation, so guessing them is throttled too.
const signupThrottle = createAttemptThrottle('signup');
// The landing page invite form is fully anonymous, so it gets its own budget per source IP.
const accessRequestThrottle = createAttemptThrottle('access-request');
// Audit writes have their own budget so repeated anonymous failures cannot fill the table.
// This budget intentionally does not reset after a successful signup.
const signupAuditLimiter = createAuditWriteLimiter({ maxEvents: LOGIN_MAX_ATTEMPTS, windowMs: LOGIN_LOCKOUT_MS });
// Shared budget for RATE_LIMITED events so a flood is visible without filling the audit table.
const rateLimitAuditLimiter = createAuditWriteLimiter({ maxEvents: LOGIN_MAX_ATTEMPTS, windowMs: LOGIN_LOCKOUT_MS });

function safeSignupUserName(value) {
  const candidate = String(value || '').trim();
  return /^[A-Za-z0-9._-]{3,64}$/.test(candidate) ? candidate : (candidate ? 'invalid' : 'unknown');
}

function safeInviteCode(value) {
  const candidate = String(value || '').trim();
  return /^[A-Za-z0-9_-]{4,32}$/.test(candidate) ? candidate : '';
}

async function recordSignupFailure(storage, request, { userName = '', inviteCode = '', reason, details = {} }) {
  const sourceIp = getClientIp(request);
  if (!signupAuditLimiter.shouldRecord(sourceIp)) return false;

  const safeUserName = safeSignupUserName(userName);
  const safeCode = safeInviteCode(inviteCode);
  await recordAuditEvent(storage, {
    action: ACTIONS.SIGNUP_FAILED,
    actorUsername: safeUserName,
    ...buildAuditContext(request, { outcome: 'failure' }),
    details: { ...details, userName: safeUserName, ...(safeCode ? { inviteCode: safeCode } : {}), reason }
  });
  return true;
}

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

registerHttp('forgotPasswordPage', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'dashboard/forgot-password',
  handler: async () => ({
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...SECURITY_HEADERS },
    body: renderForgotPasswordPage()
  })
});

registerHttp('forgotPasswordSubmit', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'dashboard/forgot-password',
  handler: async (request) => {
    const genericMessage = 'If the username and email address match an active account, a password reset link has been sent.';
    const ip = getClientIp(request);
    if (await passwordResetThrottle.isLockedOut(ip)) {
      await passwordResetThrottle.recordLockout(request);
      return {
        status: 429,
        headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...SECURITY_HEADERS },
        body: renderForgotPasswordPage({ message: genericMessage })
      };
    }
    await passwordResetThrottle.recordFailedAttempt(ip);

    const contentType = request.headers.get('content-type') || '';
    let username = '';
    let email = '';
    try {
      if (contentType.includes('application/json')) {
        const body = await request.json();
        username = typeof body.username === 'string' ? body.username.trim() : '';
        email = normalizeEmail(body.email);
      } else {
        const form = new URLSearchParams(await request.text());
        username = (form.get('username') || '').trim();
        email = normalizeEmail(form.get('email'));
      }
    } catch {
      // Return the same response as every other outcome to avoid account enumeration.
    }

    try {
      if (passwordResetQueue) await passwordResetQueue.enqueue({ username, email });
      else console.error('[auth] Password reset queue is not configured.');
    } catch (err) {
      console.error('[auth] Unable to enqueue password reset request.', { code: err.code, statusCode: err.statusCode, message: err.message });
    }

    return {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...SECURITY_HEADERS },
      body: renderForgotPasswordPage({ message: genericMessage })
    };
  }
});

app.storageQueue('processPasswordReset', {
  queueName: 'password-resets',
  connection: 'AzureWebJobsStorage',
  handler: async (message, context) => {
    try {
      const result = await processPasswordResetMessage(message, { storage: await storagePromise, config });
      context.log('[password-reset] Queue request processed.', { sent: result.sent, reason: result.reason || 'sent' });
    } catch (err) {
      context.error('[password-reset] Queue processing failed.', { code: err.code, statusCode: err.statusCode, message: err.message });
      throw err;
    }
  }
});

registerHttp('resetPasswordPage', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'dashboard/reset-password',
  handler: async (request) => {
    const token = new URL(request.url).searchParams.get('token') || '';
    const claims = verifyPasswordResetToken(token, config.identityHashSecret);
    const storage = await storagePromise;
    const user = claims ? await storage.getUser(claims.userId) : null;
    const valid = user && user.emailHash === claims.emailHash && (Number(user.sessionVersion) || 1) === (Number(claims.sessionVersion) || 1) && (user.status || 'active') === 'active';
    return {
      status: valid ? 200 : 400,
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...SECURITY_HEADERS },
      body: valid ? renderForgotPasswordPage({ resetToken: token }) : renderForgotPasswordPage({ error: 'This password reset link is invalid or expired.' })
    };
  }
});

registerHttp('resetPasswordSubmit', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'dashboard/reset-password',
  handler: async (request) => {
    const form = new URLSearchParams(await request.text());
    const token = form.get('token') || '';
    const newPassword = form.get('newPassword') || '';
    const confirmPassword = form.get('confirmPassword') || '';
    const claims = verifyPasswordResetToken(token, config.identityHashSecret);
    const storage = await storagePromise;
    const user = claims ? await storage.getUser(claims.userId) : null;
    const valid = user && user.emailHash === claims.emailHash && (Number(user.sessionVersion) || 1) === (Number(claims.sessionVersion) || 1) && (user.status || 'active') === 'active';
    if (!valid) {
      return { status: 400, headers: { 'content-type': 'text/html; charset=utf-8', ...SECURITY_HEADERS }, body: renderForgotPasswordPage({ error: 'This password reset link is invalid or expired.' }) };
    }
    if (newPassword.length < 12 || newPassword !== confirmPassword) {
      return { status: 400, headers: { 'content-type': 'text/html; charset=utf-8', ...SECURITY_HEADERS }, body: renderForgotPasswordPage({ resetToken: token, error: 'Passwords must match and contain at least 12 characters.' }) };
    }
    if (user.passwordHash && await bcrypt.compare(newPassword, user.passwordHash)) {
      return { status: 400, headers: { 'content-type': 'text/html; charset=utf-8', ...SECURITY_HEADERS }, body: renderForgotPasswordPage({ resetToken: token, error: 'New password must be different from your current password.' }) };
    }
    await storage.updateUserPassword(user.id, await bcrypt.hash(newPassword, 12));
    await recordAuditEvent(storage, {
      action: ACTIONS.PASSWORD_RESET_SELF_SERVICE,
      actorId: user.id,
      actorUsername: user.username,
      actorRole: user.role,
      ...buildAuditContext(request, { authenticationMethod: 'email' }),
      details: { userName: user.username }
    });
    return {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'set-cookie': buildClearedSessionCookie(request), ...SECURITY_HEADERS },
      body: renderForgotPasswordPage({ message: 'Your password has been reset. Sign in with your new password.' })
    };
  }
});

registerHttp('passkeyAuthenticationOptions', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'dashboard/passkeys/options',
  handler: async (request) => {
    if (await passkeyThrottle.isLockedOut(getClientIp(request))) {
      await passkeyThrottle.recordLockout(request, { endpoint: 'options' });
      return { status: 429, jsonBody: { error: 'Too many passkey attempts. Try again later.' } };
    }
    const options = await authenticationOptions(config);
    return { status: 200, jsonBody: { options, state: signChallengeState({ purpose: 'authentication', challenge: options.challenge }, config.identityHashSecret) } };
  }
});

registerHttp('passkeyAuthenticationVerify', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'dashboard/passkeys/verify',
  handler: async (request) => {
    const ip = getClientIp(request);
    if (await passkeyThrottle.isLockedOut(ip)) {
      await passkeyThrottle.recordLockout(request, { endpoint: 'verify' });
      return { status: 429, jsonBody: { error: 'Too many passkey attempts. Try again later.' } };
    }
    const payload = await request.json().catch(() => ({}));
    const state = verifyChallengeState(payload.state, config.identityHashSecret, 'authentication');
    const storage = await storagePromise;
    if (!state || !payload.response || !payload.response.id) {
      await passkeyThrottle.recordFailedAttempt(ip);
      await recordAuditEvent(storage, {
        action: ACTIONS.LOGIN_FAILED,
        ...buildAuditContext(request, { authenticationMethod: 'passkey', outcome: 'failure' }),
        details: { userName: 'unknown', reason: 'invalid_passkey_request' }
      });
      return { status: 400, jsonBody: { error: 'Invalid or expired passkey request.' } };
    }
    const credential = await storage.getPasskey(payload.response.id);
    if (!credential) {
      await passkeyThrottle.recordFailedAttempt(ip);
      await recordAuditEvent(storage, {
        action: ACTIONS.LOGIN_FAILED,
        ...buildAuditContext(request, { authenticationMethod: 'passkey', outcome: 'failure' }),
        details: { userName: 'unknown', credentialId: payload.response.id, reason: 'credential_not_found' }
      });
      return unauthorizedResponse();
    }
    const user = await storage.getUser(credential.userId);
    if (!user || (user.status || 'active') !== 'active') {
      await passkeyThrottle.recordFailedAttempt(ip);
      await recordAuditEvent(storage, {
        action: ACTIONS.LOGIN_FAILED,
        actorId: credential.userId,
        actorUsername: user?.username || credential.userId,
        actorRole: user?.role || '',
        ...buildAuditContext(request, { authenticationMethod: 'passkey', outcome: 'failure' }),
        details: { userName: user?.username || credential.userId, credentialId: credential.id, reason: 'user_inactive' }
      });
      return unauthorizedResponse();
    }
    try {
      const result = await verifyAuthentication(config, payload.response, state.challenge, credential);
      if (!result.verified) throw new Error('Passkey verification failed.');
      await storage.updatePasskeyCounter(credential.id, result.authenticationInfo.newCounter);
      await passkeyThrottle.clearAttempts(ip);
      await recordAuditEvent(storage, {
        action: ACTIONS.LOGIN_SUCCESS,
        actorId: user.id,
        actorUsername: user.username,
        actorRole: user.role,
        ...buildAuditContext(request, { authenticationMethod: 'passkey' }),
        details: { userName: user.username, credentialId: credential.id, deviceType: credential.deviceType, backedUp: credential.backedUp }
      });
      const token = createSessionToken(user, config.dashboardSessionSecret);
      return { status: 200, headers: { 'set-cookie': buildSessionCookie(token, request) }, jsonBody: { authenticated: true } };
    } catch {
      await passkeyThrottle.recordFailedAttempt(ip);
      await recordAuditEvent(storage, {
        action: ACTIONS.LOGIN_FAILED,
        actorId: user.id,
        actorUsername: user.username,
        actorRole: user.role,
        ...buildAuditContext(request, { authenticationMethod: 'passkey', outcome: 'failure' }),
        details: { userName: user.username, credentialId: credential.id, reason: 'verification_failed' }
      });
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
    if (await loginThrottle.isLockedOut(ip)) {
      const storage = await storagePromise;
      await recordAuditEvent(storage, {
        action: ACTIONS.LOGIN_FAILED,
        actorUsername: 'unknown',
        ...buildAuditContext(request, { authenticationMethod: 'password', outcome: 'failure' }),
        details: { userName: 'unknown', reason: 'rate_limited' }
      });
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
      const storage = await storagePromise;
      await recordAuditEvent(storage, {
        action: ACTIONS.LOGIN_FAILED,
        actorUsername: username || 'unknown',
        ...buildAuditContext(request, { authenticationMethod: 'password', outcome: 'failure' }),
        details: { userName: username || 'unknown', reason: 'invalid_request_body' }
      });
      return {
        status: 400,
        headers: { 'content-type': 'text/html; charset=utf-8', ...SECURITY_HEADERS },
        body: renderLoginPage({ error: 'Invalid request body.' })
      };
    }

    const storage = await storagePromise;
    const user = await verifyCredentials(username, password, storage, config.dashboardPasswordHash);
    if (!user) {
      await loginThrottle.recordFailedAttempt(ip);
      await recordAuditEvent(storage, {
        action: ACTIONS.LOGIN_FAILED,
        actorUsername: username || 'unknown',
        ...buildAuditContext(request, { authenticationMethod: 'password', outcome: 'failure' }),
        details: { userName: username || 'unknown', reason: 'invalid_credentials' }
      });
      return {
        status: 401,
        headers: { 'content-type': 'text/html; charset=utf-8', ...SECURITY_HEADERS },
        body: renderLoginPage({ error: 'Invalid username or password.' })
      };
    }

    await loginThrottle.clearAttempts(ip);
    await recordAuditEvent(storage, {
      action: ACTIONS.LOGIN_SUCCESS,
      actorId: user.id,
      actorUsername: user.username,
      actorRole: user.role,
      ...buildAuditContext(request, { authenticationMethod: 'password' }),
      details: { userName: user.username }
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
        actorRole: identity.role,
        ...buildAuditContext(request),
        details: { userName: identity.username }
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
    if (await signupThrottle.isLockedOut(ip)) {
      await signupThrottle.recordLockout(request, { endpoint: 'invite_lookup' });
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
        await signupThrottle.recordFailedAttempt(ip);
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
    if (await signupThrottle.isLockedOut(ip)) {
      const storage = await storagePromise;
      await recordSignupFailure(storage, request, { reason: 'rate_limited' });
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
      const storage = await storagePromise;
      await recordSignupFailure(storage, request, { userName: username, inviteCode, reason: 'invalid_request_body' });
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
      await signupThrottle.recordFailedAttempt(ip);
      await recordSignupFailure(storage, request, { userName: username, inviteCode, reason: invite ? 'invite_redeemed' : 'invite_not_found' });
      return {
        status: invite ? 410 : 404,
        headers: { 'content-type': 'text/html; charset=utf-8', ...SECURITY_HEADERS },
        body: renderSignupPage({
          error: invite ? 'This invite link has already been used.' : 'This invite link is invalid or has expired.'
        })
      };
    }

    if (!/^[A-Za-z0-9._-]{3,64}$/.test(username) || !displayName || !EMAIL_PATTERN.test(email) || password.length < 12) {
      await signupThrottle.recordFailedAttempt(ip);
      await recordSignupFailure(storage, request, { userName: username, inviteCode, reason: 'invalid_profile_input' });
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
      const emailPolicy = evaluateEmailPolicy(email, {
        blockedDomains: config.blockedEmailDomains,
        allowedDomains: config.allowedEmailDomains
      });
      if (!emailPolicy.allowed) {
        await signupThrottle.recordFailedAttempt(ip);
        await recordSignupFailure(storage, request, {
          userName: username,
          inviteCode,
          reason: emailPolicy.reason,
          details: { emailDomain: emailPolicy.domain }
        });
        return {
          status: 400,
          headers: { 'content-type': 'text/html; charset=utf-8', ...SECURITY_HEADERS },
          body: renderSignupPage({
            invite: inviteCode,
            error: emailPolicy.reason === 'domain_not_allowed'
              ? 'Registration is limited to approved email domains.'
              : 'Disposable and temporary email addresses cannot be used to register.'
          })
        };
      }

      const emailHash = hashIdentityValue(email, config.identityHashSecret);
      // Sub-addressed and dotted variants resolve to the same mailbox, so they are matched
      // against a canonical hash as well as the literal one.
      const emailCanonicalHash = hashIdentityValue(canonicalizeEmail(email), config.identityHashSecret);
      if (await storage.getUserByEmailHash(emailHash) || await storage.getUserByCanonicalEmailHash(emailCanonicalHash)) {
        await signupThrottle.recordFailedAttempt(ip);
        await recordSignupFailure(storage, request, { userName: username, inviteCode, reason: 'identity_already_registered' });
        return {
          status: 409,
          headers: { 'content-type': 'text/html; charset=utf-8', ...SECURITY_HEADERS },
          body: renderSignupPage({ invite: inviteCode, error: 'That email address is already registered.' })
        };
      }

      const sponsor = await storage.getUser(invite.createdBy);
      if (!sponsor || sponsor.status === 'suspended' || sponsor.branchSuspended) {
        await signupThrottle.recordFailedAttempt(ip);
        await recordSignupFailure(storage, request, { userName: username, inviteCode, reason: 'sponsor_unavailable', details: { sponsorUserName: invite.createdBy } });
        return {
          status: 403,
          headers: { 'content-type': 'text/html; charset=utf-8', ...SECURITY_HEADERS },
          body: renderSignupPage({ error: 'This invitation branch is unavailable.' })
        };
      }

      const ancestry = buildInviteAncestry(sponsor);
      if (ancestry.inviteDepth > DEFAULT_INVITE_POLICY.maximumDepth) {
        await signupThrottle.recordFailedAttempt(ip);
        await recordSignupFailure(storage, request, {
          userName: username,
          inviteCode,
          reason: 'maximum_invite_depth',
          details: { sponsorUserName: sponsor.username, inviteDepth: ancestry.inviteDepth }
        });
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
        emailCanonicalHash,
        emailMasked: maskEmail(email),
        ...ancestry,
        ...riskSignals,
        riskFlags
      });

      const verificationToken = createVerificationToken({ userId: user.id, emailHash }, config.identityHashSecret);
      try {
        await sendVerificationEmail(config, {
          recipient: email,
          username,
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
        await signupThrottle.recordFailedAttempt(ip);
        await recordSignupFailure(storage, request, { userName: username, inviteCode, reason: 'invite_redemption_race' });
        return {
          status: 409,
          headers: { 'content-type': 'text/html; charset=utf-8', ...SECURITY_HEADERS },
          body: renderSignupPage({ error: 'This invite link has already been used.' })
        };
      }

      // The invite code doubles as a real shortlink code; deleting it here means the URL
      // itself stops resolving once redeemed, instead of redirecting forever to a dead end.
      await storage.deleteLink(inviteCode);
      await signupThrottle.clearAttempts(ip);

      await recordAuditEvent(storage, {
        action: ACTIONS.SIGNUP_SUCCESS,
        actorId: user.id,
        actorUsername: user.username,
        actorRole: user.role,
        ...buildAuditContext(request),
        details: { userName: username, inviteCode, accountStatus: user.status || 'pending_verification' }
      });
      await recordAuditEvent(storage, {
        action: ACTIONS.INVITE_REDEEMED,
        actorId: user.id,
        actorUsername: user.username,
        actorRole: user.role,
        ...buildAuditContext(request),
        details: { userName: username, inviteCode }
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
        await signupThrottle.recordFailedAttempt(ip);
        await recordSignupFailure(storage, request, { userName: username, inviteCode, reason: 'user_name_exists' });
        return {
          status: 409,
          headers: { 'content-type': 'text/html; charset=utf-8', ...SECURITY_HEADERS },
          body: renderSignupPage({ invite: inviteCode, error: 'That username is already taken.' })
        };
      }
      if (isStorageUnavailableError(err)) {
        return unavailableStorageResponse(err);
      }
      if (err.code === 'EMAIL_NOT_CONFIGURED' || err.code === 'EMAIL_DELIVERY_FAILED') {
        const deliveryCause = err.cause;
        console.error('[email] Account verification email is unavailable.', {
          code: err.code,
          causeName: deliveryCause?.name,
          causeCode: deliveryCause?.code,
          statusCode: deliveryCause?.statusCode,
          causeMessage: deliveryCause?.message
        });
        await recordSignupFailure(storage, request, {
          userName: username,
          inviteCode,
          reason: err.code === 'EMAIL_NOT_CONFIGURED' ? 'email_not_configured' : 'email_delivery_failed'
        });
        return {
          status: 503,
          headers: { 'content-type': 'text/html; charset=utf-8', ...SECURITY_HEADERS },
          body: renderSignupPage({ invite: inviteCode, error: 'Account verification email is unavailable. Contact the administrator.' })
        };
      }
      await recordSignupFailure(storage, request, { userName: username, inviteCode, reason: 'internal_error' });
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
    // Verified email is the activation boundary. Risk flags remain on the profile for
    // administrator review, but broad network/browser signals must not invalidate a
    // password or block an otherwise verified account.
    const status = 'active';
    await storage.updateUserIdentity(user.id, { emailVerifiedAt: new Date().toISOString(), status });
    await recordAuditEvent(storage, {
      action: ACTIONS.EMAIL_VERIFIED,
      actorId: user.id,
      actorUsername: user.username,
      actorRole: user.role,
      ...buildAuditContext(request),
      details: { userName: user.username, accountStatus: status, riskFlags: user.riskFlags || [] }
    });
    return {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...SECURITY_HEADERS },
      body: renderSignupPage({ message: 'Email verified. You can now sign in.' })
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
        actorRole: identity.role,
        ...buildAuditContext(request),
        details: { userName: username, role, accountStatus: 'active' }
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
      const legitimateUsedLinkCount = ownedLinks.filter((link) => (Number(link.redirectCount) || 0) > 0).length;
      const rootSponsorUserId = (sponsor && sponsor.rootSponsorUserId) || identity.id;
      const rootDescendantCount = await storage.countRootDescendants(rootSponsorUserId);
      const eligibility = evaluateInviteEligibility({ user: sponsor, legitimateUsedLinkCount, rootDescendantCount });
      if (!eligibility.allowed) {
        await recordAuditEvent(storage, {
          action: ACTIONS.INVITE_CREATION_DENIED,
          actorId: identity.id,
          actorUsername: identity.username,
          actorRole: identity.role,
          ...buildAuditContext(request, { outcome: 'failure' }),
          details: { userName: identity.username, reason: eligibility.reason }
        });
        return { status: 403, jsonBody: { error: eligibility.reason } };
      }

      // Admins can mint as many invite links as they need; everyone else gets exactly one.
      if (identity.role !== 'admin') {
        const invites = await storage.listInvites();
        if (invites.some((invite) => invite.createdBy === identity.id)) {
          await recordAuditEvent(storage, {
            action: ACTIONS.INVITE_CREATION_DENIED,
            actorId: identity.id,
            actorUsername: identity.username,
            actorRole: identity.role,
            ...buildAuditContext(request, { outcome: 'failure' }),
            details: { userName: identity.username, reason: 'invite_limit_reached' }
          });
          return { status: 409, jsonBody: { error: 'You have already created an invite link.' } };
        }
      }

      const service = await servicePromise;
      const invite = await service.createInviteLink(identity.id);
      await recordAuditEvent(storage, {
        action: ACTIONS.INVITE_CREATED,
        actorId: identity.id,
        actorUsername: identity.username,
        actorRole: identity.role,
        ...buildAuditContext(request),
        details: { inviteCode: invite.code }
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
    await recordAuditEvent(storage, {
      action: ACTIONS.USER_ACCESS_CHANGED,
      actorId: identity.id,
      actorUsername: identity.username,
      actorRole: identity.role,
      ...buildAuditContext(request),
      details: { userName: username, previousRole: target.role, previousStatus: target.status || 'active', ...changes }
    });
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
    await recordAuditEvent(storage, {
      action: ACTIONS.BRANCH_SUSPENSION_CHANGED,
      actorId: identity.id,
      actorUsername: identity.username,
      actorRole: identity.role,
      ...buildAuditContext(request),
      details: { userName: username, suspended, affectedUserCount: branch.length }
    });
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
        actorRole: identity.role,
        ...buildAuditContext(request),
        details: { inviteCode: code }
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
        actorRole: identity.role,
        ...buildAuditContext(request),
        details: { userName: username }
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
        actorRole: identity.role,
        ...buildAuditContext(request),
        details: { userName: username }
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
        actorRole: identity.role,
        ...buildAuditContext(request),
        details: { userName: identity.username, apiKeyPrefix: displayPrefix }
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

registerHttp('pricingPage', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'pricing',
  handler: async (request) => {
    const identity = await resolveSessionIdentity(request);
    return {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...SECURITY_HEADERS },
      body: renderPricingPage({
        currentPlanId: identity ? resolveUserPlan(identity).id : '',
        signedIn: Boolean(identity)
      })
    };
  }
});

registerHttp('listPlans', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'api/plans',
  handler: async () => ({ status: 200, jsonBody: { plans: listPlans() } })
});

registerHttp('getAccountPlan', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'api/account/plan',
  handler: async (request) => {
    const identity = await resolveIdentity(request);
    if (!identity) return unauthorizedResponse();

    try {
      const storage = await storagePromise;
      const user = await storage.getUser(identity.id);
      const plan = resolveUserPlan(user || identity);
      const [linksUsed, redirectsUsed] = await Promise.all([
        storage.peekRateLimit(hashIdentityValue(`quota:links:${identity.id}`, config.identityHashSecret), DAY_MS),
        storage.peekRateLimit(hashIdentityValue(`quota:redirects:${identity.id}`, config.identityHashSecret), DAY_MS)
      ]);

      return {
        status: 200,
        jsonBody: {
          plan: plan.id,
          planName: plan.name,
          planExpiresAt: (user && user.planExpiresAt) || '',
          pendingPlan: (user && user.pendingPlan) || '',
          pendingPlanRequestedAt: (user && user.pendingPlanRequestedAt) || '',
          limits: {
            linksPerDay: plan.linksPerDay,
            redirectsPerDay: plan.redirectsPerDay,
            apiRequestsPerMinute: plan.apiRequestsPerMinute
          },
          usage: {
            linksToday: linksUsed,
            redirectsToday: redirectsUsed,
            resetAt: dailyQuotaReset()
          }
        }
      };
    } catch (err) {
      if (isStorageUnavailableError(err)) return unavailableStorageResponse(err);
      throw err;
    }
  }
});

registerHttp('requestPlanChange', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'api/account/plan',
  handler: async (request) => {
    // Session-only: a plan change is a billing action and must not be reachable with an API key.
    const identity = await resolveSessionIdentity(request);
    if (!identity) return unauthorizedResponse();

    const payload = await request.json().catch(() => ({}));
    if (!isPlanId(payload.plan)) return { status: 400, jsonBody: { error: 'A valid plan identifier is required.' } };

    const requestedPlan = getPlan(payload.plan);
    const currentPlan = resolveUserPlan(identity);
    if (requestedPlan.id === currentPlan.id) {
      return { status: 200, jsonBody: { plan: currentPlan.id, pending: false, message: `You are already on the ${currentPlan.name} plan.` } };
    }

    try {
      const storage = await storagePromise;
      // Downgrades cost nothing, so they apply immediately; paid plans wait for activation.
      if (requestedPlan.priceEurPerMonth === 0) {
        await storage.updateUserIdentity(identity.id, { plan: requestedPlan.id, planActivatedAt: new Date().toISOString(), planExpiresAt: '', pendingPlan: '', pendingPlanRequestedAt: '' });
        ownerPlanCache.delete(identity.id);
        await recordAuditEvent(storage, {
          action: ACTIONS.PLAN_CHANGED,
          actorId: identity.id,
          actorUsername: identity.username,
          actorRole: identity.role,
          ...buildAuditContext(request),
          details: { userName: identity.username, previousPlan: currentPlan.id, plan: requestedPlan.id, changedBy: 'self' }
        });
        return { status: 200, jsonBody: { plan: requestedPlan.id, pending: false, message: `Your account is now on the ${requestedPlan.name} plan.` } };
      }

      // Queued on the profile so administrators see the request in the dashboard, not only in the audit log.
      await storage.updateUserIdentity(identity.id, { pendingPlan: requestedPlan.id, pendingPlanRequestedAt: new Date().toISOString() });
      await recordAuditEvent(storage, {
        action: ACTIONS.PLAN_UPGRADE_REQUESTED,
        actorId: identity.id,
        actorUsername: identity.username,
        actorRole: identity.role,
        ...buildAuditContext(request),
        details: {
          userName: identity.username,
          currentPlan: currentPlan.id,
          requestedPlan: requestedPlan.id,
          priceEurPerMonth: requestedPlan.priceEurPerMonth
        }
      });

      return {
        status: 202,
        jsonBody: {
          plan: currentPlan.id,
          requestedPlan: requestedPlan.id,
          pending: true,
          message: `Upgrade to ${requestedPlan.name} requested. The plan is activated once payment is confirmed.`
        }
      };
    } catch (err) {
      if (isStorageUnavailableError(err)) return unavailableStorageResponse(err);
      throw err;
    }
  }
});

registerHttp('setUserPlan', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  route: 'api/users/{username}/plan',
  handler: async (request) => {
    const identity = await resolveIdentity(request);
    if (!identity || identity.role !== 'admin') return unauthorizedResponse();

    const username = decodeURIComponent(request.params.username || '').trim();
    const payload = await request.json().catch(() => ({}));
    if (!isPlanId(payload.plan)) return { status: 400, jsonBody: { error: 'A valid plan identifier is required.' } };
    const expiresAt = payload.expiresAt ? new Date(payload.expiresAt) : null;
    if (expiresAt && Number.isNaN(expiresAt.getTime())) {
      return { status: 400, jsonBody: { error: 'expiresAt must be a valid date.' } };
    }

    try {
      const storage = await storagePromise;
      const target = await storage.getUser(username);
      if (!target) return { status: 404, jsonBody: { error: 'Profile not found.' } };

      const plan = getPlan(payload.plan);
      const changes = {
        plan: plan.id,
        planActivatedAt: new Date().toISOString(),
        planExpiresAt: expiresAt ? expiresAt.toISOString() : '',
        pendingPlan: '',
        pendingPlanRequestedAt: ''
      };
      await storage.updateUserIdentity(target.id, changes);
      ownerPlanCache.delete(target.id);
      await recordAuditEvent(storage, {
        action: ACTIONS.PLAN_CHANGED,
        actorId: identity.id,
        actorUsername: identity.username,
        actorRole: identity.role,
        ...buildAuditContext(request),
        details: {
          userName: username,
          previousPlan: resolveUserPlan(target).id,
          plan: plan.id,
          planExpiresAt: changes.planExpiresAt,
          changedBy: 'admin'
        }
      });

      return { status: 200, jsonBody: { updated: true, username, plan: plan.id, planExpiresAt: changes.planExpiresAt } };
    } catch (err) {
      if (isStorageUnavailableError(err)) return unavailableStorageResponse(err);
      throw err;
    }
  }
});

registerHttp('adminNotifications', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'api/admin/notifications',
  handler: async (request) => {
    const identity = await resolveIdentity(request);
    if (!identity || identity.role !== 'admin') return unauthorizedResponse();

    try {
      const storage = await storagePromise;
      const [users, helpRequests] = await Promise.all([storage.listUsers(), storage.listHelpRequests()]);
      const planRequests = users
        .filter((user) => user.pendingPlan && isPlanId(user.pendingPlan))
        .map((user) => ({
          username: user.username,
          displayName: user.displayName || user.username,
          currentPlan: resolveUserPlan(user).id,
          requestedPlan: user.pendingPlan,
          requestedAt: user.pendingPlanRequestedAt || ''
        }))
        .sort((left, right) => String(right.requestedAt).localeCompare(String(left.requestedAt)));

      const openHelpRequests = helpRequests.filter((item) => item.status === 'open').length;
      const pendingApprovals = users.filter((user) => user.status === 'pending_approval').length;

      return {
        status: 200,
        jsonBody: {
          planRequests,
          openHelpRequests,
          pendingApprovals,
          total: planRequests.length + openHelpRequests + pendingApprovals
        }
      };
    } catch (err) {
      if (isStorageUnavailableError(err)) return unavailableStorageResponse(err);
      throw err;
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
    if (!state || state.userId !== identity.id || !payload.response) {
      const storage = await storagePromise;
      await recordAuditEvent(storage, {
        action: ACTIONS.PASSKEY_REGISTRATION_FAILED,
        actorId: identity.id,
        actorUsername: identity.username,
        actorRole: identity.role,
        ...buildAuditContext(request, { authenticationMethod: 'session', outcome: 'failure' }),
        details: { userName: identity.username, reason: 'invalid_passkey_request' }
      });
      return { status: 400, jsonBody: { error: 'Invalid or expired passkey request.' } };
    }
    try {
      const result = await verifyRegistration(config, payload.response, state.challenge);
      if (!result.verified) throw new Error('Passkey verification failed.');
      const info = result.registrationInfo;
      const storage = await storagePromise;
      await storage.savePasskey(identity.id, {
        ...info.credential,
        transports: payload.response.response.transports || [],
        deviceType: info.credentialDeviceType,
        backedUp: info.credentialBackedUp,
        createdAt: new Date().toISOString()
      });
      await recordAuditEvent(storage, {
        action: ACTIONS.PASSKEY_REGISTERED,
        actorId: identity.id,
        actorUsername: identity.username,
        actorRole: identity.role,
        ...buildAuditContext(request, { authenticationMethod: 'session' }),
        details: {
          userName: identity.username,
          credentialId: info.credential.id,
          deviceType: info.credentialDeviceType,
          backedUp: info.credentialBackedUp,
          transports: payload.response.response.transports || []
        }
      });
      return { status: 201, jsonBody: { registered: true, credentialId: info.credential.id } };
    } catch {
      const storage = await storagePromise;
      await recordAuditEvent(storage, {
        action: ACTIONS.PASSKEY_REGISTRATION_FAILED,
        actorId: identity.id,
        actorUsername: identity.username,
        actorRole: identity.role,
        ...buildAuditContext(request, { authenticationMethod: 'session', outcome: 'failure' }),
        details: { userName: identity.username, reason: 'verification_failed' }
      });
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
      const plan = resolveUserPlan(user || identity);
      return {
        status: 200,
        jsonBody: {
          username: identity.username,
          displayName: identity.displayName,
          role: identity.role,
          apiKeyPrefix: (user && user.apiKeyPrefix) || '',
          apiKeyCreatedAt: (user && user.apiKeyCreatedAt) || '',
          plan: plan.id,
          planName: plan.name,
          planExpiresAt: (user && user.planExpiresAt) || '',
          planLimits: {
            linksPerDay: plan.linksPerDay,
            redirectsPerDay: plan.redirectsPerDay,
            apiRequestsPerMinute: plan.apiRequestsPerMinute
          }
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

registerHttp('helpRequests', {  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'api/help',
  handler: async (request) => {
    const identity = await resolveSessionIdentity(request);
    if (!identity) return unauthorizedResponse();

    try {
      const storage = await storagePromise;
      if (request.method === 'GET') {
        return { status: 200, jsonBody: { requests: await storage.listHelpRequests(identity.id) } };
      }

      const payload = await request.json().catch(() => ({}));
      const subject = typeof payload.subject === 'string' ? payload.subject.trim() : '';
      const message = typeof payload.message === 'string' ? payload.message.trim() : '';
      if (!subject || subject.length > 120 || !message || message.length > 4000) {
        return { status: 400, jsonBody: { error: 'Subject must be 1-120 characters and message must be 1-4000 characters.' } };
      }

      const helpRequest = await storage.createHelpRequest({
        id: crypto.randomUUID(),
        userId: identity.id,
        username: identity.username,
        subject,
        message,
        createdAt: new Date().toISOString()
      });
      return { status: 201, jsonBody: helpRequest };
    } catch (err) {
      if (isStorageUnavailableError(err)) return unavailableStorageResponse(err);
      return { status: 500, jsonBody: { error: 'Unable to process the help request.' } };
    }
  }
});

registerHttp('adminHelpRequests', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'api/admin/help',
  handler: async (request) => {
    const identity = await resolveSessionIdentity(request);
    if (!identity || identity.role !== 'admin') return unauthorizedResponse();

    try {
      const storage = await storagePromise;
      return { status: 200, jsonBody: { requests: await storage.listHelpRequests() } };
    } catch (err) {
      if (isStorageUnavailableError(err)) return unavailableStorageResponse(err);
      return { status: 500, jsonBody: { error: 'Unable to load help requests.' } };
    }
  }
});

registerHttp('closeHelpRequest', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  route: 'api/help/{id}',
  handler: async (request) => {
    const identity = await resolveSessionIdentity(request);
    if (!identity) return unauthorizedResponse();

    const payload = await request.json().catch(() => ({}));
    if (payload.status !== 'closed') {
      return { status: 400, jsonBody: { error: 'Users can only close help requests.' } };
    }

    try {
      const storage = await storagePromise;
      const helpRequest = await storage.setHelpRequestStatus(request.params.id, {
        userId: identity.id,
        status: 'closed',
        changedAt: new Date().toISOString(),
        changedBy: identity.username
      });
      return helpRequest
        ? { status: 200, jsonBody: helpRequest }
        : { status: 404, jsonBody: { error: 'Help request not found.' } };
    } catch (err) {
      if (isStorageUnavailableError(err)) return unavailableStorageResponse(err);
      return { status: 500, jsonBody: { error: 'Unable to close the help request.' } };
    }
  }
});

registerHttp('addHelpRequestMessage', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'api/help/{id}/messages',
  handler: async (request) => {
    const identity = await resolveSessionIdentity(request);
    if (!identity) return unauthorizedResponse();

    const payload = await request.json().catch(() => ({}));
    const message = typeof payload.message === 'string' ? payload.message.trim() : '';
    if (!message || message.length > 2000) {
      return { status: 400, jsonBody: { error: 'Reply must be 1-2000 characters.' } };
    }

    try {
      const storage = await storagePromise;
      const helpRequest = await storage.addHelpRequestMessage(request.params.id, {
        userId: identity.id,
        author: identity.username,
        role: 'user',
        text: message,
        createdAt: new Date().toISOString()
      });
      return helpRequest
        ? { status: 201, jsonBody: helpRequest }
        : { status: 404, jsonBody: { error: 'Open help request not found.' } };
    } catch (err) {
      if (err.code === 'HELP_THREAD_FULL') return { status: 409, jsonBody: { error: err.message } };
      if (isStorageUnavailableError(err)) return unavailableStorageResponse(err);
      return { status: 500, jsonBody: { error: 'Unable to add the reply.' } };
    }
  }
});

registerHttp('respondToHelpRequest', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  route: 'api/admin/help/{id}',
  handler: async (request) => {
    const identity = await resolveSessionIdentity(request);
    if (!identity || identity.role !== 'admin') return unauthorizedResponse();

    const payload = await request.json().catch(() => ({}));
    const hasResponse = typeof payload.response === 'string';
    const response = hasResponse ? payload.response.trim() : '';
    const status = payload.status === 'closed' || payload.status === 'open' || payload.status === 'answered' ? payload.status : '';
    if ((!hasResponse && !status) || (hasResponse && (!response || response.length > 2000))) {
      return { status: 400, jsonBody: { error: 'Provide a 1-2000 character response or a valid status.' } };
    }

    try {
      const storage = await storagePromise;
      const changedAt = new Date().toISOString();
      const helpRequest = hasResponse
        ? await storage.respondToHelpRequest(request.params.id, { response, respondedAt: changedAt, respondedBy: identity.username })
        : await storage.setHelpRequestStatus(request.params.id, { status, changedAt, changedBy: identity.username });
      return helpRequest
        ? { status: 200, jsonBody: helpRequest }
        : { status: 404, jsonBody: { error: 'Help request not found.' } };
    } catch (err) {
      if (err.code === 'HELP_THREAD_FULL') return { status: 409, jsonBody: { error: err.message } };
      if (isStorageUnavailableError(err)) return unavailableStorageResponse(err);
      return { status: 500, jsonBody: { error: 'Unable to respond to the help request.' } };
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
    const channelFilter = params.get('channel') || '';
    const outcomeFilter = params.get('outcome') || '';
    const authenticationMethodFilter = params.get('authenticationMethod') || '';
    const sourceCountryCodeFilter = (params.get('sourceCountryCode') || '').toUpperCase();

    try {
      const storage = await storagePromise;
      let events = await storage.listAuditEvents({ limit: Math.min(limit * 4, 1000), sinceIso });

      if (actionFilter) {
        events = events.filter((event) => event.action === actionFilter);
      }
      if (actorFilter) {
        events = events.filter((event) => event.actorUsername === actorFilter);
      }
      if (channelFilter) {
        events = events.filter((event) => event.channel === channelFilter);
      }
      if (outcomeFilter) {
        events = events.filter((event) => event.outcome === outcomeFilter);
      }
      if (authenticationMethodFilter) {
        events = events.filter((event) => event.authenticationMethod === authenticationMethodFilter);
      }
      if (sourceCountryCodeFilter) {
        events = events.filter((event) => event.sourceCountryCode === sourceCountryCodeFilter);
      }

      return {
        status: 200,
        jsonBody: {
          retentionDays: AUDIT_RETENTION_DAYS,
          total: events.length,
          events: events.slice(0, limit).map(formatAuditEvent)
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

const STATIC_ASSETS = new Map([
  ['css/home.css', { file: 'css/home.css', contentType: 'text/css; charset=utf-8' }],
  ['css/dashboard.css', { file: 'css/dashboard.css', contentType: 'text/css; charset=utf-8' }],
  ['css/auth.css', { file: 'css/auth.css', contentType: 'text/css; charset=utf-8' }],
  ['css/not-found.css', { file: 'css/not-found.css', contentType: 'text/css; charset=utf-8' }],
  ['css/api-docs.css', { file: 'css/api-docs.css', contentType: 'text/css; charset=utf-8' }],
  ['css/custom.css', { file: 'css/custom.css', contentType: 'text/css; charset=utf-8' }],
  ['css/pricing.css', { file: 'css/pricing.css', contentType: 'text/css; charset=utf-8' }],
  ['js/login.js', { file: 'js/login.js', contentType: 'text/javascript; charset=utf-8' }],
  ['js/signup.js', { file: 'js/signup.js', contentType: 'text/javascript; charset=utf-8' }],
  ['js/forgot-password.js', { file: 'js/forgot-password.js', contentType: 'text/javascript; charset=utf-8' }],
  ['js/api-docs.js', { file: 'js/api-docs.js', contentType: 'text/javascript; charset=utf-8' }],
  ['js/pricing.js', { file: 'js/pricing.js', contentType: 'text/javascript; charset=utf-8' }],
  ['js/support-button.js', { file: 'js/support-button.js', contentType: 'text/javascript; charset=utf-8' }],
  ['images/background.jpg', { file: 'images/background.jpg', contentType: 'image/jpeg' }]
]);

registerHttp('staticAsset', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'assets/{category}/{file}',
  handler: async (request) => {
    const key = `${request.params.category}/${request.params.file}`;
    const asset = STATIC_ASSETS.get(key);
    if (!asset) {
      return { status: 404 };
    }

    return {
      status: 200,
      headers: { 'content-type': asset.contentType, 'cache-control': 'public, max-age=3600' },
      body: await readFile(path.join(__dirname, 'src', 'assets', asset.file))
    };
  }
});

const VENDOR_ASSETS = new Map([
  ['css/fontawesome.min.css', { file: ['@fortawesome', 'fontawesome-free', 'css', 'all.min.css'], contentType: 'text/css; charset=utf-8' }],
  ['webfonts/fa-solid-900.woff2', { file: ['@fortawesome', 'fontawesome-free', 'webfonts', 'fa-solid-900.woff2'], contentType: 'font/woff2' }],
  ['webfonts/fa-regular-400.woff2', { file: ['@fortawesome', 'fontawesome-free', 'webfonts', 'fa-regular-400.woff2'], contentType: 'font/woff2' }],
  ['webfonts/fa-brands-400.woff2', { file: ['@fortawesome', 'fontawesome-free', 'webfonts', 'fa-brands-400.woff2'], contentType: 'font/woff2' }],
  ['leaflet/leaflet.css', { file: ['leaflet', 'dist', 'leaflet.css'], contentType: 'text/css; charset=utf-8' }],
  ['leaflet/leaflet.js', { file: ['leaflet', 'dist', 'leaflet.js'], contentType: 'text/javascript; charset=utf-8' }],
  ['leaflet/images/marker-icon.png', { file: ['leaflet', 'dist', 'images', 'marker-icon.png'], contentType: 'image/png' }],
  ['leaflet/images/marker-icon-2x.png', { file: ['leaflet', 'dist', 'images', 'marker-icon-2x.png'], contentType: 'image/png' }],
  ['leaflet/images/marker-shadow.png', { file: ['leaflet', 'dist', 'images', 'marker-shadow.png'], contentType: 'image/png' }],
  ['swagger/swagger-ui.css', { file: ['swagger-ui-dist', 'swagger-ui.css'], contentType: 'text/css; charset=utf-8' }],
  ['swagger/swagger-ui-bundle.js', { file: ['swagger-ui-dist', 'swagger-ui-bundle.js'], contentType: 'text/javascript; charset=utf-8' }]
]);

registerHttp('vendorAsset', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'vendor/{category}/{*file}',
  handler: async (request) => {
    const key = `${request.params.category}/${request.params.file}`;
    const asset = VENDOR_ASSETS.get(key);
    if (!asset) return { status: 404, body: 'Not found.' };
    return {
      status: 200,
      headers: { 'content-type': asset.contentType, 'cache-control': 'public, max-age=86400, immutable' },
      body: await readFile(path.join(__dirname, 'node_modules', ...asset.file))
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
  handler: async (request) => {
    const service = await servicePromise;
    const health = await service.getHealth();
    const missingAppSettings = [];

    if (!config.apiKey) {
      missingAppSettings.push('SHORTLINK_API_KEY');
    }

    if (!config.storageConnectionString && !config.storageTableEndpoint) {
      missingAppSettings.push('AzureWebJobsStorage/AZURE_STORAGE_TABLE_ENDPOINT');
    }

    const identity = await resolveSessionIdentity(request);
    const status = health.status === 'healthy' && missingAppSettings.length === 0 ? 200 : 503;
    if (!identity || identity.role !== 'admin') {
      return { status, jsonBody: { status: status === 200 ? 'healthy' : 'degraded', checkedAt: health.checkedAt } };
    }

    return {
      status,
      jsonBody: {
        ...health,
        config: {
          baseUrl: config.baseUrl,
          apiKeyConfigured: Boolean(config.apiKey),
          storageConnectionConfigured: Boolean(config.storageConnectionString || config.storageTableEndpoint),
          missingAppSettings
        }
      }
    };
  }
});
