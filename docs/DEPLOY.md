# Deploy AzShortLink to Azure

This guide walks you through deploying **AzShortLink** to Azure using the included Bicep infrastructure templates and an optional GitHub Actions CI/CD pipeline.

---

## Prerequisites

| Tool | Version | Install |
|---|---|---|
| [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) | ≥ 2.60 | `winget install Microsoft.AzureCLI` |
| [Bicep CLI](https://learn.microsoft.com/azure/azure-resource-manager/bicep/install) | ≥ 0.28 | bundled with Azure CLI (`az bicep install`) |
| [Azure Functions Core Tools](https://learn.microsoft.com/azure/azure-functions/functions-run-local) | v4 | `npm i -g azure-functions-core-tools@4` |
| Node.js | ≥ 20 | [nodejs.org](https://nodejs.org) |

---

## 1  Sign in to Azure

```bash
az login
az account set --subscription "<your-subscription-id>"
```

---

## 2  Create a Resource Group

```bash
RESOURCE_GROUP="rg-azshortlink"
LOCATION="westeurope"          # change to your preferred region

az group create --name "$RESOURCE_GROUP" --location "$LOCATION"
```

---

## 3  Provision Infrastructure

The Bicep template in `infra/main.bicep` creates:
- **Storage Account** — Table Storage backend + Azure WebJobs storage
- **Storage Tables** — three separate tables: `${tableName}` (links), `${usersTableName}` (user profiles/credentials/API keys), and `${auditTableName}` (audit trail). Splitting by data sensitivity limits the blast radius of a filter bug, an overly-broad SAS token, or a scoped RBAC role assignment.
- **App Service Plan** — Consumption (Y1, Linux) for pay-per-use pricing
- **Application Insights** — Telemetry and logging
- **Key Vault** — RBAC-enabled secret storage with soft delete and purge protection
- **Function App** — Node 22 with a system-assigned managed identity, Key Vault references, and configurable CORS

The template stores the storage connection string, API key, dashboard password hash/session secret, identity hash secret, and Azure Communication Services connection string in Key Vault. Function App settings contain versionless Key Vault references rather than secret values. Non-secret values such as table names, public URL, and sender address remain normal settings.

### Deploy the template

```bash
API_KEY="$(openssl rand -hex 32)"   # generate a strong random key
IDENTITY_HASH_SECRET="$(openssl rand -hex 32)"
DASHBOARD_SESSION_SECRET="$(openssl rand -hex 32)"

# Dashboard login credentials (required to access /dashboard)
DASHBOARD_USERNAME="admin"
DASHBOARD_PASSWORD_HASH="$(node scripts/generate-dashboard-hash.js '<choose-a-strong-password>')"

az deployment group create \
  --resource-group "$RESOURCE_GROUP" \
  --template-file infra/main.bicep \
  --parameters infra/main.bicepparam \
  --parameters apiKey="$API_KEY" \
               baseUrl="https://azhk.in" \
               corsAllowedOrigins='["https://azhk.in"]' \
               localDevCorsAllowedOrigins='["http://localhost:3000","http://localhost:5173"]' \
               dashboardUsername="$DASHBOARD_USERNAME" \
               dashboardPasswordHash="$DASHBOARD_PASSWORD_HASH" \
               dashboardSessionSecret="$DASHBOARD_SESSION_SECRET" \
               identityHashSecret="$IDENTITY_HASH_SECRET" \
               communicationServicesConnectionString="$COMMUNICATION_SERVICES_CONNECTION_STRING" \
               emailSenderAddress="$EMAIL_SENDER_ADDRESS"

# Save the API key — it is still supported for API automation and acts as the admin identity
echo "SHORTLINK_API_KEY=$API_KEY"
echo "DASHBOARD_USERNAME=$DASHBOARD_USERNAME"
```

Notes:
- The deploying identity must be allowed to create role assignments (`Owner`, `User Access Administrator`, or `Role Based Access Control Administrator`) because the template grants the Function identity **Key Vault Secrets User** on the vault. `Contributor` alone is insufficient for this deployment step.
- Secret parameters are marked `@secure()` and are written into Key Vault by the deployment. Keep the source values in a secure shell, CI secret store, or bootstrap process; never commit them to `main.bicepparam`.
- Key Vault references can briefly report unresolved immediately after first deployment while managed-identity RBAC propagates. App Service retries automatically; allow several minutes before treating this as a failure.
- `SHORTLINK_TABLE_NAME`, `SHORTLINK_USERS_TABLE_NAME` and `SHORTLINK_AUDIT_TABLE_NAME` are each created by the template as separate tables and also verified at runtime by the app. The users/audit table names default to `<SHORTLINK_TABLE_NAME>Users`/`<SHORTLINK_TABLE_NAME>Audit` if not overridden.
- The app does **not** use Azure Storage Queues today, so no queue resources are provisioned.
- CORS is configured from `corsAllowedOrigins` + `localDevCorsAllowedOrigins`, which are merged and exposed as an output.
- **Store `DASHBOARD_PASSWORD_HASH` as a secret** (e.g. GitHub Actions secrets, Key Vault) — never commit it. The password itself is never stored, only its bcrypt hash.
- **`dashboardSessionSecret` is optional.** If omitted, it's auto-derived server-side from `dashboardPasswordHash` + `apiKey`, so cookie-signing works out of the box with one less secret to manage. Pass `dashboardSessionSecret` explicitly (a random value from `openssl rand -hex 32`) only if you want to force-expire all dashboard sessions without also rotating the password.
- **Expect `503 Service Unavailable` right after this step.** `WEBSITE_RUN_FROM_PACKAGE=1` tells the Function App to run from a deployed zip package, which doesn't exist yet — this is normal until you complete [Section 4](#4-deploy-the-application-code) and isn't a deployment failure.

Capture the function app name from the outputs:

```bash
FUNCTION_APP=$(az deployment group show \
  --resource-group "$RESOURCE_GROUP" \
  --name main \
  --query properties.outputs.functionAppName.value \
  --output tsv)

echo "Function App: $FUNCTION_APP"
```

---

## 4  Deploy the Application Code

### Option A — Azure Functions Core Tools (recommended for first deploy)

```bash
npm ci
func azure functionapp publish "$FUNCTION_APP" --node
```

### Option B — GitHub Actions (recommended for ongoing deploys)

See [Section 5](#5-github-actions-cicd) below.

---

## 5  GitHub Actions CI/CD

The workflow in `.github/workflows/deploy.yml` runs tests and deploys automatically on every push to `main`.

### 5.1  Create an Azure service principal with OIDC (recommended)

```bash
SUBSCRIPTION_ID=$(az account show --query id --output tsv)

az ad app create --display-name "azshortlink-github"
APP_ID=$(az ad app list --display-name "azshortlink-github" --query "[0].appId" --output tsv)
az ad sp create --id "$APP_ID"
SP_ID=$(az ad sp show --id "$APP_ID" --query id --output tsv)

# Contributor deploys resources; RBAC Administrator allows the workflow to grant
# the Function identity access to Key Vault secrets.
az role assignment create \
  --assignee "$SP_ID" \
  --role Contributor \
  --scope "/subscriptions/$SUBSCRIPTION_ID/resourceGroups/$RESOURCE_GROUP"

az role assignment create \
  --assignee "$SP_ID" \
  --role "Role Based Access Control Administrator" \
  --scope "/subscriptions/$SUBSCRIPTION_ID/resourceGroups/$RESOURCE_GROUP"

# Add federated credential for GitHub Actions
az ad app federated-credential create \
  --id "$APP_ID" \
  --parameters '{
    "name": "github-main",
    "issuer": "https://token.actions.githubusercontent.com",
    "subject": "repo:<YOUR_GITHUB_ORG>/<YOUR_REPO>:ref:refs/heads/main",
    "audiences": ["api://AzureADTokenExchange"]
  }'
```

> **Case sensitivity:** `<YOUR_GITHUB_ORG>/<YOUR_REPO>` in `subject` must exactly match the
> casing of your GitHub org and repo names (e.g. `azurekid/AzShortLink`). Since August 2024,
> Entra ID rejects federated credential subjects that only match case-insensitively, causing
> `AADSTS7002138: No matching federated identity record found`. If you already created the
> credential with the wrong case, fix it in place:
> ```bash
> CRED_ID=$(az ad app federated-credential list --id "$APP_ID" \
>   --query "[?name=='github-main'].id" --output tsv)
>
> az ad app federated-credential update \
>   --id "$APP_ID" \
>   --federated-credential-id "$CRED_ID" \
>   --parameters '{
>     "name": "github-main",
>     "issuer": "https://token.actions.githubusercontent.com",
>     "subject": "repo:azurekid/AzShortLink:ref:refs/heads/main",
>     "audiences": ["api://AzureADTokenExchange"]
>   }'
> ```

### 5.2  Add GitHub repository secrets

Go to **Settings → Secrets and variables → Actions** in your repository and add:

| Secret name | Value |
|---|---|
| `AZURE_CLIENT_ID` | App (client) ID of the service principal |
| `AZURE_TENANT_ID` | Azure AD tenant ID |
| `AZURE_SUBSCRIPTION_ID` | Azure subscription ID |
| `AZURE_FUNCTIONAPP_NAME` | Function App name (output from step 3) |

### 5.3  Trigger a deployment

Push a commit to `main` or run the workflow manually from the **Actions** tab.

---

## 6  Verify the Deployment

```bash
HOSTNAME=$(az functionapp show \
  --resource-group "$RESOURCE_GROUP" \
  --name "$FUNCTION_APP" \
  --query defaultHostName --output tsv)

# Health check
curl -i "https://$HOSTNAME/api/health"

# Create a test short link
curl -X POST "https://$HOSTNAME/api/shorten" \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com", "uniqueValue": "test"}'

# Open the browser dashboard and sign in with DASHBOARD_USERNAME / your chosen password
echo "https://$HOSTNAME/dashboard"

# Follow the redirect
curl -L "https://$HOSTNAME/test"
```

---

## 7  Post-Deployment Notes

- **Custom domain** — add a custom domain in the Function App blade and update `PUBLIC_BASE_URL` in app settings.
- **Rotating the API key** — add a new Key Vault secret version. The Function setting remains unchanged because it uses a versionless reference:
  ```bash
  KEY_VAULT=$(az deployment group show --resource-group "$RESOURCE_GROUP" --name main \
    --query properties.outputs.keyVaultName.value --output tsv)
  az keyvault secret set --vault-name "$KEY_VAULT" --name shortlink-api-key --value "<new-key>"
  ```
- **Rotating the dashboard password** — write a new password-hash secret version. Rotate the session secret too when you need to invalidate all existing sessions:
  ```bash
  NEW_HASH=$(node scripts/generate-dashboard-hash.js '<new-password>')
  az keyvault secret set --vault-name "$KEY_VAULT" --name dashboard-password-hash --value "$NEW_HASH"
  az keyvault secret set --vault-name "$KEY_VAULT" --name dashboard-session-secret --value "$(openssl rand -hex 32)"
  ```
- App Service caches Key Vault references. A new version is picked up automatically, typically within 24 hours. To apply a rotation immediately, restart the Function App or refresh its Key Vault references through the App Service management API.
- **CORS updates** — rerun the Bicep deployment with updated `corsAllowedOrigins` / `localDevCorsAllowedOrigins` values whenever you add a new browser client origin.
- **Monitoring** — Application Insights is pre-configured. View logs and metrics in the Azure portal under the Application Insights resource.
- **Costs** — The Consumption plan charges only for actual invocations. For typical low-traffic URL shorteners, monthly costs are near zero within the free tier.

---

## 8  Multiple Profiles and Domains

### 8.1  Add profiles

Profiles are stored in the configured Azure Table Storage table. The first configured dashboard account is created as the admin profile when the Function App starts. After deployment:

1. Open `https://<your-domain>/dashboard` and sign in as the admin.
2. Open the **Admin** tab and use **Add user** to create a username, display name, and password of at least 12 characters.
3. Give the user the same dashboard URL. They can create links, view statistics, delete their own links, and change their password from the **Account** tab.

Usernames are case-sensitive, so `Alice` and `alice` are distinct profiles. Admins additionally see every profile, all links with their owners, and a service health panel.

Aliases are globally unique across profiles, while redirects remain public. The API key remains available for automation and maps to the admin profile; browser dashboard requests use the signed session cookie instead.

### 8.2  Hosting multiple domains today

The current application has one global `PUBLIC_BASE_URL`/`baseUrl`. It does not yet provide tenant-aware domain routing or per-profile branded domains.

For separate customer domains, use one deployment per domain:

```bash
# Example: deploy a second isolated service for customer.example
az deployment group create \
  --resource-group "$CUSTOMER_RESOURCE_GROUP" \
  --template-file infra/main.bicep \
  --parameters infra/main.bicepparam \
  --parameters prefix="cust1" \
               baseUrl="https://customer.example" \
               customDomain="customer.example" \
               apiKey="$CUSTOMER_API_KEY" \
               dashboardUsername="$CUSTOMER_ADMIN_USERNAME" \
               dashboardPasswordHash="$CUSTOMER_ADMIN_PASSWORD_HASH"
```

Use a separate resource group, storage account/table, Function App, API key, and dashboard admin credentials for each domain. Then repeat the DNS and certificate steps below for that deployment. This is the supported way to keep customer data and generated hostnames isolated until native multi-domain tenancy is implemented.

Attaching multiple domains to one Function App is not enough: generated URLs still use one global base URL, and the current data model does not associate a domain with a profile.

## 9  Custom Domain: azhk.in (Porkbun)

The Bicep template automatically binds `azhk.in` and `www.azhk.in` to the Function App and provisions free App Service Managed Certificates for HTTPS.  
**DNS records at Porkbun must be created first, before deploying (or re-deploying) the template.**

### 9.1  Retrieve the domain verification ID

```bash
az functionapp show \
  --resource-group "$RESOURCE_GROUP" \
  --name "$FUNCTION_APP" \
  --query customDomainVerificationId \
  --output tsv
```

This prints a long hex string — call it `<VERIFICATION_ID>` below.

### 9.2  Add DNS records at Porkbun

Log in to [porkbun.com](https://porkbun.com) → **Domain Management** → `azhk.in` → **DNS**.

| Type | Host | Value / Answer | TTL |
|------|------|----------------|-----|
| `ALIAS` (ANAME) | _(leave blank / `@`)_ | `<functionAppName>.azurewebsites.net` | 600 |
| `CNAME` | `www` | `<functionAppName>.azurewebsites.net` | 600 |
| `TXT` | `asuid` | `<VERIFICATION_ID>` | 600 |
| `TXT` | `asuid.www` | `<VERIFICATION_ID>` | 600 |

> **Note:** Porkbun supports `ALIAS` (also called ANAME) records for apex/root domains (`@`).  
> Standard `CNAME` records cannot be used on the apex domain — use `ALIAS` instead.

Substitute the actual function app hostname (output from step 3):

```bash
FUNCTION_APP_HOSTNAME=$(az deployment group show \
  --resource-group "$RESOURCE_GROUP" \
  --name main \
  --query properties.outputs.functionAppHostname.value \
  --output tsv)

echo "ALIAS target: $FUNCTION_APP_HOSTNAME"
```

### 9.3  Deploy (or redeploy) the Bicep template

Once DNS is propagated (usually a few minutes), run:

```bash
az deployment group create \
  --resource-group "$RESOURCE_GROUP" \
  --template-file infra/main.bicep \
  --parameters infra/main.bicepparam \
  --parameters apiKey="$API_KEY"
```

The template will:
1. Bind `azhk.in` and `www.azhk.in` as custom hostnames on the Function App.
2. Issue free App Service Managed Certificates for both hostnames.
3. Re-bind both hostnames with SNI SSL enabled.

### 9.4  Verify

```bash
curl -I https://azhk.in/api/health
curl -I https://www.azhk.in/api/health
```

Both should return `HTTP/2 200` (or `503` if storage is not yet ready).

### 9.5  Skip custom domain

To deploy without binding a custom domain (e.g., to a staging slot), pass:

```bash
--parameters customDomain=''
```
