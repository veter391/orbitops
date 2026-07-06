# OrbitOps backend — runs the Node + TypeScript service via tsx (zero build step).
# At runtime, provide AUDIT_HMAC_KEY (required in prod) and DATABASE_URL (managed
# Postgres); without DATABASE_URL it falls back to local pglite.
FROM node:22-slim

WORKDIR /app

# Install deps first for layer caching.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8790
EXPOSE 8790

# Non-root for safety.
USER node

CMD ["npm", "start"]
