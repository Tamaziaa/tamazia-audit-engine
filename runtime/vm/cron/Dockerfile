# runtime/vm/cron/Dockerfile - cron: citator nightly, canary audits, corpus replay.
#
# Uses busybox's crond (already in the alpine base) rather than a second npm cron library -
# consistent with the zero-runtime-dependency default. Each job is a plain Node script invoked by
# crond; job logic lives in runtime/vm/cron/jobs/*.js, staged as placeholders that call
# Healthchecks.io on success/failure.
#
# The full `runtime/` directory structure is preserved under /app (not flattened) so that each
# job's relative require('../../../observability/healthchecks.js') resolves identically inside the
# container and inside a plain `node --test` run in this worktree - one relative-path contract,
# not two.

FROM node:24-alpine

RUN addgroup -S tamazia && adduser -S tamazia -G tamazia
WORKDIR /app

COPY runtime/vm/cron/crontab /etc/crontabs/tamazia
COPY runtime/vm/cron/jobs ./runtime/vm/cron/jobs
COPY runtime/observability ./runtime/observability

# crond must run as root to read /etc/crontabs, but each job script itself runs as `tamazia` via
# `su-exec` at invocation time (crontab lines below call `su-exec tamazia node ...`).
RUN apk add --no-cache su-exec

CMD ["crond", "-f", "-l", "8"]
