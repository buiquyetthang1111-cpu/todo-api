'use strict';

/** Thrown when client input is invalid. The HTTP layer maps it to 400. */
class ValidationError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = 'ValidationError';
    this.details = details;
  }
}

/** Thrown when a todo does not exist. The HTTP layer maps it to 404. */
class NotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NotFoundError';
  }
}

module.exports = { ValidationError, NotFoundError };
