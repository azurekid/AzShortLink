'use strict';

const DEFAULT_INVITE_POLICY = Object.freeze({
  minimumAccountAgeDays: 7,
  minimumLegitimateLinks: 3,
  maximumDepth: 3,
  maximumRootDescendants: 100
});

function evaluateInviteEligibility({ user, ownedLinkCount, rootDescendantCount, now = Date.now(), policy = DEFAULT_INVITE_POLICY }) {
  if (!user) {
    return { allowed: false, reason: 'Profile not found.' };
  }
  if (user.status === 'suspended' || user.branchSuspended) {
    return { allowed: false, reason: 'This profile or invitation branch is suspended.' };
  }
  if (user.role === 'admin') {
    return { allowed: true };
  }
  if (!user.emailVerifiedAt) {
    return { allowed: false, reason: 'Verify your email address before creating an invite.' };
  }

  const accountAgeMs = now - Date.parse(user.createdAt || '');
  if (!Number.isFinite(accountAgeMs) || accountAgeMs < policy.minimumAccountAgeDays * 24 * 60 * 60 * 1000) {
    return { allowed: false, reason: `Your account must be at least ${policy.minimumAccountAgeDays} days old.` };
  }
  if (ownedLinkCount < policy.minimumLegitimateLinks) {
    return { allowed: false, reason: `Create at least ${policy.minimumLegitimateLinks} legitimate links before inviting someone.` };
  }
  if ((Number(user.inviteDepth) || 0) >= policy.maximumDepth) {
    return { allowed: false, reason: 'This invitation chain has reached its maximum depth.' };
  }
  if (rootDescendantCount >= policy.maximumRootDescendants) {
    return { allowed: false, reason: 'This invitation branch has reached its account quota.' };
  }

  return { allowed: true };
}

function buildInviteAncestry(sponsor) {
  const sponsorId = sponsor.id;
  return {
    invitedByUserId: sponsorId,
    rootSponsorUserId: sponsor.rootSponsorUserId || sponsorId,
    inviteDepth: (Number(sponsor.inviteDepth) || 0) + 1
  };
}

module.exports = { DEFAULT_INVITE_POLICY, evaluateInviteEligibility, buildInviteAncestry };