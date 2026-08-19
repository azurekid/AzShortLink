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

function isAllowedRequestOrigin(request, configuredBaseUrl, extraAllowedOrigins = []) {
  const fetchSite = firstHeaderValue(request.headers.get('sec-fetch-site')).toLowerCase();
  const origin = request.headers.get('origin');

  if (fetchSite === 'cross-site') {
    // Cross-site is only permitted for routes that opt in with an explicit allowlist (e.g. a
    // separately hosted static landing page), and only when the browser-supplied Origin matches.
    if (!origin || !extraAllowedOrigins.length) return false;
    try {
      return extraAllowedOrigins.includes(new URL(origin).origin);
    } catch {
      return false;
    }
  }
  if (fetchSite === 'same-origin') return true;
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
    getExternalRequestOrigin(request),
    ...extraAllowedOrigins
  ]).has(suppliedOrigin);
}

module.exports = { getExternalRequestOrigin, isAllowedRequestOrigin };