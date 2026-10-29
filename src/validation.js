import { ValidationError } from './errors.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const MAX_MONEY = 99999999.99; // DECIMAL(10,2)

export const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);

function isRealDate(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

// Field rules. Each returns an error string or null; `null` values are allowed for optional fields.
const rules = {
  text: (max) => (v) => (typeof v !== 'string' ? 'must be a string'
    : v.trim().length === 0 ? 'must not be blank'
    : max && v.length > max ? `must be at most ${max} characters` : null),
  optionalText: (v) => (typeof v === 'string' ? null : 'must be a string'),
  date: (v) => {
    const m = typeof v === 'string' && v.match(DATE_RE);
    return m && isRealDate(+m[1], +m[2], +m[3]) ? null : 'must be a valid date (YYYY-MM-DD)';
  },
  datetime: (v) => {
    const m = typeof v === 'string' && v.match(DATETIME_RE);
    const ok = m && isRealDate(+m[1], +m[2], +m[3]) && +m[4] < 24 && +m[5] < 60 && +(m[6] || 0) < 60;
    return ok ? null : 'must be a valid ISO 8601 date-time';
  },
  money: (v) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return 'must be a number';
    if (v < 0) return 'must not be negative';
    if (v > MAX_MONEY) return `must not exceed ${MAX_MONEY}`;
    if (Math.abs(Math.round(v * 100) - v * 100) > 1e-6) return 'must have at most 2 decimal places';
    return null;
  },
  range: (min, max) => (v) => (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max
    ? null : `must be a number between ${min} and ${max}`),
  currency: (v) => (typeof v === 'string' && /^[A-Z]{3}$/.test(v) ? null : 'must be a 3-letter uppercase ISO code'),
  boolean: (v) => (typeof v === 'boolean' ? null : 'must be a boolean'),
  positiveInt: (v) => (Number.isInteger(v) && v > 0 ? null : 'must be a positive integer'),
};

const PLAN_FIELDS = {
  title: rules.text(200),
  description: rules.optionalText,
  start_date: rules.date,
  end_date: rules.date,
  budget: rules.money,
  currency: rules.currency,
  is_public: rules.boolean,
};

const LOCATION_FIELDS = {
  name: rules.text(200),
  address: rules.optionalText,
  latitude: rules.range(-90, 90),
  longitude: rules.range(-180, 180),
  arrival_date: rules.datetime,
  departure_date: rules.datetime,
  budget: rules.money,
  notes: rules.optionalText,
};

const NULLABLE = new Set(['description', 'start_date', 'end_date', 'budget',
  'address', 'latitude', 'longitude', 'arrival_date', 'departure_date', 'notes']);

// Picks only known fields from body, validates them, and returns the clean object.
function pick(body, fields, required) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new ValidationError(['request body must be a JSON object']);
  }
  const errors = [];
  const out = {};
  for (const [name, check] of Object.entries(fields)) {
    if (!(name in body) || body[name] === undefined) {
      if (required.includes(name)) errors.push(`${name} is required`);
      continue;
    }
    const value = body[name];
    if (value === null) {
      if (NULLABLE.has(name)) out[name] = null; else errors.push(`${name} must not be null`);
      continue;
    }
    const err = check(value);
    if (err) errors.push(`${name} ${err}`); else out[name] = typeof value === 'string' && name !== 'notes' && name !== 'description' ? value.trim() : value;
  }
  return { out, errors };
}

function checkOrder(errors, obj, from, to) {
  if (obj[from] && obj[to] && new Date(obj[to]) < new Date(obj[from])) {
    errors.push(`${to} must not be before ${from}`);
  }
}

export function validatePlanCreate(body) {
  const { out, errors } = pick(body, PLAN_FIELDS, ['title']);
  checkOrder(errors, out, 'start_date', 'end_date');
  if (errors.length) throw new ValidationError(errors);
  return out;
}

export function validatePlanUpdate(body) {
  const { out, errors } = pick(body, PLAN_FIELDS, []);
  checkOrder(errors, out, 'start_date', 'end_date');
  const version = body && body.version;
  if (version === undefined || version === null) errors.push('version is required for optimistic locking');
  else if (rules.positiveInt(version)) errors.push('version must be a positive integer');
  if (errors.length) throw new ValidationError(errors);
  return { fields: out, version };
}

export function validateLocationCreate(body) {
  const { out, errors } = pick(body, LOCATION_FIELDS, ['name']);
  checkOrder(errors, out, 'arrival_date', 'departure_date');
  if (errors.length) throw new ValidationError(errors);
  return out;
}

export function validateLocationUpdate(body) {
  const { out, errors } = pick(body, LOCATION_FIELDS, []);
  checkOrder(errors, out, 'arrival_date', 'departure_date');
  if (body && body.visit_order !== undefined) {
    if (rules.positiveInt(body.visit_order)) errors.push('visit_order must be a positive integer');
    else out.visit_order = body.visit_order;
  }
  if (errors.length) throw new ValidationError(errors);
  return out;
}

export function validatePagination(q) {
  const page = q.page === undefined ? 1 : Number(q.page);
  const limit = q.limit === undefined ? 20 : Number(q.limit);
  const errors = [];
  if (!Number.isInteger(page) || page < 1) errors.push('page must be a positive integer');
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) errors.push('limit must be an integer between 1 and 100');
  if (errors.length) throw new ValidationError(errors);
  return { page, limit };
}
