'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createTodoService } = require('../../src/todoService');
const { createMemoryStore } = require('../../src/todoStore');
const { ValidationError, NotFoundError } = require('../../src/errors');

/** Deterministic clock and id generator, so exact values can be asserted. */
function makeDeps() {
  let tick = 0;
  let idCounter = 0;
  return {
    now: () => `2026-01-01T00:00:${String(tick++).padStart(2, '0')}.000Z`,
    generateId: () => `id-${++idCounter}`,
  };
}

describe('todoService', () => {
  let service;

  beforeEach(() => {
    service = createTodoService({ store: createMemoryStore(), ...makeDeps() });
  });

  describe('create', () => {
    it('creates a todo with defaults, generated id and timestamps', () => {
      const todo = service.create({ title: 'Write tests' });
      assert.deepEqual(todo, {
        id: 'id-1',
        title: 'Write tests',
        description: null,
        state: 'todo',
        dueDate: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      });
    });

    it('stores the todo so it can be fetched afterwards', () => {
      const created = service.create({ title: 'Stored', state: 'doing' });
      assert.deepEqual(service.get(created.id), created);
    });

    it('keeps supplied values', () => {
      const todo = service.create({
        title: 'Full',
        description: 'desc',
        state: 'done',
        dueDate: '2026-12-01',
      });
      assert.equal(todo.description, 'desc');
      assert.equal(todo.state, 'done');
      assert.equal(todo.dueDate, '2026-12-01');
    });

    it('gives each todo a different id', () => {
      assert.notEqual(service.create({ title: 'a' }).id, service.create({ title: 'b' }).id);
    });

    it('throws ValidationError with details for invalid input and stores nothing', () => {
      assert.throws(
        () => service.create({ title: '', state: 'nope' }),
        (err) => {
          assert.ok(err instanceof ValidationError);
          assert.equal(err.message, 'Validation failed');
          assert.equal(err.details.length, 2);
          return true;
        }
      );
      assert.deepEqual(service.list(), []);
    });

    it('throws ValidationError when the input is not an object', () => {
      assert.throws(() => service.create(undefined), ValidationError);
      assert.throws(() => service.create([]), ValidationError);
    });
  });

  describe('list', () => {
    beforeEach(() => {
      service.create({ title: 'a', state: 'todo' });
      service.create({ title: 'b', state: 'doing' });
      service.create({ title: 'c', state: 'doing' });
      service.create({ title: 'd', state: 'done' });
    });

    it('returns everything without a filter', () => {
      assert.deepEqual(service.list().map((t) => t.title), ['a', 'b', 'c', 'd']);
    });

    it('filters by each state', () => {
      assert.deepEqual(service.list('todo').map((t) => t.title), ['a']);
      assert.deepEqual(service.list('doing').map((t) => t.title), ['b', 'c']);
      assert.deepEqual(service.list('done').map((t) => t.title), ['d']);
    });

    it('returns an empty array when nothing matches', () => {
      const empty = createTodoService({ ...makeDeps() });
      assert.deepEqual(empty.list('done'), []);
    });

    it('throws ValidationError for an invalid filter', () => {
      for (const bad of ['finished', 'TODO', '', ['todo', 'done'], null]) {
        assert.throws(() => service.list(bad), ValidationError, JSON.stringify(bad));
      }
    });
  });

  describe('get', () => {
    it('returns the todo', () => {
      const created = service.create({ title: 'find me' });
      assert.equal(service.get(created.id).title, 'find me');
    });

    it('throws NotFoundError for an unknown id', () => {
      assert.throws(() => service.get('nope'), NotFoundError);
    });

    it('includes the id in the NotFoundError message', () => {
      assert.throws(() => service.get('1000'), /"1000" not found/);
    });
  });

  describe('update', () => {
    it('merges the supplied fields and refreshes updatedAt only', () => {
      const created = service.create({ title: 'keep', description: 'desc' });
      const updated = service.update(created.id, { state: 'doing' });

      assert.equal(updated.id, created.id);
      assert.equal(updated.title, 'keep');
      assert.equal(updated.description, 'desc');
      assert.equal(updated.state, 'doing');
      assert.equal(updated.createdAt, created.createdAt);
      assert.equal(updated.updatedAt, '2026-01-01T00:00:01.000Z');
      assert.notEqual(updated.updatedAt, created.updatedAt);
    });

    it('persists the update', () => {
      const created = service.create({ title: 'old' });
      service.update(created.id, { title: 'new' });
      assert.equal(service.get(created.id).title, 'new');
    });

    it('can clear optional fields with null', () => {
      const created = service.create({ title: 't', description: 'd', dueDate: '2026-12-01' });
      const updated = service.update(created.id, { description: null, dueDate: null });
      assert.equal(updated.description, null);
      assert.equal(updated.dueDate, null);
    });

    it('does not mutate the previously returned object', () => {
      const created = service.create({ title: 'orig' });
      service.update(created.id, { title: 'changed' });
      assert.equal(created.title, 'orig');
    });

    it('throws NotFoundError for an unknown id', () => {
      assert.throws(() => service.update('nope', { state: 'done' }), NotFoundError);
    });

    it('checks existence before validating (unknown id + bad body -> NotFoundError)', () => {
      assert.throws(() => service.update('nope', { state: 'invalid' }), NotFoundError);
    });

    it('throws ValidationError for invalid input and leaves the todo unchanged', () => {
      const created = service.create({ title: 'original' });
      for (const bad of [{}, { state: 'archived' }, { title: '' }, { id: 'x' }, []]) {
        assert.throws(() => service.update(created.id, bad), ValidationError, JSON.stringify(bad));
      }
      assert.deepEqual(service.get(created.id), created);
    });
  });

  describe('remove', () => {
    it('removes only the requested todo', () => {
      const a = service.create({ title: 'a' });
      const b = service.create({ title: 'b' });
      const c = service.create({ title: 'c' });

      service.remove(b.id);

      assert.deepEqual(service.list().map((t) => t.id), [a.id, c.id]);
      assert.throws(() => service.get(b.id), NotFoundError);
    });

    it('can remove the first todo (index 0)', () => {
      const a = service.create({ title: 'a' });
      const b = service.create({ title: 'b' });
      service.remove(a.id);
      assert.deepEqual(service.list().map((t) => t.id), [b.id]);
    });

    it('throws NotFoundError for an unknown id and for a second delete', () => {
      const a = service.create({ title: 'a' });
      assert.throws(() => service.remove('nope'), NotFoundError);
      service.remove(a.id);
      assert.throws(() => service.remove(a.id), NotFoundError);
    });
  });

  describe('dependency injection', () => {
    it('uses the injected store (a fake that records calls)', () => {
      const calls = [];
      const fakeStore = {
        all: () => (calls.push('all'), []),
        findById: (id) => (calls.push(`findById:${id}`), undefined),
        insert: (item) => (calls.push('insert'), item),
        replace: () => (calls.push('replace'), true),
        remove: () => (calls.push('remove'), true),
      };
      const svc = createTodoService({ store: fakeStore, ...makeDeps() });

      svc.create({ title: 't' });
      svc.list();
      assert.throws(() => svc.get('x'), NotFoundError);

      assert.deepEqual(calls, ['insert', 'all', 'findById:x']);
    });

    it('works with default dependencies (real clock and UUIDs)', () => {
      const real = createTodoService();
      const todo = real.create({ title: 'real' });
      assert.match(todo.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      assert.ok(!Number.isNaN(Date.parse(todo.createdAt)));
    });
  });
});
