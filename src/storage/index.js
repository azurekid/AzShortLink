'use strict';

const { InMemoryStorage } = require('./inMemoryStorage');
const { TableStorage } = require('./tableStorage');
const { UnavailableStorage } = require('./unavailableStorage');
const { DefaultAzureCredential } = require('@azure/identity');

async function createStorage(config) {
  let storage;
  if (!config.storageConnectionString && !config.storageTableEndpoint) {
    console.warn('[storage] Azure Storage connection string missing; using in-memory storage.');
    storage = new InMemoryStorage({ tableName: config.tableName });
  } else {
    try {
      storage = await TableStorage.create(config.storageConnectionString
        ? { connectionString: config.storageConnectionString }
        : { endpoint: config.storageTableEndpoint, credential: new DefaultAzureCredential() }, {
        links: config.tableName,
        users: config.usersTableName,
        audit: config.auditTableName
      });
    } catch (err) {
      console.error('[storage] Failed to initialize Azure Table Storage.', err);
      return new UnavailableStorage({
        tableName: config.tableName,
        usersTableName: config.usersTableName,
        auditTableName: config.auditTableName,
        reason: err
      });
    }
  }

  // A transient failure here must not reject storagePromise: an unhandled rejection
  // at module load crashes the Functions worker before any function can be indexed.
  try {
    await storage.ensureAdminUser({
      username: config.dashboardUsername,
      passwordHash: config.dashboardPasswordHash
    });
  } catch (err) {
    console.error('[storage] Failed to bootstrap the admin profile; it will be retried next cold start.', err);
  }

  return storage;
}

module.exports = { createStorage };
