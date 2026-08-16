'use strict';

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function renderSignupPage(options = {}) {
  const errorMessage = options.error ? escapeHtml(options.error) : '';
  const message = options.message ? escapeHtml(options.message) : '';
  const invite = options.invite ? escapeHtml(options.invite) : '';
  // No invite code means the link is invalid/expired/redeemed - show a dead-end, not a form.
  const body = message
    ? `<span class="brand">AzShortLink</span>
    <h1>Account verification</h1>
    <p>${message}</p>
    <a href="/dashboard/login">Back to sign in</a>`
    : invite
    ? `<span class="brand">AzShortLink</span>
    <h1>Create your account</h1>
    <p>You've been invited to join AzShortLink.</p>
    <input type="hidden" name="invite" value="${invite}" />
    <label for="username">Username</label>
    <input id="username" name="username" type="text" autocomplete="username" pattern="[A-Za-z0-9._-]{3,64}" required />
    <label for="displayName">Display name</label>
    <input id="displayName" name="displayName" type="text" autocomplete="name" required />
    <label for="email">Email address</label>
    <input id="email" name="email" type="email" autocomplete="email" required />
    <label for="password">Password</label>
    <input id="password" name="password" type="password" autocomplete="new-password" minlength="12" required />
    <button type="submit">Create account</button>
    <div class="error">${errorMessage}</div>`
    : `<span class="brand">AzShortLink</span>
    <h1>Invite link unavailable</h1>
    <p>${errorMessage || 'This invite link is invalid or has expired.'}</p>
    <a href="/dashboard/login">Back to sign in</a>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>AzShortLink — Sign up</title>
  <link rel="icon" type="image/svg+xml" href="https://azurehacking.com/images/favicon.svg" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=Share+Tech+Mono&display=swap" />
  <link rel="stylesheet" href="/assets/css/auth.css" />
  <link rel="stylesheet" href="/assets/css/custom.css" />
</head>
<body>
  ${invite && !message
    ? `<form method="POST" action="/dashboard/signup" autocomplete="off">${body}</form>`
    : `<div class="auth-panel">${body}</div>`}
</body>
</html>`;
}

module.exports = { renderSignupPage };
