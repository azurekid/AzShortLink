'use strict';

const BROWSERS = [
  [/Edg\//i, 'Edge'],
  [/OPR\/|Opera/i, 'Opera'],
  [/Chrome\//i, 'Chrome'],
  [/Firefox\//i, 'Firefox'],
  [/Safari\//i, 'Safari'],
  [/curl\//i, 'curl'],
  [/PowerShell/i, 'PowerShell'],
  [/Postman/i, 'Postman']
];

const OPERATING_SYSTEMS = [
  [/Windows NT/i, 'Windows'],
  [/iPhone|iPad|iPod/i, 'iOS'],
  [/Android/i, 'Android'],
  [/Mac OS X/i, 'macOS'],
  [/CrOS/i, 'ChromeOS'],
  [/Linux/i, 'Linux']
];

const BOT_PATTERN = /bot|crawler|spider|slurp|bingpreview|facebookexternalhit|headless|monitor|preview/i;

function matchFirst(patterns, value, fallback) {
  for (const [pattern, label] of patterns) {
    if (pattern.test(value)) {
      return label;
    }
  }

  return fallback;
}

function parseUserAgent(userAgent) {
  const value = typeof userAgent === 'string' ? userAgent : '';
  if (!value) {
    return { browser: 'Unknown', os: 'Unknown', device: 'unknown' };
  }

  if (BOT_PATTERN.test(value)) {
    return { browser: matchFirst(BROWSERS, value, 'Bot'), os: matchFirst(OPERATING_SYSTEMS, value, 'Unknown'), device: 'bot' };
  }

  const os = matchFirst(OPERATING_SYSTEMS, value, 'Unknown');
  const device = /Mobile|iPhone|iPod|Android.*Mobile/i.test(value)
    ? 'mobile'
    : /iPad|Tablet/i.test(value)
      ? 'tablet'
      : 'desktop';

  return { browser: matchFirst(BROWSERS, value, 'Other'), os, device };
}

function parseReferrer(referrer) {
  if (!referrer || typeof referrer !== 'string') {
    return 'direct';
  }

  try {
    return new URL(referrer).hostname || 'direct';
  } catch {
    return 'direct';
  }
}

module.exports = { parseUserAgent, parseReferrer };
