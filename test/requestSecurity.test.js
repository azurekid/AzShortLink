'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getExternalRequestOrigin, isAllowedRequestOrigin } = require('../src/core/requestSecurity');

function request({ url = 'https://func-internal.azurewebsites.net/dashboard/login', origin, host, forwardedHost, forwardedProto, fetchSite } = {}) {
  const headers = new Headers();
  if (origin) headers.set('origin', origin);
  if (host) headers.set('host', host);
  if (forwardedHost) headers.set('x-forwarded-host', forwardedHost);
  if (forwardedProto) headers.set('x-forwarded-proto', forwardedProto);
  if (fetchSite) headers.set('sec-fetch-site', fetchSite);
  return { url, headers };
}

test('allows the configured public origin behind an Azure internal request URL', () => {
  const incoming = request({ origin: 'https://azhk.in', forwardedHost: 'azhk.in', forwardedProto: 'https' });

  assert.equal(getExternalRequestOrigin(incoming), 'https://azhk.in');
  assert.equal(isAllowedRequestOrigin(incoming, 'https://azhk.in'), true);
});

test('allows a valid www custom-domain origin from the forwarded host', () => {
  const incoming = request({ origin: 'https://www.azhk.in', forwardedHost: 'www.azhk.in', forwardedProto: 'https' });

  assert.equal(isAllowedRequestOrigin(incoming, 'https://azhk.in'), true);
});

test('rejects an unrelated browser origin', () => {
  const incoming = request({ origin: 'https://attacker.example', host: 'azhk.in', forwardedProto: 'https' });

  assert.equal(isAllowedRequestOrigin(incoming, 'https://azhk.in'), false);
});

test('accepts browser-confirmed same-origin requests despite proxy origin rewriting', () => {
  const incoming = request({
    origin: 'https://azhk.in',
    host: 'func-internal.azurewebsites.net',
    forwardedHost: 'func-internal.azurewebsites.net',
    forwardedProto: 'https',
    fetchSite: 'same-origin'
  });

  assert.equal(isAllowedRequestOrigin(incoming, 'https://different-config.example'), true);
});

test('rejects browser-confirmed cross-site requests even with a spoofed forwarded host', () => {
  const incoming = request({ origin: 'https://attacker.example', forwardedHost: 'attacker.example', forwardedProto: 'https', fetchSite: 'cross-site' });

  assert.equal(isAllowedRequestOrigin(incoming, 'https://azhk.in'), false);
});

test('allows requests without Origin such as server clients and same-origin legacy forms', () => {
  assert.equal(isAllowedRequestOrigin(request({ host: 'azhk.in' }), 'https://azhk.in'), true);
});