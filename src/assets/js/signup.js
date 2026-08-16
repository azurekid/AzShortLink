'use strict';

document.getElementById('signup-form').addEventListener('submit', () => {
  const button = document.getElementById('create-account');
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  button.textContent = 'Sending verification email...';
  document.getElementById('signup-status').textContent = 'Creating your account and sending your verification email. This may take a moment.';
});