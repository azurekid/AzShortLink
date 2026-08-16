'use strict';

function getConfig() {
  const apiKey = process.env.SHORTLINK_API_KEY || '';
  const dashboardPasswordHash = process.env.DASHBOARD_PASSWORD_HASH || '';
  const tableName = process.env.SHORTLINK_TABLE_NAME || 'AzShortLinks';

  return {
    tableName,
    // Users/credentials and the audit log are kept in separate physical tables from link
    // data so a filter bug, overly-broad SAS, or scoped RBAC role can't cross-leak between
    // them - splitting by data sensitivity limits the blast radius of a misconfiguration.
    usersTableName: process.env.SHORTLINK_USERS_TABLE_NAME || `${tableName}Users`,
    auditTableName: process.env.SHORTLINK_AUDIT_TABLE_NAME || `${tableName}Audit`,
    storageConnectionString: process.env.AZURE_STORAGE_CONNECTION_STRING || process.env.AzureWebJobsStorage || '',
    storageQueueEndpoint: process.env.AZURE_STORAGE_QUEUE_ENDPOINT || '',
    storageTableEndpoint: process.env.AZURE_STORAGE_TABLE_ENDPOINT || '',
    baseUrl: (process.env.PUBLIC_BASE_URL || 'https://azhk.in').replace(/\/$/, ''),
    apiKey,
    dashboardUsername: process.env.DASHBOARD_USERNAME || '',
    dashboardPasswordHash,
    dashboardSessionSecret: process.env.DASHBOARD_SESSION_SECRET || '',
    identityHashSecret: process.env.IDENTITY_HASH_SECRET || '',
    emailConnectionString: process.env.COMMUNICATION_SERVICES_CONNECTION_STRING || '',
    emailSenderAddress: process.env.EMAIL_SENDER_ADDRESS || ''
  };
}

module.exports = { getConfig };
