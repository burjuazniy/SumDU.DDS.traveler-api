# syntax=docker/dockerfile:1

# ---- deps: production dependencies only, cached while package*.json are unchanged
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ---- runtime: minimal image, runs as the unprivileged "node" user
FROM node:24-alpine AS runtime
ENV NODE_ENV=production \
    PORT=4567
WORKDIR /app
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node db ./db
USER node
EXPOSE 4567
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:4567/health || exit 1
CMD ["node", "src/server.js"]
