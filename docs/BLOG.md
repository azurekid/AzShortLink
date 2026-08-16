# Building AzShortLink: A Security-Conscious URL Shortener on Azure

URL shorteners look simple from a distance. Accept a long URL, generate a code, and redirect anyone who visits it. That description fits on a whiteboard, but it omits nearly every decision that turns a demo into an operational service.

Who may create links? Who owns them? What happens when an invitation tree attracts abuse? How do developers automate the system without sharing an administrator password? How do operators rotate secrets? How much visitor data should a redirect collect? And how do we keep the whole system understandable as it grows?

AzShortLink started with the basic redirect and evolved into a compact Azure-hosted platform that addresses those questions without outsourcing user authentication to a large external identity dependency. This is the story of its architecture, trust model, and tradeoffs.

## The Product Behind the Redirect

The public behavior is intentionally small:

1. A trusted user creates a short link.
2. The service stores its code and destination.
3. A visitor requests the short URL.
4. The service records aggregate usage and returns HTTP 302.

Everything else makes those steps manageable. The dashboard supports owned links, QR downloads, visual analytics, account security, profiles, invitations, health, and audit review. Developers receive the same system through OpenAPI and a branded Swagger interface.

The result remains a URL shortener, but one designed for repeated use by multiple people rather than one API key pasted into a script.

## Why Azure Functions and Table Storage?

Azure Functions fits short-link traffic well. Redirects are bursty, handling is short, and no permanent process is required. The Node.js v4 programming model keeps route registration central while allowing domain and storage behavior to remain ordinary modules.

Azure Table Storage fits the entities. A short code maps directly to one link. Profiles, credential indexes, passkeys, and invitations have known partition and row keys. The redirect path needs no relational join.

Not all data belongs in one table. AzShortLink uses three physical tables:

- links and aggregate redirect telemetry;
- profiles, credentials, passkeys, and invitations;
- security audit events.

This is defense in depth. A filter mistake or broad permission against link data should not automatically expose password hashes or audit history.

## Keeping Redirects Focused

The redirect path reads one link, derives coarse categories from `User-Agent` and `Referer`, updates cumulative counters, and returns the destination.

It records browser family, operating system, device category, and referrer host. It does not retain redirect visitor IP addresses in link analytics. Product analytics usually need distributions, not a permanent list of visitors.

The model is aggregate rather than event-based. That keeps write volume and retention simple, but it means the dashboard should not pretend it has historical time series. It visualizes what the system genuinely knows: totals, utilization, top links, distributions, owners, and recent link access.

## Local Identity Without a Shared Administrator

Many internal tools begin with one username, one password, and one global API key. That fails as soon as several people need administration or an audit event says only "admin."

AzShortLink uses local `user` and `admin` profiles. Each administrator has an individual credential. Passwords use bcrypt, sessions are signed and HTTP-only, and the final administrator cannot demote itself.

Optional passkeys add passwordless authentication without removing password recovery. WebAuthn stores public credential material and a replay counter. Challenge state is signed with a short expiration instead of living only in worker memory, because Azure may route the ceremony's two requests to different workers.

Authorization also reloads current profile state. A valid old cookie cannot preserve a role after demotion or bypass a new suspension.

## API Keys That Preserve Ownership

Automation needs a credential independent of a browser session. Each profile can issue a personal key. The plaintext is shown once; storage retains only a SHA-256 hash and display prefix.

A personal key inherits the profile's permissions. Users manage owned links. Administrators can call management and audit endpoints. Rotation invalidates the previous key.

A deployment-wide key remains for bootstrap automation and maps to the administrator identity. It is a powerful operational secret and lives in Key Vault.

## Invitations Are a Provenance Problem

Single-use invitation links do not automatically create accountability. If every new account can immediately invite another, a disposable chain can grow even though each token is redeemed once.

AzShortLink stores invitation ancestry: direct sponsor, root sponsor, and depth. Non-admin users cannot invite immediately. Defaults require a seven-day-old account with three owned links. Branches stop at depth three and one hundred descendants. A regular profile gets one invite in total.

These controls do not prove human identity. They change the economics of account farming and preserve a chain an administrator can investigate.

## Email Verification Without Retaining the Address

Invite signup verifies mailbox control through Azure Communication Services Email. The plaintext address is normalized, used for delivery, and discarded by the application. Storage keeps a masked value and an HMAC hash.

