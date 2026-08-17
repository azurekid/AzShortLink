'use strict';

const { TableClient } = require('@azure/data-tables');
const crypto = require('node:crypto');
const { retentionCutoffIso, generateAuditRowKey } = require('../core/audit');
const { appendHelpMessage, formatTicketNumber, getHelpMessages } = require('../services/helpRequests');

const PARTITION_KEY = 'LINK';
const USER_PARTITION_KEY = 'USER';
const APIKEY_PARTITION_KEY = 'APIKEY';
const PASSKEY_PARTITION_KEY = 'PASSKEY';
const INVITE_PARTITION_KEY = 'INVITE';
const HELP_PARTITION_KEY = 'HELP';
const RATE_LIMIT_PARTITION_KEY = 'RATE_LIMIT';
const AUDIT_PARTITION_KEY = 'AUDIT';
const RATE_LIMIT_ATTEMPT_RETENTION_MS = 24 * 60 * 60 * 1000;
const RATE_LIMIT_WINDOW_GRACE_MS = 5 * 60 * 1000;
const RATE_LIMIT_PURGE_SCAN_LIMIT = 200;
const RATE_LIMIT_PURGE_DELETE_LIMIT = 25;

// Rate-limit rows are opaque hashes on their own, so the caller-supplied request context is
// stored alongside them to make "who triggered this" answerable from the table itself.
function rateLimitContextColumns(context = {}) {
  const location = context.location || {};
  return {
    scope: String(context.scope || '').slice(0, 64),
    sourceIp: String(context.sourceIp || '').slice(0, 64),
    sourceCountry: String(location.country || '').slice(0, 128),
    sourceCountryCode: String(location.countryCode || '').slice(0, 2),
    sourceRegion: String(location.region || '').slice(0, 128),
    sourceCity: String(location.city || '').slice(0, 128),
    userAgent: String(context.userAgent || '').slice(0, 512),
    httpMethod: String(context.httpMethod || '').slice(0, 16),
    requestPath: String(context.requestPath || '').slice(0, 512),
    actorUsername: String(context.actorUsername || 'anonymous').slice(0, 128)
  };
}

