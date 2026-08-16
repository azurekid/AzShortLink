'use strict';

const bcrypt = require('bcryptjs');
const { generateTemporaryPassword } = require('../auth/auth');
const { sendPasswordResetEmail } = require('./email');

async function resetPasswordAndSendEmail({ storage, user, email, config, generatePassword = generateTemporaryPassword, hashPassword = (password) => bcrypt.hash(password, 12), sendEmail = sendPasswordResetEmail }) {
  const temporaryPassword = generatePassword();
  const previousPasswordHash = user.passwordHash;
  const updated = await storage.updateUserPassword(user.id, await hashPassword(temporaryPassword));
  if (!updated) return false;

  try {
    await sendEmail(config, {
      recipient: email,
      username: user.username,
      displayName: user.displayName,
      temporaryPassword
    });
    return true;
  } catch (error) {
    await storage.updateUserPassword(user.id, previousPasswordHash);
    throw error;
  }
}

module.exports = { resetPasswordAndSendEmail };