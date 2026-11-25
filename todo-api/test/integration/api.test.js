'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../../app');

let server;
let baseUrl;

beforeEach(async () => {
  // A fresh app (and therefore an empty in-memory "database") for every test.
  server = createApp({ seed: false }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterEach(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

/**
 * Small fetch wrapper.
 *  - json: object that is sent as application/json
 *  - raw:  string sent as-is (defaults to application/json, override via headers)
 */
async function call(method, path, { json, raw, headers = {} } = {}) {
  const options = { method, headers: { ...headers } };
  if (json !== undefined) {
    options.body = JSON.stringify(json);
    options.headers['content-type'] = 'application/json';
  } else if (raw !== undefined) {
    options.body = raw;
    options.headers = { 'content-type': 'application/json', ...headers };
  }
  const response = await fetch(baseUrl + path, options);
  const text = await response.text();
  return {
    status: response.status,
    headers: response.headers,
    body: text ? JSON.parse(text) : null,
  };
}

async function createTodo(payload = { title: 'Test todo' }) {
  const res = await call('POST', '/todos', { json: payload });
  assert.equal(res.status, 201);
  return res.body;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function assertErrorShape(res, status) {
  assert.equal(res.status, status);
  assert.match(res.headers.get('content-type'), /application\/json/);
  assert.equal(typeof res.body.error, 'string');
  assert.equal(typeof res.body.message, 'string');
}

// ---------------------------------------------------------------------------
// Happy paths
// ---------------------------------------------------------------------------

describe('happy paths', () => {
  it('POST /todos creates a todo (201, Location header, timestamps)', async () => {
    const res = await call('POST', '/todos', {
      json: {
        title: 'Write API documentation',
        description: 'OpenAPI + README examples',
        state: 'todo',
      },
    });

    assert.equal(res.status, 201);
    assert.match(res.headers.get('content-type'), /application\/json/);
    assert.equal(res.headers.get('location'), `/todos/${res.body.id}`);
    assert.equal(res.body.title, 'Write API documentation');
    assert.equal(res.body.description, 'OpenAPI + README examples');
    assert.equal(res.body.state, 'todo');
    assert.ok(res.body.id);
    assert.ok(!Number.isNaN(Date.parse(res.body.createdAt)));
    assert.ok(!Number.isNaN(Date.parse(res.body.updatedAt)));
  });

  it('POST /todos applies defaults (state = todo, optional fields = null)', async () => {
    const todo = await createTodo({ title: 'Only a title' });
    assert.equal(todo.state, 'todo');
    assert.equal(todo.description, null);
    assert.equal(todo.dueDate, null);
  });

  it('POST /todos accepts a valid dueDate (date and date-time)', async () => {
    const a = await createTodo({ title: 'a', dueDate: '2026-12-01' });
    const b = await createTodo({ title: 'b', dueDate: '2026-12-01T10:30:00Z' });
    assert.equal(a.dueDate, '2026-12-01');
    assert.equal(b.dueDate, '2026-12-01T10:30:00Z');
  });

  it('POST /todos trims the title', async () => {
    const todo = await createTodo({ title: '  padded  ' });
    assert.equal(todo.title, 'padded');
  });

  it('GET /todos returns all todos', async () => {
    await createTodo({ title: 'one' });
    await createTodo({ title: 'two' });
    const res = await call('GET', '/todos');
    assert.equal(res.status, 200);
    assert.equal(res.body.length, 2);
  });

  it('GET /todos returns an empty array when there are no todos', async () => {
    const res = await call('GET', '/todos');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, []);
  });

  it('GET /todos?state= filters by state', async () => {
    await createTodo({ title: 'a', state: 'todo' });
    await createTodo({ title: 'b', state: 'doing' });
    await createTodo({ title: 'c', state: 'doing' });
    await createTodo({ title: 'd', state: 'done' });

    for (const [state, expected] of [['todo', 1], ['doing', 2], ['done', 1]]) {
      const res = await call('GET', `/todos?state=${state}`);
      assert.equal(res.status, 200);
      assert.equal(res.body.length, expected, `state=${state}`);
      assert.ok(res.body.every((t) => t.state === state));
    }
  });

  it('GET /todos/:id returns the requested todo', async () => {
    const created = await createTodo({ title: 'find me' });
    const res = await call('GET', `/todos/${created.id}`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, created);
  });

  it('PUT /todos/:id with a partial body updates it and returns the full object', async () => {
    const created = await createTodo({ title: 'keep me', description: 'desc' });
    await sleep(5);
    const res = await call('PUT', `/todos/${created.id}`, { json: { state: 'doing' } });

    assert.equal(res.status, 200);
    assert.equal(res.body.id, created.id);
    assert.equal(res.body.state, 'doing');
    assert.equal(res.body.title, 'keep me');
    assert.equal(res.body.description, 'desc');
    assert.equal(res.body.createdAt, created.createdAt);
    assert.ok(Date.parse(res.body.updatedAt) > Date.parse(created.updatedAt));

    const fetched = await call('GET', `/todos/${created.id}`);
    assert.deepEqual(fetched.body, res.body);
  });

  it('PUT /todos/:id can update every field and clear optional ones with null', async () => {
    const created = await createTodo({
      title: 'old',
      description: 'old desc',
      dueDate: '2026-12-01',
    });
    const res = await call('PUT', `/todos/${created.id}`, {
      json: { title: 'new', description: null, state: 'done', dueDate: null },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.title, 'new');
    assert.equal(res.body.description, null);
    assert.equal(res.body.state, 'done');
    assert.equal(res.body.dueDate, null);
  });

  it('PATCH /todos/:id behaves like a partial update', async () => {
    const created = await createTodo();
    const res = await call('PATCH', `/todos/${created.id}`, { json: { state: 'done' } });
    assert.equal(res.status, 200);
    assert.equal(res.body.state, 'done');
  });

  it('DELETE /todos/:id removes only that todo (204, empty body)', async () => {
    const first = await createTodo({ title: 'first' });
    const second = await createTodo({ title: 'second' });
    const third = await createTodo({ title: 'third' });

    const res = await call('DELETE', `/todos/${second.id}`);
    assert.equal(res.status, 204);
    assert.equal(res.body, null);

    const list = await call('GET', '/todos');
    assert.deepEqual(
      list.body.map((t) => t.id),
      [first.id, third.id]
    );
    assert.equal((await call('GET', `/todos/${second.id}`)).status, 404);
  });
});

// ---------------------------------------------------------------------------
// Client errors: POST /todos
// ---------------------------------------------------------------------------

describe('POST /todos client errors', () => {
  const invalidBodies = [
    ['title is missing', { description: 'no title' }],
    ['title is an empty string', { title: '' }],
    ['title is only whitespace', { title: '   ' }],
    ['title is a number', { title: 123 }],
    ['title is null', { title: null }],
    ['title is too long', { title: 'x'.repeat(201) }],
    ['description is a number', { title: 'ok', description: 42 }],
    ['description is too long', { title: 'ok', description: 'x'.repeat(2001) }],
    ['state is not allowed', { title: 'ok', state: 'finished' }],
    ['state has the wrong case', { title: 'ok', state: 'TODO' }],
    ['state is a number', { title: 'ok', state: 1 }],
    ['dueDate is free text', { title: 'ok', dueDate: 'next friday' }],
    ['dueDate is a number', { title: 'ok', dueDate: 20261201 }],
    ['dueDate is an impossible date', { title: 'ok', dueDate: '2026-02-30' }],
    ['dueDate has an invalid time', { title: 'ok', dueDate: '2026-12-01T25:00:00Z' }],
    ['an unknown field is sent', { title: 'ok', priority: 'high' }],
    ['a read-only field (id) is sent', { title: 'ok', id: 'my-own-id' }],
    ['a read-only field (createdAt) is sent', { title: 'ok', createdAt: '2020-01-01' }],
  ];

  for (const [name, payload] of invalidBodies) {
    it(`returns 400 when ${name}`, async () => {
      const res = await call('POST', '/todos', { json: payload });
      assertErrorShape(res, 400);
      assert.ok(Array.isArray(res.body.details) && res.body.details.length > 0);
      // Nothing must have been stored.
      assert.deepEqual((await call('GET', '/todos')).body, []);
    });
  }

  it('returns 400 for malformed JSON', async () => {
    const res = await call('POST', '/todos', { raw: '{ "title": "broken"' });
    assertErrorShape(res, 400);
  });

  it('returns 400 when the body is not JSON at all but is labelled as JSON', async () => {
    const res = await call('POST', '/todos', { raw: 'this is not json' });
    assertErrorShape(res, 400);
  });

  it('returns 400 when the body is a JSON array', async () => {
    const res = await call('POST', '/todos', { raw: '[{"title":"array"}]' });
    assertErrorShape(res, 400);
  });

  it('returns 400 when the body is a JSON primitive', async () => {
    const res = await call('POST', '/todos', { raw: '"just a string"' });
    assertErrorShape(res, 400);
  });

  it('returns 400 when there is no body', async () => {
    const res = await call('POST', '/todos', { headers: { 'content-type': 'application/json' } });
    assertErrorShape(res, 400);
  });

  it('returns 415 when the Content-Type is not application/json', async () => {
    const res = await call('POST', '/todos', {
      raw: 'title=hello',
      headers: { 'content-type': 'text/plain' },
    });
    assertErrorShape(res, 415);
  });
});

// ---------------------------------------------------------------------------
// Client errors: GET /todos and GET /todos/:id
// ---------------------------------------------------------------------------

describe('GET client errors', () => {
  it('GET /todos?state=finished returns 400', async () => {
    const res = await call('GET', '/todos?state=finished');
    assertErrorShape(res, 400);
  });

  it('GET /todos?state= (empty value) returns 400', async () => {
    const res = await call('GET', '/todos?state=');
    assertErrorShape(res, 400);
  });

  it('GET /todos?state=TODO (wrong case) returns 400', async () => {
    const res = await call('GET', '/todos?state=TODO');
    assertErrorShape(res, 400);
  });

  it('GET /todos?state=todo&state=done (repeated parameter) returns 400', async () => {
    const res = await call('GET', '/todos?state=todo&state=done');
    assertErrorShape(res, 400);
  });

  it('GET /todos/1000 returns 404', async () => {
    const res = await call('GET', '/todos/1000');
    assertErrorShape(res, 404);
  });

  it('GET /todos/<unknown uuid> returns 404', async () => {
    const res = await call('GET', '/todos/3f0c5c1e-8f7a-4a43-9d57-0c3a1d9f2a11');
    assertErrorShape(res, 404);
  });
});

// ---------------------------------------------------------------------------
// Client errors: PUT / PATCH /todos/:id
// ---------------------------------------------------------------------------

describe('PUT /todos/:id client errors', () => {
  it('returns 404 for an unknown id', async () => {
    const res = await call('PUT', '/todos/1000', { json: { state: 'doing' } });
    assertErrorShape(res, 404);
  });

  it('PATCH returns 404 for an unknown id', async () => {
    const res = await call('PATCH', '/todos/1000', { json: { state: 'doing' } });
    assertErrorShape(res, 404);
  });

  const invalidUpdates = [
    ['state is not allowed', { state: 'archived' }],
    ['state is null', { state: null }],
    ['title is empty', { title: '' }],
    ['title is a number', { title: 5 }],
    ['title is null', { title: null }],
    ['description is a number', { description: 5 }],
    ['dueDate is invalid', { dueDate: 'tomorrow' }],
    ['an unknown field is sent', { foo: 'bar' }],
    ['a read-only field (id) is sent', { id: 'other-id' }],
    ['a read-only field (updatedAt) is sent', { updatedAt: '2020-01-01' }],
    ['the object is empty', {}],
  ];

  for (const [name, payload] of invalidUpdates) {
    it(`returns 400 when ${name}`, async () => {
      const created = await createTodo({ title: 'original', state: 'todo' });
      const res = await call('PUT', `/todos/${created.id}`, { json: payload });
      assertErrorShape(res, 400);

      // The stored todo must be unchanged after a rejected update.
      const after = await call('GET', `/todos/${created.id}`);
      assert.deepEqual(after.body, created);
    });
  }

  it('returns 400 for malformed JSON', async () => {
    const created = await createTodo();
    const res = await call('PUT', `/todos/${created.id}`, { raw: '{"state": ' });
    assertErrorShape(res, 400);
  });

  it('returns 400 when the body is a JSON array', async () => {
    const created = await createTodo();
    const res = await call('PUT', `/todos/${created.id}`, { raw: '[]' });
    assertErrorShape(res, 400);
  });

  it('returns 415 when the Content-Type is not application/json', async () => {
    const created = await createTodo();
    const res = await call('PUT', `/todos/${created.id}`, {
      raw: 'state=doing',
      headers: { 'content-type': 'text/plain' },
    });
    assertErrorShape(res, 415);
  });
});

// ---------------------------------------------------------------------------
// Client errors: DELETE, unsupported methods and unknown routes
// ---------------------------------------------------------------------------

describe('DELETE and routing client errors', () => {
  it('DELETE /todos/1000 returns 404', async () => {
    const res = await call('DELETE', '/todos/1000');
    assertErrorShape(res, 404);
  });

  it('deleting the same todo twice returns 404 the second time', async () => {
    const created = await createTodo();
    assert.equal((await call('DELETE', `/todos/${created.id}`)).status, 204);
    assertErrorShape(await call('DELETE', `/todos/${created.id}`), 404);
  });

  it('DELETE /todos (collection) returns 405 with an Allow header', async () => {
    const res = await call('DELETE', '/todos');
    assertErrorShape(res, 405);
    assert.match(res.headers.get('allow'), /GET/);
    assert.match(res.headers.get('allow'), /POST/);
  });

  it('POST /todos/:id returns 405 with an Allow header', async () => {
    const created = await createTodo();
    const res = await call('POST', `/todos/${created.id}`, { json: { title: 'x' } });
    assertErrorShape(res, 405);
    assert.match(res.headers.get('allow'), /DELETE/);
  });

  it('an unknown route returns 404', async () => {
    const res = await call('GET', '/unknown');
    assertErrorShape(res, 404);
  });
});
