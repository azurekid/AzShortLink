# AzShortLink

A low-cost Azure Functions URL shortener for `azhk.in` with authenticated link creation, redirects, redirect statistics, a browser dashboard, and deploy-ready Azure infrastructure.

## Features

- `POST /api/shorten` (authenticated) to create short URLs
- Random or custom alias support (`uniqueValue`, `alias`, or `code` in payload)
- `GET /{code}` redirect to original URL
- Azure Table Storage backend with explicit table provisioning in Bicep
- `GET /api/stats/{code?}` (authenticated) for stats JSON
- `GET /dashboard` terminal-themed UI for creating and inspecting short links
- `GET /api/health` for table/queue/config diagnostics
- Configurable Azure Function App CORS origins for deployed and local browser clients

## Configuration

Set these app settings in Azure Function App:

- `SHORTLINK_API_KEY` (required, used via `x-api-key` header or Authorization token header)
- `PUBLIC_BASE_URL` (default: `https://azhk.in`)
- `AZURE_STORAGE_CONNECTION_STRING` (or `AzureWebJobsStorage`)
- `SHORTLINK_TABLE_NAME` (default: `AzShortLinks`)

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
- `GET /dashboard` returns an HTML dashboard where you paste the API key and create new short links from the browser

`/api/stats` requires API key authentication. The `/dashboard` page itself is anonymous so it can collect the API key client-side and call the authenticated APIs.

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
