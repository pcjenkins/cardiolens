# syntax=docker/dockerfile:1
# Multi-stage build: install -> test + build -> small runtime image.

# ---------- 1. dependencies ----------
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---------- 2. test + build ----------
FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Build-time-only secret so pages can compile; the real secret is supplied at runtime.
# `npm run build` triggers `prebuild`, which runs the Jest suite - failing tests fail the image build.
RUN SESSION_SECRET=build-only-placeholder-secret-0000000000 npm run build

# ---------- 3. runtime ----------
FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DB_PATH=/app/db/cardiolens.db

# Standalone server (only the node_modules it actually needs), plus static assets.
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
# Test evidence for this exact image, shown on Admin -> Release test results.
COPY --from=build --chown=node:node /app/data/release ./data/release
# Seed script + its one extra dependency, used on first start to create the database.
COPY --from=build --chown=node:node /app/scripts ./scripts
COPY --from=build --chown=node:node /app/node_modules/bcryptjs ./node_modules/bcryptjs
COPY --chown=node:node docker-entrypoint.sh ./

RUN mkdir -p /app/db && chown node:node /app/db
USER node
EXPOSE 3000
VOLUME ["/app/db"]
ENTRYPOINT ["sh", "./docker-entrypoint.sh"]
