'use strict';

document.getElementById('forgot-password-form').addEventListener('submit', (event) => {
  const isReset = event.currentTarget.action.endsWith('/dashboard/reset-password');
  const button = document.getElementById('reset-password');
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  button.textContent = isReset ? 'Resetting password...' : 'Sending reset link...';
  document.getElementById('reset-status').textContent = isReset
    ? 'Updating your password and revoking existing sessions.'
    : 'Checking your account and preparing the email. This may take a moment.';
});