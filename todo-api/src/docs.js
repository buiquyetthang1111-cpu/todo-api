'use strict';

const swaggerUi = require('swagger-ui-express');
const spec = require('../openapi.json');

/**
 * Mounts the interactive API documentation:
 *   /doc               Swagger UI (supports "Try it out")
 *   /doc/openapi.json  the raw OpenAPI document
 */
function mountDocs(app) {
  app.get('/doc/openapi.json', (req, res) => {
    res.status(200).json(spec);
  });
  app.use('/doc', swaggerUi.serve, swaggerUi.setup(spec, { customSiteTitle: 'Todo API docs' }));
}

module.exports = { mountDocs, spec };
