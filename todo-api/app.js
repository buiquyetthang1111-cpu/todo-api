'use strict';

const express = require('express');
const { createTodoService } = require('./src/todoService');
const { ValidationError, NotFoundError } = require('./src/errors');
const { toCsv } = require('./src/csv');
const { mountDocs } = require('./src/docs');

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function sendError(res, status, message, details) {
  const titles = {
    400: 'Bad Request',
    404: 'Not Found',
    405: 'Method Not Allowed',
    406: 'Not Acceptable',
    413: 'Payload Too Large',
    415: 'Unsupported Media Type',
    500: 'Internal Server Error',
  };
  const body = { error: titles[status] || 'Error', message };
  if (details && details.length > 0) body.details = details;
  return res.status(status).json(body);
}

/** Rejects requests whose body is present but is not application/json. */
function requireJson(req, res, next) {
  // req.is() returns null when there is no body, false when the type differs.
  if (req.is('application/json') === false) {
    return sendError(res, 415, 'Content-Type must be application/json');
  }
  next();
}

// ---------------------------------------------------------------------------
// App factory. Routes are thin: they translate HTTP <-> service calls.
// Pass your own `service` to test the HTTP layer in isolation; otherwise a
// fresh service with an empty in-memory store is created.
// ---------------------------------------------------------------------------

function createApp({ seed = false, service = createTodoService(), docs = true } = {}) {
  const app = express();
  app.disable('x-powered-by');

  if (docs) mountDocs(app); // Swagger UI at /doc

  if (seed) {
    service.create({
      title: 'Study REST APIs',
      description: 'Read a dissertation by Roy Fielding',
    });
  }

  app.use(express.json());

  app.post('/todos', requireJson, (req, res) => {
    const todo = service.create(req.body);
    res.set('Location', `/todos/${todo.id}`);
    res.status(201).json(todo);
  });

  // Content negotiation: JSON by default, CSV when the client asks for it.
  // An Accept header that allows neither gets 406 Not Acceptable.
  app.get('/todos', (req, res) => {
    const format = req.accepts(['application/json', 'text/csv']);
    if (!format) {
      return sendError(res, 406, 'Supported representations: application/json, text/csv');
    }

    const todos = service.list(req.query.state); // may throw ValidationError -> 400
    res.set('Vary', 'Accept');
    if (format === 'text/csv') {
      res.set('Content-Type', 'text/csv; charset=utf-8');
      return res.status(200).send(toCsv(todos));
    }
    return res.status(200).json(todos);
  });

  app.get('/todos/:id', (req, res) => {
    res.status(200).json(service.get(req.params.id));
  });

  const updateTodo = (req, res) => {
    res.status(200).json(service.update(req.params.id, req.body));
  };
  app.put('/todos/:id', requireJson, updateTodo);
  app.patch('/todos/:id', requireJson, updateTodo);

  app.delete('/todos/:id', (req, res) => {
    service.remove(req.params.id);
    res.status(204).end();
  });

  // Known paths with an unsupported method -> 405 + Allow header
  const methodNotAllowed = (allowed) => (req, res) => {
    res.set('Allow', allowed);
    if (req.method === 'OPTIONS') return res.status(204).end();
    return sendError(res, 405, `Method ${req.method} not allowed. Allowed: ${allowed}`);
  };
  app.all('/todos', methodNotAllowed('GET, POST, OPTIONS'));
  app.all('/todos/:id', methodNotAllowed('GET, PUT, PATCH, DELETE, OPTIONS'));

  // Unknown route -> 404
  app.use((req, res) => {
    sendError(res, 404, `Route ${req.method} ${req.path} not found`);
  });

  // Central error handler: maps domain errors and body-parser errors to HTTP.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof ValidationError) {
      return sendError(res, 400, err.message, err.details);
    }
    if (err instanceof NotFoundError) {
      return sendError(res, 404, err.message);
    }
    if (err.type === 'entity.parse.failed') {
      return sendError(res, 400, 'Malformed JSON in request body');
    }
    if (err.type === 'entity.too.large') {
      return sendError(res, 413, 'Request body is too large');
    }
    if (err.status >= 400 && err.status < 500) {
      return sendError(res, err.status, err.message);
    }
    console.error(err);
    return sendError(res, 500, 'Unexpected server error');
  });

  return app;
}

module.exports = { createApp };
