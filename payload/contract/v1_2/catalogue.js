'use strict';
// payload/contract/v1_2/catalogue.js - the catalogue index and LawRef / PenaltyRef (Kimi WS0, blueprint
// 2.2). Built from the compiled catalogue artifact (pure; no network). A record "has a penalty" iff
// record.penalty is a non-null object; its one canonical penalty id is CANONICAL_PENALTY_ID (the current
// catalogue carries one penalty block per record and no explicit id). A LawRef/PenaltyRef to an id absent
// from the hash-pinned catalogue THROWS at construction, so a claim on a law that does not exist, or a
// penalty that was never catalogued, is unrepresentable.

const core = require('./core.js');

const { brands, freeze, reqString, CANONICAL_PENALTY_ID } = core;

// recordHasPenalty(record) -> true iff a catalogue record carries a non-null penalty OBJECT (not an array:
// `typeof [] === 'object'`, so an array penalty would otherwise be treated as catalogued - CodeRabbit PR #33).
function recordHasPenalty(record) {
  if (!record || record.penalty == null) return false;
  if (typeof record.penalty !== 'object') return false;
  return !Array.isArray(record.penalty);
}
function catalogueHashOf(cat) {
  const h = typeof cat.content_hash === 'string' && cat.content_hash ? cat.content_hash : null;
  if (!h) throw new Error('buildCatalogueIndex: the compiled catalogue has no content_hash to pin against (Rule 2)');
  return h;
}
function buildCatalogueIndex(compiledCatalogue) {
  const cat = compiledCatalogue || {};
  const catalogue_hash = catalogueHashOf(cat);
  const byId = new Map();
  for (const r of (Array.isArray(cat.records) ? cat.records : [])) {
    if (r && typeof r.id === 'string') byId.set(r.id, r);
  }
  return Object.freeze({
    catalogue_hash,
    hasLaw: (law_id) => byId.has(law_id),
    hasPenalty: (law_id, penalty_id) => penalty_id === CANONICAL_PENALTY_ID && recordHasPenalty(byId.get(law_id)),
    penaltyIdsFor: (law_id) => (recordHasPenalty(byId.get(law_id)) ? [CANONICAL_PENALTY_ID] : []),
    lawCount: byId.size,
  });
}

// assertPinnedIndex(idx, methodName, ctx): the catalogue index is mandatory and hash-pinned; without the
// named resolver there is no LawRef/PenaltyRef (Rule 2).
function assertPinnedIndex(idx, methodName, ctx) {
  if (!idx || typeof idx[methodName] !== 'function') {
    throw new Error(ctx + ': a catalogue index (buildCatalogueIndex) is required - no ' + ctx + ' without a hash-pinned catalogue (Rule 2)');
  }
}

function LawRef(spec, catalogueIndex) {
  const s = spec || {};
  assertPinnedIndex(catalogueIndex, 'hasLaw', 'LawRef');
  reqString(s.law_id, 'law_id', 'LawRef');
  reqString(s.catalogue_hash, 'catalogue_hash', 'LawRef');
  if (!catalogueIndex.hasLaw(s.law_id)) throw new Error('LawRef: law_id ' + JSON.stringify(s.law_id) + ' is not in the compiled catalogue - a claim on a law that does not exist is unrepresentable (blueprint 2.2)');
  if (s.catalogue_hash !== catalogueIndex.catalogue_hash) throw new Error('LawRef: catalogue_hash ' + JSON.stringify(s.catalogue_hash) + ' does not match the pinned catalogue ' + JSON.stringify(catalogueIndex.catalogue_hash));
  return freeze({ law_id: s.law_id, catalogue_hash: s.catalogue_hash }, brands.lawRef);
}

function PenaltyRef(spec, catalogueIndex) {
  const s = spec || {};
  assertPinnedIndex(catalogueIndex, 'hasPenalty', 'PenaltyRef');
  reqString(s.law_id, 'law_id', 'PenaltyRef');
  reqString(s.penalty_id, 'penalty_id', 'PenaltyRef');
  reqString(s.catalogue_hash, 'catalogue_hash', 'PenaltyRef');
  if (s.catalogue_hash !== catalogueIndex.catalogue_hash) throw new Error('PenaltyRef: catalogue_hash ' + JSON.stringify(s.catalogue_hash) + ' does not match the pinned catalogue ' + JSON.stringify(catalogueIndex.catalogue_hash));
  if (!catalogueIndex.hasPenalty(s.law_id, s.penalty_id)) {
    throw new Error('PenaltyRef: penalty ' + JSON.stringify(s.penalty_id) + ' for law ' + JSON.stringify(s.law_id) + ' is not present in the hash-pinned catalogue - a penalty is copied from the catalogue, never generated (blueprint 2.2). Valid penalty ids for this law: [' + catalogueIndex.penaltyIdsFor(s.law_id).join(', ') + ']');
  }
  return freeze({ law_id: s.law_id, penalty_id: s.penalty_id, catalogue_hash: s.catalogue_hash }, brands.penaltyRef);
}

module.exports = { buildCatalogueIndex, LawRef, PenaltyRef };
