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

// buildEntityCard(facts) -> { domain, identity, jurisdiction, sector, capabilities }. `facts` is exactly
// the object mint/index.js's runFactsDoors() produces ({ identity, jurisdiction, sector, capabilities }) -
// this module is a pure, read-only projection of it, never a second identity/jurisdiction/sector resolver.
function buildEntityCard(facts) {
  const f = facts || {};
  return {
    domain: (f.identity && f.identity.domain) || null,
    identity: {
      display_name: factSummary(f.identity && f.identity.display_name),
      legal_name: factSummary(f.identity && f.identity.legal_name),
      company_number: factSummary(f.identity && f.identity.company_number),
      registered_office: factSummary(f.identity && f.identity.registered_office),
    },
    jurisdiction: {
      bound: Array.isArray(f.jurisdiction && f.jurisdiction.bound)
        ? f.jurisdiction.bound.map((b) => ({ jurisdiction: b.jurisdiction, confidence: b.confidence, tier_evidence: b.tier_evidence || [] }))
        : [],
      serves: Array.isArray(f.jurisdiction && f.jurisdiction.serves) ? f.jurisdiction.serves.slice() : [],
    },
    sector: {
      value: (f.sector && f.sector.value) || null,
      conflict_flag: Boolean(f.sector && f.sector.conflict_flag),
      contradictions: Array.isArray(f.sector && f.sector.contradictions) ? f.sector.contradictions : [],
    },
    capabilities: f.capabilities || null,
  };
}

module.exports = { buildEntityCard, factSummary };
