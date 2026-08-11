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

@description('Apex custom domain to bind to the Function App (e.g. azhk.in). Leave empty to skip custom-domain provisioning.')
param customDomain string = 'azhk.in'

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

// ── Custom Domain & Managed Certificate ──────────────────────────────────────
// Pre-requisites (must be done before deploying this template):
//   1. Add an ALIAS (ANAME) record at porkbun.com:
//        Host: @  →  Value: ${functionAppName}.azurewebsites.net
//   2. Add a CNAME record:
//        Host: www  →  Value: ${functionAppName}.azurewebsites.net
//   3. Add a TXT record for domain verification:
//        Host: asuid  →  Value: <customDomainVerificationId>
//        Host: asuid.www  →  Value: <customDomainVerificationId>
//      Retrieve the id with:
//        az functionapp show --resource-group <rg> --name <functionAppName> \
//          --query customDomainVerificationId --output tsv

// SNI hostname binding for the apex domain (azhk.in)
resource apexHostBinding 'Microsoft.Web/sites/hostNameBindings@2023-01-01' = if (!empty(customDomain)) {
  name: customDomain
  parent: functionApp
  properties: {
    hostNameType: 'Verified'
    sslState: 'Disabled'  // certificate resource below enables SSL after cert provisioning
    customHostNameDnsRecordType: 'A'
  }
}

// SNI hostname binding for www subdomain (www.azhk.in)
resource wwwHostBinding 'Microsoft.Web/sites/hostNameBindings@2023-01-01' = if (!empty(customDomain)) {
  name: 'www.${customDomain}'
  parent: functionApp
  dependsOn: [
    apexHostBinding
  ]
  properties: {
    hostNameType: 'Verified'
    sslState: 'Disabled'
    customHostNameDnsRecordType: 'CName'
  }
}

// App Service Managed Certificate for the apex domain
resource apexCert 'Microsoft.Web/certificates@2023-01-01' = if (!empty(customDomain)) {
  name: '${prefix}-cert-apex-${take(suffix, 8)}'
  location: location
  dependsOn: [
    apexHostBinding
  ]
  properties: {
    serverFarmId: appServicePlan.id
    canonicalName: customDomain
  }
}

// App Service Managed Certificate for the www subdomain
resource wwwCert 'Microsoft.Web/certificates@2023-01-01' = if (!empty(customDomain)) {
  name: '${prefix}-cert-www-${take(suffix, 8)}'
  location: location
  dependsOn: [
    wwwHostBinding
  ]
  properties: {
    serverFarmId: appServicePlan.id
    canonicalName: 'www.${customDomain}'
  }
}

// Re-bind hostnames with SNI SSL after certificate provisioning.
module hostBindingsSsl './modules/hostBindingsSsl.bicep' = if (!empty(customDomain)) {
  name: '${prefix}-hostbindings-ssl-${take(suffix, 8)}'
  params: {
    functionAppName: functionApp.name
    customDomain: customDomain
    apexThumbprint: apexCert!.properties.thumbprint
    wwwThumbprint: wwwCert!.properties.thumbprint
  }
}

// ── Outputs ───────────────────────────────────────────────────────────────────
output functionAppName string = functionApp.name
output functionAppHostname string = functionApp.properties.defaultHostName
output customDomainVerificationId string = functionApp.properties.customDomainVerificationId
output storageAccountName string = storageAccount.name
output shortLinkTableName string = tableName
output dashboardUrl string = 'https://${functionApp.properties.defaultHostName}/dashboard'
output healthUrl string = 'https://${functionApp.properties.defaultHostName}/api/health'
output allowedCorsOrigins array = effectiveCorsOrigins
