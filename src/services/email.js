'use strict';

const { EmailClient } = require('@azure/communication-email');

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function buildVerificationEmailContent({ username, verificationUrl }) {
  const safeUsername = escapeHtml(username);
  const safeVerificationUrl = escapeHtml(verificationUrl);
  const plainText = [
    `Hi ${username},`,
    '',
    'Welcome to AzShortLink. Verify your email address within 24 hours before signing in:',
    verificationUrl,
    '',
    'After verification, we recommend adding a passkey from your profile for secure, passwordless sign-in.',
    '',
    'New invites can be created once your account is at least 7 days old and you have created at least 3 legitimate links.',
    '',
    'For any questions, use the Help tab in the dashboard.'
  ].join('\n');

  const html = `<!doctype html>
<html lang="en">
<body style="margin:0;background:#f3f6f8;font-family:Arial,sans-serif;color:#17212b">
  <div style="max-width:600px;margin:0 auto;padding:32px 16px">
    <div style="background:#0078d4;color:#fff;padding:24px 28px">
      <strong style="font-size:22px">AzShortLink</strong>
      <div style="margin-top:6px;font-size:14px">Account verification</div>
    </div>
    <div style="background:#fff;padding:28px;border:1px solid #d8e0e7;border-top:0">
      <h1 style="margin:0 0 18px;font-size:22px">Hi ${safeUsername},</h1>
      <p>Welcome to AzShortLink. Verify your email address within 24 hours before signing in.</p>
      <p style="margin:24px 0"><a href="${safeVerificationUrl}" style="display:inline-block;background:#0078d4;color:#fff;text-decoration:none;padding:12px 18px;font-weight:bold">Verify email address</a></p>
      <p>After verification, we recommend adding a passkey from your profile for secure, passwordless sign-in.</p>
      <p>New invites can be created once your account is at least 7 days old and you have created at least 3 legitimate links.</p>
      <p style="margin-bottom:0">For any questions, use the Help tab in the dashboard.</p>
    </div>
  </div>
</body>
</html>`;

  return { subject: 'Verify your AzShortLink account', plainText, html };
}

async function sendVerificationEmail(config, { recipient, username, displayName, verificationUrl }) {
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
      content: buildVerificationEmailContent({ username, verificationUrl })
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

module.exports = { buildVerificationEmailContent, sendVerificationEmail };