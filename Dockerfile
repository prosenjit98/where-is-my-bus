# syntax=docker/dockerfile:1
#
# Where Is My Bus server, for a Linux host. The server runs its TypeScript directly on Node 22
# (type stripping), and serves the rider web app, the owners' dashboard and the admin panel itself:
# there is no build step, only the backend's two runtime dependencies (pg, redis) to install.
#
#   docker build -t where-is-my-bus .
#   docker run -p 8080:8080 -v wimb-data:/data -e ADMIN_TOKEN=... where-is-my-bus      files in /data
#
# With PostgreSQL and Redis, and one server process per CPU core, use docker-compose.yml.

ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-bookworm-slim AS deps
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:${NODE_VERSION}-bookworm-slim
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    DATA_FILE=/data/network.json
WORKDIR /app

COPY --from=deps /app/backend/node_modules backend/node_modules
COPY backend/package.json backend/
COPY backend/src backend/src
COPY backend/public backend/public
COPY packages/core/package.json packages/core/
COPY packages/core/src packages/core/src
COPY web web
# The demo network, and the city's seed network if there is one (SEED_FILE in docker-compose.yml).
COPY data/demo-network.json data/seed-*.json data/

# Without DATABASE_URL the network and everything else are kept as files here.
RUN mkdir -p /data && chown node:node /data
VOLUME /data
USER node
EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 8080) + '/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"

# One process. docker-compose.yml runs backend/src/cluster.ts instead: one per core, sharing
# their live buses through Redis.
CMD ["node", "--disable-warning=ExperimentalWarning", "backend/src/server.ts"]
