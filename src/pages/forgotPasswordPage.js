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
  const body = message
    ? `<span class="brand">AzShortLink</span>
    <h1>Check your email</h1>
    <p>${message}</p>
    <a href="/dashboard/login">Back to sign in</a>`
    : `<span class="brand">AzShortLink</span>
    <h1>Reset password</h1>
    <p>Enter the username and email address registered with your account.</p>
    <label for="username">Username</label>
    <input id="username" name="username" type="text" autocomplete="username" required />
    <label for="email">Email address</label>
    <input id="email" name="email" type="email" autocomplete="email" required />
    <button id="reset-password" type="submit">Send temporary password</button>
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
  ${message ? `<div class="auth-panel">${body}</div>` : `<form id="forgot-password-form" method="POST" action="/dashboard/forgot-password" autocomplete="off">${body}</form>
  <script>
    document.getElementById('forgot-password-form').addEventListener('submit', () => {
      const button = document.getElementById('reset-password');
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      button.textContent = 'Sending temporary password...';
      document.getElementById('reset-status').textContent = 'Checking your account and preparing the email. This may take a moment.';
    });
  </script>`}
</body>
</html>`;
}

module.exports = { renderForgotPasswordPage };