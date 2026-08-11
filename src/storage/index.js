'use strict';

const { InMemoryStorage } = require('./inMemoryStorage');
const { TableStorage } = require('./tableStorage');

async function createStorage(config) {
  if (!config.storageConnectionString) {
    return new InMemoryStorage();
  }

  try {
    return await TableStorage.create(config.storageConnectionString, config.tableName);
  } catch {
    return new InMemoryStorage();
  }
}

module.exports = { createStorage };
