'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../../app');
const spec = require('../../openapi.json');

let server;
let baseUrl;

beforeEach(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterEach(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

async function post(body) {
  const res = await fetch(`${baseUrl}/todos`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  assert.equal(res.status, 201);
  return res.json();
}

const getTodos = (path = '/todos', accept) =>
  fetch(baseUrl + path, { headers: accept === undefined ? {} : { accept } });

const HEADER = 'id,title,description,state,dueDate,createdAt,updatedAt';

// ---------------------------------------------------------------------------
// GET /todos content negotiation
// ---------------------------------------------------------------------------

describe('GET /todos content negotiation', () => {
  it('returns CSV for Accept: text/csv', async () => {
    const a = await post({ title: 'First', description: 'one', state: 'done' });
    const b = await post({ title: 'Second', state: 'done', dueDate: '2026-12-01' });

    const res = await getTodos('/todos?state=done', 'text/csv');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /^text\/csv/);
    assert.match(res.headers.get('vary'), /Accept/i);

    const lines = (await res.text()).split('\n');
    assert.equal(lines[0], HEADER);
    assert.equal(lines.length, 3);
    assert.equal(lines[1], `${a.id},First,one,done,,${a.createdAt},${a.updatedAt}`);
    assert.equal(lines[2], `${b.id},Second,,done,2026-12-01,${b.createdAt},${b.updatedAt}`);
  });

  it('applies the state filter to the CSV output', async () => {
    await post({ title: 'a', state: 'todo' });
    await post({ title: 'b', state: 'done' });
    const text = await (await getTodos('/todos?state=todo', 'text/csv')).text();
    assert.equal(text.split('\n').length, 2); // header + 1 row
    assert.ok(text.includes(',a,'));
    assert.ok(!text.includes(',b,'));
  });

  it('returns only the header row when there are no todos', async () => {
    const res = await getTodos('/todos', 'text/csv');
    assert.equal(res.status, 200);
    assert.equal(await res.text(), HEADER);
  });

  it('escapes special characters so the CSV stays well-formed', async () => {
    await post({ title: 'Buy milk, eggs', description: 'He said "now"' });
    const text = await (await getTodos('/todos', 'text/csv')).text();
    assert.ok(text.includes('"Buy milk, eggs","He said ""now"""'));
  });

  it('returns JSON for Accept: application/json', async () => {
    await post({ title: 'x' });
    const res = await getTodos('/todos', 'application/json');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /application\/json/);
    assert.equal((await res.json()).length, 1);
  });

  it('returns JSON when there is no Accept header or it is */*', async () => {
    for (const accept of [undefined, '*/*']) {
      const res = await getTodos('/todos', accept);
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type'), /application\/json/, String(accept));
    }
  });

  it('respects quality values: CSV preferred over JSON', async () => {
    const res = await getTodos('/todos', 'application/json;q=0.5, text/csv;q=0.9');
    assert.match(res.headers.get('content-type'), /^text\/csv/);
  });

  it('respects quality values: JSON preferred over CSV', async () => {
    const res = await getTodos('/todos', 'text/csv;q=0.2, application/json;q=0.8');
    assert.match(res.headers.get('content-type'), /application\/json/);
  });

  it('returns 406 when the client accepts neither JSON nor CSV', async () => {
    for (const accept of ['application/xml', 'text/html', 'image/png']) {
      const res = await getTodos('/todos', accept);
      assert.equal(res.status, 406, accept);
      const body = await res.json();
      assert.equal(body.error, 'Not Acceptable');
      assert.match(body.message, /text\/csv/);
    }
  });

  it('still returns a 400 for an invalid state filter when CSV is requested', async () => {
    const res = await getTodos('/todos?state=finished', 'text/csv');
    assert.equal(res.status, 400);
    assert.match(res.headers.get('content-type'), /application\/json/);
    assert.equal((await res.json()).error, 'Bad Request');
  });
});

// ---------------------------------------------------------------------------
// API documentation
// ---------------------------------------------------------------------------

describe('API documentation at /doc', () => {
  it('serves the Swagger UI page at /doc/', async () => {
    const res = await fetch(`${baseUrl}/doc/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    assert.match(await res.text(), /swagger/i);
  });

  it('serves the OpenAPI document at /doc/openapi.json', async () => {
    const res = await fetch(`${baseUrl}/doc/openapi.json`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /application\/json/);
    assert.deepEqual(await res.json(), spec);
  });

  it('can be switched off with docs: false', async () => {
    const other = createApp({ docs: false }).listen(0);
    await new Promise((resolve) => other.once('listening', resolve));
    try {
      const res = await fetch(`http://127.0.0.1:${other.address().port}/doc/openapi.json`);
      assert.equal(res.status, 404);
    } finally {
      other.closeAllConnections?.();
      await new Promise((resolve) => other.close(resolve));
    }
  });

  it('the documented example requests really work against the API', async () => {
    const createExample = spec.paths['/todos'].post.requestBody.content['application/json'].example;
    const created = await post(createExample);
    assert.equal(created.title, createExample.title);

    const updateExample = spec.paths['/todos/{id}'].put.requestBody.content['application/json'].example;
    const res = await fetch(`${baseUrl}/todos/${created.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(updateExample),
    });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).state, updateExample.state);
  });
});
