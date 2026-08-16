'use strict';

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function renderForgotPasswordPage(options = {}) {
  const message = options.message ? escapeHtml(options.message) : '';
  const error = options.error ? escapeHtml(options.error) : '';
  const resetToken = options.resetToken ? escapeHtml(options.resetToken) : '';
  const body = message
    ? `<span class="brand">AzShortLink</span>
    <h1>Check your email</h1>
    <p>${message}</p>
    <a href="/dashboard/login">Back to sign in</a>`
    : resetToken
    ? `<span class="brand">AzShortLink</span>
    <h1>Choose a new password</h1>
    <p>Use at least 12 characters. Completing this reset signs out all existing sessions.</p>
    <input type="hidden" name="token" value="${resetToken}" />
    <label for="new-password">New password</label>
    <input id="new-password" name="newPassword" type="password" minlength="12" autocomplete="new-password" required />
    <label for="confirm-password">Confirm new password</label>
    <input id="confirm-password" name="confirmPassword" type="password" minlength="12" autocomplete="new-password" required />
    <button id="reset-password" type="submit">Reset password</button>
    <div id="reset-status" class="status" role="status" aria-live="polite"></div>
    <div class="error">${error}</div>`
    : `<span class="brand">AzShortLink</span>
    <h1>Reset password</h1>
    <p>Enter the username and email address registered with your account.</p>
    <label for="username">Username</label>
    <input id="username" name="username" type="text" autocomplete="username" required />
    <label for="email">Email address</label>
    <input id="email" name="email" type="email" autocomplete="email" required />
    <button id="reset-password" type="submit">Send reset link</button>
    <div id="reset-status" class="status" role="status" aria-live="polite"></div>
    <div class="error">${error}</div>
    <p><a href="/dashboard/login">Back to sign in</a></p>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>AzShortLink — Reset password</title>
  <link rel="icon" type="image/svg+xml" href="https://azurehacking.com/images/favicon.svg" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=Share+Tech+Mono&display=swap" />
  <link rel="stylesheet" href="/assets/css/auth.css" />
  <link rel="stylesheet" href="/assets/css/custom.css" />
</head>
<body>
  ${message ? `<div class="auth-panel">${body}</div>` : `<form id="forgot-password-form" method="POST" action="${resetToken ? '/dashboard/reset-password' : '/dashboard/forgot-password'}" autocomplete="off">${body}</form>
  <script src="/assets/js/forgot-password.js"></script>`}
</body>
</html>`;
}

module.exports = { renderForgotPasswordPage };