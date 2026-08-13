'use strict';

function renderNotFoundPage() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>AzShortLink — Link not found</title>
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
    .card {
      position:relative; z-index:1; width:min(440px,100%); padding:30px; text-align:center;
      background:color-mix(in srgb,var(--card) 82%,transparent);
      border:1px solid var(--border); border-radius:10px;
      box-shadow:0 4px 24px rgba(0,0,0,.45);
      backdrop-filter:blur(6px);
      transition:border-color var(--ease),box-shadow var(--ease);
    }
    .card:hover { border-color:var(--border-hover); box-shadow:0 4px 24px rgba(0,0,0,.45),var(--glow); }
    .brand {
      display:block; margin-bottom:18px; color:var(--accent); font-size:1.25rem; font-weight:700;
      font-family:"Share Tech Mono","Cascadia Mono",ui-monospace,monospace;
      transition:text-shadow var(--ease);
    }
    .card:hover .brand { text-shadow:0 0 16px rgba(0,212,255,.7); }
    .code { margin:0 0 6px; color:var(--danger); font-size:2.5rem; font-weight:800; letter-spacing:.04em; }
    h1 { margin:0 0 6px; font-size:1.3rem; color:var(--heading); }
    p { margin:0 0 18px; color:var(--muted); font-size:.9rem; }
    a.home {
      display:inline-block; margin-top:6px; min-height:44px; line-height:24px; padding:10px 20px;
      color:#061017; background:var(--accent); border:1px solid var(--accent);
      border-radius:8px; font-weight:700; text-decoration:none; transition:all var(--ease);
    }
    a.home:hover { transform:translateY(-1px); box-shadow:var(--glow); filter:brightness(1.08); }
  </style>
  <link rel="stylesheet" href="/custom.css" />
</head>
<body>
  <div class="card">
    <span class="brand">AzShortLink</span>
    <p class="code">404</p>
    <h1>This short link doesn't exist</h1>
    <p>The link you followed may be broken, expired, or removed.</p>
    <a class="home" href="/">Go to homepage</a>
  </div>
</body>
</html>`;
}

module.exports = { renderNotFoundPage };
