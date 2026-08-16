'use strict';

const { DefaultAzureCredential } = require('@azure/identity');
const { QueueClient, QueueServiceClient } = require('@azure/storage-queue');

function createPasswordResetQueue(config) {
  let client;
  if (config.storageConnectionString) {
    client = QueueServiceClient.fromConnectionString(config.storageConnectionString).getQueueClient('password-resets');
  } else if (config.storageQueueEndpoint) {
    client = new QueueClient(`${config.storageQueueEndpoint.replace(/\/$/, '')}/password-resets`, new DefaultAzureCredential());
  } else {
    return null;
  }

  return {
    async enqueue(payload) {
      await client.createIfNotExists();
      await client.sendMessage(JSON.stringify(payload));
    }
  };
}

module.exports = { createPasswordResetQueue };
