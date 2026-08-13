'use strict';

class InMemoryStorage {
  constructor(options = {}) {
    this.items = new Map();
    this.users = new Map();
    this.tableName = options.tableName || '';
  }

  async createUser({ username, passwordHash, displayName, role = 'user', createdAt }) {
    const userId = username.trim().toLowerCase();
    if (this.users.has(userId)) {
      const err = new Error('User already exists');
      err.code = 'USER_EXISTS';
      throw err;
    }

    const user = { id: userId, username, passwordHash, displayName, role, createdAt };
    this.users.set(userId, user);
    return { ...user, passwordHash: undefined };
  }

  async getUser(username) {
    const user = this.users.get(String(username).trim().toLowerCase());
    return user ? { ...user } : null;
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
      lastAccessedAt: ''
    });
  }

  async getLink(code) {
    const item = this.items.get(code);
    return item ? { ...item } : null;
  }

  async updateRedirectStats(code, redirectCount, lastAccessedAt) {
    const item = this.items.get(code);
    if (!item) {
      return;
    }

    this.items.set(code, {
      ...item,
      redirectCount,
      lastAccessedAt
    });
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
