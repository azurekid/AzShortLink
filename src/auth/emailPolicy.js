'use strict';

// Known throwaway/disposable mailbox providers. Kept as a bundled list so signup never
// depends on an outbound lookup; operators can extend or override it through config.
const DISPOSABLE_EMAIL_DOMAINS = Object.freeze([
  '0-mail.com', '10minutemail.com', '10minutemail.net', '20minutemail.com', '33mail.com',
  'anonbox.net', 'armyspy.com', 'bccto.me', 'burnermail.io', 'byom.de',
  'cuvox.de', 'dayrep.com', 'dea-link.eu', 'discard.email', 'discardmail.com',
  'dispostable.com', 'dropmail.me', 'du.st', 'e4ward.com', 'einrot.com',
  'emailondeck.com', 'emailtemporanea.net', 'fakeinbox.com', 'fakemail.net', 'fakemailgenerator.com',
  'fleckens.hu', 'gemuese.eu', 'getairmail.com', 'getnada.com', 'grr.la',
  'guerrillamail.biz', 'guerrillamail.com', 'guerrillamail.de', 'guerrillamail.info', 'guerrillamail.net',
  'guerrillamail.org', 'guerrillamailblock.com', 'harakirimail.com', 'inboxbear.com', 'inboxkitten.com',
  'incognitomail.com', 'jetable.org', 'kasmail.com', 'linshiyouxiang.net', 'mail-temporaire.fr',
  'mail.tm', 'mail7.io', 'mailcatch.com', 'maildrop.cc', 'mailduck.io',
  'maileater.com', 'mailforspam.com', 'mailinator.com', 'mailmoat.com', 'mailnesia.com',
  'mailnull.com', 'mailsac.com', 'mailslurp.com', 'mailtemp.info', 'mailtothis.com',
  'meltmail.com', 'mintemail.com', 'moakt.com', 'mohmal.com', 'mvrht.com',
  'mytemp.email', 'mytrashmail.com', 'nowmymail.com', 'nwytg.net', 'objectmail.com',
  'onetimemail.org', 'opayq.com', 'pokemail.net', 'proxymail.eu', 'rcpt.at',
  'rhyta.com', 'sharklasers.com', 'shieldemail.com', 'shortmail.net', 'spam4.me',
  'spambog.com', 'spamgourmet.com', 'spamhereplease.com', 'spamex.com', 'superrito.com',
  'teleworm.us', 'temp-mail.io', 'temp-mail.org', 'tempail.com', 'tempinbox.com',
  'tempmail.dev', 'tempmail.plus', 'tempmailaddress.com', 'tempmailo.com', 'tempr.email',
  'throwawaymail.com', 'tmail.ws', 'tmpmail.net', 'trash-mail.com', 'trashmail.com',
  'trashmail.de', 'trashmail.me', 'trashmail.net', 'trbvm.com', 'yopmail.com',
  'yopmail.fr', 'yopmail.net', 'zetmail.com'
]);

// Providers whose mailbox routing ignores dots in the local part, so `a.b@` and `ab@` are
// one inbox and must hash to one identity.
const DOT_INSENSITIVE_DOMAINS = Object.freeze(['gmail.com', 'googlemail.com']);

function parseDomainList(value) {
  return String(value || '')
    .split(/[,\s;]+/)
    .map((entry) => entry.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean);
}

function splitEmail(email) {
  const normalized = String(email || '').trim().toLowerCase();
  const separator = normalized.lastIndexOf('@');
  if (separator <= 0 || separator === normalized.length - 1) return null;
  return { local: normalized.slice(0, separator), domain: normalized.slice(separator + 1) };
}

function matchesDomain(domain, candidate) {
  return domain === candidate || domain.endsWith(`.${candidate}`);
}

// Sub-address tags and provider-ignored dots let one mailbox generate unlimited unique-looking
// addresses, so duplicate detection hashes this canonical form instead of the raw address.
function canonicalizeEmail(email) {
  const parts = splitEmail(email);
  if (!parts) return '';
  let local = parts.local.split('+')[0];
  if (DOT_INSENSITIVE_DOMAINS.some((candidate) => matchesDomain(parts.domain, candidate))) {
    local = local.replaceAll('.', '');
  }
  const domain = parts.domain === 'googlemail.com' ? 'gmail.com' : parts.domain;
  return local ? `${local}@${domain}` : '';
}

function evaluateEmailPolicy(email, { blockedDomains = [], allowedDomains = [] } = {}) {
  const parts = splitEmail(email);
  if (!parts) return { allowed: false, reason: 'invalid_email', domain: '' };

  const { domain } = parts;
  if (allowedDomains.length && !allowedDomains.some((candidate) => matchesDomain(domain, candidate))) {
    return { allowed: false, reason: 'domain_not_allowed', domain };
  }

  const blocked = [...DISPOSABLE_EMAIL_DOMAINS, ...blockedDomains];
  if (blocked.some((candidate) => matchesDomain(domain, candidate))) {
    return { allowed: false, reason: 'disposable_email_domain', domain };
  }

  return { allowed: true, reason: '', domain };
}

module.exports = {
  DISPOSABLE_EMAIL_DOMAINS,
  parseDomainList,
  canonicalizeEmail,
  evaluateEmailPolicy
};
