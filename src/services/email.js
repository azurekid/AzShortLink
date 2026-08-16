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
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>Verify your AzShortLink account</title>
</head>
<body style="margin:0;padding:0;background-color:#eef2f5;color:#17212b;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">Verify your email address to finish setting up your AzShortLink account.</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background-color:#eef2f5">
    <tr>
      <td align="center" style="padding:32px 12px">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;background-color:#ffffff;border:1px solid #d7e0e7;border-collapse:separate">
          <tr>
            <td style="padding:24px 32px;background-color:#17212b;border-bottom:4px solid #00a4ef;color:#ffffff">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td style="font-size:23px;line-height:28px;font-weight:700">AzShortLink</td>
                  <td align="right" style="font-size:12px;line-height:18px;color:#b9c8d4;text-transform:uppercase">Account verification</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:36px 32px 20px">
              <h1 style="margin:0 0 16px;color:#17212b;font-size:24px;line-height:32px;font-weight:700">Hi ${safeUsername},</h1>
              <p style="margin:0;color:#405261;font-size:16px;line-height:25px">Welcome to AzShortLink. Verify your email address within 24 hours to activate your account and sign in.</p>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:8px 32px 28px">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td align="center" bgcolor="#0078d4" style="background-color:#0078d4">
                    <a href="${safeVerificationUrl}" style="display:inline-block;padding:14px 24px;color:#ffffff;font-size:16px;line-height:20px;font-weight:700;text-decoration:none">Verify email address</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 28px">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background-color:#f4f8fb;border-left:4px solid #00a4ef">
                <tr>
                  <td style="padding:18px 20px">
                    <p style="margin:0 0 8px;color:#17212b;font-size:14px;line-height:21px;font-weight:700">After verification</p>
                    <p style="margin:0 0 10px;color:#405261;font-size:14px;line-height:21px">Add a passkey from your profile for secure, passwordless sign-in.</p>
                    <p style="margin:0;color:#405261;font-size:14px;line-height:21px">You can create a new invite once your account is at least 7 days old and you have created at least 3 legitimate links.</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 32px">
              <p style="margin:0 0 10px;color:#405261;font-size:14px;line-height:21px">If the button does not work, open this link:</p>
              <p style="margin:0;word-break:break-all;font-size:12px;line-height:19px"><a href="${safeVerificationUrl}" style="color:#0067b8;text-decoration:underline">${safeVerificationUrl}</a></p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px;background-color:#f8fafb;border-top:1px solid #d7e0e7;color:#627482;font-size:12px;line-height:19px">
              For questions or support, use the Help tab in your dashboard.<br>
              This verification link expires after 24 hours.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
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