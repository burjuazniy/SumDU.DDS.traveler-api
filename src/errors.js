export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export class ValidationError extends HttpError {
  constructor(details) {
    super(400, `Validation error: ${details.join('; ')}`, { details });
  }
}

export class NotFoundError extends HttpError {
  constructor(what) {
    super(404, `${what} not found`);
  }
}

export class ConflictError extends HttpError {
  constructor(currentVersion) {
    super(409, 'Conflict: travel plan was modified by another user', {
      current_version: currentVersion,
      message: 'Reload the plan and apply your changes to the current version.',
    });
  }
}

// PostgreSQL error codes that mean "the client sent bad data", not "the server broke".
const PG_CLIENT_ERRORS = {
  '23514': 'check constraint violated', // check_violation (e.g. departure < arrival)
  '23502': 'required field is missing', // not_null_violation
  '22P02': 'invalid value format',      // invalid_text_representation
  '22007': 'invalid date/time format',  // invalid_datetime_format
  '22008': 'date/time out of range',    // datetime_field_overflow
  '22003': 'numeric value out of range',// numeric_value_out_of_range
};

export function fromPgError(err) {
  const reason = PG_CLIENT_ERRORS[err.code];
  if (!reason) return null;
  return new ValidationError([err.constraint ? `${reason} (${err.constraint})` : reason]);
}
