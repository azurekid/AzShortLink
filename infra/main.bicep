@description('Base name used for all resources (2-10 lowercase alphanumeric chars).')
@minLength(2)
@maxLength(10)
param prefix string = 'azsl'

@description('Azure region for all resources.')
param location string = resourceGroup().location

@description('Enable Key Vault purge protection. Keep enabled for production; disabling only affects newly created vaults.')
param keyVaultPurgeProtectionEnabled bool = true

@description('API key for the shortlink service (required, keep secret).')
@secure()
param apiKey string

@description('Public base URL for short links (e.g. https://azhk.in).')
param baseUrl string = 'https://azhk.in'

@description('Apex custom domain to bind to the Function App (e.g. azhk.in). Leave empty to skip custom-domain provisioning.')
param customDomain string = 'azhk.in'

@description('App Service Plan SKU name. The Consumption plan (Y1) does NOT support TLS/SSL bindings for custom domains (managed or uploaded certificates) - use B1 or higher if customDomain is set.')
param appServicePlanSkuName string = 'B1'

@description('App Service Plan SKU tier. Must be Basic, Standard, Premium or PremiumV3 (not Dynamic) to enable custom-domain SSL bindings.')
param appServicePlanSkuTier string = 'Basic'

@description('When true (default), issue free App Service Managed Certificates. When false, upload your own certificate via customCertificatePfxBase64/customCertificatePassword (requires appServicePlanSkuTier other than Dynamic).')
param useManagedCertificate bool = true

@description('Base64-encoded PFX certificate bundle (convert your PEM cert+key+chain with openssl) used when useManagedCertificate is false. The certificate must cover both the apex and www hostnames (SAN or wildcard).')
@secure()
param customCertificatePfxBase64 string = ''

@description('Password protecting the PFX bundle above. Leave empty if the PFX has no password.')
@secure()
param customCertificatePassword string = ''

@description('Username required to sign in to the /dashboard console.')
param dashboardUsername string = ''

@description('Bcrypt hash of the dashboard password (generate with scripts/generate-dashboard-hash.js). Never pass a plaintext password here.')
@secure()
param dashboardPasswordHash string = ''

@description('Optional: random secret used to sign dashboard session cookies (generate with openssl rand -hex 32). If left empty, it is auto-derived from dashboardPasswordHash and apiKey - set explicitly if you want to invalidate all sessions independently of rotating the password.')
@secure()
param dashboardSessionSecret string = ''

@description('Secret HMAC key used to hash verified identities and risk signals. Generate with openssl rand -hex 32.')
@secure()
param identityHashSecret string = ''

@description('Azure Communication Services connection string used for verification email delivery.')
@secure()
param communicationServicesConnectionString string = ''

@description('Verified sender address configured in Azure Communication Services Email.')
param emailSenderAddress string = ''

@description('Table Storage table name for short-link data.')
param tableName string = 'AzShortLinks'

@description('Table Storage table name for user profiles, credentials and API keys. Kept separate from link data so a filter bug or scoped credential cannot cross-leak between them.')
param usersTableName string = '${tableName}Users'

@description('Table Storage table name for the security audit trail. Kept separate from link and user data to limit the blast radius of a misconfiguration.')
param auditTableName string = '${tableName}Audit'

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
var storageAccountName = toLower('st${prefix}${take(suffix, 8)}')
var appServicePlanName = 'asp-${prefix}-${take(suffix, 8)}'
var functionAppName = 'func-${prefix}-${take(suffix, 8)}'
var appInsightsName = 'appi-${prefix}-${take(suffix, 8)}'
var keyVaultName = 'kv-${prefix}-${take(suffix, 8)}'
var keyVaultSecretsUserRoleDefinitionId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')

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

resource shortLinkTableService 'Microsoft.Storage/storageAccounts/tableServices@2023-01-01' = {
  parent: storageAccount
  name: 'default'
}

// Links, users/credentials and the audit trail are stored in separate tables (not just
// separate partitions in one table) so a filter bug, overly-broad SAS, or a scoped RBAC
// role assignment can't cross-leak between data classes of differing sensitivity.
resource shortLinkTable 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-01-01' = {
  parent: shortLinkTableService
  name: tableName
}

resource usersTable 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-01-01' = {
  parent: shortLinkTableService
  name: usersTableName
}

resource auditTable 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-01-01' = {
  parent: shortLinkTableService
  name: auditTableName
}

