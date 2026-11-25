'use strict';

// Pure input validation: no Express, no I/O, no clock. Easy to unit test.

const STATES = ['todo', 'doing', 'done'];
const WRITABLE_FIELDS = ['title', 'description', 'state', 'dueDate'];
const MAX_TITLE_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 2000;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isValidState(value) {
  return typeof value === 'string' && STATES.includes(value);
}

/**
 * Accepts "YYYY-MM-DD" or a full ISO 8601 date-time ("2026-12-01T10:00:00Z").
 * Rejects impossible calendar dates such as 2026-02-30.
 */
function isValidDueDate(value) {
  if (typeof value !== 'string') return false;
  const match =
    /^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2}))?$/.exec(
      value
    );
  if (!match) return false;
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const realDate =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
  return realDate && !Number.isNaN(Date.parse(value));
}

/**
 * Validates a request body for create (requireTitle = true) or update.
 * Returns { errors: string[], value: object } where value holds the
 * cleaned fields that are safe to store.
 */
function validateTodoInput(body, { requireTitle }) {
  const errors = [];
  const value = {};

  if (!isPlainObject(body)) {
    return { errors: ['Request body must be a JSON object'], value };
  }

  for (const key of Object.keys(body)) {
    if (!WRITABLE_FIELDS.includes(key)) {
      errors.push(`Unknown or read-only field: "${key}"`);
    }
  }

  if (Object.hasOwn(body, 'title')) {
    if (typeof body.title !== 'string' || body.title.trim() === '') {
      errors.push('title must be a non-empty string');
    } else if (body.title.trim().length > MAX_TITLE_LENGTH) {
      errors.push(`title must be at most ${MAX_TITLE_LENGTH} characters`);
    } else {
      value.title = body.title.trim();
    }
  } else if (requireTitle) {
    errors.push('title is required');
  }

  if (Object.hasOwn(body, 'description')) {
    if (body.description === null) {
      value.description = null;
    } else if (typeof body.description !== 'string') {
      errors.push('description must be a string or null');
    } else if (body.description.length > MAX_DESCRIPTION_LENGTH) {
      errors.push(`description must be at most ${MAX_DESCRIPTION_LENGTH} characters`);
    } else {
      value.description = body.description;
    }
  }

  if (Object.hasOwn(body, 'state')) {
    if (!isValidState(body.state)) {
      errors.push(`state must be one of: ${STATES.join(', ')}`);
    } else {
      value.state = body.state;
    }
  }

  if (Object.hasOwn(body, 'dueDate')) {
    if (body.dueDate === null) {
      value.dueDate = null;
    } else if (!isValidDueDate(body.dueDate)) {
      errors.push('dueDate must be an ISO 8601 date (YYYY-MM-DD) or date-time, or null');
    } else {
      value.dueDate = body.dueDate;
    }
  }

  if (!requireTitle && errors.length === 0 && Object.keys(value).length === 0) {
    errors.push(`Provide at least one of: ${WRITABLE_FIELDS.join(', ')}`);
  }

  return { errors, value };
}

module.exports = {
  STATES,
  WRITABLE_FIELDS,
  MAX_TITLE_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  isPlainObject,
  isValidState,
  isValidDueDate,
  validateTodoInput,
};
