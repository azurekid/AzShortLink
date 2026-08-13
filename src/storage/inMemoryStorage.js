'use strict';

const { retentionCutoffIso, generateAuditRowKey } = require('../audit');

class InMemoryStorage {
  constructor(options = {}) {
    this.items = new Map();
    this.users = new Map();
    this.apiKeys = new Map();
    this.auditEvents = new Map();
    this.tableName = options.tableName || '';
  }

  async createUser({ username, passwordHash, displayName, role = 'user', createdAt }) {
    const userId = username.trim();
    if (this.users.has(userId)) {
      const err = new Error('User already exists');
      err.code = 'USER_EXISTS';
      throw err;
    }

    const user = { id: userId, username: userId, passwordHash, displayName, role, createdAt };
    this.users.set(userId, user);
    return { ...user, passwordHash: undefined };
  }

  async getUser(username) {
    const user = this.users.get(String(username).trim());
    return user ? { ...user } : null;
  }

  async listUsers() {
    return Array.from(this.users.values()).map((user) => ({
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      createdAt: user.createdAt,
      linkCount: Array.from(this.items.values()).filter((item) => item.ownerId === user.id).length
    }));
  }

  async updateUserPassword(userId, passwordHash) {
    const user = this.users.get(String(userId).trim());
    if (!user) {
      return false;
    }

    this.users.set(user.id, { ...user, passwordHash });
    return true;
  }

  async setUserApiKey(userId, { hash, displayPrefix, createdAt }) {
    const user = this.users.get(String(userId).trim());
    if (!user) {
      return false;
    }

    if (user.apiKeyHash) {
      this.apiKeys.delete(user.apiKeyHash);
    }

    this.users.set(user.id, { ...user, apiKeyHash: hash, apiKeyPrefix: displayPrefix, apiKeyCreatedAt: createdAt });
    this.apiKeys.set(hash, user.id);
    return true;
  }

  async getUserByApiKeyHash(hash) {
    const userId = this.apiKeys.get(hash);
    return userId ? this.getUser(userId) : null;
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
    const user = this.users.get(id);
    if (!user) {
      return false;
    }

    if (user.apiKeyHash) {
      this.apiKeys.delete(user.apiKeyHash);
    }

    this.users.delete(id);
    return true;
  }

  async createLink({ code, targetUrl, createdAt, ownerId = '' }) {
    if (this.items.has(code)) {
      const err = new Error('Alias already exists');
      err.code = 'ALIAS_EXISTS';
      throw err;
    }

    this.items.set(code, {
      code,
      targetUrl,
      createdAt,
      ownerId,
      redirectCount: 0,
      lastAccessedAt: '',
      agentStats: { browsers: {}, os: {}, devices: {}, referrers: {} }
    });
  }

  async getLink(code) {
    const item = this.items.get(code);
    return item ? { ...item } : null;
  }

  async updateRedirectStats(code, redirectCount, lastAccessedAt, agentStats) {
    const item = this.items.get(code);
    if (!item) {
      return;
    }

    this.items.set(code, {
      ...item,
      redirectCount,
      lastAccessedAt,
      agentStats: agentStats || item.agentStats
    });
  }

  async deleteLink(code) {
    this.items.delete(code);
  }

  async listLinks(limit = 250, ownerId = '') {
    return Array.from(this.items.values())
      .filter((item) => !ownerId || item.ownerId === ownerId)
      .slice(0, limit)
      .map((item) => ({ ...item }));
  }

  async ping() {
    return true;
  }

  async appendAuditEvent(entry) {
    const rowKey = generateAuditRowKey();
    this.auditEvents.set(rowKey, { ...entry, rowKey });

    const cutoff = retentionCutoffIso();
    for (const [key, event] of this.auditEvents) {
      if (event.timestamp < cutoff) {
        this.auditEvents.delete(key);
      }
    }
  }

  async listAuditEvents({ limit = 200, sinceIso = '' } = {}) {
    const cutoff = sinceIso || retentionCutoffIso();
    return Array.from(this.auditEvents.values())
      .filter((event) => event.timestamp >= cutoff)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, limit);
  }

  async getHealthDetails() {
    return {
      type: 'in-memory',
      table: {
        name: this.tableName,
        status: 'not-configured',
        message: 'Azure Storage is not configured, so link data is stored in-memory only.'
      },
      queue: {
        status: 'not-required',
        names: [],
        message: 'This app does not use Azure Storage Queues.'
      }
    };
  }
}

module.exports = { InMemoryStorage };
