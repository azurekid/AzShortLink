'use strict';

const ADMIN_ONLY = Symbol('adminOnly');

function buildOpenApiSpec(baseUrl, options = {}) {
  const spec = {
    openapi: '3.0.3',
    info: {
      title: 'AzShortLink API',
      version: '1.0.0',
      description: 'Create, manage, and analyze short links. Open `/api` for an interactive reference.'
    },
    servers: [{ url: baseUrl, description: 'Current deployment' }],
    tags: [
      { name: 'Links' },
      { name: 'Analytics' },
      { name: 'Profile' },
      { name: 'Administration' },
      { name: 'Invites' },
      { name: 'Plans' },
      { name: 'Operations' }
    ],
    paths: {
      '/api/shorten': {
        post: operation('Create a short link', 'Links', {
          description: 'Counts against the daily new-link quota of the account plan.',
          requestBody: jsonBody('ShortLinkRequest'),
          responses: { 201: jsonResponse('ShortLink'), 400: errorResponse(), 401: errorResponse(), 409: errorResponse(), 429: jsonResponse('QuotaError') }
        })
      },
      '/api/stats': {
        get: operation('List short-link statistics', 'Links', {
          parameters: [scopeParameter()],
          responses: { 200: jsonResponse('LinkStatsList'), 401: errorResponse() }
        })
      },
      '/api/stats/{code}': {
        get: operation('Get statistics for one short link', 'Links', {
          parameters: [codeParameter(), scopeParameter()],
          responses: { 200: jsonResponse('LinkStatsList'), 401: errorResponse() }
        })
      },
      '/api/links/{code}': {
        delete: operation('Delete a short link', 'Links', {
          parameters: [codeParameter()],
          responses: { 200: jsonResponse('DeleteLinkResponse'), 401: errorResponse(), 403: errorResponse(), 404: errorResponse() }
        })
      },
      '/api/links/{code}/qr': {
        get: operation('Download a short-link QR code', 'Links', {
          description: 'Returns a 512px PNG encoding the public short URL.',
          parameters: [codeParameter()],
          responses: {
            200: { description: 'QR code PNG.', content: { 'image/png': { schema: { type: 'string', format: 'binary' } } } },
            401: errorResponse(),
            404: errorResponse()
          }
        })
      },
      '/api/analytics': {
        get: operation('Get aggregate redirect analytics', 'Analytics', {
          parameters: [scopeParameter(), { name: 'code', in: 'query', description: 'Restrict analytics to one accessible short link.', schema: { type: 'string' } }],
          responses: { 200: jsonResponse('AnalyticsResponse'), 401: errorResponse() }
        })
      },
      '/api/profile': {
        get: sessionOperation('Get the signed-in profile', 'Profile', { responses: { 200: jsonResponse('Profile'), 401: errorResponse() } })
      },
      '/api/profile/password': {
        post: sessionOperation('Change the signed-in profile password', 'Profile', {
          requestBody: jsonBody('ChangePasswordRequest'),
          responses: { 200: jsonResponse('UpdateResponse'), 400: errorResponse(), 401: errorResponse() }
        })
      },
      '/api/profile/apikey': {
        post: sessionOperation('Generate a personal API key', 'Profile', {
          description: 'The plaintext key is returned only once.',
          responses: { 201: jsonResponse('ApiKeyResponse'), 401: errorResponse() }
        })
      },
      '/api/profile/passkeys/options': {
        post: sessionOperation('Begin passkey registration', 'Profile', { responses: { 200: jsonResponse('PasskeyOptionsResponse'), 401: errorResponse() } })
      },
      '/api/profile/passkeys/verify': {
        post: sessionOperation('Complete passkey registration', 'Profile', {
          requestBody: jsonBody('PasskeyVerifyRequest'),
          responses: { 201: jsonResponse('PasskeyRegisteredResponse'), 400: errorResponse(), 401: errorResponse() }
        })
      },
      '/api/users': {
        get: adminOperation('List profiles', 'Administration', { responses: { 200: jsonResponse('UsersResponse'), 401: errorResponse() } }),
        post: adminOperation('Create a profile', 'Administration', {
          requestBody: jsonBody('CreateUserRequest'),
          responses: { 201: jsonResponse('User'), 400: errorResponse(), 401: errorResponse(), 409: errorResponse() }
        })
      },
      '/api/users/{username}': {
        delete: adminOperation('Delete a profile', 'Administration', {
          parameters: [usernameParameter()],
          responses: { 204: { description: 'Profile deleted.' }, 400: errorResponse(), 401: errorResponse(), 404: errorResponse() }
        })
      },
      '/api/users/{username}/password': {
        post: adminOperation('Reset another profile password', 'Administration', {
          parameters: [usernameParameter()],
          requestBody: jsonBody('ResetPasswordRequest'),
          responses: { 200: jsonResponse('UpdateResponse'), 400: errorResponse(), 401: errorResponse(), 404: errorResponse() }
        })
      },
      '/api/users/{username}/access': {
        patch: adminOperation('Change profile role or approval status', 'Administration', {
          parameters: [usernameParameter()],
          requestBody: jsonBody('UserAccessRequest'),
          responses: { 200: jsonResponse('UpdateResponse'), 400: errorResponse(), 401: errorResponse(), 404: errorResponse(), 409: errorResponse() }
        })
      },
      '/api/users/{username}/branch': {
        post: adminOperation('Suspend or restore an invitation branch', 'Administration', {
          parameters: [usernameParameter()],
          requestBody: jsonBody('BranchSuspensionRequest'),
          responses: { 200: jsonResponse('UpdateResponse'), 401: errorResponse(), 404: errorResponse() }
        })
      },
      '/api/invites': {
        get: adminOperation('List invite links', 'Invites', { responses: { 200: jsonResponse('InvitesResponse'), 401: errorResponse() } }),
        post: operation('Create an invite link', 'Invites', { responses: { 201: jsonResponse('Invite'), 401: errorResponse(), 409: errorResponse() } })
      },
      '/api/invites/mine': {
        get: operation('Get your invite link', 'Invites', { responses: { 200: jsonResponse('MyInviteResponse'), 401: errorResponse() } })
      },
      '/api/invites/{code}': {
        delete: adminOperation('Revoke an invite link', 'Invites', {
          parameters: [codeParameter()],
          responses: { 204: { description: 'Invite revoked.' }, 401: errorResponse(), 404: errorResponse(), 409: errorResponse() }
        })
      },
      '/api/plans': {
        get: { summary: 'List the available plans and their limits', tags: ['Plans'], responses: { 200: jsonResponse('PlansResponse') } }
      },
      '/api/account/plan': {
        get: operation('Get the current plan, limits and daily usage', 'Plans', {
          responses: { 200: jsonResponse('AccountPlanResponse'), 401: errorResponse() }
        }),
        post: sessionOperation('Request a plan change', 'Plans', {
          description: 'Downgrades to a free plan apply immediately; paid plans are activated once payment is confirmed.',
          requestBody: jsonBody('PlanChangeRequest'),
          responses: { 200: jsonResponse('PlanChangeResponse'), 202: jsonResponse('PlanChangeResponse'), 400: errorResponse(), 401: errorResponse() }
        })
      },
      '/api/users/{username}/plan': {
        patch: adminOperation('Assign a plan to a profile', 'Administration', {
          parameters: [usernameParameter()],
          requestBody: jsonBody('SetUserPlanRequest'),
          responses: { 200: jsonResponse('UpdateResponse'), 400: errorResponse(), 401: errorResponse(), 404: errorResponse() }
        })
      },
      '/api/admin/notifications': {
        get: adminOperation('List items awaiting administrator action', 'Administration', {
          description: 'Pending plan requests, open help requests and profiles awaiting approval.',
          responses: { 200: jsonResponse('AdminNotificationsResponse'), 401: errorResponse() }
        })
      },
      '/api/audit': {
        get: adminOperation('List audit events', 'Administration', {
          parameters: [
            { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 1000, default: 200 } },
            { name: 'since', in: 'query', schema: { type: 'string', format: 'date-time' } },
            { name: 'action', in: 'query', schema: { type: 'string' } },
            { name: 'actor', in: 'query', schema: { type: 'string' } },
            { name: 'channel', in: 'query', schema: { type: 'string', enum: ['api', 'dashboard'] } },
            { name: 'outcome', in: 'query', schema: { type: 'string', enum: ['success', 'failure'] } },
            { name: 'authenticationMethod', in: 'query', schema: { type: 'string', enum: ['anonymous', 'password', 'passkey', 'session', 'personal_api_key', 'deployment_api_key'] } },
            { name: 'sourceCountryCode', in: 'query', schema: { type: 'string', minLength: 2, maxLength: 2 } }
          ],
          responses: { 200: jsonResponse('AuditResponse'), 401: errorResponse() }
        })
      },
      '/api/health': {
        get: {
          summary: 'Get service health',
          tags: ['Operations'],
          responses: { 200: jsonResponse('HealthResponse'), 503: jsonResponse('HealthResponse') }
        }
      }
    },
    components: {
      securitySchemes: {
        ApiKeyHeader: { type: 'apiKey', in: 'header', name: 'x-api-key' },
        BearerAuth: { type: 'http', scheme: 'bearer' },
        DashboardSession: { type: 'apiKey', in: 'cookie', name: 'azsl_session' }
      },
      schemas: {
        Error: { type: 'object', required: ['error'], properties: { error: { type: 'string' } } },
        ShortLinkRequest: { type: 'object', required: ['url'], properties: { url: { type: 'string', format: 'uri' }, uniqueValue: { type: 'string', pattern: '^[A-Za-z0-9_-]{4,32}$' } } },
        ShortLink: { type: 'object', properties: { code: { type: 'string' }, shortUrl: { type: 'string', format: 'uri' }, targetUrl: { type: 'string', format: 'uri' } } },
        LinkStats: { type: 'object', properties: { code: { type: 'string' }, targetUrl: { type: 'string', format: 'uri' }, redirectCount: { type: 'integer' }, lastAccessedAt: { type: 'string', format: 'date-time', nullable: true }, ownerId: { type: 'string' } } },
        LinkStatsList: { type: 'object', properties: { baseUrl: { type: 'string', format: 'uri' }, total: { type: 'integer' }, links: { type: 'array', items: { $ref: '#/components/schemas/LinkStats' } } } },
        DeleteLinkResponse: { type: 'object', properties: { deleted: { type: 'boolean' }, code: { type: 'string' } } },
        AnalyticsResponse: { type: 'object', additionalProperties: true },
        Profile: { type: 'object', properties: { username: { type: 'string' }, displayName: { type: 'string' }, role: { type: 'string', enum: ['admin', 'user'] }, apiKeyPrefix: { type: 'string' }, apiKeyCreatedAt: { type: 'string', format: 'date-time' }, plan: { type: 'string', enum: ['free', 'pro', 'business'] }, planName: { type: 'string' }, planExpiresAt: { type: 'string' } } },
        QuotaError: { type: 'object', properties: { error: { type: 'string' }, plan: { type: 'string' }, limit: { type: 'integer' }, resetAt: { type: 'string', format: 'date-time' }, upgradeUrl: { type: 'string', format: 'uri' } } },
        Plan: {
          type: 'object',
          properties: {
            id: { type: 'string', enum: ['free', 'pro', 'business'] }, name: { type: 'string' }, priceEurPerMonth: { type: 'number' },
            linksPerDay: { type: 'integer' }, redirectsPerDay: { type: 'integer' }, apiRequestsPerMinute: { type: 'integer' },
            highlights: { type: 'array', items: { type: 'string' } }
          }
        },
        PlansResponse: { type: 'object', properties: { plans: { type: 'array', items: { $ref: '#/components/schemas/Plan' } } } },
        AccountPlanResponse: {
          type: 'object',
          properties: {
            plan: { type: 'string' }, planName: { type: 'string' }, planExpiresAt: { type: 'string' },
            pendingPlan: { type: 'string', description: 'Plan the account requested; activated by an administrator.' },
            pendingPlanRequestedAt: { type: 'string' },
            limits: { type: 'object', properties: { linksPerDay: { type: 'integer' }, redirectsPerDay: { type: 'integer' }, apiRequestsPerMinute: { type: 'integer' } } },
            usage: { type: 'object', properties: { linksToday: { type: 'integer' }, redirectsToday: { type: 'integer' }, resetAt: { type: 'string', format: 'date-time' } } }
          }
        },
        PlanChangeRequest: { type: 'object', required: ['plan'], properties: { plan: { type: 'string', enum: ['free', 'pro', 'business'] } } },
        PlanChangeResponse: { type: 'object', properties: { plan: { type: 'string' }, requestedPlan: { type: 'string' }, pending: { type: 'boolean' }, message: { type: 'string' } } },
        AdminNotificationsResponse: {
          type: 'object',
          properties: {
            total: { type: 'integer' }, openHelpRequests: { type: 'integer' }, pendingApprovals: { type: 'integer' },
            planRequests: {
              type: 'array',
              items: {
                type: 'object',
                properties: { username: { type: 'string' }, displayName: { type: 'string' }, currentPlan: { type: 'string' }, requestedPlan: { type: 'string' }, requestedAt: { type: 'string', format: 'date-time' } }
              }
            }
          }
        },
        SetUserPlanRequest: { type: 'object', required: ['plan'], properties: { plan: { type: 'string', enum: ['free', 'pro', 'business'] }, expiresAt: { type: 'string', format: 'date-time', description: 'Optional end of the paid period; the account falls back to Free afterwards.' } } },
        ChangePasswordRequest: { type: 'object', required: ['currentPassword', 'newPassword'], properties: { currentPassword: { type: 'string', format: 'password' }, newPassword: { type: 'string', format: 'password', minLength: 12 } } },
        ResetPasswordRequest: { type: 'object', required: ['newPassword'], properties: { newPassword: { type: 'string', format: 'password', minLength: 12 } } },
        UpdateResponse: { type: 'object', properties: { updated: { type: 'boolean' }, message: { type: 'string' } } },
        ApiKeyResponse: { type: 'object', properties: { apiKey: { type: 'string', description: 'Shown once; store securely.' }, displayPrefix: { type: 'string' }, createdAt: { type: 'string', format: 'date-time' } } },
        User: { type: 'object', properties: { username: { type: 'string' }, displayName: { type: 'string' }, role: { type: 'string', enum: ['admin', 'user'] }, createdAt: { type: 'string', format: 'date-time' } } },
        CreateUserRequest: { type: 'object', required: ['username', 'password'], properties: { username: { type: 'string', pattern: '^[A-Za-z0-9._-]{3,64}$' }, displayName: { type: 'string' }, password: { type: 'string', format: 'password', minLength: 12 }, role: { type: 'string', enum: ['user', 'admin'] } } },
        UserAccessRequest: { type: 'object', properties: { role: { type: 'string', enum: ['user', 'admin'] }, status: { type: 'string', enum: ['active', 'pending_approval', 'suspended'] } } },
        BranchSuspensionRequest: { type: 'object', required: ['suspended'], properties: { suspended: { type: 'boolean' } } },
        PasskeyOptionsResponse: { type: 'object', properties: { options: { type: 'object', additionalProperties: true }, state: { type: 'string' } } },
        PasskeyVerifyRequest: { type: 'object', required: ['response', 'state'], properties: { response: { type: 'object', additionalProperties: true }, state: { type: 'string' } } },
        PasskeyRegisteredResponse: { type: 'object', properties: { registered: { type: 'boolean' }, credentialId: { type: 'string' } } },
        UsersResponse: { type: 'object', properties: { total: { type: 'integer' }, users: { type: 'array', items: { $ref: '#/components/schemas/User' } } } },
        Invite: { type: 'object', properties: { code: { type: 'string' }, inviteUrl: { type: 'string', format: 'uri' }, createdAt: { type: 'string', format: 'date-time' }, createdBy: { type: 'string' }, redeemed: { type: 'boolean' } } },
        InvitesResponse: { type: 'object', properties: { total: { type: 'integer' }, invites: { type: 'array', items: { $ref: '#/components/schemas/Invite' } } } },
        MyInviteResponse: { type: 'object', properties: { invite: { allOf: [{ $ref: '#/components/schemas/Invite' }], nullable: true } } },
        AuditSource: {
          type: 'object',
          properties: {
            country: { type: 'string' }, countryCode: { type: 'string' }, region: { type: 'string' }, city: { type: 'string' },
            latitude: { type: 'number', nullable: true }, longitude: { type: 'number', nullable: true }
          }
        },
        AuditEvent: {
          type: 'object',
          required: ['schemaVersion', 'eventId', 'timestamp', 'action', 'category', 'outcome', 'channel'],
          properties: {
            schemaVersion: { type: 'integer' }, eventId: { type: 'string', format: 'uuid' }, timestamp: { type: 'string', format: 'date-time' },
            action: { type: 'string' }, category: { type: 'string', enum: ['authentication', 'identity', 'link', 'invite', 'security', 'billing', 'application'] },
            outcome: { type: 'string', enum: ['success', 'failure'] }, actorId: { type: 'string' }, actorUsername: { type: 'string' }, actorRole: { type: 'string' },
            channel: { type: 'string', enum: ['api', 'dashboard', 'unknown'] }, authenticationMethod: { type: 'string' }, sourceIp: { type: 'string' },
            userAgent: { type: 'string' }, httpMethod: { type: 'string' }, requestPath: { type: 'string' }, source: { $ref: '#/components/schemas/AuditSource' },
            details: { type: 'object', description: 'Action-specific fields. User targets always use `userName`; resources use `linkCode` or `inviteCode`.' }
          }
        },
        AuditResponse: {
          type: 'object',
          properties: { retentionDays: { type: 'integer' }, total: { type: 'integer' }, events: { type: 'array', items: { $ref: '#/components/schemas/AuditEvent' } } }
        },
        HealthResponse: { type: 'object', additionalProperties: true }
      }
    }
  };

  if (!options.includeAdmin) {
    for (const [path, pathItem] of Object.entries(spec.paths)) {
      for (const [method, pathOperation] of Object.entries(pathItem)) {
        if (pathOperation[ADMIN_ONLY]) delete pathItem[method];
      }
      if (Object.keys(pathItem).length === 0) delete spec.paths[path];
    }
    spec.tags = spec.tags.filter((tag) => tag.name !== 'Administration');
  }

  return spec;
}

