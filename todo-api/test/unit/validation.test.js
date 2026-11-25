'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  STATES,
  MAX_TITLE_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  isPlainObject,
  isValidState,
  isValidDueDate,
  validateTodoInput,
} = require('../../src/validation');

describe('isPlainObject', () => {
  it('accepts plain objects', () => {
    assert.equal(isPlainObject({}), true);
    assert.equal(isPlainObject({ a: 1 }), true);
  });

  it('rejects null, arrays and primitives', () => {
    for (const value of [null, undefined, [], [1], 'text', 42, true]) {
      assert.equal(isPlainObject(value), false, String(value));
    }
  });
});

describe('isValidState', () => {
  it('accepts every allowed state', () => {
    assert.deepEqual(STATES, ['todo', 'doing', 'done']);
    for (const state of STATES) assert.equal(isValidState(state), true, state);
  });

  it('rejects other values (case-sensitive, non-strings)', () => {
    for (const value of ['TODO', 'finished', '', ' todo', 1, null, undefined, ['todo']]) {
      assert.equal(isValidState(value), false, String(value));
    }
  });
});

describe('isValidDueDate', () => {
  it('accepts ISO dates and date-times', () => {
    for (const value of [
      '2026-12-01',
      '2024-02-29', // leap day
      '2026-12-01T10:30Z',
      '2026-12-01T10:30:00Z',
      '2026-12-01T10:30:00.123Z',
      '2026-12-01T10:30:00+02:00',
      '2026-12-01T10:30:00-05:00',
    ]) {
      assert.equal(isValidDueDate(value), true, value);
    }
  });

  it('rejects impossible calendar dates', () => {
    for (const value of ['2026-02-30', '2026-13-01', '2026-00-10', '2026-04-31', '2025-02-29']) {
      assert.equal(isValidDueDate(value), false, value);
    }
  });

  it('rejects invalid times', () => {
    for (const value of ['2026-12-01T25:00:00Z', '2026-12-01T10:61:00Z']) {
      assert.equal(isValidDueDate(value), false, value);
    }
  });

  it('rejects wrong formats and non-strings', () => {
    for (const value of [
      'next friday',
      '01/12/2026',
      '2026-1-1',
      '2026-12-01T10:00:00', // time without a timezone
      '',
      20261201,
      null,
      undefined,
      {},
    ]) {
      assert.equal(isValidDueDate(value), false, String(value));
    }
  });
});

