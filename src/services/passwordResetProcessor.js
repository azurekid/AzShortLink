'use strict';

const { timingSafeEqualString } = require('../auth/auth');
const { EMAIL_PATTERN, createPasswordResetToken, hashIdentityValue, normalizeEmail } = require('../auth/identity');
const { sendPasswordResetEmail } = require('./email');

function parseQueueMessage(message) {
  if (Buffer.isBuffer(message)) return JSON.parse(message.toString('utf8'));
  return typeof message === 'string' ? JSON.parse(message) : message;
}

async function processPasswordResetMessage(message, { storage, config, sendEmail = sendPasswordResetEmail }) {
  const payload = parseQueueMessage(message);
  const username = typeof payload?.username === 'string' ? payload.username.trim() : '';
  const email = normalizeEmail(payload?.email);
  if (!username || !EMAIL_PATTERN.test(email)) return { sent: false, reason: 'invalid_request' };

  const user = await storage.getUser(username);
  const suppliedEmailHash = hashIdentityValue(email, config.identityHashSecret);
  const emailMatches = user && timingSafeEqualString(user.emailHash || '', suppliedEmailHash);
  if (!emailMatches || !user.emailVerifiedAt || (user.status || 'active') !== 'active') {
    return { sent: false, reason: 'account_mismatch' };
  }

  const token = createPasswordResetToken(user, config.identityHashSecret);
  await sendEmail(config, {
    recipient: email,
    username: user.username,
    displayName: user.displayName,
    resetUrl: `${config.baseUrl}/dashboard/reset-password?token=${encodeURIComponent(token)}`
  });
  return { sent: true };
}

module.exports = { parseQueueMessage, processPasswordResetMessage };