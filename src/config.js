// All settings come from the environment so the same code runs natively and in Docker.
const env = process.env;

const databaseUrl = env.DATABASE_URL ||
  `postgres://${env.DB_USER || 'travel'}:${env.DB_PASSWORD || 'travel'}@${env.DB_HOST || '127.0.0.1'}:${env.DB_PORT || 5432}/${env.DB_NAME || 'travel_planner'}`;

export const config = {
  port: Number(env.PORT || 4567),
  databaseUrl,
  poolSize: Number(env.DB_POOL || 20),
  logLevel: env.LOG_LEVEL || 'info',
};
