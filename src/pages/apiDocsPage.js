'use strict';

const { HEAD_ASSETS } = require('../dashboard/shared');

function renderApiDocsPage() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>AzShortLink API Reference</title>
${HEAD_ASSETS}
  <link rel="stylesheet" href="/vendor/swagger/swagger-ui.css" />
  <link rel="stylesheet" href="/assets/css/api-docs.css" />
  <link rel="stylesheet" href="/assets/css/custom.css" />
</head>
<body>
  <div class="bg-layer"></div>
  <main class="docs-shell">
    <header class="docs-header">
      <a class="brand" href="/">AzShortLink</a>
      <a class="dashboard-link" href="/dashboard"><i class="fas fa-arrow-left"></i>Dashboard</a>
    </header>
    <section class="docs-intro">
      <p>Developer interface</p>
      <h1>API reference</h1>
      <span>Interactive OpenAPI 3.0 documentation for the current deployment.</span>
    </section>
    <section class="swagger-frame" aria-label="Interactive API reference">
      <div id="swagger-ui"></div>
    </section>
  </main>
  <script src="/vendor/swagger/swagger-ui-bundle.js"></script>
  <script src="/assets/js/api-docs.js"></script>
  <script src="/assets/js/support-button.js" defer></script>
</body>
</html>`;
}

module.exports = { renderApiDocsPage };