var storageConnectionString = 'DefaultEndpointsProtocol=https;AccountName=${storageAccount.name};AccountKey=${storageAccount.listKeys().keys[0].value};EndpointSuffix=${environment().suffixes.storage}'
var effectiveCorsOrigins = union(corsAllowedOrigins, localDevCorsAllowedOrigins)

// Versionless references automatically pick up the newest secret version after App Service's
// Key Vault reference cache refreshes, without changing Function App configuration.
var keyVaultSecretBaseUri = 'https://${keyVaultName}${environment().suffixes.keyvaultDns}/secrets'
var storageConnectionStringReference = '@Microsoft.KeyVault(SecretUri=${keyVaultSecretBaseUri}/azure-webjobs-storage/)'
var apiKeyReference = '@Microsoft.KeyVault(SecretUri=${keyVaultSecretBaseUri}/shortlink-api-key/)'
var dashboardPasswordHashReference = '@Microsoft.KeyVault(SecretUri=${keyVaultSecretBaseUri}/dashboard-password-hash/)'
var dashboardSessionSecretReference = '@Microsoft.KeyVault(SecretUri=${keyVaultSecretBaseUri}/dashboard-session-secret/)'
var identityHashSecretReference = '@Microsoft.KeyVault(SecretUri=${keyVaultSecretBaseUri}/identity-hash-secret/)'
var communicationServicesConnectionStringReference = '@Microsoft.KeyVault(SecretUri=${keyVaultSecretBaseUri}/communication-services-connection-string/)'

// ── Key Vault ────────────────────────────────────────────────────────────────
resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: keyVaultName
  location: location
  properties: {
    tenantId: tenant().tenantId
    enableRbacAuthorization: true
    enablePurgeProtection: keyVaultPurgeProtectionEnabled
    enableSoftDelete: true
    softDeleteRetentionInDays: 90
    publicNetworkAccess: 'Enabled'
    sku: {
      family: 'A'
      name: 'standard'
    }
  }
}

resource storageConnectionStringSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'azure-webjobs-storage'
  properties: {
    value: storageConnectionString
  }
}

resource apiKeySecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'shortlink-api-key'
  properties: {
    value: apiKey
  }
}

resource dashboardPasswordHashSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (!empty(dashboardPasswordHash)) {
  parent: keyVault
  name: 'dashboard-password-hash'
  properties: {
    value: dashboardPasswordHash
  }
}

resource dashboardSessionSecretResource 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (!empty(dashboardSessionSecret)) {
  parent: keyVault
  name: 'dashboard-session-secret'
  properties: {
    value: dashboardSessionSecret
  }
}

resource identityHashSecretResource 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (!empty(identityHashSecret)) {
  parent: keyVault
  name: 'identity-hash-secret'
  properties: {
    value: identityHashSecret
  }
}

resource communicationServicesConnectionStringSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (!empty(communicationServicesConnectionString)) {
  parent: keyVault
  name: 'communication-services-connection-string'
  properties: {
    value: communicationServicesConnectionString
  }
}

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

