import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';

export class HttpError extends Error {
  status: number;
  details?: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const notFound = (what = 'Record') => new HttpError(404, `${what} not found`);

interface PgError {
  code: string;
  detail?: string;
  constraint?: string;
  column?: string;
}

const isPgError = (err: unknown): err is PgError =>
  typeof err === 'object' && err !== null && typeof (err as PgError).code === 'string' &&
  /^[0-9A-Z]{5}$/.test((err as PgError).code);

/** Turns database errors into clear HTTP responses. */
function fromPg(err: PgError): HttpError | null {
  switch (err.code) {
    case '23505': // unique_violation
      return new HttpError(409, 'A record with that value already exists', { constraint: err.constraint, detail: err.detail });
    case '23503': // foreign_key_violation
      return /still referenced/.test(err.detail ?? '')
        ? new HttpError(409, 'This record is still used by other records', { detail: err.detail })
        : new HttpError(400, 'A referenced record does not exist', { detail: err.detail });
    case '23001': // restrict_violation
      return new HttpError(409, 'This record is still used by other records', { detail: err.detail });
    case '23502': // not_null_violation
      return new HttpError(400, `${err.column ?? 'A field'} is required`);
    case '23514': // check_violation
      return new HttpError(400, 'A value is not allowed', { constraint: err.constraint });
    case '22P02': // invalid_text_representation
    case '22007': // invalid_datetime_format
    case '22008': // datetime_field_overflow
    case '22003': // numeric_value_out_of_range
    case '22001': // string_data_right_truncation
      return new HttpError(400, 'A value has the wrong format');
    default:
      return null;
  }
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  let httpErr: HttpError;
  if (err instanceof HttpError) {
    httpErr = err;
  } else if (err instanceof ZodError) {
    httpErr = new HttpError(400, 'Invalid request', err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  } else if (err?.type === 'entity.parse.failed') {
    httpErr = new HttpError(400, 'Request body is not valid JSON');
  } else if (isPgError(err) && fromPg(err)) {
    httpErr = fromPg(err)!;
  } else {
    console.error(err);
    httpErr = new HttpError(500, 'Something went wrong');
  }
  res.status(httpErr.status).json({ error: { message: httpErr.message, details: httpErr.details } });
};
