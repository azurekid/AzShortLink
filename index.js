'use strict';

const { app } = require('@azure/functions');
const { getConfig } = require('./src/config');
const { createStorage } = require('./src/storage');
const { ShortLinkService } = require('./src/service/shortLinkService');
const { renderDashboard } = require('./src/dashboard');

const config = getConfig();
const servicePromise = createStorage(config).then((storage) => new ShortLinkService(storage, { baseUrl: config.baseUrl }));

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

  return getApiKeyFromRequest(request) === config.apiKey;
}

function unauthorizedResponse() {
  return {
    status: 401,
    jsonBody: {
      error: 'Unauthorized'
    }
  };
}

app.http('shortenUrl', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'api/shorten',
  handler: async (request) => {
    if (!isAuthorized(request)) {
      return unauthorizedResponse();
    }

    const service = await servicePromise;
    const payload = await request.json();

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

      return { status: 500, jsonBody: { error: 'Unable to create short URL.' } };
    }
  }
});

app.http('redirectUrl', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: '{code}',
  handler: async (request) => {
    const service = await servicePromise;
    const code = request.params.code;
    const result = await service.resolveShortLink(code);

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
    if (!isAuthorized(request)) {
      return unauthorizedResponse();
    }

    const service = await servicePromise;
    const code = request.params.code;
    const links = await service.getStats(code);
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

app.http('dashboard', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'dashboard',
  handler: async (request) => {
    if (!isAuthorized(request)) {
      return unauthorizedResponse();
    }

    const service = await servicePromise;
    const links = await service.getStats('');
    return {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8'
      },
      body: renderDashboard(config.baseUrl, links)
    };
  }
});

app.http('health', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'api/health',
  handler: async () => {
    const service = await servicePromise;
    return {
      status: 200,
      jsonBody: await service.getHealth()
    };
  }
});
