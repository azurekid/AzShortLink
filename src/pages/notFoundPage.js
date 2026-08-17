'use strict';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function renderNotFoundPage({
  code = '404',
  title = 'Short link not found',
  description = 'The link you followed may be broken, expired, or removed.',
  command = 'Resolve-ShortLink -CurrentRequest',
  output = 'ERROR: No matching short link was found.'
} = {}) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>AzShortLink — ${escapeHtml(code)}</title>
  <link rel="icon" type="image/svg+xml" href="https://azurehacking.com/images/favicon.svg" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=Share+Tech+Mono&display=swap" />
  <link rel="stylesheet" href="/assets/css/not-found.css" />
  <link rel="stylesheet" href="/assets/css/custom.css" />
</head>
<body>
  <nav class="navbar" aria-label="Main navigation">
    <a class="brand" href="/dashboard/login">AzShortLink <span>// URL service</span></a>
  </nav>
  <main class="error-page">
    <section class="error-content" aria-labelledby="error-title">
      <p class="code">${escapeHtml(code)}</p>
      <h1 id="error-title">${escapeHtml(title)}</h1>
      <p class="description">${escapeHtml(description)}</p>
      <div class="terminal" role="status" aria-label="Lookup result">
        <div><span class="prompt">$</span> ${escapeHtml(command)}</div>
        <div class="output">${escapeHtml(output)}</div>
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