// ── App Service Plan ──────────────────────────────────────────────────────────
// Defaults to Consumption (Y1/Dynamic). Switch to Basic (B1) or higher to enable
// custom-domain TLS/SSL bindings - Consumption doesn't support them.
resource appServicePlan 'Microsoft.Web/serverfarms@2023-01-01' = {
  name: appServicePlanName
  location: location
  sku: {
    name: appServicePlanSkuName
    tier: appServicePlanSkuTier
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
  dependsOn: [
    storageConnectionStringSecret
    apiKeySecret
    dashboardPasswordHashSecret
    dashboardSessionSecretResource
    identityHashSecretResource
    communicationServicesConnectionStringSecret
  ]
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: appServicePlan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'NODE|22'
      functionAppScaleLimit: 200
      cors: {
        allowedOrigins: effectiveCorsOrigins
        supportCredentials: false
      }
      appSettings: [
        {
          name: 'AzureWebJobsStorage'
          value: storageConnectionStringReference
        }
        {
          name: 'AZURE_STORAGE_CONNECTION_STRING'
          value: storageConnectionStringReference
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
          // Without this, Azure serves its built-in "Functions app is up and running" splash
          // page for GET / on custom domains, hiding our own root route handler.
          name: 'AzureWebJobsDisableHomepage'
          value: 'true'
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
          value: apiKeyReference
        }
        {
          name: 'PUBLIC_BASE_URL'
          value: baseUrl
        }
        {
          name: 'SHORTLINK_TABLE_NAME'
          value: tableName
        }
        {
          name: 'SHORTLINK_USERS_TABLE_NAME'
          value: usersTableName
        }
        {
          name: 'SHORTLINK_AUDIT_TABLE_NAME'
          value: auditTableName
        }
        {
          name: 'DASHBOARD_USERNAME'
          value: dashboardUsername
        }
        {
          name: 'DASHBOARD_PASSWORD_HASH'
          value: empty(dashboardPasswordHash) ? '' : dashboardPasswordHashReference
        }
        {
          name: 'DASHBOARD_SESSION_SECRET'
          value: empty(dashboardSessionSecret) ? '' : dashboardSessionSecretReference
        }
        {
          name: 'IDENTITY_HASH_SECRET'
          value: empty(identityHashSecret) ? '' : identityHashSecretReference
        }
        {
          name: 'COMMUNICATION_SERVICES_CONNECTION_STRING'
          value: empty(communicationServicesConnectionString) ? '' : communicationServicesConnectionStringReference
        }
        {
          name: 'EMAIL_SENDER_ADDRESS'
          value: emailSenderAddress
        }
      ]
    }
  }
}

resource functionKeyVaultSecretsUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, functionApp.id, keyVaultSecretsUserRoleDefinitionId)
  scope: keyVault
  properties: {
    principalId: functionApp.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: keyVaultSecretsUserRoleDefinitionId
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
    customHostNameDnsRecordType: 'CName'  // Consumption (Y1) plan doesn't support A-record custom domains
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

// App Service Managed Certificate for the apex domain (free, auto-renewed)
resource apexCert 'Microsoft.Web/certificates@2023-01-01' = if (!empty(customDomain) && useManagedCertificate) {
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

// App Service Managed Certificate for the www subdomain (free, auto-renewed)
resource wwwCert 'Microsoft.Web/certificates@2023-01-01' = if (!empty(customDomain) && useManagedCertificate) {
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

// Uploaded custom certificate (converted from PEM files), covering both apex and www hostnames.
resource customCert 'Microsoft.Web/certificates@2023-01-01' = if (!empty(customDomain) && !useManagedCertificate) {
  name: '${prefix}-cert-custom-${take(suffix, 8)}'
  location: location
  dependsOn: [
    apexHostBinding
    wwwHostBinding
  ]
  properties: {
    serverFarmId: appServicePlan.id
    pfxBlob: customCertificatePfxBase64
    password: customCertificatePassword
  }
}

// Re-bind hostnames with SNI SSL after the managed certificates are issued.
module hostBindingsSslManaged './modules/hostBindingsSsl.bicep' = if (!empty(customDomain) && useManagedCertificate) {
  name: '${prefix}-hostbindings-ssl-managed-${take(suffix, 8)}'
  params: {
    functionAppName: functionApp.name
    customDomain: customDomain
    apexThumbprint: apexCert!.properties.thumbprint
    wwwThumbprint: wwwCert!.properties.thumbprint
  }
}

// Re-bind hostnames with SNI SSL using the uploaded custom certificate.
module hostBindingsSslCustom './modules/hostBindingsSsl.bicep' = if (!empty(customDomain) && !useManagedCertificate) {
  name: '${prefix}-hostbindings-ssl-custom-${take(suffix, 8)}'
  params: {
    functionAppName: functionApp.name
    customDomain: customDomain
    apexThumbprint: customCert!.properties.thumbprint
    wwwThumbprint: customCert!.properties.thumbprint
  }
}

// ── Outputs ───────────────────────────────────────────────────────────────────
output functionAppName string = functionApp.name
output functionAppHostname string = functionApp.properties.defaultHostName
output customDomainVerificationId string = functionApp.properties.customDomainVerificationId
output storageAccountName string = storageAccount.name
output keyVaultName string = keyVault.name
output shortLinkTableName string = tableName
output usersTableName string = usersTableName
output auditTableName string = auditTableName
output dashboardUrl string = 'https://${functionApp.properties.defaultHostName}/dashboard'
output healthUrl string = 'https://${functionApp.properties.defaultHostName}/api/health'
output allowedCorsOrigins array = effectiveCorsOrigins
