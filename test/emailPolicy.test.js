'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { canonicalizeEmail, evaluateEmailPolicy, parseDomainList } = require('../src/auth/emailPolicy');

test('rejects known disposable mailbox providers and their subdomains', () => {
  for (const email of ['user@mailinator.com', 'user@inbox.mailinator.com', 'user@yopmail.com', 'user@temp-mail.org']) {
    const result = evaluateEmailPolicy(email);
    assert.equal(result.allowed, false, email);
    assert.equal(result.reason, 'disposable_email_domain');
  }
});

test('accepts ordinary mailbox providers', () => {
  for (const email of ['user@gmail.com', 'user@contoso.com', 'user@outlook.com']) {
    assert.equal(evaluateEmailPolicy(email).allowed, true, email);
  }
});

test('operators can extend the blocklist and pin an allowlist', () => {
  assert.equal(evaluateEmailPolicy('user@contoso.com', { blockedDomains: ['contoso.com'] }).reason, 'disposable_email_domain');
  assert.equal(evaluateEmailPolicy('user@contoso.com', { allowedDomains: ['fabrikam.com'] }).reason, 'domain_not_allowed');
  assert.equal(evaluateEmailPolicy('user@mail.fabrikam.com', { allowedDomains: ['fabrikam.com'] }).allowed, true);
});

test('malformed addresses are rejected before any domain matching', () => {
  for (const email of ['', 'not-an-email', '@contoso.com', 'user@']) {
    assert.equal(evaluateEmailPolicy(email).reason, 'invalid_email', email);
  }
});

test('sub-address tags and provider-ignored dots collapse to one identity', () => {
  assert.equal(canonicalizeEmail('First.Last+signup17@GoogleMail.com'), 'firstlast@gmail.com');
  assert.equal(canonicalizeEmail('firstlast@gmail.com'), 'firstlast@gmail.com');
  // Dots are only stripped where the provider ignores them.
  assert.equal(canonicalizeEmail('first.last+tag@contoso.com'), 'first.last@contoso.com');
  assert.equal(canonicalizeEmail('+tag@contoso.com'), '');
});

test('domain lists accept comma, space and @-prefixed entries', () => {
  assert.deepEqual(parseDomainList(' @Contoso.com, fabrikam.com  tailspin.com '), ['contoso.com', 'fabrikam.com', 'tailspin.com']);
  assert.deepEqual(parseDomainList(''), []);
});
