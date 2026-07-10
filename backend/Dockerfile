# OrbitOps backend — runs the Node + TypeScript service via tsx (zero build step).
# At runtime, provide AUDIT_HMAC_KEY (required in prod) and DATABASE_URL (managed
# Postgres); without DATABASE_URL it falls back to local pglite.
FROM node:22-slim

WORKDIR /app

# Install deps first for layer caching.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# pglite (dev/demo DB) writes to DATA_DIR at runtime; make it writable by the
# non-root user. Ignored when DATABASE_URL points at managed Postgres.
RUN mkdir -p /app/.data && chown -R node:node /app/.data

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8790
ENV DATA_DIR=/app/.data/pgdata
EXPOSE 8790

# Non-root for safety.
USER node

CMD ["npm", "start"]
