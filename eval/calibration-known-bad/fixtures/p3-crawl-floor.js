'use strict';
// SEEDED KNOWN-BAD (P3, caution.md budget-floor / Constitution Rule 8). DO NOT import or run this.
// It exists so tools/domain-gates/budget-caps.js --calibrate proves it can still see the class E-236
// deleted: a Math.max FLOOR on a time budget, and a deadline literal above the 120s hard cap. A gate
// that reports zero on this file has not earned its green (Constitution Rule 4).

// (1) The exact E-236 regression: a 45s / 20s FLOOR on the SPA-render deadline via Math.max. A budget is
//     a cap, never a minimum - a few shells must not always cost the floor.
function renderTail(deadlineMs, toRender, pool, renderPage) {
  return pool(toRender, 12, Math.max(20000, Math.floor(deadlineMs * 0.6)), renderPage);
}

// (2) A floor imposed by binding name (the value initialises a timeout). Wrapped in a function so the
//     other operand is a defined parameter (lint-clean); budget-caps still flags the Math.max floor by the
//     "timeoutMs" binding name.
function perStepTimeout(someComputedBudget) {
  const timeoutMs = Math.max(5000, someComputedBudget);
  return timeoutMs;
}

// (3) A deadline literal above the 120s hard-deadline cap (the 752s stuck-Chromium class).
function slowStep(fn) {
  return setTimeout(fn, 200000);
}

// (4) An oversize ms-budget named with the `*_MS` / `*Ms` SUFFIX and NO budget word (close/settle are not
//     in the word list): the exact CONFIDENT-ZERO class the gate missed before isBudgetName recognised
//     the millisecond suffix (caution.md C-203). A gate that reports zero on these has not earned its green.
const DEFAULT_CLOSE_MS = 200000;
function forceCloseCeiling(closeMs) {
  return closeMs || DEFAULT_CLOSE_MS;
}

module.exports = { renderTail, perStepTimeout, slowStep, forceCloseCeiling, DEFAULT_CLOSE_MS };
