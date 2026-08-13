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
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: "IBM Plex Mono", "Fira Code", "Courier New", monospace;
      color: #d6ffe4;
      background: #050806;
    }
    form {
      width: min(360px, calc(100% - 32px));
      background: rgba(5, 18, 9, 0.88);
      border: 1px solid rgba(73, 255, 135, 0.22);
      border-radius: 10px;
      padding: 28px;
    }
    h1 { font-size: 18px; margin: 0 0 18px; color: #a6ffb9; }
    label { display: block; font-size: 12px; color: #8fcca1; margin: 12px 0 4px; }
    input {
      width: 100%;
      padding: 10px;
      background: #0a120c;
      border: 1px solid rgba(73, 255, 135, 0.3);
      border-radius: 6px;
      color: #d6ffe4;
      font: inherit;
    }
    button {
      margin-top: 18px;
      width: 100%;
      padding: 10px;
      background: #49ff87;
      color: #05120a;
      border: none;
      border-radius: 6px;
      font-weight: 700;
      cursor: pointer;
    }
    .error { margin-top: 14px; color: #ff7373; font-size: 13px; min-height: 16px; }
  </style>
</head>
<body>
  <form method="POST" action="/dashboard/login" autocomplete="off">
    <h1>AzShortLink — Sign in</h1>
    <label for="username">Username</label>
    <input id="username" name="username" type="text" autocomplete="username" required />
    <label for="password">Password</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required />
    <button type="submit">Sign in</button>
    <div class="error">${errorMessage}</div>
  </form>
</body>
</html>`;
}

module.exports = { renderLoginPage };
