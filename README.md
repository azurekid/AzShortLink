# AzShortLink

A low-cost Azure Functions URL shortener with authenticated link creation, redirects, redirect statistics, a multi-profile browser dashboard, and deploy-ready Azure infrastructure

## Features

- `POST /api/shorten` (authenticated) to create short URLs
- Random or custom alias support (`uniqueValue`, `alias`, or `code` in payload)
- `GET /{code}` redirect to original URL
- Azure Table Storage backend with explicit table provisioning in Bicep
- Link data, user profiles/credentials, and the audit trail are stored in **separate Azure Tables** (not just separate partitions) to limit the blast radius of a filter bug, an overly-broad SAS token, or a scoped RBAC role assignment
- `GET /api/stats/{code?}` (authenticated) for stats JSON
- `GET /dashboard` authenticated UI for creating and inspecting profile-owned short links
- Tabbed dashboard: Links, Statistics, Account, and an admin-only Admin tab
- `DELETE /api/links/{code}` to remove links you own (admins may remove any link)
- `GET /api/links/{code}/qr` downloads a PNG QR code for a link you own (admins may access any link)
- `GET /api/analytics` for aggregated redirect statistics
- `POST /api/profile/password` so users can rotate their own password
- `POST /api/profile/apikey` issues a personal API key scoped to the signed-in profile
- `GET /api/users` (admin) lists every profile with its link count
- `DELETE /api/users/{username}` (admin) removes a profile (not your own, not the primary admin)
- `POST /api/users/{username}/password` (admin) resets another profile's password without knowing the current one
- `GET /api/audit` (admin) queries the 30-day security audit trail for your SIEM
- `GET /custom.css` serves `src/custom.css` so you can override the theme without touching app code
- Admin-created user profiles with bcrypt password hashes and signed sessions
- Case-sensitive usernames
- `GET /api/health` for table/queue/config diagnostics
- Configurable Azure Function App CORS origins for deployed and local browser clients

## Configuration

Set these app settings in Azure Function App:

- `SHORTLINK_API_KEY` (required, used via `x-api-key` header or Authorization token header)
- `PUBLIC_BASE_URL` (default: `https://azhk.in`)
- `AZURE_STORAGE_CONNECTION_STRING` (or `AzureWebJobsStorage`)
- `SHORTLINK_TABLE_NAME` (default: `AzShortLinks`) — short link data
- `SHORTLINK_USERS_TABLE_NAME` (default: `<SHORTLINK_TABLE_NAME>Users`) — user profiles, credentials and API keys
- `SHORTLINK_AUDIT_TABLE_NAME` (default: `<SHORTLINK_TABLE_NAME>Audit`) — security audit trail
- `DASHBOARD_USERNAME` (required for the initial admin profile)
- `DASHBOARD_PASSWORD_HASH` (required; generate with `node scripts/generate-dashboard-hash.js '<password>'`)
- `DASHBOARD_SESSION_SECRET` (optional; derived from the API key and password hash when omitted)
- `API_RATE_LIMIT_MAX_REQUESTS` (optional; API requests per client IP per window, default `60`)
- `API_RATE_LIMIT_WINDOW_MS` (optional; rate-limit window in milliseconds, default `60000`)

All `/api/*` endpoints return HTTP `429` with a `Retry-After` header when a client exceeds the limit. The limiter is process-local and keys requests by the first `x-forwarded-for` address, so use an Azure WAF or API gateway for a deployment-wide quota across multiple Function workers.

The app does not use Azure Storage Queues today, so only the table resource is provisioned. `/api/health` reports queue status as `not-required`.

You can use `local.settings.sample.json` as a template for local settings.

## API

The complete OpenAPI 3.0 document is available at [`/openapi.json`](/openapi.json). Open [`/docs`](/docs) for the interactive Swagger UI, where developers can enter an `x-api-key` or bearer token and send requests to the current deployment.

### Create short URL

`POST /api/shorten`

Headers:

- `x-api-key: <SHORTLINK_API_KEY>` **or** `Authorization` token header

Body:

```json
{
  "url": "https://learn.microsoft.com/azure/azure-functions/",
  "uniqueValue": "myDocLink"
}
```

`uniqueValue` is optional. If omitted, a unique random code is generated.

### Redirect

`GET /{code}` returns HTTP `302` to the original URL.

### Stats and dashboard

- `GET /api/stats/{code?}` returns JSON statistics
- `GET /dashboard` returns an authenticated dashboard. Sign in with the configured admin profile; browser requests use the secure session cookie and do not require the API key.
- Admins can create additional profiles from the dashboard. New profiles can create links and see only their own links and statistics.
- Short aliases remain globally unique across all profiles.

### Dashboard tabs

| Tab | Available to | Contents |
|---|---|---|
| Links | everyone | Create links, list links, delete links |
| Statistics | everyone | Icon stat cards plus bar charts for top links, browsers, operating systems, device types and referrers |
| Account | everyone | Current profile, self-service password change, personal API key |
| Admin | admins | All profiles with link counts, add user, service health, redirects by profile |
| Audit trail | admins | Filterable 30-day security audit log (login attempts, link/user/password/API-key events) with CSV export |

