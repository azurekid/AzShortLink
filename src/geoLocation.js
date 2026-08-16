'use strict';

const net = require('node:net');
const geoip = require('geoip-lite');

const countryNames = new Intl.DisplayNames(['en'], { type: 'region' });

function normalizeIp(value) {
  let candidate = String(value || '').split(',')[0].trim();
  if (candidate.startsWith('[')) candidate = candidate.slice(1, candidate.indexOf(']'));
  if (net.isIP(candidate)) return candidate;

  const ipv4WithPort = candidate.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/);
  return ipv4WithPort && net.isIP(ipv4WithPort[1]) ? ipv4WithPort[1] : '';
}

function lookupGeoLocation(value) {
  const ip = normalizeIp(value);
  if (!ip) return null;

  const result = geoip.lookup(ip);
  if (!result || !result.country) return null;

  const latitude = Number(result.ll?.[0]);
  const longitude = Number(result.ll?.[1]);
  return {
    countryCode: result.country,
    country: countryNames.of(result.country) || result.country,
    region: result.region || '',
    city: result.city || '',
    latitude: Number.isFinite(latitude) ? Number(latitude.toFixed(1)) : null,
    longitude: Number.isFinite(longitude) ? Number(longitude.toFixed(1)) : null
  };
}

module.exports = { normalizeIp, lookupGeoLocation };