'use strict';

function getConfig() {
  return {
    tableName: process.env.SHORTLINK_TABLE_NAME || 'AzShortLinks',
    storageConnectionString: process.env.AZURE_STORAGE_CONNECTION_STRING || process.env.AzureWebJobsStorage || '',
    baseUrl: (process.env.PUBLIC_BASE_URL || 'https://azhk.in').replace(/\/$/, ''),
    apiKey: process.env.SHORTLINK_API_KEY || '',
    dashboardUsername: process.env.DASHBOARD_USERNAME || '',
    dashboardPasswordHash: process.env.DASHBOARD_PASSWORD_HASH || '',
    dashboardSessionSecret: process.env.DASHBOARD_SESSION_SECRET || ''
  };
}

module.exports = { getConfig };
