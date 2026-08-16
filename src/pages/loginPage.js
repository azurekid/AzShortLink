'use strict';

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function renderLoginPage(options = {}) {
  const errorMessage = options.error ? escapeHtml(options.error) : '';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>AzShortLink — Sign in</title>
  <link rel="icon" type="image/svg+xml" href="https://azurehacking.com/images/favicon.svg" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=Share+Tech+Mono&display=swap" />
  <link rel="stylesheet" href="/assets/css/auth.css" />
  <link rel="stylesheet" href="/assets/css/custom.css" />
</head>
<body>
  <form method="POST" action="/dashboard/login" autocomplete="off">
    <span class="brand">AzShortLink</span>
    <h1>Sign in</h1>
    <p>Usernames are case-sensitive.</p>
    <label for="username">Username</label>
    <input id="username" name="username" type="text" autocomplete="username" required />
    <label for="password">Password</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required />
    <button type="submit">Sign in</button>
    <button id="passkey-login" type="button">Sign in with a passkey</button>
    <p><a href="/dashboard/forgot-password">Forgot password?</a></p>
    <div class="error">${errorMessage}</div>
  </form>
  <script src="/passkeys.js"></script>
  <script src="/assets/js/login.js"></script>
</body>
</html>`;
}

module.exports = { renderLoginPage };
