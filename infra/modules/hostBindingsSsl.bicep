param functionAppName string
param customDomain string
param apexThumbprint string
// param wwwThumbprint string

resource apexHostBindingSsl 'Microsoft.Web/sites/hostNameBindings@2023-01-01' = {
  name: '${functionAppName}/${customDomain}'
  properties: {
    hostNameType: 'Verified'
    sslState: 'SniEnabled'
    thumbprint: apexThumbprint
    customHostNameDnsRecordType: 'CName'  // Consumption (Y1) plan doesn't support A-record custom domains
  }
}

// resource wwwHostBindingSsl 'Microsoft.Web/sites/hostNameBindings@2023-01-01' = {
//   name: '${functionAppName}/www.${customDomain}'
//   dependsOn: [
//     apexHostBindingSsl
//   ]
//   properties: {
//     hostNameType: 'Verified'
//     sslState: 'SniEnabled'
//     thumbprint: wwwThumbprint
//     customHostNameDnsRecordType: 'CName'
//   }
// }
