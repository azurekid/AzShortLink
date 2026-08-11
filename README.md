# AzShortLink

A low-cost Azure Functions URL shortener for `azhk.in` with authenticated link creation, redirects, redirect statistics, and a lightweight dashboard.

## Features

- `POST /api/shorten` (authenticated) to create short URLs
- Random or custom alias support (`uniqueValue`, `alias`, or `code` in payload)
- `GET /{code}` redirect to original URL
- Azure Table Storage backend (with in-memory fallback for local/dev)
- `GET /api/stats/{code?}` (authenticated) for stats JSON
- `GET /dashboard` (authenticated) lightweight dashboard
- `GET /api/health` for health status

## Configuration

Set these app settings in Azure Function App:

- `SHORTLINK_API_KEY` (required, used via `x-api-key` header or Authorization token header)
- `PUBLIC_BASE_URL` (default: `https://azhk.in`)
- `AZURE_STORAGE_CONNECTION_STRING` (or `AzureWebJobsStorage`)
- `SHORTLINK_TABLE_NAME` (default: `AzShortLinks`)

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
- `GET /dashboard` returns an HTML dashboard

Both require API key authentication.

### Health

`GET /api/health` returns storage and service health.

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
  --parameters apiKey="$(openssl rand -hex 32)"
```

## Run tests

```bash
npm test
```
