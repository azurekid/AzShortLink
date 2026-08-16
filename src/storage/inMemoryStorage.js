'use strict';

const { retentionCutoffIso, generateAuditRowKey } = require('../core/audit');
const { appendHelpMessage, formatTicketNumber, getHelpMessages } = require('../services/helpRequests');

class InMemoryStorage {
  constructor(options = {}) {
    this.items = new Map();
    this.users = new Map();
    this.apiKeys = new Map();
    this.passkeys = new Map();
    this.invites = new Map();
    this.helpRequests = new Map();
    this.auditEvents = new Map();
    this.rateLimitAttempts = new Map();
    this.rateLimitWindows = new Map();
    this.tableName = options.tableName || '';
  }

  async createUser({ username, passwordHash, displayName, role = 'user', createdAt, ...identity }) {
    const userId = username.trim();
    if (this.users.has(userId)) {
      const err = new Error('User already exists');
      err.code = 'USER_EXISTS';
      throw err;
    }

    const user = {
      id: userId,
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
      riskFlags: identity.riskFlags || [],
      branchSuspended: Boolean(identity.branchSuspended),
      sessionVersion: Number(identity.sessionVersion) || 1
    };
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
      status: user.status || 'active',
      emailMasked: user.emailMasked || '',
      emailVerifiedAt: user.emailVerifiedAt || '',
      invitedByUserId: user.invitedByUserId || '',
      rootSponsorUserId: user.rootSponsorUserId || user.id,
      inviteDepth: Number(user.inviteDepth) || 0,
      riskFlags: user.riskFlags || [],
      branchSuspended: Boolean(user.branchSuspended),
      sessionVersion: Number(user.sessionVersion) || 1,
      createdAt: user.createdAt,
      linkCount: Array.from(this.items.values()).filter((item) => item.ownerId === user.id).length
    }));
  }

  async getUserByEmailHash(emailHash) {
    return Array.from(this.users.values()).find((user) => user.emailHash === emailHash) || null;
  }

  async countRecentRateLimitAttempts(rateKey, sinceIso) {
    return (this.rateLimitAttempts.get(rateKey) || []).filter((attemptedAt) => attemptedAt >= sinceIso).length;
  }

  async recordRateLimitAttempt(rateKey, attemptedAt) {
    const attempts = (this.rateLimitAttempts.get(rateKey) || []).filter((value) => value >= new Date(Date.parse(attemptedAt) - 24 * 60 * 60 * 1000).toISOString());
    attempts.push(attemptedAt);
    this.rateLimitAttempts.set(rateKey, attempts);
  }

  async clearRateLimitAttempts(rateKey) {
    this.rateLimitAttempts.delete(rateKey);
  }

  async consumeRateLimit(rateKey, maxRequests, windowMs, now = Date.now()) {
    const bucket = Math.floor(now / windowMs);
    const key = `${rateKey}:${bucket}`;
    const count = (this.rateLimitWindows.get(key) || 0) + 1;
    this.rateLimitWindows.set(key, count);
    return { allowed: count <= maxRequests, retryAfterSeconds: Math.max(1, Math.ceil(((bucket + 1) * windowMs - now) / 1000)) };
  }

  async updateUserIdentity(userId, changes) {
    const user = this.users.get(String(userId).trim());
    if (!user) return false;
    this.users.set(user.id, { ...user, ...changes });
    return true;
  }

  async countRootDescendants(rootSponsorUserId) {
    return Array.from(this.users.values()).filter((user) => user.rootSponsorUserId === rootSponsorUserId && user.id !== rootSponsorUserId).length;
  }

  async findUsersByRiskSignal({ signupIpHash, signupDeviceHash }) {
    return Array.from(this.users.values()).filter((user) =>
      (signupIpHash && user.signupIpHash === signupIpHash) ||
      (signupDeviceHash && user.signupDeviceHash === signupDeviceHash)
    );
  }

  async updateUserPassword(userId, passwordHash) {
    const user = this.users.get(String(userId).trim());
    if (!user) {
      return false;
    }

    this.users.set(user.id, { ...user, passwordHash, sessionVersion: (Number(user.sessionVersion) || 1) + 1 });
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

  async savePasskey(userId, credential) {
    this.passkeys.set(credential.id, { ...credential, userId });
  }

  async getPasskey(credentialId) {
    const credential = this.passkeys.get(credentialId);
    return credential ? { ...credential } : null;
  }

  async listPasskeys(userId) {
    return Array.from(this.passkeys.values()).filter((credential) => credential.userId === userId).map((credential) => ({ ...credential }));
  }

  async updatePasskeyCounter(credentialId, counter) {
    const credential = this.passkeys.get(credentialId);
    if (!credential) return false;
    this.passkeys.set(credentialId, { ...credential, counter });
    return true;
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

    for (const [credentialId, credential] of this.passkeys) {
      if (credential.userId === id) this.passkeys.delete(credentialId);
    }

    this.users.delete(id);
    return true;
  }

  async createInvite({ code, createdBy, createdAt }) {
    this.invites.set(code, { code, createdBy, createdAt, redeemed: false, redeemedBy: '', redeemedAt: '' });
  }

  async getInvite(code) {
    const invite = this.invites.get(String(code).trim());
    return invite ? { ...invite } : null;
  }

  async listInvites() {
    return Array.from(this.invites.values()).map((invite) => ({ ...invite }));
  }

  async redeemInvite(code, redeemedBy, redeemedAt) {
    const invite = this.invites.get(String(code).trim());
    if (!invite || invite.redeemed) {
      return false;
    }

    this.invites.set(invite.code, { ...invite, redeemed: true, redeemedBy, redeemedAt });
    return true;
  }

  async deleteInvite(code) {
    this.invites.delete(String(code).trim());
  }

  async createHelpRequest({ id, userId, username, subject, message, createdAt }) {
    const request = { id, ticketNumber: formatTicketNumber(id), userId, username, subject, message, createdAt, status: 'open', response: '', respondedAt: '', respondedBy: '', closedAt: '', closedBy: '', messages: [{ role: 'user', author: username, text: message, createdAt }] };
    this.helpRequests.set(id, request);
    return { ...request };
  }

  async listHelpRequests(userId = '') {
    return Array.from(this.helpRequests.values())
      .filter((request) => !userId || request.userId === userId)
      .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
      .map((request) => ({ ...request, ticketNumber: formatTicketNumber(request.id), messages: getHelpMessages(request) }));
  }

  async respondToHelpRequest(id, { response, respondedAt, respondedBy }) {
    const request = this.helpRequests.get(String(id).trim());
    if (!request) return null;
    const messages = appendHelpMessage(request, { role: 'admin', author: respondedBy, text: response, createdAt: respondedAt });
    const updated = { ...request, response, respondedAt, respondedBy, status: 'answered', messages };
    this.helpRequests.set(request.id, updated);
    return { ...updated };
  }

  async addHelpRequestMessage(id, { userId, author, role, text, createdAt }) {
    const request = this.helpRequests.get(String(id).trim());
    if (!request || (userId && request.userId !== userId) || request.status === 'closed') return null;
    const messages = appendHelpMessage(request, { role, author, text, createdAt });
    const updated = { ...request, messages, status: role === 'admin' ? 'answered' : 'open' };
    this.helpRequests.set(request.id, updated);
    return { ...updated };
  }

  async setHelpRequestStatus(id, { userId = '', status, changedAt, changedBy }) {
    const request = this.helpRequests.get(String(id).trim());
    if (!request || (userId && request.userId !== userId)) return null;
    const updated = {
      ...request,
      status,
      closedAt: status === 'closed' ? changedAt : '',
      closedBy: status === 'closed' ? changedBy : ''
    };
    this.helpRequests.set(request.id, updated);
    return { ...updated };
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
      agentStats: { browsers: {}, os: {}, devices: {}, referrers: {}, countries: {}, locations: {} }
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
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp) || b.rowKey.localeCompare(a.rowKey))
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
      usersTable: {
        name: '',
        status: 'not-configured',
        message: 'Azure Storage is not configured, so profile data is stored in-memory only.'
      },
      auditTable: {
        name: '',
        status: 'not-configured',
        message: 'Azure Storage is not configured, so audit data is stored in-memory only.'
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
