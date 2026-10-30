import express from 'express';
import { allDbs } from './db.js';
import { HttpError, NotFoundError, ValidationError, fromPgError } from './errors.js';
import { config } from './config.js';
import { httpMetrics, registry } from './metrics.js';
import {
  isUuid, validateLocationCreate, validateLocationUpdate, validatePagination,
  validatePlanCreate, validatePlanUpdate,
} from './validation.js';

// STORAGE=relational (labs 1-7: locations table) or jsonb (lab 8: locations inside travel_plans).
const repoDir = config.storage === 'jsonb' ? './repositories/jsonb' : './repositories';
const plans = await import(`${repoDir}/plans.js`);
const locations = await import(`${repoDir}/locations.js`);

const startedAt = Date.now();

// Wraps async handlers so rejected promises reach the error middleware.
const route = (fn) => (req, res, next) => fn(req, res, next).catch(next);

const requireUuid = (what) => (req, _res, next) => {
  next(isUuid(req.params.id) ? undefined : new NotFoundError(what));
};

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false);

  // XSS hardening: the API only ever answers JSON, and browsers are told not to sniff or frame it.
  app.use((_req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
      'Referrer-Policy': 'no-referrer',
    });
    next();
  });
  app.use(httpMetrics);
  app.use(express.json({ limit: '100kb' }));

  // Prometheus scrape endpoint (lab 7). Not routed through the public load balancer in production.
  app.get('/metrics', route(async (_req, res) => {
    res.set('Content-Type', registry.contentType).send(await registry.metrics());
  }));

  app.get('/health', route(async (_req, res) => {
    const t0 = process.hrtime.bigint();
    try {
      await Promise.all(allDbs().map((db) => db.query('SELECT 1')));
      const responseTime = Number(process.hrtime.bigint() - t0) / 1e6;
      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: Date.now() - startedAt,
        database: { status: 'healthy', responseTime },
      });
    } catch {
      res.status(503).json({
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        uptime: Date.now() - startedAt,
        database: { status: 'unhealthy' },
      });
    }
  }));

  app.get('/api/travel-plans', route(async (req, res) => {
    const paging = validatePagination(req.query);
    const { items, total } = await plans.listPlans(paging);
    res.set('X-Total-Count', String(total)).json(items);
  }));

  app.post('/api/travel-plans', route(async (req, res) => {
    res.status(201).json(await plans.createPlan(validatePlanCreate(req.body)));
  }));

  app.get('/api/travel-plans/:id', requireUuid('Travel plan'), route(async (req, res) => {
    res.json(await plans.getPlanWithLocations(req.params.id));
  }));

  app.put('/api/travel-plans/:id', requireUuid('Travel plan'), route(async (req, res) => {
    const { fields, version } = validatePlanUpdate(req.body);
    res.json(await plans.updatePlan(req.params.id, fields, version));
  }));

  app.delete('/api/travel-plans/:id', requireUuid('Travel plan'), route(async (req, res) => {
    await plans.deletePlan(req.params.id);
    res.status(204).end();
  }));

  app.post('/api/travel-plans/:id/locations', requireUuid('Travel plan'), route(async (req, res) => {
    const fields = validateLocationCreate(req.body);
    res.status(201).json(await locations.addLocation(req.params.id, fields));
  }));

  app.put('/api/locations/:id', requireUuid('Location'), route(async (req, res) => {
    res.json(await locations.updateLocation(req.params.id, validateLocationUpdate(req.body)));
  }));

  app.delete('/api/locations/:id', requireUuid('Location'), route(async (req, res) => {
    await locations.deleteLocation(req.params.id);
    res.status(204).end();
  }));

  app.use((req, _res, next) => next(new HttpError(404, `Route ${req.method} ${req.path} not found`)));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    let error = err;
    if (err.type === 'entity.parse.failed') error = new ValidationError(['malformed JSON body']);
    else if (!(err instanceof HttpError)) error = fromPgError(err) || err;

    if (error instanceof HttpError) {
      return res.status(error.status).json({ error: error.message, ...error.extra, timestamp: new Date().toISOString() });
    }
    console.error(err);
    return res.status(500).json({ error: 'Internal server error', timestamp: new Date().toISOString() });
  });

  return app;
}
