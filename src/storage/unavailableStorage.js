'use strict';

class UnavailableStorage {
  constructor(options = {}) {
    this.tableName = options.tableName || '';
    this.usersTableName = options.usersTableName || '';
    this.auditTableName = options.auditTableName || '';
    this.reason = options.reason || new Error('Storage initialization failed.');
  }

  createError() {
    const err = new Error(
      `Storage is unavailable. ${this.reason.message || 'Verify the storage connection string, table configuration, and permissions.'}`
    );
    err.code = 'STORAGE_UNAVAILABLE';
    err.cause = this.reason;
    return err;
  }

  async createLink() {
    throw this.createError();
  }

  async getLink() {
    throw this.createError();
  }

  async updateRedirectStats() {
    throw this.createError();
  }

  async listLinks() {
    throw this.createError();
  }

  async deleteLink() {
    throw this.createError();
  }

  async createUser() {
    throw this.createError();
  }

  async getUser() {
    throw this.createError();
  }

  async listUsers() {
    throw this.createError();
  }

  async getUserByEmailHash() {
    throw this.createError();
  }

  async getUserByCanonicalEmailHash() {
    throw this.createError();
  }

  async countRecentRateLimitAttempts() {
    throw this.createError();
  }

  async recordRateLimitAttempt() {
    throw this.createError();
  }

  async clearRateLimitAttempts() {
    throw this.createError();
  }

  async purgeExpiredRateLimitEntries() {
    throw this.createError();
  }

  async consumeRateLimit() {
    throw this.createError();
  }

  async peekRateLimit() {
    throw this.createError();
  }

  async updateUserIdentity() {
    throw this.createError();
  }

  async countRootDescendants() {
    throw this.createError();
  }

  async findUsersByRiskSignal() {
    throw this.createError();
  }

  async updateUserPassword() {
    throw this.createError();
  }

  async setUserApiKey() {
    throw this.createError();
  }

  async getUserByApiKeyHash() {
    throw this.createError();
  }

  async savePasskey() {
    throw this.createError();
  }

  async getPasskey() {
    throw this.createError();
  }

  async listPasskeys() {
    throw this.createError();
  }

  async updatePasskeyCounter() {
    throw this.createError();
  }

  async ensureAdminUser() {
    throw this.createError();
  }

  async deleteUser() {
    throw this.createError();
  }

  async createInvite() {
    throw this.createError();
  }

  async getInvite() {
    throw this.createError();
  }

  async listInvites() {
    throw this.createError();
  }

  async redeemInvite() {
    throw this.createError();
  }

  async deleteInvite() {
    throw this.createError();
  }

  async createHelpRequest() {
    throw this.createError();
  }

  async listHelpRequests() {
    throw this.createError();
  }

  async respondToHelpRequest() {
    throw this.createError();
  }

  async addHelpRequestMessage() {
    throw this.createError();
  }

  async setHelpRequestStatus() {
    throw this.createError();
  }

  async appendAuditEvent() {
    throw this.createError();
  }

  async listAuditEvents() {
    throw this.createError();
  }

  async ping() {
    return false;
  }

  async getHealthDetails() {
    return {
      type: 'unavailable',
      table: {
        name: this.tableName,
        status: 'down',
        message: this.reason.message || 'Storage initialization failed.'
      },
      usersTable: {
        name: this.usersTableName,
        status: 'down',
        message: this.reason.message || 'Storage initialization failed.'
      },
      auditTable: {
        name: this.auditTableName,
        status: 'down',
        message: this.reason.message || 'Storage initialization failed.'
      },
      queue: {
        status: 'not-required',
        names: [],
        message: 'This app does not use Azure Storage Queues.'
      }
    };
  }
}

module.exports = { UnavailableStorage };
