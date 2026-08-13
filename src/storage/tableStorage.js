'use strict';

const { TableClient } = require('@azure/data-tables');
const { retentionCutoffIso, generateAuditRowKey } = require('../audit');

const PARTITION_KEY = 'LINK';
const USER_PARTITION_KEY = 'USER';
const APIKEY_PARTITION_KEY = 'APIKEY';
const AUDIT_PARTITION_KEY = 'AUDIT';

function parseAgentStats(value) {
  if (!value) {
    return { browsers: {}, os: {}, devices: {}, referrers: {} };
  }

  try {
    const parsed = JSON.parse(value);
    return {
      browsers: parsed.browsers || {},
      os: parsed.os || {},
      devices: parsed.devices || {},
      referrers: parsed.referrers || {}
    };
  } catch {
    return { browsers: {}, os: {}, devices: {}, referrers: {} };
  }
}

class TableStorage {
  constructor(client, options = {}) {
    this.client = client;
    this.tableName = options.tableName || '';
  }

  async createUser({ username, passwordHash, displayName, role = 'user', createdAt }) {
    const userId = username.trim();
    try {
      await this.client.createEntity({
        partitionKey: USER_PARTITION_KEY,
        rowKey: userId,
        username: userId,
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

    return { id: userId, username: userId, displayName, role, createdAt };
  }

  async getUser(username) {
    const userId = String(username).trim();
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
        createdAt: item.createdAt,
        apiKeyHash: item.apiKeyHash || '',
        apiKeyPrefix: item.apiKeyPrefix || '',
        apiKeyCreatedAt: item.apiKeyCreatedAt || ''
      };
    } catch (err) {
      if (err && err.statusCode === 404) {
        return null;
      }
      throw err;
    }
  }

  async listUsers() {
    const users = [];
    const entities = this.client.listEntities({
      queryOptions: { filter: `PartitionKey eq '${USER_PARTITION_KEY}'` }
    });

    for await (const item of entities) {
      users.push({
        id: item.rowKey,
        username: item.username || item.rowKey,
        displayName: item.displayName || item.username || item.rowKey,
        role: item.role || 'user',
        createdAt: item.createdAt || '',
        apiKeyPrefix: item.apiKeyPrefix || ''
      });
    }

    return users;
  }

  async updateUserPassword(userId, passwordHash) {
    try {
      await this.client.updateEntity(
        { partitionKey: USER_PARTITION_KEY, rowKey: String(userId).trim(), passwordHash },
        'Merge'
      );
      return true;
    } catch (err) {
      if (err && err.statusCode === 404) {
        return false;
      }
      throw err;
    }
  }

  async setUserApiKey(userId, { hash, displayPrefix, createdAt }) {
    const id = String(userId).trim();
    const existing = await this.getUser(id);
    if (!existing) {
      return false;
    }

    if (existing.apiKeyHash) {
      try {
        await this.client.deleteEntity(APIKEY_PARTITION_KEY, existing.apiKeyHash);
      } catch (err) {
        if (!err || err.statusCode !== 404) {
          throw err;
        }
      }
    }

    await this.client.upsertEntity(
      { partitionKey: APIKEY_PARTITION_KEY, rowKey: hash, ownerId: id, createdAt },
      'Replace'
    );
    await this.client.updateEntity(
      { partitionKey: USER_PARTITION_KEY, rowKey: id, apiKeyHash: hash, apiKeyPrefix: displayPrefix, apiKeyCreatedAt: createdAt },
      'Merge'
    );
    return true;
  }

  async getUserByApiKeyHash(hash) {
    try {
      const entity = await this.client.getEntity(APIKEY_PARTITION_KEY, hash);
      return this.getUser(entity.ownerId);
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

  async deleteUser(userId) {
    const id = String(userId).trim();
    const existing = await this.getUser(id);
    if (!existing) {
      return false;
    }

    if (existing.apiKeyHash) {
      try {
        await this.client.deleteEntity(APIKEY_PARTITION_KEY, existing.apiKeyHash);
      } catch (err) {
        if (!err || err.statusCode !== 404) {
          throw err;
        }
      }
    }

    await this.client.deleteEntity(USER_PARTITION_KEY, id);
    return true;
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
        lastAccessedAt: item.lastAccessedAt || '',
        agentStats: parseAgentStats(item.agentStats)
      };
    } catch (err) {
      if (err && err.statusCode === 404) {
        return null;
      }
      throw err;
    }
  }

  async updateRedirectStats(code, redirectCount, lastAccessedAt, agentStats) {
    const entity = {
      partitionKey: PARTITION_KEY,
      rowKey: code,
      redirectCount,
      lastAccessedAt
    };
    if (agentStats) {
      entity.agentStats = JSON.stringify(agentStats);
    }

    await this.client.updateEntity(entity, 'Merge');
  }

  async deleteLink(code) {
    try {
      await this.client.deleteEntity(PARTITION_KEY, code);
    } catch (err) {
      if (!err || err.statusCode !== 404) {
        throw err;
      }
    }
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
        lastAccessedAt: item.lastAccessedAt || '',
        agentStats: parseAgentStats(item.agentStats)
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

  async appendAuditEvent(entry) {
    // `timestamp` is a reserved property on TableEntity (mapped to the service-assigned
    // Timestamp metadata), so a custom `entry.timestamp` would be silently dropped by the
    // SDK. Store it under `eventTime` instead and translate back in listAuditEvents.
    const { timestamp, ...rest } = entry;
    await this.client.createEntity({
      partitionKey: AUDIT_PARTITION_KEY,
      rowKey: generateAuditRowKey(),
      eventTime: timestamp,
      ...rest
    });

    // Bounded, best-effort purge so a single write never scans/deletes the whole log.
    const cutoff = retentionCutoffIso();
    const expired = this.client.listEntities({
      queryOptions: { filter: `PartitionKey eq '${AUDIT_PARTITION_KEY}' and eventTime lt '${cutoff}'` }
    });
    let deleted = 0;
    for await (const item of expired) {
      if (deleted >= 25) {
        break;
      }
      try {
        await this.client.deleteEntity(AUDIT_PARTITION_KEY, item.rowKey);
        deleted += 1;
      } catch {
        // Best-effort: leave it for the next write to retry.
      }
    }
  }

  async listAuditEvents({ limit = 200, sinceIso = '' } = {}) {
    const cutoff = sinceIso || retentionCutoffIso();
    const events = [];
    const entities = this.client.listEntities({
      queryOptions: { filter: `PartitionKey eq '${AUDIT_PARTITION_KEY}' and eventTime ge '${cutoff}'` }
    });

    for await (const item of entities) {
      events.push({
        timestamp: item.eventTime || '',
        action: item.action,
        actorId: item.actorId || '',
        actorUsername: item.actorUsername || 'anonymous',
        ip: item.ip || '',
        details: item.details || '{}'
      });
    }

    return events.sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, limit);
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