function parseAgentStats(value) {
  if (!value) {
    return { browsers: {}, os: {}, devices: {}, referrers: {}, countries: {}, locations: {} };
  }

  try {
    const parsed = JSON.parse(value);
    return {
      browsers: parsed.browsers || {},
      os: parsed.os || {},
      devices: parsed.devices || {},
      referrers: parsed.referrers || {},
      countries: parsed.countries || {},
      locations: parsed.locations || {}
    };
  } catch {
    return { browsers: {}, os: {}, devices: {}, referrers: {}, countries: {}, locations: {} };
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

  async createUser({ username, passwordHash, displayName, role = 'user', createdAt, ...identity }) {
    const userId = username.trim();
    try {
      await this.usersClient.createEntity({
        partitionKey: USER_PARTITION_KEY,
        rowKey: userId,
        username: userId,
        passwordHash,
        displayName,
        role,
        createdAt,
        status: identity.status || 'active',
        emailHash: identity.emailHash || '',
        emailMasked: identity.emailMasked || '',
        emailVerifiedAt: identity.emailVerifiedAt || '',
        invitedByUserId: identity.invitedByUserId || '',
        rootSponsorUserId: identity.rootSponsorUserId || userId,
        inviteDepth: Number(identity.inviteDepth) || 0,
        signupIpHash: identity.signupIpHash || '',
        signupDeviceHash: identity.signupDeviceHash || '',
        riskFlags: JSON.stringify(identity.riskFlags || []),
        branchSuspended: Boolean(identity.branchSuspended),
        sessionVersion: Number(identity.sessionVersion) || 1
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
        status: item.status || 'active',
        emailHash: item.emailHash || '',
        emailMasked: item.emailMasked || '',
        emailVerifiedAt: item.emailVerifiedAt || '',
        invitedByUserId: item.invitedByUserId || '',
        rootSponsorUserId: item.rootSponsorUserId || item.rowKey,
        inviteDepth: Number(item.inviteDepth) || 0,
        signupIpHash: item.signupIpHash || '',
        signupDeviceHash: item.signupDeviceHash || '',
        riskFlags: JSON.parse(item.riskFlags || '[]'),
        branchSuspended: Boolean(item.branchSuspended),
        apiKeyHash: item.apiKeyHash || '',
        apiKeyPrefix: item.apiKeyPrefix || '',
        apiKeyCreatedAt: item.apiKeyCreatedAt || '',
        sessionVersion: Number(item.sessionVersion) || 1
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
        status: item.status || 'active',
        emailMasked: item.emailMasked || '',
        emailVerifiedAt: item.emailVerifiedAt || '',
        invitedByUserId: item.invitedByUserId || '',
        rootSponsorUserId: item.rootSponsorUserId || item.rowKey,
        inviteDepth: Number(item.inviteDepth) || 0,
        riskFlags: JSON.parse(item.riskFlags || '[]'),
        branchSuspended: Boolean(item.branchSuspended),
        createdAt: item.createdAt || '',
        apiKeyPrefix: item.apiKeyPrefix || '',
        sessionVersion: Number(item.sessionVersion) || 1
      });
    }

    return users;
  }

  async getUserByEmailHash(emailHash) {
    const escaped = String(emailHash).replaceAll("'", "''");
    const entities = this.usersClient.listEntities({
      queryOptions: { filter: `PartitionKey eq '${USER_PARTITION_KEY}' and emailHash eq '${escaped}'` }
    });
    for await (const item of entities) return this.getUser(item.rowKey);
    return null;
  }

  async countRecentRateLimitAttempts(rateKey, sinceIso) {
    const escapedKey = String(rateKey).replaceAll("'", "''");
    const escapedSince = String(sinceIso).replaceAll("'", "''");
    const entities = this.usersClient.listEntities({
      queryOptions: { filter: `PartitionKey eq '${RATE_LIMIT_PARTITION_KEY}' and rateKey eq '${escapedKey}' and attemptedAt ge '${escapedSince}'` }
    });
    let count = 0;
    for await (const item of entities) {
      if (item.rateKey === rateKey && item.attemptedAt >= sinceIso) count += 1;
    }
    return count;
  }

  async recordRateLimitAttempt(rateKey, attemptedAt, context = {}) {
    await this.usersClient.createEntity({
      partitionKey: RATE_LIMIT_PARTITION_KEY,
      rowKey: `${Date.now()}-${crypto.randomUUID()}`,
      rateKey,
      attemptedAt,
      expiresAt: new Date(Date.parse(attemptedAt) + RATE_LIMIT_ATTEMPT_RETENTION_MS).toISOString(),
      ...rateLimitContextColumns(context)
    });
    await this.purgeExpiredRateLimitEntries();
  }

  async clearRateLimitAttempts(rateKey) {
    const escapedKey = String(rateKey).replaceAll("'", "''");
    const entities = this.usersClient.listEntities({
      queryOptions: { filter: `PartitionKey eq '${RATE_LIMIT_PARTITION_KEY}' and rateKey eq '${escapedKey}'` }
    });
    const deletions = [];
    for await (const item of entities) {
      if (item.rateKey === rateKey) deletions.push(this.usersClient.deleteEntity(RATE_LIMIT_PARTITION_KEY, item.rowKey));
    }
    await Promise.all(deletions);
  }

  // Bounded, best-effort cleanup so short-lived counters do not accumulate in the users table.
  async purgeExpiredRateLimitEntries(now = Date.now()) {
    const nowIso = new Date(now).toISOString();
    try {
      const entities = this.usersClient.listEntities({
        queryOptions: { filter: `PartitionKey eq '${RATE_LIMIT_PARTITION_KEY}' and expiresAt lt '${nowIso}'` }
      });
      const rowKeys = [];
      let scanned = 0;
      for await (const item of entities) {
        scanned += 1;
        if (item.expiresAt && item.expiresAt < nowIso) rowKeys.push(item.rowKey);
        if (rowKeys.length >= RATE_LIMIT_PURGE_DELETE_LIMIT || scanned >= RATE_LIMIT_PURGE_SCAN_LIMIT) break;
      }
      await Promise.all(rowKeys.map(async (rowKey) => {
        try {
          await this.usersClient.deleteEntity(RATE_LIMIT_PARTITION_KEY, rowKey);
        } catch {
          // Leave it for the next purge to retry.
        }
      }));
    } catch {
      // Purging must never fail the request that triggered it.
    }
  }

  async consumeRateLimit(rateKey, maxRequests, windowMs, now = Date.now(), context = {}) {
    const bucket = Math.floor(now / windowMs);
    const rowKey = `${rateKey}-${bucket}`;
    const windowEndsAt = (bucket + 1) * windowMs;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const item = await this.usersClient.getEntity(RATE_LIMIT_PARTITION_KEY, rowKey);
        const count = Number(item.count) || 0;
        if (count >= maxRequests) {
          return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((windowEndsAt - now) / 1000)) };
        }
        await this.usersClient.updateEntity({ ...item, count: count + 1, lastAttemptAt: new Date(now).toISOString() }, 'Replace', { etag: item.etag });
        return { allowed: true, retryAfterSeconds: 0 };
      } catch (err) {
        if (err && err.statusCode === 404) {
          try {
            await this.usersClient.createEntity({
              partitionKey: RATE_LIMIT_PARTITION_KEY,
              rowKey,
              rateKey,
              bucket,
              count: 1,
              attemptedAt: new Date(now).toISOString(),
              lastAttemptAt: new Date(now).toISOString(),
              expiresAt: new Date(windowEndsAt + RATE_LIMIT_WINDOW_GRACE_MS).toISOString(),
              ...rateLimitContextColumns(context)
            });
            // Only on the first request of a window, so the scan cost stays bounded per client.
            await this.purgeExpiredRateLimitEntries(now);
            return { allowed: true, retryAfterSeconds: 0 };
          } catch (createError) {
            if (!createError || (createError.statusCode !== 409 && createError.code !== 'EntityAlreadyExists')) throw createError;
          }
        } else if (!err || err.statusCode !== 412) {
          throw err;
        }
      }
    }
    return { allowed: false, retryAfterSeconds: 1 };
  }

  async updateUserIdentity(userId, changes) {
    const entity = { partitionKey: USER_PARTITION_KEY, rowKey: String(userId).trim(), ...changes };
    if (changes.riskFlags) entity.riskFlags = JSON.stringify(changes.riskFlags);
    try {
      await this.usersClient.updateEntity(entity, 'Merge');
      return true;
    } catch (err) {
      if (err && err.statusCode === 404) return false;
      throw err;
    }
  }

  async countRootDescendants(rootSponsorUserId) {
    const escaped = String(rootSponsorUserId).replaceAll("'", "''");
    const entities = this.usersClient.listEntities({
      queryOptions: { filter: `PartitionKey eq '${USER_PARTITION_KEY}' and rootSponsorUserId eq '${escaped}'` }
    });
    let count = 0;
    for await (const item of entities) if (item.rowKey !== rootSponsorUserId) count += 1;
    return count;
  }

  async findUsersByRiskSignal({ signupIpHash, signupDeviceHash }) {
    const users = await this.listUsers();
    const matches = [];
    for (const user of users) {
      const full = await this.getUser(user.id);
      if ((signupIpHash && full.signupIpHash === signupIpHash) || (signupDeviceHash && full.signupDeviceHash === signupDeviceHash)) matches.push(full);
    }
    return matches;
  }

  async updateUserPassword(userId, passwordHash) {
    try {
      const user = await this.getUser(userId);
      if (!user) return false;
      await this.usersClient.updateEntity(
        { partitionKey: USER_PARTITION_KEY, rowKey: String(userId).trim(), passwordHash, sessionVersion: (Number(user.sessionVersion) || 1) + 1 },
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

  async savePasskey(userId, credential) {
    await this.usersClient.upsertEntity({
      partitionKey: PASSKEY_PARTITION_KEY,
      rowKey: credential.id,
      userId,
      publicKey: Buffer.from(credential.publicKey).toString('base64url'),
      counter: Number(credential.counter) || 0,
      transports: JSON.stringify(credential.transports || []),
      deviceType: credential.deviceType || '',
      backedUp: Boolean(credential.backedUp),
      createdAt: credential.createdAt || new Date().toISOString()
    }, 'Replace');
  }

  async getPasskey(credentialId) {
    try {
      const item = await this.usersClient.getEntity(PASSKEY_PARTITION_KEY, credentialId);
      return {
        id: item.rowKey,
        userId: item.userId,
        publicKey: new Uint8Array(Buffer.from(item.publicKey, 'base64url')),
        counter: Number(item.counter) || 0,
        transports: JSON.parse(item.transports || '[]'),
        deviceType: item.deviceType || '',
        backedUp: Boolean(item.backedUp),
        createdAt: item.createdAt || ''
      };
    } catch (err) {
      if (err && err.statusCode === 404) return null;
      throw err;
    }
  }

  async listPasskeys(userId) {
    const escaped = String(userId).replaceAll("'", "''");
    const entities = this.usersClient.listEntities({
      queryOptions: { filter: `PartitionKey eq '${PASSKEY_PARTITION_KEY}' and userId eq '${escaped}'` }
    });
    const passkeys = [];
    for await (const item of entities) passkeys.push(await this.getPasskey(item.rowKey));
    return passkeys;
  }

  async updatePasskeyCounter(credentialId, counter) {
    try {
      await this.usersClient.updateEntity({ partitionKey: PASSKEY_PARTITION_KEY, rowKey: credentialId, counter }, 'Merge');
      return true;
    } catch (err) {
      if (err && err.statusCode === 404) return false;
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

    const passkeys = await this.listPasskeys(id);
    await Promise.all(passkeys.map((credential) => this.usersClient.deleteEntity(PASSKEY_PARTITION_KEY, credential.id)));

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

  async createHelpRequest({ id, userId, username, subject, message, createdAt }) {
    const messages = [{ role: 'user', author: username, text: message, createdAt }];
    const request = { id, ticketNumber: formatTicketNumber(id), userId, username, subject, message, createdAt, status: 'open', response: '', respondedAt: '', respondedBy: '', closedAt: '', closedBy: '', messages };
    await this.usersClient.createEntity({ partitionKey: HELP_PARTITION_KEY, rowKey: id, ...request, messages: JSON.stringify(messages) });
    return request;
  }

  async listHelpRequests(userId = '') {
    const escapedUserId = String(userId).replaceAll("'", "''");
    const filter = userId
      ? `PartitionKey eq '${HELP_PARTITION_KEY}' and userId eq '${escapedUserId}'`
      : `PartitionKey eq '${HELP_PARTITION_KEY}'`;
    const entities = this.usersClient.listEntities({ queryOptions: { filter } });
    const requests = [];
    for await (const item of entities) {
      requests.push({
        id: item.rowKey,
        ticketNumber: formatTicketNumber(item.rowKey),
        userId: item.userId || '',
        username: item.username || item.userId || '',
        subject: item.subject || '',
        message: item.message || '',
        createdAt: item.createdAt || '',
        status: item.status || 'open',
        response: item.response || '',
        respondedAt: item.respondedAt || '',
        respondedBy: item.respondedBy || '',
        closedAt: item.closedAt || '',
        closedBy: item.closedBy || '',
        messages: getHelpMessages(item)
      });
    }
    return requests.sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
  }

  async respondToHelpRequest(id, { response, respondedAt, respondedBy }) {
    try {
      const existing = await this.usersClient.getEntity(HELP_PARTITION_KEY, String(id).trim());
      const messages = appendHelpMessage(existing, { role: 'admin', author: respondedBy, text: response, createdAt: respondedAt });
      await this.usersClient.updateEntity({
        partitionKey: HELP_PARTITION_KEY,
        rowKey: String(id).trim(),
        response,
        respondedAt,
        respondedBy,
        status: 'answered',
        messages: JSON.stringify(messages)
      }, 'Merge');
      const item = await this.usersClient.getEntity(HELP_PARTITION_KEY, String(id).trim());
      return {
        id: item.rowKey,
        ticketNumber: formatTicketNumber(item.rowKey),
        userId: item.userId || '',
        username: item.username || item.userId || '',
        subject: item.subject || '',
        message: item.message || '',
        createdAt: item.createdAt || '',
        status: item.status || 'open',
        response: item.response || '',
        respondedAt: item.respondedAt || '',
        respondedBy: item.respondedBy || '',
        closedAt: item.closedAt || '',
        closedBy: item.closedBy || '',
        messages: getHelpMessages(item)
      };
    } catch (err) {
      if (err && err.statusCode === 404) return null;
      throw err;
    }
  }

  async addHelpRequestMessage(id, { userId, author, role, text, createdAt }) {
    const requestId = String(id).trim();
    try {
      const existing = await this.usersClient.getEntity(HELP_PARTITION_KEY, requestId);
      if ((userId && existing.userId !== userId) || existing.status === 'closed') return null;
      const messages = appendHelpMessage(existing, { role, author, text, createdAt });
      await this.usersClient.updateEntity({
        partitionKey: HELP_PARTITION_KEY,
        rowKey: requestId,
        messages: JSON.stringify(messages),
        status: role === 'admin' ? 'answered' : 'open'
      }, 'Merge');
      return (await this.listHelpRequests()).find((request) => request.id === requestId) || null;
    } catch (err) {
      if (err && err.statusCode === 404) return null;
      throw err;
    }
  }

  async setHelpRequestStatus(id, { userId = '', status, changedAt, changedBy }) {
    const requestId = String(id).trim();
    try {
      const existing = await this.usersClient.getEntity(HELP_PARTITION_KEY, requestId);
      if (userId && existing.userId !== userId) return null;
      await this.usersClient.updateEntity({
        partitionKey: HELP_PARTITION_KEY,
        rowKey: requestId,
        status,
        closedAt: status === 'closed' ? changedAt : '',
        closedBy: status === 'closed' ? changedBy : ''
      }, 'Merge');
      return (await this.listHelpRequests()).find((request) => request.id === requestId) || null;
    } catch (err) {
      if (err && err.statusCode === 404) return null;
      throw err;
    }
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

  static async create(storageConfig, tableNames) {
    const names = typeof tableNames === 'string'
      ? { links: tableNames, users: `${tableNames}Users`, audit: `${tableNames}Audit` }
      : tableNames;

    async function createClient(name) {
      const client = storageConfig.connectionString
        ? TableClient.fromConnectionString(storageConfig.connectionString, name)
        : new TableClient(storageConfig.endpoint, name, storageConfig.credential);
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
    const expiredRowKeys = [];
    for await (const item of expired) {
      if (expiredRowKeys.length >= 25) break;
      expiredRowKeys.push(item.rowKey);
    }
    await Promise.all(expiredRowKeys.map(async (rowKey) => {
      try {
        await this.auditClient.deleteEntity(AUDIT_PARTITION_KEY, rowKey);
      } catch {
        // Best-effort: leave it for the next write to retry.
      }
    }));
  }

  async listAuditEvents({ limit = 200, sinceIso = '' } = {}) {
    const cutoff = sinceIso || retentionCutoffIso();
    // Defense-in-depth: the value is interpolated into an OData filter string, so a literal
    // single quote is escaped even though callers are expected to pre-validate the format.
    const escapedCutoff = String(cutoff).replaceAll("'", "''");
    const events = [];
    const entities = this.auditClient.listEntities({
      queryOptions: { filter: `PartitionKey eq '${AUDIT_PARTITION_KEY}' and eventTime ge '${escapedCutoff}'` }
    });

    for await (const item of entities) {
      events.push({
        schemaVersion: Number(item.schemaVersion) || 1,
        eventId: item.eventId || item.rowKey || '',
        timestamp: item.eventTime || '',
        action: item.action,
        category: item.category || 'application',
        actorId: item.actorId || '',
        actorUsername: item.actorUsername || 'anonymous',
        actorRole: item.actorRole || '',
        ip: item.ip || '',
        sourceIp: item.sourceIp || item.ip || '',
        userAgent: item.userAgent || '',
        channel: item.channel || 'unknown',
        authenticationMethod: item.authenticationMethod || 'unknown',
        httpMethod: item.httpMethod || '',
        requestPath: item.requestPath || '',
        outcome: item.outcome || 'success',
        sourceCountry: item.sourceCountry || '',
        sourceCountryCode: item.sourceCountryCode || '',
        sourceRegion: item.sourceRegion || '',
        sourceCity: item.sourceCity || '',
        sourceLatitude: Number.isFinite(item.sourceLatitude) ? item.sourceLatitude : null,
        sourceLongitude: Number.isFinite(item.sourceLongitude) ? item.sourceLongitude : null,
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
