# syntax=docker/dockerfile:1
# Web tier (Next.js). Multi-stage: install -> test + build -> small runtime image.

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts: the root postinstall installs the API package, which has its own image.
RUN npm ci --ignore-scripts

FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# `npm run build` triggers `prebuild`, which runs the Jest suite - failing tests fail the image build.
RUN SESSION_SECRET=build-only-placeholder-secret-0000000000 npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/data/release ./data/release
USER node
EXPOSE 3000
CMD ["node", "server.js"]
