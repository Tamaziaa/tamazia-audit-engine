'use strict';
// facts/entity/reasons.js — the entity-resolution lane's applicability reason enum (Kimi
// KIMI-FINAL-BATCH-2026-07-20.md E15). This repo has no central applicability/reasons.js door today
// (applicability/connect.js builds its gate-failure reason strings inline); this file is the ONE new
// door for the three reason strings the entity lane adds, so a consumer (a future gate, a render
// banner) never re-types the literal string a second time (Rule 1).

const ENTITY_REASONS = Object.freeze({
  ESTABLISHMENT_UNRESOLVED: 'establishment_unresolved',
  REGISTER_UNREACHABLE: 'register_unreachable',
  EVIDENCE_ABSENT: 'evidence_absent',
});

module.exports = { ENTITY_REASONS };
