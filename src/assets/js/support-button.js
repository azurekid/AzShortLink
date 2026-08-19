'use strict';

(function () {
  var link = document.createElement('a');
  link.className = 'bmc-fab';
  link.href = 'https://www.buymeacoffee.com/DijkmanRogier';
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.setAttribute('aria-label', 'Support AzShortLink on Buy Me a Coffee');
  link.innerHTML = '<span class="bmc-fab-emoji" aria-hidden="true">\u2615</span><span class="bmc-fab-text">Buy me a coffee</span>';
  document.body.appendChild(link);
})();
