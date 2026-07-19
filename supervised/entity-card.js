'use strict';
// supervised/entity-card.js - projects the harness's facts doors (facts/identity.js, facts/jurisdiction.js,
// facts/sector.js - already the ONE door for each of these facts, Rule 1) into the compact "entity card"
// the orchestrator (Claude, stages 6/7) is handed instead of the raw bundle (spec section 2's context-
// hygiene doctrine: "Claude sees the entity card, candidate findings with their spans, and targeted
// excerpts. Whole-HTML context is where hallucinated findings come from."). This module RE-DERIVES
// nothing - every field is read straight off the fact envelope its one door already produced.

// factSummary(fact) -> { value, confidence } | null, tolerant of an absent/malformed fact envelope (a
// harness run over a partially-unreadable site must still produce SOME entity card, honestly marked).
function factSummary(fact) {
  if (!fact || typeof fact !== 'object') return null;
  return { value: fact.value === undefined ? null : fact.value, confidence: fact.confidence || 'abstain' };
}

// identityCardOf(identity) -> the entity card's `identity` section, tolerant of an absent envelope.
function identityCardOf(identity) {
  const id = identity || {};
  return {
    display_name: factSummary(id.display_name),
    legal_name: factSummary(id.legal_name),
    company_number: factSummary(id.company_number),
    registered_office: factSummary(id.registered_office),
  };
}

// jurisdictionCardOf(jurisdiction) -> the entity card's `jurisdiction` section, tolerant of an absent
// envelope; `bound` entries are projected to just the fields the card needs (never the raw fact object).
function jurisdictionCardOf(jurisdiction) {
  const j = jurisdiction || {};
  const bound = Array.isArray(j.bound) ? j.bound.map((b) => ({ jurisdiction: b.jurisdiction, confidence: b.confidence, tier_evidence: b.tier_evidence || [] })) : [];
  const serves = Array.isArray(j.serves) ? j.serves.slice() : [];
  return { bound, serves };
}

// sectorCardOf(sector) -> the entity card's `sector` section, tolerant of an absent envelope.
function sectorCardOf(sector) {
  const s = sector || {};
  return { value: s.value || null, conflict_flag: Boolean(s.conflict_flag), contradictions: Array.isArray(s.contradictions) ? s.contradictions : [] };
}

// buildEntityCard(facts) -> { domain, identity, jurisdiction, sector, capabilities }. `facts` is exactly
// the object mint/index.js's runFactsDoors() produces ({ identity, jurisdiction, sector, capabilities }) -
// this module is a pure, read-only projection of it, never a second identity/jurisdiction/sector resolver.
function buildEntityCard(facts) {
  const f = facts || {};
  return {
    domain: (f.identity && f.identity.domain) || null,
    identity: identityCardOf(f.identity),
    jurisdiction: jurisdictionCardOf(f.jurisdiction),
    sector: sectorCardOf(f.sector),
    capabilities: f.capabilities || null,
  };
}

module.exports = { buildEntityCard, factSummary };
