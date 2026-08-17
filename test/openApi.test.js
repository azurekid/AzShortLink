'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildOpenApiSpec } = require('../src/api/openApi');

test('builds a user OpenAPI document without administrator operations by default', () => {
  const spec = buildOpenApiSpec('https://short.example');

  assert.equal(spec.openapi, '3.0.3');
  assert.equal(spec.servers[0].url, 'https://short.example');
  assert.ok(spec.paths['/api/shorten'].post);
  assert.ok(spec.paths['/api/stats/{code}'].get);
  assert.equal(spec.paths['/api/links/{code}/qr'].get.responses[200].content['image/png'].schema.format, 'binary');
  assert.ok(spec.paths['/api/profile/apikey'].post);
  assert.equal(spec.paths['/api/users'], undefined);
  assert.equal(spec.paths['/api/users/{username}/password'], undefined);
  assert.equal(spec.paths['/api/invites'].get, undefined);
  assert.ok(spec.paths['/api/invites'].post);
  assert.equal(spec.paths['/api/invites/{code}'], undefined);
  assert.equal(spec.paths['/api/audit'], undefined);
  assert.ok(spec.paths['/api/health'].get);
  assert.equal(spec.tags.some((tag) => tag.name === 'Administration'), false);
  assert.deepEqual(spec.paths['/api/shorten'].post.security, [{ ApiKeyHeader: [] }, { BearerAuth: [] }, { DashboardSession: [] }]);
  assert.equal(spec.paths['/api/health'].get.security, undefined);
  assert.ok(spec.components.securitySchemes.ApiKeyHeader);
});

test('the custom alias example stays short instead of being generated from the pattern', () => {
  const alias = buildOpenApiSpec('https://short.example').components.schemas.ShortLinkRequest.properties.uniqueValue;

  assert.ok(alias.example.length <= 6, alias.example);
  assert.match(alias.example, new RegExp(alias.pattern));
});

test('includes administrator operations for an admin document', () => {
  const spec = buildOpenApiSpec('https://short.example', { includeAdmin: true });

  assert.ok(spec.paths['/api/users'].get);
  assert.ok(spec.paths['/api/users/{username}/password'].post);
  assert.ok(spec.paths['/api/invites'].get);
  assert.ok(spec.paths['/api/invites'].post);
  assert.ok(spec.paths['/api/invites/{code}'].delete);
  assert.ok(spec.paths['/api/audit'].get);
  assert.ok(spec.paths['/api/audit'].get.parameters.some((parameter) => parameter.name === 'channel'));
  assert.equal(spec.components.schemas.AuditEvent.properties.details.type, 'object');
  assert.match(spec.components.schemas.AuditEvent.properties.details.description, /userName/);
  assert.equal(spec.tags.some((tag) => tag.name === 'Administration'), true);
});