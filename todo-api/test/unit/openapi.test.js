'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const spec = require('../../openapi.json');

const METHODS = ['get', 'put', 'post', 'delete', 'patch', 'options', 'head'];

/** Collects every { method, path, operation } in the spec. */
function operations() {
  const result = [];
  for (const [path, item] of Object.entries(spec.paths)) {
    for (const method of METHODS) {
      if (item[method]) result.push({ method, path, operation: item[method] });
    }
  }
  return result;
}

/** Resolves a local "#/..." reference, or returns undefined. */
function resolve(ref) {
  return ref
    .slice(2)
    .split('/')
    .reduce((node, key) => (node === undefined ? undefined : node[key]), spec);
}

/** Collects every $ref string in the document. */
function allRefs(node, found = []) {
  if (Array.isArray(node)) node.forEach((child) => allRefs(child, found));
  else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (key === '$ref') found.push(value);
      else allRefs(value, found);
    }
  }
  return found;
}

describe('OpenAPI document', () => {
  it('declares OpenAPI 3 with a title, version and a local server', () => {
    assert.match(spec.openapi, /^3\./);
    assert.ok(spec.info.title);
    assert.ok(spec.info.version);
    assert.equal(spec.servers[0].url, 'http://localhost:3000');
  });

  it('documents every implemented endpoint', () => {
    const documented = operations().map((o) => `${o.method.toUpperCase()} ${o.path}`).sort();
    assert.deepEqual(documented, [
      'DELETE /todos/{id}',
      'GET /todos',
      'GET /todos/{id}',
      'PATCH /todos/{id}',
      'POST /todos',
      'PUT /todos/{id}',
    ]);
  });

  it('gives every operation a summary, unique operationId, tag and responses', () => {
    const ids = new Set();
    for (const { method, path, operation } of operations()) {
      const name = `${method} ${path}`;
      assert.ok(operation.summary, `${name} summary`);
      assert.ok(operation.operationId, `${name} operationId`);
      assert.ok(!ids.has(operation.operationId), `${name} duplicate operationId`);
      ids.add(operation.operationId);
      assert.ok(operation.tags?.length > 0, `${name} tags`);
      assert.ok(Object.keys(operation.responses).length > 0, `${name} responses`);
    }
  });

  it('resolves every $ref', () => {
    const refs = allRefs(spec);
    assert.ok(refs.length > 0);
    for (const ref of refs) {
      assert.ok(ref.startsWith('#/'), ref);
      assert.notEqual(resolve(ref), undefined, `unresolved ${ref}`);
    }
  });

  it('GET /todos offers both JSON and CSV and has a "state" filter limited to the 3 states', () => {
    const get = spec.paths['/todos'].get;
    const ok = get.responses['200'].content;
    assert.ok(ok['application/json']);
    assert.ok(ok['text/csv']);

    const stateParam = get.parameters.find((p) => p.name === 'state');
    assert.equal(stateParam.in, 'query');
    assert.deepEqual(resolve(stateParam.schema.$ref).enum, ['todo', 'doing', 'done']);

    assert.ok(get.responses['400'], 'invalid filter -> 400');
    assert.ok(get.responses['406'], 'unsupported Accept -> 406');
  });

  it('documents the success status codes of the assignment', () => {
    assert.ok(spec.paths['/todos'].post.responses['201']);
    assert.ok(spec.paths['/todos/{id}'].get.responses['200']);
    assert.ok(spec.paths['/todos/{id}'].put.responses['200']);
    assert.ok(spec.paths['/todos/{id}'].delete.responses['204']);
  });

  it('documents the client errors (400/404) on the routes that can produce them', () => {
    const item = spec.paths['/todos/{id}'];
    assert.ok(spec.paths['/todos'].post.responses['400']);
    assert.ok(item.get.responses['404']);
    for (const method of ['put', 'patch']) {
      assert.ok(item[method].responses['400'], `${method} 400`);
      assert.ok(item[method].responses['404'], `${method} 404`);
    }
    assert.ok(item.delete.responses['404']);
  });

  it('declares the {id} path parameter so "Try it out" can fill it in', () => {
    const [param] = spec.paths['/todos/{id}'].parameters;
    assert.equal(param.name, 'id');
    assert.equal(param.in, 'path');
    assert.equal(param.required, true);
  });

  it('every request body is JSON and has an example for "Try it out"', () => {
    for (const { method, path, operation } of operations()) {
      if (!operation.requestBody) continue;
      const json = operation.requestBody.content['application/json'];
      assert.ok(json, `${method} ${path} JSON body`);
      assert.ok(json.example, `${method} ${path} example`);
    }
  });

  it('the request schemas allow exactly the writable fields', () => {
    const writable = ['title', 'description', 'state', 'dueDate'];
    for (const name of ['NewTodo', 'UpdateTodo']) {
      const schema = spec.components.schemas[name];
      assert.deepEqual(Object.keys(schema.properties), writable, name);
      assert.equal(schema.additionalProperties, false, name);
    }
    assert.deepEqual(spec.components.schemas.NewTodo.required, ['title']);
  });
});