describe('validateTodoInput (create)', () => {
  const create = (body) => validateTodoInput(body, { requireTitle: true });

  it('accepts a title only', () => {
    const { errors, value } = create({ title: 'Buy milk' });
    assert.deepEqual(errors, []);
    assert.deepEqual(value, { title: 'Buy milk' });
  });

  it('accepts all fields and returns them cleaned', () => {
    const { errors, value } = create({
      title: '  Padded  ',
      description: 'desc',
      state: 'doing',
      dueDate: '2026-12-01',
    });
    assert.deepEqual(errors, []);
    assert.deepEqual(value, {
      title: 'Padded',
      description: 'desc',
      state: 'doing',
      dueDate: '2026-12-01',
    });
  });

  it('accepts null for description and dueDate', () => {
    const { errors, value } = create({ title: 't', description: null, dueDate: null });
    assert.deepEqual(errors, []);
    assert.equal(value.description, null);
    assert.equal(value.dueDate, null);
  });

  it('accepts a title and description at exactly the length limits', () => {
    const { errors } = create({
      title: 'x'.repeat(MAX_TITLE_LENGTH),
      description: 'y'.repeat(MAX_DESCRIPTION_LENGTH),
    });
    assert.deepEqual(errors, []);
  });

  it('requires a title', () => {
    assert.deepEqual(create({}).errors, ['title is required']);
    assert.deepEqual(create({ description: 'only' }).errors, ['title is required']);
  });

  it('rejects empty, whitespace, null and non-string titles', () => {
    for (const title of ['', '   ', null, 5, true, [], {}]) {
      const { errors } = create({ title });
      assert.deepEqual(errors, ['title must be a non-empty string'], JSON.stringify(title));
    }
  });

  it('rejects a title that is too long', () => {
    const { errors } = create({ title: 'x'.repeat(MAX_TITLE_LENGTH + 1) });
    assert.equal(errors.length, 1);
    assert.match(errors[0], /at most 200/);
  });

  it('rejects an invalid description', () => {
    assert.match(create({ title: 't', description: 5 }).errors[0], /description/);
    const tooLong = create({ title: 't', description: 'x'.repeat(MAX_DESCRIPTION_LENGTH + 1) });
    assert.match(tooLong.errors[0], /at most 2000/);
  });

  it('rejects an invalid state', () => {
    for (const state of ['finished', 'TODO', '', null, 1]) {
      const { errors } = create({ title: 't', state });
      assert.equal(errors.length, 1, JSON.stringify(state));
      assert.match(errors[0], /state must be one of: todo, doing, done/);
    }
  });

  it('rejects an invalid dueDate', () => {
    const { errors } = create({ title: 't', dueDate: '2026-02-30' });
    assert.equal(errors.length, 1);
    assert.match(errors[0], /dueDate/);
  });

  it('rejects unknown and read-only fields', () => {
    for (const field of ['id', 'createdAt', 'updatedAt', 'priority']) {
      const { errors } = create({ title: 't', [field]: 'x' });
      assert.deepEqual(errors, [`Unknown or read-only field: "${field}"`]);
    }
  });

  it('rejects bodies that are not objects', () => {
    for (const body of [undefined, null, [], [{ title: 't' }], 'text', 42]) {
      assert.deepEqual(create(body).errors, ['Request body must be a JSON object']);
    }
  });

  it('collects every error instead of stopping at the first', () => {
    const { errors } = create({ title: '', state: 'nope', dueDate: 'x', extra: 1 });
    assert.equal(errors.length, 4);
  });

  it('does not copy unvalidated fields into value', () => {
    const { value } = create({ title: 't', id: 'hacked' });
    assert.equal('id' in value, false);
  });
});

describe('validateTodoInput (update)', () => {
  const update = (body) => validateTodoInput(body, { requireTitle: false });

  it('does not require a title', () => {
    const { errors, value } = update({ state: 'done' });
    assert.deepEqual(errors, []);
    assert.deepEqual(value, { state: 'done' });
  });

  it('accepts each field on its own', () => {
    assert.deepEqual(update({ title: 'New' }).value, { title: 'New' });
    assert.deepEqual(update({ description: 'd' }).value, { description: 'd' });
    assert.deepEqual(update({ dueDate: '2026-12-01' }).value, { dueDate: '2026-12-01' });
  });

  it('allows clearing optional fields with null', () => {
    assert.deepEqual(update({ description: null, dueDate: null }).value, {
      description: null,
      dueDate: null,
    });
  });

  it('rejects an empty object', () => {
    const { errors } = update({});
    assert.equal(errors.length, 1);
    assert.match(errors[0], /Provide at least one of/);
  });

  it('rejects a null or empty title when it is provided', () => {
    assert.equal(update({ title: null }).errors.length, 1);
    assert.equal(update({ title: '' }).errors.length, 1);
  });

  it('rejects an invalid state', () => {
    assert.match(update({ state: 'archived' }).errors[0], /state must be one of/);
  });

  it('rejects read-only fields', () => {
    assert.deepEqual(update({ id: 'x' }).errors, ['Unknown or read-only field: "id"']);
  });

  it('rejects bodies that are not objects', () => {
    assert.deepEqual(update([]).errors, ['Request body must be a JSON object']);
    assert.deepEqual(update(undefined).errors, ['Request body must be a JSON object']);
  });
});
