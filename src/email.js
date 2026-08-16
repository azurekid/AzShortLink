'use strict';

const { EmailClient } = require('@azure/communication-email');

async function sendVerificationEmail(config, { recipient, displayName, verificationUrl }) {
  if (!config.emailConnectionString || !config.emailSenderAddress) {
    const err = new Error('Email verification delivery is not configured.');
    err.code = 'EMAIL_NOT_CONFIGURED';
    throw err;
  }

  const client = new EmailClient(config.emailConnectionString);
  const poller = await client.beginSend({
    senderAddress: config.emailSenderAddress,
    recipients: { to: [{ address: recipient, displayName }] },
    content: {
      subject: 'Verify your AzShortLink account',
      plainText: `Verify your account within 24 hours: ${verificationUrl}`,
      html: `<p>Verify your AzShortLink account within 24 hours.</p><p><a href="${verificationUrl}">Verify email address</a></p>`
    }
  });
  return poller.pollUntilDone();
}

module.exports = { sendVerificationEmail };