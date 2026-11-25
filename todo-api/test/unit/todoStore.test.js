'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createMemoryStore } = require('../../src/todoStore');

describe('memory store', () => {
  let store;
  beforeEach(() => {
    store = createMemoryStore();
  });

  it('starts empty', () => {
    assert.deepEqual(store.all(), []);
  });

  it('inserts and finds by id', () => {
    const item = { id: 'a', title: 'A' };
    assert.equal(store.insert(item), item);
    assert.equal(store.findById('a'), item);
  });

  it('returns undefined for an unknown id', () => {
    assert.equal(store.findById('missing'), undefined);
  });

  it('all() returns a copy, so callers cannot change the store', () => {
    store.insert({ id: 'a' });
    store.all().push({ id: 'intruder' });
    assert.equal(store.all().length, 1);
  });

  it('replace() swaps the item and reports whether it existed', () => {
    store.insert({ id: 'a', title: 'old' });
    assert.equal(store.replace('a', { id: 'a', title: 'new' }), true);
    assert.equal(store.findById('a').title, 'new');
    assert.equal(store.replace('missing', { id: 'missing' }), false);
  });

  it('remove() deletes exactly one item, wherever it is', () => {
    for (const id of ['a', 'b', 'c', 'd']) store.insert({ id });
    assert.equal(store.remove('c'), true); // middle
    assert.equal(store.remove('a'), true); // first
    assert.deepEqual(store.all().map((t) => t.id), ['b', 'd']);
  });

  it('remove() returns false for an unknown id and changes nothing', () => {
    store.insert({ id: 'a' });
    assert.equal(store.remove('missing'), false);
    assert.equal(store.all().length, 1);
  });
});
