'use strict';

const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse
} = require('@simplewebauthn/server');
const { hashIdentityValue } = require('./identity');

function relyingParty(config) {
  const origin = new URL(config.baseUrl).origin;
  return { origin, rpID: new URL(origin).hostname };
}

function signChallengeState(payload, secret, now = Date.now()) {
  const encoded = Buffer.from(JSON.stringify({ ...payload, expiresAt: now + 5 * 60 * 1000 })).toString('base64url');
  return `${encoded}.${hashIdentityValue(encoded, secret)}`;
}

function verifyChallengeState(state, secret, purpose, now = Date.now()) {
  const [encoded, signature] = String(state || '').split('.');
  if (!encoded || !signature || hashIdentityValue(encoded, secret) !== signature) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    return payload.purpose === purpose && payload.expiresAt >= now ? payload : null;
  } catch {
    return null;
  }
}

async function registrationOptions(config, user, existingCredentials) {
  const { rpID } = relyingParty(config);
  return generateRegistrationOptions({
    rpName: 'AzShortLink',
    rpID,
    userID: Buffer.from(user.id),
    userName: user.username,
    userDisplayName: user.displayName,
    attestationType: 'none',
    excludeCredentials: existingCredentials.map((credential) => ({ id: credential.id, transports: credential.transports })),
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' }
  });
}

async function verifyRegistration(config, response, expectedChallenge) {
  const { origin, rpID } = relyingParty(config);
  return verifyRegistrationResponse({ response, expectedChallenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true });
}

async function authenticationOptions(config) {
  const { rpID } = relyingParty(config);
  return generateAuthenticationOptions({ rpID, userVerification: 'required' });
}

async function verifyAuthentication(config, response, expectedChallenge, storedCredential) {
  const { origin, rpID } = relyingParty(config);
  return verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    credential: storedCredential,
    requireUserVerification: true
  });
}

module.exports = {
  signChallengeState,
  verifyChallengeState,
  registrationOptions,
  verifyRegistration,
  authenticationOptions,
  verifyAuthentication
};