'use strict';

function firstHeaderValue(value) {
  return String(value || '').split(',')[0].trim();
}

function getExternalRequestOrigin(request) {
  const requestUrl = new URL(request.url);
  const host = firstHeaderValue(request.headers.get('x-forwarded-host')) || firstHeaderValue(request.headers.get('host'));
  const protocol = firstHeaderValue(request.headers.get('x-forwarded-proto')) || requestUrl.protocol.replace(':', '');
  if (!host || !/^https?$/.test(protocol)) return requestUrl.origin;

  try {
    return new URL(`${protocol}://${host}`).origin;
  } catch {
    return requestUrl.origin;
  }
}

function isAllowedRequestOrigin(request, configuredBaseUrl) {
  const origin = request.headers.get('origin');
  if (!origin) return true;

  let suppliedOrigin;
  try {
    suppliedOrigin = new URL(origin).origin;
  } catch {
    return false;
  }

  return new Set([
    new URL(request.url).origin,
    new URL(configuredBaseUrl).origin,
    getExternalRequestOrigin(request)
  ]).has(suppliedOrigin);
}

module.exports = { getExternalRequestOrigin, isAllowedRequestOrigin };