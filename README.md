# AzShortLink

A low-cost Azure Functions URL shortener with authenticated link creation, redirects, redirect statistics, a multi-profile browser dashboard, and deploy-ready Azure infrastructure.

## Features

- `POST /api/shorten` (authenticated) to create short URLs
- Random or custom alias support (`uniqueValue`, `alias`, or `code` in payload)
- `GET /{code}` redirect to original URL
- Azure Table Storage backend with explicit table provisioning in Bicep
- `GET /api/stats/{code?}` (authenticated) for stats JSON
- `GET /dashboard` authenticated UI for creating and inspecting profile-owned short links
- Tabbed dashboard: Links, Statistics, Account, and an admin-only Admin tab
- `DELETE /api/links/{code}` to remove links you own (admins may remove any link)
- `GET /api/analytics` for aggregated redirect statistics
- `POST /api/profile/password` so users can rotate their own password
- `GET /api/users` (admin) lists every profile with its link count
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
- `SHORTLINK_TABLE_NAME` (default: `AzShortLinks`)
- `DASHBOARD_USERNAME` (required for the initial admin profile)
- `DASHBOARD_PASSWORD_HASH` (required; generate with `node scripts/generate-dashboard-hash.js '<password>'`)
- `DASHBOARD_SESSION_SECRET` (optional; derived from the API key and password hash when omitted)

The app does not use Azure Storage Queues today, so only the table resource is provisioned. `/api/health` reports queue status as `not-required`.

You can use `local.settings.sample.json` as a template for local settings.

## API

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
| Statistics | everyone | Totals, averages, top links, recent redirect activity |
| Account | everyone | Current profile and self-service password change |
| Admin | admins | All profiles with link counts, add user, service health |

Admins see every profile's links (with an owner column) and can delete any link. Regular users only ever see and delete their own links. Changing a password signs the user out so they re-authenticate.

### Custom styling

Edit `src/custom.css` and redeploy. It is served at `/custom.css` and loaded after the built-in theme on both the login and dashboard pages, so any CSS variable or selector can be overridden. For example:

```css
:root { --accent: #ff7a18; }
```

API clients may still authenticate with `SHORTLINK_API_KEY`; that key acts as the admin identity. Dashboard users authenticate with their profile credentials.

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
