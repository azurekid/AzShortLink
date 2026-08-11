'use strict';

class InMemoryStorage {
  constructor() {
    this.items = new Map();
  }

  async createLink({ code, targetUrl, createdAt }) {
    if (this.items.has(code)) {
      const err = new Error('Alias already exists');
      err.code = 'ALIAS_EXISTS';
      throw err;
    }

    this.items.set(code, {
      code,
      targetUrl,
      createdAt,
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

  async listLinks(limit = 250) {
    return Array.from(this.items.values())
      .slice(0, limit)
      .map((item) => ({ ...item }));
  }

  async ping() {
    return true;
  }
}

module.exports = { InMemoryStorage };
