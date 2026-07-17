'use strict';
// CALIBRATION FIXTURE (known-bad INPUT, self-testing dialect) for evidence/browser/observe.js.
//
// THE DISEASE (caution.md C-040): a stuck Chromium once held a mint hostage for 752 seconds because
// the browser's own goto timeout did not bound launch + networkidle. observe() must make that
// STRUCTURALLY IMPOSSIBLE: its ONE outer Promise.race deadline covers launch -> observe -> close, so
// a browser that never returns from goto is refused with lane:{ran:false, reason:'deadline'} rather
// than hanging the mint. This fixture is the seeded proof: a scripted browser whose goto NEVER
// settles. The gate (observe's deadline) EARNS ITS ZERO only if it refuses this hang.
//
// DIALECT (earn-your-zero polarity, matching the p1-jurisdiction fixture and run.js semantics):
//   calibrate() returns a findings ARRAY - one finding when the trap is CORRECTLY refused, an EMPTY
//   array (misses written to stderr) when observe() failed to bound the hang. A strict runner that
//   requires non-empty findings therefore fails exactly when the deadline has regressed.
//   Standalone: `node eval/calibration-known-bad/fixtures/p3-browser-deadline.js` exits 1 on a miss.
//
// The fixture GUARDS ITSELF against a true hang: it races observe() against a wall-clock guard, so a
// regression that makes observe() hang is reported as a MISS, never an actual hang of this process.

const path = require('path');
const { observe } = require(path.resolve(__dirname, '..', '..', '..', 'evidence', 'browser', 'observe.js'));

const DEADLINE_MS = 25;   // a tiny CAP for the fixture; the real default is 45000 (a cap, never a floor)
const GUARD_MS = 1500;    // generous wall-clock guard for a loaded CI runner; far below the 752s class

// A scripted browser whose page.goto() NEVER settles - the exact 752s shape, in a fake.
function hangingLaunch() {
  const page = {
    on() {},
    goto() { return new Promise(() => {}); }, // HANG: never resolves, no timer
    async settle() {},
    async cookies() { return []; },
    async findConsentControl() { return null; },
    async clickConsent() {},
  };
  return async function launch() {
    return { async newPage() { return page; }, async close() {} };
  };
}

async function runTrials() {
  const misses = [];
  const started = Date.now();
  const guard = new Promise((resolve) => { setTimeout(() => resolve({ __hung: true }), GUARD_MS); });
  const result = await Promise.race([
    observe('https://hang.example', { launchBrowser: hangingLaunch(), deadlineMs: DEADLINE_MS, closeMs: 100 }),
    guard,
  ]);
  if (result.__hung) {
    misses.push('deadline: observe() did not return within ' + GUARD_MS + 'ms on a hanging browser - the outer Promise.race deadline is broken (the 752s class is back)');
    return misses;
  }
  const lane = result.lane || {};
  if (!(lane.ran === false && lane.reason === 'deadline')) {
    misses.push('deadline: observe() returned lane ' + JSON.stringify(lane) + ' on a hanging browser; expected {ran:false, reason:"deadline"}');
  }
  const wall = Date.now() - started;
  if (wall >= GUARD_MS) misses.push('deadline: observe() took ' + wall + 'ms, past the ' + GUARD_MS + 'ms guard');
  return misses;
}

async function calibrate() {
  const misses = await runTrials();
  if (misses.length > 0) {
    for (const m of misses) console.error('MISSED TRAP ' + m);
    return [];
  }
  return [{
    file: __filename,
    rule: 'p3-browser-deadline',
    message: 'trap caught: a hanging browser is refused with lane.reason=deadline (C-040 / Rule 9)',
  }];
}

module.exports = { hangingLaunch, runTrials, calibrate, DEADLINE_MS, GUARD_MS };

if (require.main === module) {
  calibrate().then((findings) => {
    if (findings.length === 0) {
      console.error('p3-browser-deadline: trap MISSED - the outer deadline did not bound a hanging browser');
      process.exit(1);
    }
    console.log(JSON.stringify({ checker: 'p3-browser-deadline', findings }));
    process.exit(0);
  });
}
