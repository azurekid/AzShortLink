'use strict';

function renderNotFoundPage() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>AzShortLink — 404</title>
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
      margin:0; min-height:100vh; color:var(--text); line-height:1.6;
      font-family:Inter,"Segoe UI",system-ui,sans-serif;
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
    .navbar, .footer, .error-page { position:relative; z-index:1; width:min(1040px,calc(100% - 48px)); margin:auto; }
    .navbar {
      display:flex; justify-content:space-between; align-items:center; padding:28px 0;
      border-bottom:1px solid rgba(45,45,68,.7);
    }
    .brand { color:var(--accent); font:700 1.25rem "Share Tech Mono","Cascadia Mono",ui-monospace,monospace; }
    .brand span { color:var(--muted); }
    .error-page { display:grid; place-items:center; min-height:calc(100vh - 177px); padding:56px 0; }
    .error-content { width:min(680px,100%); text-align:center; }
    .code { margin:0; color:var(--danger); font:800 clamp(5rem,16vw,9rem)/1 "Share Tech Mono",monospace; letter-spacing:.04em; text-shadow:0 0 30px rgba(239,68,68,.35); }
    h1 { margin:12px 0 8px; color:var(--heading); font-size:clamp(1.7rem,4vw,2.4rem); }
    .description { margin:0 auto 26px; max-width:580px; color:var(--muted); }
    .terminal {
      margin:0 auto 28px; padding:18px 20px; text-align:left; color:var(--text);
      background:rgba(18,18,26,.84); border:1px solid var(--border); border-radius:10px;
      box-shadow:0 4px 24px rgba(0,0,0,.45); font:400 .9rem/1.8 "Share Tech Mono",monospace;
    }
    .terminal::before { content:"●  ●  ●"; display:block; margin-bottom:10px; color:var(--border-hover); letter-spacing:.25em; }
    .prompt { color:var(--accent); }
    .output { color:var(--danger); }
    .actions { display:flex; justify-content:center; flex-wrap:wrap; gap:12px; }
    a.action {
      display:inline-flex; align-items:center; justify-content:center; min-height:44px; padding:10px 20px;
      color:#061017; background:var(--accent); border:1px solid var(--accent); border-radius:8px;
      font-weight:700; text-decoration:none; transition:all var(--ease);
    }
    a.action:hover { transform:translateY(-1px); box-shadow:var(--glow); filter:brightness(1.08); }
    a.action.secondary { color:var(--text); background:transparent; border-color:var(--border-hover); }
    .footer { padding:24px 0; border-top:1px solid rgba(45,45,68,.7); color:var(--muted); text-align:center; font-size:.8rem; }
    @media (max-width:600px) {
      .navbar, .footer, .error-page { width:min(100% - 32px,1040px); }
      .navbar { padding:20px 0; }
      .brand { font-size:1rem; }
      .error-page { min-height:calc(100vh - 145px); padding:40px 0; }
    }
  </style>
  <link rel="stylesheet" href="/custom.css" />
</head>
<body>
  <nav class="navbar" aria-label="Main navigation">
    <a class="brand" href="/dashboard/login">AzShortLink <span>// URL service</span></a>
  </nav>
  <main class="error-page">
    <section class="error-content" aria-labelledby="error-title">
      <p class="code">404</p>
      <h1 id="error-title">Short link not found</h1>
      <p class="description">The link you followed may be broken, expired, or removed.</p>
      <div class="terminal" role="status" aria-label="Lookup result">
        <div><span class="prompt">$</span> Resolve-ShortLink -CurrentRequest</div>
        <div class="output">ERROR: No matching short link was found.</div>
      </div>
      <div class="actions">
        <a class="action" href="/dashboard/login">Back to home</a>
      </div>
    </section>
  </main>
  <footer class="footer">&copy; 2026 AzShortLink. All rights reserved.</footer>
</body>
</html>`;
}

module.exports = { renderNotFoundPage };
