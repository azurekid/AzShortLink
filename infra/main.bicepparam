using './main.bicep'

// ── Required ──────────────────────────────────────────────────────────────────
// Set apiKey to a strong secret before deploying.
// You can also pass it at deploy time:
//   az deployment group create ... --parameters apiKey='<secret>'
param apiKey = readEnvironmentVariable('SHORTLINK_API_KEY', '')

// ── Optional overrides ────────────────────────────────────────────────────────
param prefix = 'azsl'
// param location    = 'westeurope'
param baseUrl     = 'https://azhk.in'
param customDomain = 'azhk.in'
// param tableName   = 'AzShortLinks'
// param usersTableName = 'AzShortLinksUsers'
// param auditTableName = 'AzShortLinksAudit'
// param corsAllowedOrigins = [
//   'https://azhk.in'
// ]
// param localDevCorsAllowedOrigins = [
//   'http://localhost:3000'
//   'http://localhost:5173'
// ]

// ── App Service Plan SKU (Consumption/Y1 does NOT support custom-domain SSL) ──
param appServicePlanSkuName = 'B1'
param appServicePlanSkuTier = 'Basic'

// ── Certificate source ────────────────────────────────────────────────────────
// true  = free App Service Managed Certificate (default, no PFX needed)
// false = upload your own certificate below (convert your .pem files to a
//         base64 PFX first, see docs/DEPLOY.md):
//   openssl pkcs12 -export -out cert.pfx -inkey privkey.pem -in cert.pem -certfile chain.pem -passout pass:<password>
//   base64 -w0 cert.pfx > cert.pfx.b64
param useManagedCertificate = false
param customCertificatePfxBase64 = readEnvironmentVariable('SHORTLINK_CERT_PFX_BASE64', '')
param customCertificatePassword = readEnvironmentVariable('SHORTLINK_CERT_PFX_PASSWORD', '')

// ── Dashboard login ────────────────────────────────────────────────────────────
// Generate the hash with: node scripts/generate-dashboard-hash.js '<password>'
// Generate the session secret with: openssl rand -hex 32
param dashboardUsername = readEnvironmentVariable('DASHBOARD_USERNAME', '')
param dashboardPasswordHash = readEnvironmentVariable('DASHBOARD_PASSWORD_HASH', '')
param dashboardSessionSecret = readEnvironmentVariable('DASHBOARD_SESSION_SECRET', '')
