'use strict';

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function renderDashboard(baseUrl, links) {
  const rows = links
    .map(
      (item) => `<tr>
<td><a href="/${escapeHtml(item.code)}" target="_blank" rel="noopener noreferrer">/${escapeHtml(item.code)}</a></td>
<td><a href="${escapeHtml(item.targetUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.targetUrl)}</a></td>
<td>${escapeHtml(item.redirectCount)}</td>
<td>${escapeHtml(item.lastAccessedAt || '-')}</td>
</tr>`
    )
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>AzShortLink Dashboard</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 24px; color: #111; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #ddd; text-align: left; padding: 8px; }
    th { background: #f3f3f3; }
    .muted { color: #555; font-size: 0.95rem; }
  </style>
</head>
<body>
  <h1>AzShortLink Dashboard</h1>
  <p class="muted">Base URL: ${escapeHtml(baseUrl)}</p>
  <p class="muted">Total links: ${links.length}</p>
  <table>
    <thead>
      <tr>
        <th>Short URL</th>
        <th>Target URL</th>
        <th>Redirects</th>
        <th>Last Redirect (UTC)</th>
      </tr>
    </thead>
    <tbody>${rows || '<tr><td colspan="4">No links available</td></tr>'}</tbody>
  </table>
</body>
</html>`;
}

module.exports = { renderDashboard };
