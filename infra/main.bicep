@description('Base name used for all resources (2-10 lowercase alphanumeric chars).')
@minLength(2)
@maxLength(10)
param prefix string = 'azsl'

@description('Azure region for all resources.')
param location string = resourceGroup().location

@description('API key for the shortlink service (required, keep secret).')
@secure()
param apiKey string

@description('Public base URL for short links (e.g. https://azhk.in).')
param baseUrl string = 'https://azhk.in'

@description('Table Storage table name.')
param tableName string = 'AzShortLinks'

@description('Allowed production/browser origins for CORS (include the deployed UI origin).')
param corsAllowedOrigins array = [
  baseUrl
]

@description('Allowed local development origins for CORS.')
param localDevCorsAllowedOrigins array = [
  'http://localhost:3000'
  'http://127.0.0.1:3000'
  'http://localhost:5173'
  'http://127.0.0.1:5173'
  'http://localhost:7071'
]

// ── Unique suffix so resource names don't collide across deployments ──────────
var suffix = uniqueString(resourceGroup().id, prefix)
var storageAccountName = toLower('${prefix}st${take(suffix, 8)}')
var appServicePlanName = '${prefix}-plan-${take(suffix, 8)}'
var functionAppName = '${prefix}-func-${take(suffix, 8)}'
var appInsightsName = '${prefix}-ai-${take(suffix, 8)}'

// ── Storage Account ───────────────────────────────────────────────────────────
resource storageAccount 'Microsoft.Storage/storageAccounts@2023-01-01' = {
  name: storageAccountName
  location: location
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    supportsHttpsTrafficOnly: true
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
  }
}

resource shortLinkTable 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-01-01' = {
  name: '${storageAccount.name}/default/${tableName}'
}

var storageConnectionString = 'DefaultEndpointsProtocol=https;AccountName=${storageAccount.name};AccountKey=${storageAccount.listKeys().keys[0].value};EndpointSuffix=${environment().suffixes.storage}'
var effectiveCorsOrigins = union(corsAllowedOrigins, localDevCorsAllowedOrigins)

// ── Application Insights ──────────────────────────────────────────────────────
resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: appInsightsName
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    RetentionInDays: 30
  }
}

// ── App Service Plan (Consumption) ────────────────────────────────────────────
resource appServicePlan 'Microsoft.Web/serverfarms@2023-01-01' = {
  name: appServicePlanName
  location: location
  sku: {
    name: 'Y1'
    tier: 'Dynamic'
  }
  kind: 'linux'
  properties: {
    reserved: true
  }
}

// ── Function App ──────────────────────────────────────────────────────────────
resource functionApp 'Microsoft.Web/sites@2023-01-01' = {
  name: functionAppName
  location: location
  kind: 'functionapp,linux'
  properties: {
    serverFarmId: appServicePlan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'NODE|20'
      functionAppScaleLimit: 200
      cors: {
        allowedOrigins: effectiveCorsOrigins
        supportCredentials: false
      }
      appSettings: [
        {
          name: 'AzureWebJobsStorage'
          value: storageConnectionString
        }
        {
          name: 'AZURE_STORAGE_CONNECTION_STRING'
          value: storageConnectionString
        }
        {
          name: 'FUNCTIONS_WORKER_RUNTIME'
          value: 'node'
        }
        {
          name: 'FUNCTIONS_EXTENSION_VERSION'
          value: '~4'
        }
        {
          name: 'WEBSITE_RUN_FROM_PACKAGE'
          value: '1'
        }
        {
          name: 'APPINSIGHTS_INSTRUMENTATIONKEY'
          value: appInsights.properties.InstrumentationKey
        }
        {
          name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
          value: appInsights.properties.ConnectionString
        }
        {
          name: 'SHORTLINK_API_KEY'
          value: apiKey
        }
        {
          name: 'PUBLIC_BASE_URL'
          value: baseUrl
        }
        {
          name: 'SHORTLINK_TABLE_NAME'
          value: tableName
        }
      ]
    }
  }
}

// ── Outputs ───────────────────────────────────────────────────────────────────
output functionAppName string = functionApp.name
output functionAppHostname string = functionApp.properties.defaultHostName
output storageAccountName string = storageAccount.name
output shortLinkTableName string = tableName
output dashboardUrl string = 'https://${functionApp.properties.defaultHostName}/dashboard'
output healthUrl string = 'https://${functionApp.properties.defaultHostName}/api/health'
output allowedCorsOrigins array = effectiveCorsOrigins
