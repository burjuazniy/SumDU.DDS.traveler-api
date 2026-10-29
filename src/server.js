import { createApp } from './app.js';
import { config } from './config.js';
import { pool } from './db.js';

const server = createApp().listen(config.port, () => {
  console.log(`TravelerAPI listening on http://0.0.0.0:${config.port}`);
});

// Keep-alive longer than typical load balancer idle timeouts; lets k6 reuse connections.
server.keepAliveTimeout = 65_000;

const shutdown = (signal) => {
  console.log(`${signal} received, shutting down`);
  server.close(() => pool.end().then(() => process.exit(0)));
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
