'use strict';

const { TableClient } = require('@azure/data-tables');

const PARTITION_KEY = 'LINK';
const USER_PARTITION_KEY = 'USER';

class TableStorage {
  constructor(client, options = {}) {
    this.client = client;
    this.tableName = options.tableName || '';
  }

  async createUser({ username, passwordHash, displayName, role = 'user', createdAt }) {
    const userId = username.trim().toLowerCase();
    try {
      await this.client.createEntity({
        partitionKey: USER_PARTITION_KEY,
        rowKey: userId,
        username,
        passwordHash,
        displayName,
        role,
        createdAt
      });
    } catch (err) {
      if (err && (err.statusCode === 409 || err.code === 'EntityAlreadyExists')) {
        const userErr = new Error('User already exists');
        userErr.code = 'USER_EXISTS';
        throw userErr;
      }
      throw err;
    }

    return { id: userId, username, displayName, role, createdAt };
  }

  async getUser(username) {
    const userId = String(username).trim().toLowerCase();
    if (!userId) {
      return null;
    }

    try {
      const item = await this.client.getEntity(USER_PARTITION_KEY, userId);
      return {
        id: item.rowKey,
        username: item.username,
        passwordHash: item.passwordHash,
        displayName: item.displayName || item.username,
        role: item.role || 'user',
        createdAt: item.createdAt
      };
    } catch (err) {
      if (err && err.statusCode === 404) {
        return null;
      }
      throw err;
    }
  }

  async ensureAdminUser({ username, passwordHash }) {
    if (!username || !passwordHash || (await this.getUser(username))) {
      return;
    }

    await this.createUser({
      username,
      passwordHash,
      displayName: username,
      role: 'admin',
      createdAt: new Date().toISOString()
    });
  }

  static async create(connectionString, tableName) {
    const client = TableClient.fromConnectionString(connectionString, tableName);
    try {
      await client.createTable();
    } catch (err) {
      if (!err || (err.statusCode !== 409 && err.code !== 'TableAlreadyExists')) {
        throw err;
      }
    }

    return new TableStorage(client, { tableName });
  }

  async createLink({ code, targetUrl, createdAt, ownerId = '' }) {
    try {
      await this.client.createEntity({
        partitionKey: PARTITION_KEY,
        rowKey: code,
        targetUrl,
        createdAt,
        ownerId,
        redirectCount: 0,
        lastAccessedAt: ''
      });
    } catch (err) {
      if (err && (err.statusCode === 409 || err.code === 'EntityAlreadyExists')) {
        const aliasErr = new Error('Alias already exists');
        aliasErr.code = 'ALIAS_EXISTS';
        throw aliasErr;
      }
      throw err;
    }
  }

  async getLink(code) {
    try {
      const item = await this.client.getEntity(PARTITION_KEY, code);
      return {
        code: item.rowKey,
        targetUrl: item.targetUrl,
        createdAt: item.createdAt,
        ownerId: item.ownerId || '',
        redirectCount: Number(item.redirectCount) || 0,
        lastAccessedAt: item.lastAccessedAt || ''
      };
    } catch (err) {
      if (err && err.statusCode === 404) {
        return null;
      }
      throw err;
    }
  }

  async updateRedirectStats(code, redirectCount, lastAccessedAt) {
    await this.client.updateEntity(
      {
        partitionKey: PARTITION_KEY,
        rowKey: code,
        redirectCount,
        lastAccessedAt
      },
      'Merge'
    );
  }

  async listLinks(limit = 250, ownerId = '') {
    const links = [];
    const entities = this.client.listEntities({ queryOptions: { filter: `PartitionKey eq '${PARTITION_KEY}'` } });

    for await (const item of entities) {
      if (ownerId && item.ownerId !== ownerId) {
        continue;
      }

      links.push({
        code: item.rowKey,
        targetUrl: item.targetUrl,
        createdAt: item.createdAt,
        ownerId: item.ownerId || '',
        redirectCount: Number(item.redirectCount) || 0,
        lastAccessedAt: item.lastAccessedAt || ''
      });

      if (links.length >= limit) {
        break;
      }
    }

    return links;
  }

  async ping() {
    try {
      await this.client.getAccessPolicy();
      return true;
    } catch {
      return false;
    }
  }

  async getHealthDetails() {
    const healthy = await this.ping();
    return {
      type: 'table',
      table: {
        name: this.tableName,
        status: healthy ? 'up' : 'down',
        message: healthy
          ? 'Azure Table Storage is reachable.'
          : 'Azure Table Storage check failed. Verify AzureWebJobsStorage/AZURE_STORAGE_CONNECTION_STRING and data-plane access.'
      },
      queue: {
        status: 'not-required',
        names: [],
        message: 'This app does not use Azure Storage Queues.'
      }
    };
  }
}

module.exports = { TableStorage };