Why not a plain hash? Email addresses have low entropy. An attacker could hash a candidate list and compare it. A keyed hash requires the deployment secret as well as the address.

That secret is durable state. Rotating it without migrating stored hashes breaks duplicate matching, so the runbook treats it differently from an ordinary API-key rotation.

Signup IP and coarse device signals use the same keyed approach. A match raises a risk flag and requires approval. It is not proof that accounts belong to one person: households, offices, VPNs, and managed devices make that inference unreliable.

## Containing a Bad Branch

Provenance matters when operators can act on it. Recursive branch suspension marks a sponsor and every descendant as unavailable for protected operations. Restoration reverses the state.

This is stronger than deleting one visible offender while descendants continue operating. It also preserves human review: signals prioritize investigation, sponsor relationships explain the chain, and audit events show administrative action.

## QR Codes as Derived Data

A QR image is a representation of the short URL, not a separate stored asset. AzShortLink generates a 512 px PNG on demand after applying normal identity and ownership checks.

Users can download it immediately after creation or later from the link list. Nothing new is stored, and the image always reflects the canonical public URL.

## Documentation as an Interface

The OpenAPI document is served at `/openapi.json`. Swagger UI at `/api` uses the same visual language as the dashboard and targets the current deployment.

Developers can authorize with personal or deployment keys, while same-origin session-only operations use the dashboard cookie. The documentation is executable: schemas, status codes, security, and request bodies can be explored directly.

Repository documentation is split by responsibility. The README is the entry point, the deployment guide is an operator runbook, the architecture document is the technical source of truth, and this blog explains the decisions. Separating those concerns reduces drift.

## Key Vault and Managed Identity

As API keys, password hashes, session secrets, identity keys, storage credentials, and email credentials accumulated, ordinary Function settings became a poor secret-management boundary.

Bicep creates an RBAC-enabled Key Vault with soft delete and purge protection. The Function receives a system identity and narrowly scoped `Key Vault Secrets User` access. Sensitive settings become versionless Key Vault references.

Rotation now means adding a secret version rather than editing several settings or deploying code. Non-secret configuration remains visible; hiding public URLs or table names would add complexity without protecting anything.

## Infrastructure and Deployment Order

Bicep provisions the plan, Function App, Storage Account and tables, Application Insights, Key Vault, identity access, settings, and optional certificates.

Custom domains require ordering. Azure must create the Function before its verification ID exists, while certificates require verified bindings. The runbook therefore uses two passes:

1. deploy without the custom domain;
2. create DNS records from outputs;
3. redeploy with bindings and certificates.

This reflects the real dependency graph instead of promising impossible one-command magic.

## What the Design Does Not Claim

AzShortLink does not perform KYC. Email verification proves mailbox control. Passkeys prove possession of a registered authenticator. Neither proves legal identity.

It does not claim deployment-wide rate limiting. The built-in limiter is process-local; scaled workers need Front Door, API Management, or another shared enforcement layer.

It is also not a multi-domain tenant platform. One deployment has one canonical base URL. Separate domains should use isolated deployments until tenant and domain ownership are explicit in the data model.

Honest boundaries are a security feature. Documentation must distinguish guarantees from heuristics.

## Lessons from the Build

**Keep the public path small.** Redirects should not depend on administration or email delivery.

**Model provenance early.** Sponsor relationships are cheap to record at creation and difficult to reconstruct later.

**Treat risk indicators as indicators.** IP and device matches can prioritize review, not silently become identity decisions.

**Reload mutable authorization state.** Signed claims establish integrity, not permanent truth.

**Separate secrets from configuration.** Vault what is sensitive; leave normal operational settings observable.

**Do not visualize data you do not have.** Cumulative counters support distributions, not historical charts.

**Make developer documentation executable.** OpenAPI and same-origin Swagger reduce integration friction and expose contract drift.

## Closing Thoughts

A reliable shortener is not defined by how quickly it generates random characters. It is defined by ownership, operational controls, security boundaries, and failure behavior.

AzShortLink stays compact: one Function application, Table Storage, Key Vault, Application Insights, and an email service. Within that footprint it supports individual administrators, scoped automation, passkeys, controlled invitations, branch accountability, privacy-aware analytics, QR distribution, auditable operations, and repeatable Azure deployment.

The redirect is the easy part. The surrounding trust model is the product.
