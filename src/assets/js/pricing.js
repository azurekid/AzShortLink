'use strict';

const status = document.getElementById('pricing-status');

async function requestPlan(button) {
  const planId = button.dataset.plan;
  button.disabled = true;
  status.classList.remove('error');
  status.textContent = 'Submitting your plan request...';

  try {
    const response = await fetch('/api/account/plan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ plan: planId })
    });
    const body = await response.json().catch(() => ({}));

    if (response.status === 401) {
      status.classList.add('error');
      status.textContent = 'Sign in to change your plan.';
      return;
    }
    if (!response.ok) {
      status.classList.add('error');
      status.textContent = body.error || 'Unable to submit the plan request.';
      return;
    }

    status.textContent = body.message || 'Plan request submitted.';
  } catch {
    status.classList.add('error');
    status.textContent = 'Network error. Please try again.';
  } finally {
    button.disabled = false;
  }
}

for (const button of document.querySelectorAll('.plan-action')) {
  button.addEventListener('click', () => requestPlan(button));
}
