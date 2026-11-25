'use strict';

const COLUMNS = ['id', 'title', 'description', 'state', 'dueDate', 'createdAt', 'updatedAt'];

/**
 * Escapes one CSV field (RFC 4180): null/undefined become an empty field, and
 * fields containing a comma, double quote or line break are wrapped in double
 * quotes with inner quotes doubled.
 */
function escapeField(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Converts a list of todos to CSV text: a header row plus one row per todo. */
function toCsv(todos) {
  const rows = todos.map((todo) => COLUMNS.map((column) => escapeField(todo[column])));
  return [COLUMNS, ...rows].map((row) => row.join(',')).join('\n');
}

module.exports = { COLUMNS, escapeField, toCsv };
