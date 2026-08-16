'use strict';

const { DefaultAzureCredential } = require('@azure/identity');
const { QueueClient, QueueServiceClient } = require('@azure/storage-queue');

function createPasswordResetQueue(config, options = {}) {
  let client;
  let createQueue = false;
  if (options.client) {
    client = options.client;
    createQueue = Boolean(options.createQueue);
  } else
  if (config.storageConnectionString) {
    client = QueueServiceClient.fromConnectionString(config.storageConnectionString).getQueueClient('password-resets');
    createQueue = true;
  } else if (config.storageQueueEndpoint) {
    client = new QueueClient(`${config.storageQueueEndpoint.replace(/\/$/, '')}/password-resets`, new DefaultAzureCredential());
  } else {
    return null;
  }

  return {
    async enqueue(payload) {
      if (createQueue) await client.createIfNotExists();
      await client.sendMessage(JSON.stringify(payload));
    }
  };
}

module.exports = { createPasswordResetQueue };
