'use strict';

const { randomUUID } = require('node:crypto');
const { ValidationError, NotFoundError } = require('./errors');
const { STATES, isValidState, validateTodoInput } = require('./validation');
const { createMemoryStore } = require('./todoStore');

/**
 * Application logic, independent of Express. Everything non-deterministic is
 * injectable so tests control it:
 *   store      - repository (defaults to an in-memory one)
 *   now        - () => ISO timestamp string
 *   generateId - () => string
 */
function createTodoService({
  store = createMemoryStore(),
  now = () => new Date().toISOString(),
  generateId = randomUUID,
} = {}) {
  function getOrThrow(id) {
    const todo = store.findById(id);
    if (!todo) throw new NotFoundError(`Todo with id "${id}" not found`);
    return todo;
  }

  return {
    create(input) {
      const { errors, value } = validateTodoInput(input, { requireTitle: true });
      if (errors.length > 0) throw new ValidationError('Validation failed', errors);

      const timestamp = now();
      return store.insert({
        id: generateId(),
        title: value.title,
        description: value.description ?? null,
        state: value.state ?? 'todo',
        dueDate: value.dueDate ?? null,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    },

    list(state) {
      if (state !== undefined && !isValidState(state)) {
        throw new ValidationError(
          `Invalid state filter. Allowed values: ${STATES.join(', ')}`
        );
      }
      const all = store.all();
      return state === undefined ? all : all.filter((t) => t.state === state);
    },

    get(id) {
      return getOrThrow(id);
    },

    // Existence is checked before validation: unknown id -> 404, bad body -> 400.
    update(id, input) {
      const existing = getOrThrow(id);
      const { errors, value } = validateTodoInput(input, { requireTitle: false });
      if (errors.length > 0) throw new ValidationError('Validation failed', errors);

      const updated = { ...existing, ...value, updatedAt: now() };
      store.replace(id, updated);
      return updated;
    },

    remove(id) {
      getOrThrow(id);
      store.remove(id);
    },
  };
}

module.exports = { createTodoService };
