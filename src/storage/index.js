'use strict';

const { InMemoryStorage } = require('./inMemoryStorage');
const { TableStorage } = require('./tableStorage');
const { UnavailableStorage } = require('./unavailableStorage');

async function createStorage(config) {
  if (!config.storageConnectionString) {
    console.warn('[storage] Azure Storage connection string missing; using in-memory storage.');
    return new InMemoryStorage({ tableName: config.tableName });
  }

  try {
    return await TableStorage.create(config.storageConnectionString, config.tableName);
  } catch (err) {
    console.error('[storage] Failed to initialize Azure Table Storage.', err);
    return new UnavailableStorage({
      tableName: config.tableName,
      reason: err
    });
  }
}

module.exports = { createStorage };
