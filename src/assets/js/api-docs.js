'use strict';

window.ui = SwaggerUIBundle({
  url: '/openapi.json',
  dom_id: '#swagger-ui',
  deepLinking: true,
  persistAuthorization: true,
  presets: [SwaggerUIBundle.presets.apis],
  layout: 'BaseLayout'
});