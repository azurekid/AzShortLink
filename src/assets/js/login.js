'use strict';

document.getElementById('passkey-login').addEventListener('click', async () => {
  const error = document.querySelector('.error');
  error.textContent = '';
  try {
    const optionsResponse = await fetch('/dashboard/passkeys/options', { method: 'POST' });
    const payload = await optionsResponse.json();
    const response = await SimpleWebAuthnBrowser.startAuthentication({ optionsJSON: payload.options });
    const verifyResponse = await fetch('/dashboard/passkeys/verify', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ response, state: payload.state })
    });
    if (!verifyResponse.ok) throw new Error('Passkey sign-in failed.');
    window.location.href = '/dashboard';
  } catch (err) {
    error.textContent = err.message || 'Passkey sign-in failed.';
  }
});