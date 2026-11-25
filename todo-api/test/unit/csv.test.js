'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { COLUMNS, escapeField, toCsv } = require('../../src/csv');

const HEADER = 'id,title,description,state,dueDate,createdAt,updatedAt';

const todo = (overrides = {}) => ({
  id: 'id-1',
  title: 'Title',
  description: 'Desc',
  state: 'todo',
  dueDate: '2026-12-01',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:01.000Z',
  ...overrides,
});

describe('escapeField', () => {
  it('leaves plain text unchanged', () => {
    assert.equal(escapeField('hello world'), 'hello world');
  });

  it('turns null and undefined into an empty field (not the text "null")', () => {
    assert.equal(escapeField(null), '');
    assert.equal(escapeField(undefined), '');
  });

  it('quotes fields containing a comma', () => {
    assert.equal(escapeField('a,b'), '"a,b"');
  });

  it('doubles inner double quotes and wraps the field', () => {
    assert.equal(escapeField('say "hi"'), '"say ""hi"""');
  });

  it('quotes fields containing line breaks', () => {
    assert.equal(escapeField('line1\nline2'), '"line1\nline2"');
    assert.equal(escapeField('line1\r\nline2'), '"line1\r\nline2"');
  });

  it('converts non-strings to text', () => {
    assert.equal(escapeField(42), '42');
  });
});

describe('toCsv', () => {
  it('has a header that matches the columns', () => {
    assert.equal(HEADER, COLUMNS.join(','));
    assert.equal(toCsv([]), HEADER);
  });

  it('writes one row per todo, in order', () => {
    const csv = toCsv([todo({ id: 'a' }), todo({ id: 'b' })]);
    const lines = csv.split('\n');
    assert.equal(lines.length, 3);
    assert.equal(lines[0], HEADER);
    assert.ok(lines[1].startsWith('a,'));
    assert.ok(lines[2].startsWith('b,'));
  });

  it('writes the exact row for a simple todo', () => {
    assert.equal(
      toCsv([todo()]),
      `${HEADER}\nid-1,Title,Desc,todo,2026-12-01,2026-01-01T00:00:00.000Z,2026-01-01T00:00:01.000Z`
    );
  });

  it('every row has as many fields as the header (no column mismatch)', () => {
    const csv = toCsv([todo(), todo({ description: null, dueDate: null })]);
    for (const line of csv.split('\n')) {
      assert.equal(line.split(',').length, COLUMNS.length, line);
    }
  });

  it('writes empty fields for null description and dueDate', () => {
    const [, row] = toCsv([todo({ description: null, dueDate: null })]).split('\n');
    assert.equal(row, 'id-1,Title,,todo,,2026-01-01T00:00:00.000Z,2026-01-01T00:00:01.000Z');
  });

  it('escapes commas, quotes and newlines in titles and descriptions', () => {
    const csv = toCsv([todo({ title: 'Buy milk, eggs', description: 'He said "now"\nthen left' })]);
    assert.ok(csv.includes('"Buy milk, eggs"'));
    assert.ok(csv.includes('"He said ""now""\nthen left"'));
  });

  it('does not change its input', () => {
    const input = [todo()];
    const copy = JSON.parse(JSON.stringify(input));
    toCsv(input);
    assert.deepEqual(input, copy);
  });
});
