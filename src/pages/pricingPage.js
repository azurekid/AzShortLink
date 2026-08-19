'use strict';

const { listPlans } = require('../core/plans');

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function formatNumber(value) {
  return new Intl.NumberFormat('en-US').format(value);
}

function renderPlanCard(plan, currentPlanId) {
  const isCurrent = plan.id === currentPlanId;
  return `      <article class="plan-card${plan.id === 'pro' ? ' plan-featured' : ''}" aria-labelledby="plan-${escapeHtml(plan.id)}">
        <h2 id="plan-${escapeHtml(plan.id)}">${escapeHtml(plan.name)}</h2>
        <p class="plan-price"><span class="amount">&euro;${escapeHtml(plan.priceEurPerMonth)}</span><span class="period">/ month</span></p>
        <dl class="plan-limits">
          <div><dt>New short links</dt><dd>${formatNumber(plan.linksPerDay)} / day</dd></div>
          <div><dt>Redirects</dt><dd>${formatNumber(plan.redirectsPerDay)} / day</dd></div>
          <div><dt>API requests</dt><dd>${formatNumber(plan.apiRequestsPerMinute)} / minute</dd></div>
        </dl>
        <ul class="plan-highlights">
          ${plan.highlights.map((highlight) => `<li>${escapeHtml(highlight)}</li>`).join('\n          ')}
        </ul>
        ${isCurrent
          ? '<p class="plan-current" aria-live="polite">Your current plan</p>'
          : `<button class="plan-action" type="button" data-plan="${escapeHtml(plan.id)}">${plan.priceEurPerMonth === 0 ? 'Switch to Free' : `Upgrade to ${escapeHtml(plan.name)}`}</button>`}
      </article>`;
}

function renderPricingPage({ currentPlanId = '', signedIn = false } = {}) {
  const plans = listPlans();
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>AzShortLink — Pricing</title>
  <link rel="icon" type="image/svg+xml" href="https://azurehacking.com/images/favicon.svg" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=Share+Tech+Mono&display=swap" />
  <link rel="stylesheet" href="/assets/css/pricing.css" />
  <link rel="stylesheet" href="/assets/css/custom.css" />
</head>
<body>
  <nav class="navbar" aria-label="Main navigation">
    <a class="brand" href="/dashboard/login">AzShortLink <span>// URL service</span></a>
    <a class="nav-link" href="/dashboard">Dashboard</a>
  </nav>
  <main class="pricing-page">
    <header class="pricing-header">
      <h1>Plans and limits</h1>
      <p>Every plan includes the full dashboard, analytics, QR codes and the API. Paid plans raise the daily volume your account can serve.</p>
    </header>
    <section class="plan-grid" aria-label="Available plans">
${plans.map((plan) => renderPlanCard(plan, currentPlanId)).join('\n')}
    </section>
    <p class="pricing-status" id="pricing-status" role="status">${signedIn ? '' : 'Sign in to change your plan.'}</p>
    <section class="pricing-notes">
      <h2>How the limits work</h2>
      <ul>
        <li>Daily counters reset at 00:00 UTC.</li>
        <li>Redirect limits apply to all links owned by the account together.</li>
        <li>Reaching a limit returns HTTP 429; existing links are never deleted.</li>
      </ul>
    </section>
  </main>
  <footer class="footer">&copy; 2026 AzShortLink. All rights reserved.</footer>
  <script src="/assets/js/pricing.js"></script>
  <a class="bmc-fab" href="https://www.buymeacoffee.com/DijkmanRogier" target="_blank" rel="noopener noreferrer" aria-label="Support AzShortLink on Buy Me a Coffee"><span class="bmc-fab-emoji" aria-hidden="true">&#9749;</span><span class="bmc-fab-text">Buy me a coffee</span></a>
</body>
</html>`;
}

module.exports = { renderPricingPage };
