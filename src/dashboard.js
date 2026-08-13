'use strict';

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function renderDashboard(baseUrl, options = {}) {
  const apiKeyConfigured = options.apiKeyConfigured !== false;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>AzShortLink Dashboard</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #050806;
      --bg-panel: rgba(5, 18, 9, 0.88);
      --line: rgba(73, 255, 135, 0.22);
      --text: #d6ffe4;
      --muted: #8fcca1;
      --accent: #49ff87;
      --accent-strong: #a6ffb9;
      --danger: #ff7373;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: "IBM Plex Mono", "Fira Code", "Courier New", monospace;
      color: var(--text);
      background:
        radial-gradient(circle at top, rgba(73, 255, 135, 0.1), transparent 36%),
        linear-gradient(180deg, rgba(73, 255, 135, 0.05), transparent 12%),
        var(--bg);
      position: relative;
      overflow-x: hidden;
    }
    body::before {
      content: "";
      position: fixed;
      inset: 0;
      background: repeating-linear-gradient(
        to bottom,
        rgba(255, 255, 255, 0.035),
        rgba(255, 255, 255, 0.035) 1px,
        transparent 1px,
        transparent 4px
      );
      pointer-events: none;
      opacity: 0.22;
    }
    .shell {
      width: min(1100px, calc(100% - 32px));
      margin: 24px auto;
      padding: 24px;
      border: 1px solid var(--line);
      background: var(--bg-panel);
      box-shadow: 0 0 24px rgba(73, 255, 135, 0.14);
      position: relative;
    }
    .shell::after {
      content: "_";
      position: absolute;
      right: 24px;
      bottom: 18px;
      color: var(--accent);
      animation: blink 1s steps(1) infinite;
    }
    @keyframes blink { 50% { opacity: 0; } }
    h1, h2 { margin: 0 0 12px; line-height: 1.1; }
    h1 { font-size: clamp(2rem, 4vw, 3.4rem); text-transform: uppercase; letter-spacing: 0.12em; }
    h1 .glitch {
      color: var(--accent);
      text-shadow: 2px 0 rgba(255, 0, 92, 0.3), -2px 0 rgba(73, 255, 135, 0.4);
    }
    p, label, button, input, table { font-size: 0.98rem; }
    p { color: var(--muted); }
    .grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 20px;
      margin-top: 24px;
    }
    .panel {
      border: 1px solid var(--line);
      padding: 18px;
      background: rgba(0, 0, 0, 0.24);
    }
    .panel.full { grid-column: 1 / -1; }
    .label, label {
      display: block;
      margin-bottom: 8px;
      color: var(--accent-strong);
    }
    .stack { display: grid; gap: 14px; }
    input, button {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 0;
      padding: 12px 14px;
      background: rgba(1, 11, 4, 0.95);
      color: var(--text);
      font: inherit;
    }
    input:focus, button:focus, a:focus {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }
    button {
      cursor: pointer;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    button:hover {
      border-color: var(--accent);
      box-shadow: 0 0 18px rgba(73, 255, 135, 0.16);
    }
    .actions {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
    }
    .actions > * { flex: 1 1 180px; }
    .hint, .status, .result, .banner {
      border-left: 3px solid var(--accent);
      padding: 12px 14px;
      background: rgba(5, 15, 8, 0.7);
      color: var(--text);
      white-space: pre-wrap;
      word-break: break-word;
    }
    .banner.warning, .status.error { border-left-color: var(--danger); }
    .result a, table a { color: var(--accent-strong); }
    .mono { font-family: inherit; }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 12px;
    }
    th, td {
      border: 1px solid var(--line);
      text-align: left;
      padding: 10px;
      vertical-align: top;
    }
    th {
      color: var(--accent-strong);
      background: rgba(73, 255, 135, 0.08);
    }
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }
    @media (max-width: 860px) {
      .shell { padding: 18px; }
      .grid { grid-template-columns: 1fr; }
      .actions { flex-direction: column; }
    }
  </style>
</head>
<body>
  <main class="shell">
    <h1><span class="glitch">AzShortLink</span> Console</h1>
    <p>Base URL: <span class="mono">${escapeHtml(baseUrl)}</span></p>
    <p>Use the terminal console below to mint new short links and inspect existing aliases with your API key.</p>
    <form method="POST" action="/dashboard/logout" style="margin: -8px 0 12px;">
      <button type="submit" style="width: auto;">Sign out</button>
    </form>
    ${
      apiKeyConfigured
        ? ''
        : '<p class="banner warning">Warning: SHORTLINK_API_KEY is not configured on the server. API write operations will fail until the app setting is restored.</p>'
    }
    <div class="grid">
      <section class="panel">
        <h2>Create short link</h2>
        <form id="create-form" class="stack">
          <div>
            <label for="url">Original URL</label>
            <input id="url" name="url" type="url" placeholder="https://example.com/resource" required />
          </div>
          <div>
            <label for="alias">Custom alias (optional)</label>
            <input id="alias" name="alias" type="text" maxlength="32" placeholder="mrrobot2026" />
          </div>
          <div>
            <label for="apiKey">API key</label>
            <input id="apiKey" name="apiKey" type="password" autocomplete="off" placeholder="Paste API key for authenticated requests" required />
          </div>
          <div class="actions">
            <button type="submit">Create link</button>
            <button id="copy-button" type="button">Copy result</button>
          </div>
        </form>
        <div id="status" class="status" role="status" aria-live="polite">Awaiting input…</div>
        <div id="result" class="result" hidden></div>
      </section>
      <section class="panel">
        <h2>API notes</h2>
        <div class="hint">
