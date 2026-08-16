'use strict';

const { EmailClient } = require('@azure/communication-email');

async function sendVerificationEmail(config, { recipient, displayName, verificationUrl }) {
  if (!config.emailConnectionString || !config.emailSenderAddress) {
    const err = new Error('Email verification delivery is not configured.');
    err.code = 'EMAIL_NOT_CONFIGURED';
    throw err;
  }

  try {
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
    const result = await poller.pollUntilDone();
    if (result && result.status && String(result.status).toLowerCase() !== 'succeeded') {
      throw new Error('Email delivery did not succeed.');
    }
    return result;
  } catch (cause) {
    const err = new Error('Verification email delivery failed.');
    err.code = 'EMAIL_DELIVERY_FAILED';
    err.cause = cause;
    throw err;
  }
}

module.exports = { sendVerificationEmail };