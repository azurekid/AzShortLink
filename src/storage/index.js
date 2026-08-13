'use strict';

const { InMemoryStorage } = require('./inMemoryStorage');
const { TableStorage } = require('./tableStorage');
const { UnavailableStorage } = require('./unavailableStorage');

async function createStorage(config) {
  let storage;
  if (!config.storageConnectionString) {
    console.warn('[storage] Azure Storage connection string missing; using in-memory storage.');
    storage = new InMemoryStorage({ tableName: config.tableName });
  } else {
    try {
      storage = await TableStorage.create(config.storageConnectionString, config.tableName);
    } catch (err) {
      console.error('[storage] Failed to initialize Azure Table Storage.', err);
      return new UnavailableStorage({
        tableName: config.tableName,
        reason: err
      });
    }
  }

  await storage.ensureAdminUser({
    username: config.dashboardUsername,
    passwordHash: config.dashboardPasswordHash
  });
  return storage;
}

module.exports = { createStorage };
