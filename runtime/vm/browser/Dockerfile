# runtime/vm/browser/Dockerfile - warm Playwright chromium pool, memory-capped.
#
# Uses Playwright's official image (bundles a matched Chromium build + all OS deps, avoiding the
# usual apt dependency drift). dumb-init is included in the base image; docker-compose.yml also
# sets `init: true` as a second, host-level PID 1 reaper - belt and braces for zombie Chromium
# renderer processes.

FROM mcr.microsoft.com/playwright:v1.49.0-jammy

RUN groupadd -r tamazia && useradd -r -g tamazia -G audio,video tamazia \
  && mkdir -p /data/har && chown -R tamazia:tamazia /data/har /home/pwuser 2>/dev/null || true

WORKDIR /app
COPY runtime/vm/browser/server.js ./server.js
COPY runtime/vm/browser/package.json ./package.json
RUN npm install --omit=dev --no-audit --no-fund

USER tamazia
ENV NODE_ENV=production
EXPOSE 3500

CMD ["node", "server.js"]
