'use strict';
// runtime/vm/cron/jobs/corpus-replay.js - nightly holdout eval against the hand-labelled corpus.
//
// Real implementation invokes the engine's eval/reference-set and eval/calibration-known-bad
// tooling against the P0-19 hand-labelled corpus once it exists, from the VM rather than only from
// CI, so drift is caught even between pull requests. Staged placeholder: proves the cron ->
// Healthchecks.io round trip only.

const { withHealthcheck } = require('../../../observability/healthchecks.js');

async function run() {
  console.log('corpus-replay: staged placeholder, no real replay performed yet (P0-19 corpus pending)');
  return { replayed: 0, staged: true };
}

if (require.main === module) {
  withHealthcheck(process.env.HEALTHCHECKS_PING_URL, run)
    .then((r) => console.log('corpus-replay done', r))
    .catch((err) => {
      console.error('corpus-replay failed', err);
      process.exitCode = 1;
    });
}

module.exports = { run };
