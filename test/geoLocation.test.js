'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeIp, lookupGeoLocation } = require('../src/analytics/geoLocation');

test('normalizes trusted proxy IP header values', () => {
  assert.equal(normalizeIp('8.8.8.8, 10.0.0.1'), '8.8.8.8');
  assert.equal(normalizeIp('8.8.8.8:443'), '8.8.8.8');
  assert.equal(normalizeIp('[2001:4860:4860::8888]:443'), '2001:4860:4860::8888');
  assert.equal(normalizeIp('not-an-ip'), '');
});

test('looks up public IPs locally and ignores private addresses', () => {
  const location = lookupGeoLocation('8.8.8.8');

  assert.equal(location.countryCode, 'US');
  assert.equal(location.country, 'United States');
  assert.equal(lookupGeoLocation('127.0.0.1'), null);
});