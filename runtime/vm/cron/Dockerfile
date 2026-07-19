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

# Ownership so the non-root `tamazia` user (below) can read its own crontab and job sources; busybox
# crond also refuses a crontab file it does not consider safe (root- or owner-writable only).
RUN chown -R tamazia:tamazia /etc/crontabs/tamazia /app

# busybox crond resolves /etc/crontabs/<name> to a system account by filename and, for EVERY job it
# runs, unconditionally calls initgroups()+setgid()+setuid() to that account before exec'ing the
# job shell (this happens even when crond is already running as that same account - there is no
# "already this user, skip" fast path in busybox's change_identity()). initgroups()/setgroups() is
# gated purely on the CAP_SETGID capability on Linux, not on whether the target list matches the
# caller's current groups, so this daemon does need SOME elevated capability even though the
# crontab here only ever names its own account (`tamazia`) - full root is not that capability,
# though: CAP_SETUID + CAP_SETGID are the entire ask. Those two, and only those two, are granted at
# the orchestration layer (`runtime/vm/docker-compose.yml`'s `cap_drop: [ALL]` + `cap_add:
# [SETGID, SETUID]` on the `cron` service) instead of running this container as UID 0, so it never
# holds CAP_SYS_ADMIN, CAP_NET_RAW, CAP_DAC_OVERRIDE or any other part of root's surface. crond's
# own privilege check runs before it execs the job's shell, so by the time a job script starts it
# is already `tamazia`; no `su-exec` (or other second privilege-drop) is needed or used in
# runtime/vm/cron/crontab, because a second attempt after that first exec would no longer have the
# capability available and would only add a fragile step for no behavioural gain.
USER tamazia

CMD ["crond", "-f", "-l", "8"]
