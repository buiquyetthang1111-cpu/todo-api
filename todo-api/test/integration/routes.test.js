'use strict';

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../../app');
const { createTodoService } = require('../../src/todoService');
const { ValidationError, NotFoundError } = require('../../src/errors');

const servers = [];

async function start(options) {
  const server = createApp(options).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  servers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
}

afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop();
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
});

async function request(baseUrl, method, path, json) {
  const response = await fetch(baseUrl + path, {
    method,
    headers: json === undefined ? {} : { 'content-type': 'application/json' },
    body: json === undefined ? undefined : JSON.stringify(json),
  });
  const text = await response.text();
  return { status: response.status, headers: response.headers, body: text ? JSON.parse(text) : null };
}

// ---------------------------------------------------------------------------
// Full stack: HTTP -> routes -> service -> store
// ---------------------------------------------------------------------------

describe('full stack with a controlled clock and ids', () => {
  it('walks a todo through its whole life with exact, predictable values', async () => {
    let tick = 0;
    const service = createTodoService({
      now: () => `2026-01-01T00:00:0${tick++}.000Z`,
      generateId: () => 'todo-1',
    });
    const url = await start({ service });

    // create
    const created = await request(url, 'POST', '/todos', {
      title: 'Write API documentation',
      description: 'OpenAPI + README examples',
    });
    assert.equal(created.status, 201);
    assert.equal(created.headers.get('location'), '/todos/todo-1');
    assert.deepEqual(created.body, {
      id: 'todo-1',
      title: 'Write API documentation',
      description: 'OpenAPI + README examples',
      state: 'todo',
      dueDate: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    // read
    assert.deepEqual((await request(url, 'GET', '/todos/todo-1')).body, created.body);

    // update
    const updated = await request(url, 'PUT', '/todos/todo-1', { state: 'doing' });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.state, 'doing');
    assert.equal(updated.body.createdAt, '2026-01-01T00:00:00.000Z');
    assert.equal(updated.body.updatedAt, '2026-01-01T00:00:01.000Z');

    // filter reflects the update
    assert.equal((await request(url, 'GET', '/todos?state=todo')).body.length, 0);
    assert.equal((await request(url, 'GET', '/todos?state=doing')).body.length, 1);

    // delete
    assert.equal((await request(url, 'DELETE', '/todos/todo-1')).status, 204);
    assert.equal((await request(url, 'GET', '/todos/todo-1')).status, 404);
    assert.deepEqual((await request(url, 'GET', '/todos')).body, []);
  });

  it('seeds one example todo when seed is true', async () => {
    const url = await start({ seed: true });
    const res = await request(url, 'GET', '/todos');
    assert.equal(res.status, 200);
    assert.equal(res.body.length, 1);
    assert.equal(res.body[0].title, 'Study REST APIs');
  });

  it('keeps separate app instances isolated from each other', async () => {
    const a = await start();
    const b = await start();
    await request(a, 'POST', '/todos', { title: 'only in A' });
    assert.equal((await request(a, 'GET', '/todos')).body.length, 1);
    assert.equal((await request(b, 'GET', '/todos')).body.length, 0);
  });
});

// ---------------------------------------------------------------------------
// HTTP layer in isolation: the service is replaced by a stub, so these tests
// only fail if the routes or the error mapping are wrong.
// ---------------------------------------------------------------------------

describe('routes with a stubbed service', () => {
  function stubService(overrides = {}) {
    const calls = [];
    const record = (name, result) => (...args) => {
      calls.push([name, ...args]);
      return typeof result === 'function' ? result(...args) : result;
    };
    return {
      calls,
      service: {
        create: record('create', { id: 'x', title: 'stub' }),
        list: record('list', []),
        get: record('get', { id: 'x' }),
        update: record('update', { id: 'x' }),
        remove: record('remove', undefined),
        ...Object.fromEntries(
          Object.entries(overrides).map(([name, fn]) => [name, record(name, fn)])
        ),
      },
    };
  }

  it('passes the request body and path parameters to the service', async () => {
    const { service, calls } = stubService();
    const url = await start({ service });

    await request(url, 'POST', '/todos', { title: 'hello' });
    await request(url, 'GET', '/todos/abc');
    await request(url, 'PUT', '/todos/abc', { state: 'done' });
    await request(url, 'PATCH', '/todos/abc', { title: 'patched' });
    await request(url, 'DELETE', '/todos/abc');

    assert.deepEqual(calls, [
      ['create', { title: 'hello' }],
      ['get', 'abc'],
      ['update', 'abc', { state: 'done' }],
      ['update', 'abc', { title: 'patched' }],
      ['remove', 'abc'],
    ]);
  });

  it('passes the state query parameter to list()', async () => {
    const { service, calls } = stubService();
    const url = await start({ service });
    await request(url, 'GET', '/todos?state=done');
    await request(url, 'GET', '/todos');
    assert.deepEqual(calls, [['list', 'done'], ['list', undefined]]);
  });

  it('returns what the service returns, with the right status codes', async () => {
    const { service } = stubService();
    const url = await start({ service });
    assert.equal((await request(url, 'POST', '/todos', { title: 't' })).status, 201);
    assert.equal((await request(url, 'GET', '/todos')).status, 200);
    assert.equal((await request(url, 'DELETE', '/todos/x')).status, 204);
  });

  it('maps ValidationError to 400 and includes details', async () => {
    const { service } = stubService({
      create: () => {
        throw new ValidationError('Validation failed', ['title is required']);
      },
    });
    const url = await start({ service });
    const res = await request(url, 'POST', '/todos', {});
    assert.equal(res.status, 400);
    assert.deepEqual(res.body, {
      error: 'Bad Request',
      message: 'Validation failed',
      details: ['title is required'],
    });
  });

  it('omits "details" when a ValidationError has none', async () => {
    const { service } = stubService({
      list: () => {
        throw new ValidationError('Invalid state filter');
      },
    });
    const url = await start({ service });
    const res = await request(url, 'GET', '/todos?state=x');
    assert.equal(res.status, 400);
    assert.equal('details' in res.body, false);
  });

  it('maps NotFoundError to 404', async () => {
    const { service } = stubService({
      get: () => {
        throw new NotFoundError('Todo with id "1000" not found');
      },
    });
    const url = await start({ service });
    const res = await request(url, 'GET', '/todos/1000');
    assert.equal(res.status, 404);
    assert.deepEqual(res.body, {
      error: 'Not Found',
      message: 'Todo with id "1000" not found',
    });
  });

  it('maps an unexpected error to 500 without leaking its message', async () => {
    const originalConsoleError = console.error;
    console.error = () => {}; // keep the test output clean
    try {
      const { service } = stubService({
        get: () => {
          throw new Error('database password is hunter2');
        },
      });
      const url = await start({ service });
      const res = await request(url, 'GET', '/todos/x');
      assert.equal(res.status, 500);
      assert.equal(res.body.error, 'Internal Server Error');
      assert.ok(!JSON.stringify(res.body).includes('hunter2'));
    } finally {
      console.error = originalConsoleError;
    }
  });

  it('does not call the service when the Content-Type is wrong (415)', async () => {
    const { service, calls } = stubService();
    const url = await start({ service });
    const res = await fetch(`${url}/todos`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: 'title=x',
    });
    assert.equal(res.status, 415);
    assert.deepEqual(calls, []);
  });

  it('does not call the service when the JSON is malformed (400)', async () => {
    const { service, calls } = stubService();
    const url = await start({ service });
    const res = await fetch(`${url}/todos`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{ "title": ',
    });
    assert.equal(res.status, 400);
    assert.deepEqual(calls, []);
  });
});