Admins see every profile's links (with an owner column) and can delete any link. Regular users only ever see and delete their own links. Changing a password signs the user out so they re-authenticate.

### Custom styling

Edit `src/custom.css` and redeploy. It is served at `/custom.css` and loaded after the built-in theme on both the login and dashboard pages, so any CSS variable or selector can be overridden. For example:

```css
:root { --accent: #ff7a18; }
```

### Personal API keys

Each profile can issue its own API key from **Account → Personal API key**. Keys look like `azsl_<random>`, are shown exactly once, and only a SHA-256 hash is stored. A key inherits its owner's permissions, so links created with it belong to that profile and a non-admin key can only read or delete that profile's links. Generating a new key immediately invalidates the previous one.

```bash
curl -X POST "https://azhk.in/api/shorten" \
  -H "x-api-key: azsl_<your-key>" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com"}'
```

The deployment-wide `SHORTLINK_API_KEY` still works and maps to the admin profile.

### Redirect telemetry

Each redirect updates per-link counters for browser, operating system, device type, and referrer host, derived from the request's `User-Agent` and `Referer` headers. No IP addresses or personal data are stored, and no extra storage write is added — the counters piggyback on the existing redirect-count update. The Statistics tab renders these as bar charts alongside totals and top links.

API clients may still authenticate with `SHORTLINK_API_KEY`; that key acts as the admin identity. Dashboard users authenticate with their profile credentials.

### Audit trail

Every security-relevant action is recorded to Azure Table Storage (a dedicated audit table, separate from links and user profiles) and retained for 30 days:

| Action | Recorded on |
|---|---|
| `LOGIN_SUCCESS` / `LOGIN_FAILED` | Every dashboard sign-in attempt, success or failure |
| `LINK_CREATED` | Who created a link, its code, and the target URL |
| `LINK_DELETED` | Who deleted a link, and whether it was an admin acting on someone else's link |
| `USER_CREATED` | Admin-created profiles |
| `USER_DELETED` | Admin-deleted profiles |
| `PASSWORD_CHANGED` | Self-service password rotation |
| `PASSWORD_RESET_BY_ADMIN` | Admin-forced password reset for another profile |
| `API_KEY_ROTATED` | Personal API key generation |

Query it as an admin:

```bash
curl "https://azhk.in/api/audit?limit=500" -H "x-api-key: <admin-api-key>"
```

Optional query params: `since` (ISO 8601 timestamp), `action` (filter to one action type), `actor` (filter to one username), `limit` (default 200, max 1000). The response includes `retentionDays: 30` so a SIEM pull job can confirm the window it's operating under. Entries older than 30 days are purged opportunistically in small batches on each new write, so no scheduled job is required, but very low-traffic deployments may retain slightly-expired entries a little longer than 30 days until the next write occurs — the query itself always filters them out regardless.

**Never logged:** passwords, password hashes, session tokens, or full API keys. Only the acting user, action, timestamp, source IP, and non-secret details (e.g., link code/target URL) are recorded.

## Multiple profiles and domains

### Multiple profiles in one deployment

The current deployment supports multiple user profiles in one Function App:

1. Deploy the initial admin credentials as described in [docs/DEPLOY.md](docs/DEPLOY.md).
2. Open `/dashboard` and sign in as the admin.
3. Open the **Admin** tab and use **Add user** to create a username, display name, and password of at least 12 characters.
4. Give the new user the dashboard URL. They sign in with their own credentials and can change their password from the **Account** tab.

Usernames are **case-sensitive**: `Alice` and `alice` are different profiles.

Each link stores its profile owner in Azure Table Storage. Redirects remain public, but dashboard statistics are filtered to the signed-in profile. There is currently one admin role; users cannot create other users or view another profile's links.

### Multiple domains

Per-customer domains are **not supported in one deployment yet**. `PUBLIC_BASE_URL` and the generated short-link hostname are global settings, and the Bicep template provisions one configured domain plus its `www` hostname.

To host separate domains safely today, deploy this solution once per domain with a separate Function App, storage table/account, `baseUrl`, and `customDomain` value. This gives each domain an independent tenant boundary. Do not attach several customer domains to one app while expecting profile-specific URL generation; links and branding are not domain-scoped yet.

Native multi-domain support requires a future tenant/domain model, host-header routing, per-domain certificate provisioning, and domain-scoped link generation.

### Health

`GET /api/health` returns storage, queue, and configuration health. It returns HTTP `503` until required app settings and Azure Table Storage are ready.

## Deploy to Azure

Provision infrastructure and deploy with a single Bicep template + GitHub Actions pipeline.
See **[docs/DEPLOY.md](docs/DEPLOY.md)** for the full step-by-step guide.

Quick start:

```bash
az group create --name rg-azshortlink --location westeurope
az deployment group create \
  --resource-group rg-azshortlink \
  --template-file infra/main.bicep \
  --parameters infra/main.bicepparam \
  --parameters apiKey="$(openssl rand -hex 32)" \
               corsAllowedOrigins='["https://azhk.in"]' \
               localDevCorsAllowedOrigins='["http://localhost:3000","http://localhost:5173"]'
```

## Run tests

```bash
npm test
```
