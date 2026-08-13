'use strict';

const { app } = require('@azure/functions');
const { getConfig } = require('./src/config');
const { createStorage } = require('./src/storage');
const { ShortLinkService } = require('./src/service/shortLinkService');
const { renderDashboard } = require('./src/dashboard');
const { renderLoginPage } = require('./src/loginPage');
const {
  verifyCredentials,
  createSessionToken,
  buildSessionCookie,
  buildClearedSessionCookie,
  isDashboardSessionValid,
  timingSafeEqualString
} = require('./src/auth');

const config = getConfig();
const servicePromise = createStorage(config).then((storage) => new ShortLinkService(storage, { baseUrl: config.baseUrl }));
const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'"
};

function configurationErrorResponse() {
  return {
    status: 503,
    jsonBody: {
      error: 'SHORTLINK_API_KEY is not configured. Set the app setting and restart the Function App.'
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

function isAuthorized(request) {
  if (!config.apiKey) {
    return false;
  }

  return timingSafeEqualString(getApiKeyFromRequest(request), config.apiKey);
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
    if (!config.apiKey) {
      return configurationErrorResponse();
    }

    if (!isAuthorized(request)) {
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
      const result = await service.createShortLink(payload);
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
        location: '/dashboard',
        'cache-control': 'no-store'
      }
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
      result = await service.resolveShortLink(code);
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
    if (!config.apiKey) {
      return configurationErrorResponse();
    }

    if (!isAuthorized(request)) {
      return unauthorizedResponse();
    }

    const service = await servicePromise;
    const code = request.params.code;
    let links;

    try {
      links = await service.getStats(code);
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

function dashboardAuthConfigured() {
  return Boolean(config.dashboardUsername && config.dashboardPasswordHash && config.dashboardSessionSecret);
}

function dashboardConfigErrorResponse() {
  return {
    status: 503,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
    body: 'Dashboard login is not configured. Set DASHBOARD_USERNAME, DASHBOARD_PASSWORD_HASH and DASHBOARD_SESSION_SECRET app settings.'
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
        apiKeyConfigured: Boolean(config.apiKey)
      })
    };
  }
});

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

    const valid = await verifyCredentials(username, password, config);
    if (!valid) {
      recordFailedAttempt(ip);
      return {
        status: 401,
        headers: { 'content-type': 'text/html; charset=utf-8', ...SECURITY_HEADERS },
        body: renderLoginPage({ error: 'Invalid username or password.' })
      };
    }

    clearAttempts(ip);
    const token = createSessionToken(config.dashboardUsername, config.dashboardSessionSecret);
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
