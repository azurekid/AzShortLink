using './main.bicep'

// ── Required ──────────────────────────────────────────────────────────────────
// Set apiKey to a strong secret before deploying.
// You can also pass it at deploy time:
//   az deployment group create ... --parameters apiKey='<secret>'
param apiKey = readEnvironmentVariable('SHORTLINK_API_KEY', '')

// ── Optional overrides ────────────────────────────────────────────────────────
param prefix = 'azsl'
// param location    = 'westeurope'
// param baseUrl     = 'https://azhk.in'
// param tableName   = 'AzShortLinks'
