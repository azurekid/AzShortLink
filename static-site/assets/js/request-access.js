'use strict';

// Update this if the Function App is deployed under a different hostname.
const API_BASE_URL = 'https://azhk.in';

const form = document.getElementById('request-form');
const status = document.getElementById('request-status');

function showStatus(message, isError) {
  status.textContent = message;
  status.classList.toggle('error', Boolean(isError));
  status.hidden = false;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const submitButton = form.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  showStatus('Sending your request...', false);

  const email = form.email.value.trim();
  const reason = form.reason.value.trim();

  try {
    const response = await fetch(`${API_BASE_URL}/api/access-requests`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, reason })
    });
    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      showStatus(body.error || 'Unable to submit the request. Please try again later.', true);
      return;
    }

    showStatus(body.message || 'Thanks. Your request has been received.', false);
    form.reset();
  } catch {
    showStatus('Network error. Please try again.', true);
  } finally {
    submitButton.disabled = false;
  }
});
