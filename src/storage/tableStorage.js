'use strict';

const { TableClient } = require('@azure/data-tables');
const { retentionCutoffIso, generateAuditRowKey } = require('../audit');

const PARTITION_KEY = 'LINK';
const USER_PARTITION_KEY = 'USER';
const APIKEY_PARTITION_KEY = 'APIKEY';
const INVITE_PARTITION_KEY = 'INVITE';
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
  constructor({ linksClient, usersClient, auditClient }, options = {}) {
    this.linksClient = linksClient;
    this.usersClient = usersClient;
    this.auditClient = auditClient;
    this.tableNames = {
      links: options.linksTableName || '',
      users: options.usersTableName || '',
      audit: options.auditTableName || ''
    };
    // Kept for callers/tests that only care about the primary (links) table name.
    this.tableName = this.tableNames.links;
  }

  async createUser({ username, passwordHash, displayName, role = 'user', createdAt }) {
    const userId = username.trim();
    try {
      await this.usersClient.createEntity({
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
      const item = await this.usersClient.getEntity(USER_PARTITION_KEY, userId);
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
    const entities = this.usersClient.listEntities({
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
      await this.usersClient.updateEntity(
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
        await this.usersClient.deleteEntity(APIKEY_PARTITION_KEY, existing.apiKeyHash);
      } catch (err) {
        if (!err || err.statusCode !== 404) {
          throw err;
        }
      }
    }

    await this.usersClient.upsertEntity(
      { partitionKey: APIKEY_PARTITION_KEY, rowKey: hash, ownerId: id, createdAt },
      'Replace'
    );
    await this.usersClient.updateEntity(
      { partitionKey: USER_PARTITION_KEY, rowKey: id, apiKeyHash: hash, apiKeyPrefix: displayPrefix, apiKeyCreatedAt: createdAt },
      'Merge'
    );
    return true;
  }

  async getUserByApiKeyHash(hash) {
    try {
      const entity = await this.usersClient.getEntity(APIKEY_PARTITION_KEY, hash);
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
        await this.usersClient.deleteEntity(APIKEY_PARTITION_KEY, existing.apiKeyHash);
      } catch (err) {
        if (!err || err.statusCode !== 404) {
          throw err;
        }
      }
    }

    await this.usersClient.deleteEntity(USER_PARTITION_KEY, id);
    return true;
  }

  async createInvite({ code, createdBy, createdAt }) {
    await this.usersClient.createEntity({
      partitionKey: INVITE_PARTITION_KEY,
      rowKey: code,
      createdBy,
      createdAt,
      redeemed: false,
      redeemedBy: '',
      redeemedAt: ''
    });
  }

  async getInvite(code) {
    try {
      const item = await this.usersClient.getEntity(INVITE_PARTITION_KEY, String(code).trim());
      return {
        code: item.rowKey,
        createdBy: item.createdBy || '',
        createdAt: item.createdAt || '',
        redeemed: Boolean(item.redeemed),
        redeemedBy: item.redeemedBy || '',
        redeemedAt: item.redeemedAt || ''
      };
    } catch (err) {
      if (err && err.statusCode === 404) {
        return null;
      }
      throw err;
    }
  }

  async listInvites() {
    const invites = [];
    const entities = this.usersClient.listEntities({
      queryOptions: { filter: `PartitionKey eq '${INVITE_PARTITION_KEY}'` }
    });

    for await (const item of entities) {
      invites.push({
        code: item.rowKey,
        createdBy: item.createdBy || '',
        createdAt: item.createdAt || '',
        redeemed: Boolean(item.redeemed),
        redeemedBy: item.redeemedBy || '',
        redeemedAt: item.redeemedAt || ''
      });
    }

    return invites;
  }

  // Returns false (without throwing) if the invite is missing or was already redeemed, so
  // callers can treat a lost race as a normal "already used" outcome rather than an error.
  async redeemInvite(code, redeemedBy, redeemedAt) {
    const existing = await this.getInvite(code);
    if (!existing || existing.redeemed) {
      return false;
    }

    await this.usersClient.updateEntity(
      { partitionKey: INVITE_PARTITION_KEY, rowKey: String(code).trim(), redeemed: true, redeemedBy, redeemedAt },
      'Merge'
    );
    return true;
  }

  async deleteInvite(code) {
    try {
      await this.usersClient.deleteEntity(INVITE_PARTITION_KEY, String(code).trim());
    } catch (err) {
      if (!err || err.statusCode !== 404) {
        throw err;
      }
    }
  }

  static async create(connectionString, tableNames) {
    const names = typeof tableNames === 'string'
      ? { links: tableNames, users: `${tableNames}Users`, audit: `${tableNames}Audit` }
      : tableNames;

    async function createClient(name) {
      const client = TableClient.fromConnectionString(connectionString, name);
      try {
        await client.createTable();
      } catch (err) {
        if (!err || (err.statusCode !== 409 && err.code !== 'TableAlreadyExists')) {
          throw err;
        }
      }
      return client;
    }

    const [linksClient, usersClient, auditClient] = await Promise.all([
      createClient(names.links),
      createClient(names.users),
      createClient(names.audit)
    ]);

    return new TableStorage(
      { linksClient, usersClient, auditClient },
      { linksTableName: names.links, usersTableName: names.users, auditTableName: names.audit }
    );
  }

  async createLink({ code, targetUrl, createdAt, ownerId = '' }) {
    try {
      await this.linksClient.createEntity({
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
      const item = await this.linksClient.getEntity(PARTITION_KEY, code);
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

    await this.linksClient.updateEntity(entity, 'Merge');
  }

  async deleteLink(code) {
    try {
      await this.linksClient.deleteEntity(PARTITION_KEY, code);
    } catch (err) {
      if (!err || err.statusCode !== 404) {
        throw err;
      }
    }
  }

  async listLinks(limit = 250, ownerId = '') {
    const links = [];
    const entities = this.linksClient.listEntities({ queryOptions: { filter: `PartitionKey eq '${PARTITION_KEY}'` } });

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
      await Promise.all([
        this.linksClient.getAccessPolicy(),
        this.usersClient.getAccessPolicy(),
        this.auditClient.getAccessPolicy()
      ]);
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
    await this.auditClient.createEntity({
      partitionKey: AUDIT_PARTITION_KEY,
      rowKey: generateAuditRowKey(),
      eventTime: timestamp,
      ...rest
    });

    // Bounded, best-effort purge so a single write never scans/deletes the whole log.
    const cutoff = retentionCutoffIso();
    const expired = this.auditClient.listEntities({
      queryOptions: { filter: `PartitionKey eq '${AUDIT_PARTITION_KEY}' and eventTime lt '${cutoff}'` }
    });
    let deleted = 0;
    for await (const item of expired) {
      if (deleted >= 25) {
        break;
      }
      try {
        await this.auditClient.deleteEntity(AUDIT_PARTITION_KEY, item.rowKey);
        deleted += 1;
      } catch {
        // Best-effort: leave it for the next write to retry.
      }
    }
  }

  async listAuditEvents({ limit = 200, sinceIso = '' } = {}) {
    const cutoff = sinceIso || retentionCutoffIso();
    const events = [];
    const entities = this.auditClient.listEntities({
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
    const [linksUp, usersUp, auditUp] = await Promise.all([
      this.linksClient.getAccessPolicy().then(() => true).catch(() => false),
      this.usersClient.getAccessPolicy().then(() => true).catch(() => false),
      this.auditClient.getAccessPolicy().then(() => true).catch(() => false)
    ]);
    const healthy = linksUp && usersUp && auditUp;
    const describe = (name, up) => ({
      name,
      status: up ? 'up' : 'down',
      message: up
        ? 'Azure Table Storage is reachable.'
        : 'Azure Table Storage check failed. Verify AzureWebJobsStorage/AZURE_STORAGE_CONNECTION_STRING and data-plane access.'
    });

    return {
      type: 'table',
      // Links, users and audit data live in separate tables so a single compromised
      // credential or filter bug can't expose all three data classes at once.
      table: describe(this.tableNames.links, linksUp),
      usersTable: describe(this.tableNames.users, usersUp),
      auditTable: describe(this.tableNames.audit, auditUp),
      queue: {
        status: 'not-required',
        names: [],
        message: 'This app does not use Azure Storage Queues.'
      }
    };
  }
}

module.exports = { TableStorage };