POST /api/shorten
GET /api/stats
GET /api/health

Alias rules: 4-32 chars, letters/numbers/_/-
Redirects remain HTTP 302.
        </div>
        <div class="actions" style="margin-top: 14px;">
          <button id="load-stats" type="button">Load stats</button>
        </div>
      </section>
      <section class="panel full">
        <h2>Known links</h2>
        <table>
          <thead>
            <tr>
              <th>Short URL</th>
              <th>Target URL</th>
              <th>Redirects</th>
              <th>Last Redirect (UTC)</th>
            </tr>
          </thead>
          <tbody id="stats-body">
            <tr><td colspan="4">No data loaded yet. Use “Load stats” with an API key.</td></tr>
          </tbody>
        </table>
      </section>
    </div>
  </main>
  <script>
    const statusEl = document.getElementById('status');
    const resultEl = document.getElementById('result');
    const statsBodyEl = document.getElementById('stats-body');
    const copyButton = document.getElementById('copy-button');
    const createForm = document.getElementById('create-form');
    const loadStatsButton = document.getElementById('load-stats');

    function setStatus(message, isError = false) {
      statusEl.textContent = message;
      statusEl.className = isError ? 'status error' : 'status';
    }

    function getApiKey() {
      return document.getElementById('apiKey').value.trim();
    }

    function escapeHtml(value) {
      return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
    }

    function renderLinks(links) {
      if (!links.length) {
        statsBodyEl.innerHTML = '<tr><td colspan="4">No links returned.</td></tr>';
        return;
      }

      statsBodyEl.innerHTML = links.map((item) => {
        const code = escapeHtml(item.code || '');
        const shortUrl = escapeHtml(item.shortUrl || '${escapeHtml(baseUrl)}' + '/' + (item.code || ''));
        const targetUrl = escapeHtml(item.targetUrl || '');
        const redirectCount = escapeHtml(item.redirectCount ?? 0);
        const lastAccessedAt = escapeHtml(item.lastAccessedAt || '-');

        return '<tr>' +
          '<td><a href=\"' + shortUrl + '\" target=\"_blank\" rel=\"noopener noreferrer\">' + shortUrl + '</a></td>' +
          '<td><a href=\"' + targetUrl + '\" target=\"_blank\" rel=\"noopener noreferrer\">' + targetUrl + '</a></td>' +
          '<td>' + redirectCount + '</td>' +
          '<td>' + lastAccessedAt + '</td>' +
        '</tr>';
      }).join('');
    }

    async function apiRequest(path, options = {}) {
      const apiKey = getApiKey();
      const headers = new Headers(options.headers || {});
      if (apiKey) {
        headers.set('x-api-key', apiKey);
      }

      const response = await fetch(path, { ...options, headers });
      const contentType = response.headers.get('content-type') || '';
      const body = contentType.includes('application/json') ? await response.json() : await response.text();
      if (!response.ok) {
        const message = body && body.error ? body.error : response.statusText;
        throw new Error(message || 'Request failed.');
      }

      return body;
    }

    createForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      resultEl.hidden = true;
      setStatus('Creating short link...');

      try {
        const payload = {
          url: document.getElementById('url').value.trim()
        };
        const alias = document.getElementById('alias').value.trim();
        if (alias) {
          payload.uniqueValue = alias;
        }

        const result = await apiRequest('/api/shorten', {
          method: 'POST',
          headers: {
            'content-type': 'application/json'
          },
          body: JSON.stringify(payload)
        });

        resultEl.hidden = false;
        const safeShortUrl = escapeHtml(result.shortUrl);
        resultEl.innerHTML = 'Created: <a id="short-url" href=\"' + safeShortUrl + '\" target=\"_blank\" rel=\"noopener noreferrer\">' + safeShortUrl + '</a>';
        setStatus('Short link created.');
        await navigator.clipboard.writeText(result.shortUrl).catch(() => {});
      } catch (error) {
        setStatus(error.message, true);
      }
    });

    copyButton.addEventListener('click', async () => {
      const shortUrl = document.getElementById('short-url');
      if (!shortUrl) {
        setStatus('No short URL available to copy.', true);
        return;
      }

      try {
        await navigator.clipboard.writeText(shortUrl.textContent);
        setStatus('Short URL copied to clipboard.');
      } catch (error) {
        setStatus('Clipboard copy failed. Copy the URL manually.', true);
      }
    });

    loadStatsButton.addEventListener('click', async () => {
      setStatus('Loading stats...');
      try {
        const result = await apiRequest('/api/stats');
        renderLinks(result.links || []);
        setStatus('Stats loaded.');
      } catch (error) {
        setStatus(error.message, true);
      }
    });
  </script>
</body>
</html>`;
}

module.exports = { renderDashboard };
