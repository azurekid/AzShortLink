'use strict';

const { app } = require('@azure/functions');
const { getConfig } = require('./src/config');
const { createStorage } = require('./src/storage');
const { ShortLinkService } = require('./src/service/shortLinkService');
const { renderDashboard } = require('./src/dashboard');

const config = getConfig();
const servicePromise = createStorage(config).then((storage) => new ShortLinkService(storage, { baseUrl: config.baseUrl }));

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

app.http('dashboard', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'dashboard',
  handler: async () => {
    return {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8'
      },
      body: renderDashboard(config.baseUrl, {
        apiKeyConfigured: Boolean(config.apiKey)
      })
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
