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

// (2) A floor imposed by binding name (the value initialises a timeout).
const timeoutMs = Math.max(5000, someComputedBudget());

// (3) A deadline literal above the 120s hard-deadline cap (the 752s stuck-Chromium class).
function slowStep(fn) {
  return setTimeout(fn, 200000);
}

module.exports = { renderTail, timeoutMs, slowStep };