function operation(summary, tag, options = {}) {
  return { summary, tags: [tag], security: [{ ApiKeyHeader: [] }, { BearerAuth: [] }, { DashboardSession: [] }], ...options };
}

function sessionOperation(summary, tag, options = {}) {
  return { summary, tags: [tag], security: [{ DashboardSession: [] }], ...options };
}

function adminOperation(summary, tag, options = {}) {
  return {
    ...operation(summary, tag, options),
    description: `${options.description ? `${options.description} ` : ''}Requires an administrator identity.`,
    [ADMIN_ONLY]: true
  };
}

function jsonBody(schemaName) {
  return { required: true, content: { 'application/json': { schema: { $ref: `#/components/schemas/${schemaName}` } } } };
}

function jsonResponse(schemaName) {
  return { description: 'Success.', content: { 'application/json': { schema: { $ref: `#/components/schemas/${schemaName}` } } } };
}

function errorResponse() {
  return { description: 'Request failed.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } };
}

function codeParameter() {
  return { name: 'code', in: 'path', required: true, schema: { type: 'string' } };
}

function usernameParameter() {
  return { name: 'username', in: 'path', required: true, schema: { type: 'string' } };
}

function scopeParameter() {
  return { name: 'scope', in: 'query', description: 'Administrators may use `mine` to restrict results to their own links.', schema: { type: 'string', enum: ['mine'] } };
}

module.exports = { buildOpenApiSpec };