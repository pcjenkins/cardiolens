# syntax=docker/dockerfile:1
# Data tier (Express + Apollo GraphQL). Build context is the repo root (docker-compose sets it).
FROM node:22-bookworm-slim
WORKDIR /app/api
ENV NODE_ENV=production API_HOST=0.0.0.0 API_PORT=4000
COPY api/package.json api/package-lock.json ./
RUN npm ci --include=dev          # tsx runs the TypeScript directly
COPY api/ ./
USER node
EXPOSE 4000
# First start on an empty database: build schema + demo data, then serve.
CMD ["sh", "-c", "npx tsx scripts/ensure-seeded.ts && npx tsx src/server.ts"]
