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
  <style>
    :root {
      color-scheme: dark;
      --bg:#0a0a0f; --surface:#12121a; --card:#1a1a2e; --input:#16162a;
      --accent:#00d4ff; --danger:#ef4444; --text:#e2e8f0; --heading:#f1f5f9;
      --muted:#94a3b8; --border:#2d2d44; --border-hover:#3d3d5c;
      --glow:0 0 24px rgba(0,212,255,.22); --ease:220ms cubic-bezier(.4,0,.2,1);
    }
    * { box-sizing: border-box; }
    body {
      margin:0; min-height:100vh; display:grid; place-items:center; padding:24px;
      color:var(--text); line-height:1.6; font-family:Inter,"Segoe UI",system-ui,sans-serif;
      background-color:var(--bg);
      background-image:
        linear-gradient(rgba(10,10,15,.55),rgba(10,10,15,.78)),
        radial-gradient(circle at 15% 8%,rgba(0,212,255,.18),transparent 34%),
        radial-gradient(circle at 85% 92%,rgba(124,58,237,.18),transparent 36%),
        url("https://blackcatwebshop.z13.web.core.windows.net/media/azure-hacking-corp.jpg");
      background-position:center; background-size:cover; background-repeat:no-repeat; background-attachment:fixed;
    }
    body::after {
      content:""; position:fixed; inset:0; pointer-events:none; z-index:0;
      background:repeating-linear-gradient(0deg,transparent,transparent 3px,rgba(0,212,255,.018) 3px,rgba(0,212,255,.018) 4px);
    }
    form {
      position:relative; z-index:1; width:min(400px,100%); padding:30px;
      background:color-mix(in srgb,var(--card) 82%,transparent);
      border:1px solid var(--border); border-radius:10px;
      box-shadow:0 4px 24px rgba(0,0,0,.45);
      backdrop-filter:blur(6px);
      transition:border-color var(--ease),box-shadow var(--ease);
    }
    form:hover { border-color:var(--border-hover); box-shadow:0 4px 24px rgba(0,0,0,.45),var(--glow); }
    .brand {
      display:block; margin-bottom:18px; color:var(--accent); font-size:1.25rem; font-weight:700;
      font-family:"Share Tech Mono","Cascadia Mono",ui-monospace,monospace;
      transition:text-shadow var(--ease);
    }
    form:hover .brand { text-shadow:0 0 16px rgba(0,212,255,.7); }
    h1 { margin:0 0 6px; font-size:1.4rem; color:var(--heading); }
    p { margin:0 0 18px; color:var(--muted); font-size:.9rem; }
    label { display:block; margin:14px 0 6px; color:var(--muted); font-size:.88rem; }
    input {
      width:100%; min-height:44px; padding:10px 12px; color:var(--text);
      background:var(--input); border:1px solid var(--border); border-radius:8px; font:inherit;
      transition:border-color var(--ease);
    }
    input:hover { border-color:var(--border-hover); }
    input:focus { outline:2px solid var(--accent); outline-offset:2px; }
    button {
      margin-top:22px; width:100%; min-height:44px; padding:10px 16px; cursor:pointer;
      color:#061017; background:var(--accent); border:1px solid var(--accent);
      border-radius:8px; font:inherit; font-weight:700; transition:all var(--ease);
    }
    button:hover { transform:translateY(-1px); box-shadow:var(--glow); filter:brightness(1.08); }
    .error { min-height:20px; margin-top:14px; color:var(--danger); font-size:.86rem; }
  </style>
  <link rel="stylesheet" href="/custom.css" />
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
    <div class="error">${errorMessage}</div>
  </form>
  <script src="/passkeys.js"></script>
  <script>
    document.getElementById('passkey-login').addEventListener('click', async () => {
      const error = document.querySelector('.error');
      error.textContent = '';
      try {
        const optionsResponse = await fetch('/dashboard/passkeys/options', { method: 'POST' });
        const payload = await optionsResponse.json();
        const response = await SimpleWebAuthnBrowser.startAuthentication({ optionsJSON: payload.options });
        const verifyResponse = await fetch('/dashboard/passkeys/verify', {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ response, state: payload.state })
        });
        if (!verifyResponse.ok) throw new Error('Passkey sign-in failed.');
        window.location.href = '/dashboard';
      } catch (err) { error.textContent = err.message || 'Passkey sign-in failed.'; }
    });
  </script>
</body>
</html>`;
}

module.exports = { renderLoginPage };
