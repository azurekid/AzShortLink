'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '..');

test('global HTTP security policy includes transport and browser hardening', () => {
  const source = readFileSync(join(root, 'index.js'), 'utf8');

  assert.match(source, /strict-transport-security/);
  assert.match(source, /max-age=63072000; includeSubDomains; preload/);
  assert.match(source, /permissions-policy/);
  assert.match(source, /cross-origin-opener-policy/);
  assert.doesNotMatch(source, /script-src[^\n]*unsafe-inline/);
  assert.match(source, /Cross-origin request denied/);
});

test('Azure infrastructure uses managed identity and default-deny data access', () => {
  const source = readFileSync(join(root, 'infra', 'main.bicep'), 'utf8');

  assert.match(source, /allowSharedKeyAccess: false/);
  assert.match(source, /defaultToOAuthAuthentication: true/);
  assert.match(source, /AzureWebJobsStorage__credential/);
  assert.match(source, /value: 'managedidentity'/);
  assert.match(source, /storageTableDataContributorRoleDefinitionId/);
  assert.match(source, /defaultAction: 'Deny'/);
  assert.match(source, /virtualNetworkSubnetId: appIntegrationSubnet\.id/);
  assert.doesNotMatch(source, /listKeys\(\)/);
});

test('production CORS excludes local development origins by default', () => {
  const source = readFileSync(join(root, 'infra', 'main.bicep'), 'utf8');
  const parameters = readFileSync(join(root, 'infra', 'main.bicepparam'), 'utf8');

  assert.match(source, /param includeLocalDevCorsOrigins bool = false/);
  assert.match(source, /includeLocalDevCorsOrigins \? union/);
  assert.match(parameters, /param includeLocalDevCorsOrigins = false/);
});