// Lab 7: Prometheus metrics. GET /metrics exposes RED metrics per route (rate, errors,
// duration histogram), optimistic-lock conflicts, DB pool state and default Node.js process metrics.
import client from 'prom-client';
import { allDbs } from './db.js';

export const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry, prefix: 'traveler_' });

const httpDuration = new client.Histogram({
  name: 'traveler_http_request_duration_seconds',
  help: 'HTTP request duration by route, method and status code',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.2, 0.5, 1, 2.5],
  registers: [registry],
});

export const conflicts = new client.Counter({
  name: 'traveler_optimistic_lock_conflicts_total',
  help: 'PUT /api/travel-plans/:id answered 409 because the version was stale',
  registers: [registry],
});

new client.Gauge({
  name: 'traveler_db_pool_connections',
  help: 'node-postgres pool connections by state (summed over all databases)',
  labelNames: ['state'],
  registers: [registry],
  collect() {
    const pools = allDbs().map((db) => db.pool).filter(Boolean);
    const sum = (k) => pools.reduce((s, p) => s + (p[k] || 0), 0);
    this.set({ state: 'total' }, sum('totalCount'));
    this.set({ state: 'idle' }, sum('idleCount'));
    this.set({ state: 'waiting' }, sum('waitingCount'));
  },
});

// Express middleware: label by the matched route pattern (e.g. /api/travel-plans/:id), not the raw
// URL, so UUIDs do not create a time series per request.
export function httpMetrics(req, res, next) {
  const end = httpDuration.startTimer();
  res.on('finish', () => {
    const route = req.route ? req.baseUrl + req.route.path : (res.statusCode === 404 ? 'unmatched' : req.path);
    end({ method: req.method, route, status: res.statusCode });
    if (res.statusCode === 409) conflicts.inc();
  });
  next();
}
