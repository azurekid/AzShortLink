'use strict';

const crypto = require('node:crypto');

// If DASHBOARD_SESSION_SECRET isn't set, derive a stable per-deployment secret from the
// password hash + API key (both already secret) so cookie-signing works with one less setting.
function deriveSessionSecret(passwordHash, apiKey) {
  if (!passwordHash || !apiKey) {
    return '';
  }

  return crypto.createHmac('sha256', passwordHash).update(apiKey).digest('hex');
}

function getConfig() {
  const apiKey = process.env.SHORTLINK_API_KEY || '';
  const dashboardPasswordHash = process.env.DASHBOARD_PASSWORD_HASH || '';

  return {
    tableName: process.env.SHORTLINK_TABLE_NAME || 'AzShortLinks',
    storageConnectionString: process.env.AZURE_STORAGE_CONNECTION_STRING || process.env.AzureWebJobsStorage || '',
    baseUrl: (process.env.PUBLIC_BASE_URL || 'https://azhk.in').replace(/\/$/, ''),
    apiKey,
    dashboardUsername: process.env.DASHBOARD_USERNAME || '',
    dashboardPasswordHash,
    dashboardSessionSecret: process.env.DASHBOARD_SESSION_SECRET || deriveSessionSecret(dashboardPasswordHash, apiKey)
  };
}

module.exports = { getConfig };
