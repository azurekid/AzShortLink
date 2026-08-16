'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildOpenApiSpec } = require('../src/openApi');

test('builds an OpenAPI document for every public API route', () => {
  const spec = buildOpenApiSpec('https://short.example');

  assert.equal(spec.openapi, '3.0.3');
  assert.equal(spec.servers[0].url, 'https://short.example');
  assert.ok(spec.paths['/api/shorten'].post);
  assert.ok(spec.paths['/api/stats/{code}'].get);
  assert.equal(spec.paths['/api/links/{code}/qr'].get.responses[200].content['image/png'].schema.format, 'binary');
  assert.ok(spec.paths['/api/profile/apikey'].post);
  assert.ok(spec.paths['/api/users/{username}/password'].post);
  assert.ok(spec.paths['/api/invites/{code}'].delete);
  assert.ok(spec.paths['/api/audit'].get);
  assert.ok(spec.paths['/api/health'].get);
  assert.deepEqual(spec.paths['/api/shorten'].post.security, [{ ApiKeyHeader: [] }, { BearerAuth: [] }, { DashboardSession: [] }]);
  assert.equal(spec.paths['/api/health'].get.security, undefined);
  assert.ok(spec.components.securitySchemes.ApiKeyHeader);
});