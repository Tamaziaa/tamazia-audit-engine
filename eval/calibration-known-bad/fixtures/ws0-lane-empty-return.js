'use strict';
// CALIBRATION FIXTURE (known-bad, deliberately committed): the lane-empty-array-return class (Kimi WS0,
// blueprint 2.2 invariant c). An evidence lane's ERROR path returns an empty array as if it were a
// successful value, instead of a typed LaneError (payload/contract/v1_2.js requireBytes). That is exactly
// how "empty-arrays-flowing-as-success" rendered the blank page as clean. tools/lane-empty-gate/check.js
// MUST flag this catch when run with --calibrate, or the gate has not earned its zero. Never imported by
// engine code. The catch calls console.warn (a real recorder) so this is NOT a swallow-gate violation -
// the disease here is the empty-array return, not a silent swallow.

function fetchRequiredSurface(url) {
  try {
    return fetchPagesSomehow(url); // pretend lane fetch
  } catch (e) {
    // BAD: a fetch failure is laundered into an empty-but-successful array. It should return a LaneError so
    // every verdict depending on this surface is unconstructible as clean.
    console.warn('lane fetch failed for ' + url + ': ' + e);
    return [];
  }
}

// a defined helper so the fixture has no undefined reference (eslint no-undef).
function fetchPagesSomehow(url) { throw new Error('unreachable in the fixture: ' + url); }

module.exports = { fetchRequiredSurface };
