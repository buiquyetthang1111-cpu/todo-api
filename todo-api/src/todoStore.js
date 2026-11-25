'use strict';

/**
 * In-memory repository. The service only talks to this small interface
 * (all / findById / insert / replace / remove), so tests can use a fake store
 * and a real database could replace this file later.
 */
function createMemoryStore() {
  const items = [];

  return {
    all: () => [...items],
    findById: (id) => items.find((item) => item.id === id),
    insert: (item) => {
      items.push(item);
      return item;
    },
    replace: (id, item) => {
      const index = items.findIndex((t) => t.id === id);
      if (index === -1) return false;
      items[index] = item;
      return true;
    },
    remove: (id) => {
      const index = items.findIndex((t) => t.id === id);
      if (index === -1) return false;
      items.splice(index, 1); // remove exactly one item at `index`
      return true;
    },
  };
}

module.exports = { createMemoryStore };
