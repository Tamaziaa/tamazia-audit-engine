# runtime/vm/worker/Dockerfile - pipeline step-function worker container.
#
# Runs runtime/queue/steps against pg-boss. Node 24, per the engine-wide "Node 24" rule. This
# image is built from the repo root context in production (see bootstrap.sh) so it can COPY the
# real runtime/queue directory; the placeholder CMD below is staged until that wiring lands.

FROM node:24-alpine

RUN addgroup -S tamazia && adduser -S tamazia -G tamazia
WORKDIR /app

COPY runtime/queue/package.json ./runtime/queue/package.json
RUN cd runtime/queue && npm install --omit=dev --no-audit --no-fund

COPY runtime/queue ./runtime/queue

USER tamazia

# Placeholder entrypoint: starts a pg-boss consumer bound to each stage queue once NEON_URL and
# WS0's payload contract are wired. Staged as a healthcheck-only loop so `docker compose config`
# and a smoke `docker compose up` both succeed without a live database.
CMD ["node", "-e", "console.log('tamazia-runtime worker staged - see runtime/queue/steps/index.js'); setInterval(() => {}, 60000);"]
