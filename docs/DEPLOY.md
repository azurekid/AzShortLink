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
- **App Service Plan** — Consumption (Y1, Linux) for pay-per-use pricing
- **Application Insights** — Telemetry and logging
- **Function App** — Node 20, all app settings pre-configured

### Deploy the template

```bash
API_KEY="$(openssl rand -hex 32)"   # generate a strong random key

az deployment group create \
  --resource-group "$RESOURCE_GROUP" \
  --template-file infra/main.bicep \
  --parameters infra/main.bicepparam \
  --parameters apiKey="$API_KEY" baseUrl="https://azhk.in"

# Save the API key — you will need it to call the API
echo "SHORTLINK_API_KEY=$API_KEY"
```

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

# Grant Contributor access on the resource group
az role assignment create \
  --assignee "$SP_ID" \
  --role Contributor \
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
curl "https://$HOSTNAME/api/health"

# Create a test short link
curl -X POST "https://$HOSTNAME/api/shorten" \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com", "uniqueValue": "test"}'

# Follow the redirect
curl -L "https://$HOSTNAME/test"
```

---

## 7  Post-Deployment Notes

- **Custom domain** — add a custom domain in the Function App blade and update `PUBLIC_BASE_URL` in app settings.
- **Rotating the API key** — update the `SHORTLINK_API_KEY` app setting in the Azure portal or via:
  ```bash
  az functionapp config appsettings set \
    --resource-group "$RESOURCE_GROUP" \
    --name "$FUNCTION_APP" \
    --settings SHORTLINK_API_KEY="<new-key>"
  ```
- **Monitoring** — Application Insights is pre-configured. View logs and metrics in the Azure portal under the Application Insights resource.
- **Costs** — The Consumption plan charges only for actual invocations. For typical low-traffic URL shorteners, monthly costs are near zero within the free tier.
