'use strict';
// CALIBRATION FIXTURE (known-bad, deliberately committed): the taxonomy SECOND-DOOR class (Kimi WS0,
// Constitution Rule 22). This file re-declares the shared taxonomy vocabulary that only taxonomy/index.js
// (deriving from facts/vocabulary.js) is allowed to own: a hardcoded multi-segment SECTOR-PATH literal and
// a JURISDICTION_AXES declaration. tools/taxonomy-onedoor/check.js MUST flag both when run with
// --calibrate, or the gate has not earned its zero. This file is never imported by engine code.

// BAD: a real sector-path literal hardcoded outside the taxonomy door (the aesthetics-vs-injectables
// vocabulary that must have ONE source). Should be taxonomy.sectorPath('aesthetics', 'injectables').
const STRAY_SECTOR_PATH = 'healthcare.aesthetics.injectables';

// BAD: a second door for the jurisdiction AXES, re-derived here instead of taxonomy.JurisdictionAxes(...).
const JURISDICTION_AXES = { country: 'US', sub_jurisdiction: 'CA', profession: 'attorney' };

// BAD: an establishment/audience relation literal declared as a local axis constant.
const establishment_jurisdiction = { relation: 'establishment' };

module.exports = { STRAY_SECTOR_PATH, JURISDICTION_AXES, establishment_jurisdiction };
