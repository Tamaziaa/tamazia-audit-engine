'use strict';
/**
 * applicability/connect.js - THE one applicability door (Constitution Rule 13; the P2 applicability-leak
 * killer). The single pure function that decides WHICH catalogue records bind THIS firm.
 *
 * WHY THIS EXISTS: on the old estate the rigorous attachment authority (resolveLaws) was an orphan
 * called only by QA while the live path used a weaker connect() that leaked national law via a
 * supranational code or a bare-token trigger (caution.md C-051/C-053/C-054/C-061..C-064/C-076/C-077;
 * the P0 class where US-legal records fired on a UK firm). This module is the ONE attachment authority,
 * a pure set-membership filter over the fact envelopes and the compiled catalogue: serving a market is
 * never being bound by its law (Rule 13), and applicability is a structural scope filter, NOT an
 * evidence claim (the artifact-gated breach chain downstream is what prevents unfounded findings).
 *
 * PUBLIC API:
 *   connect(facts, catalogue) -> { applicable, excluded, counts }
 *     facts     = { jurisdiction, sector, capabilities } - the EXACT envelopes the facts doors emit.
 *     catalogue = records[] OR { records: [] }            - same tolerance as propose.js recordsForIndex.
 *   applicable : full record objects, INPUT ORDER preserved, never mutated (no copies edited in place).
 *   excluded   : [{ record_id, reason }] where the reason NAMES the failed gate (first failure wins).
 *   counts     : { frameworksAssessed, frameworksBinding, rulesChecked } - catalogueSize is NOT emitted
 *                (caution.md C-118: coverage copy states "screened the catalogue; N bind you", never a
 *                rotting total).
 *
 * THE GATES, IN ORDER (a record is applicable only if EVERY gate passes; the first failure wins the
 * reason). Each reads the record and the fact envelopes; none authors a law fact (Rule 2).
 *   1. JURISDICTION (Rule 13, the leak killer). record.jurisdiction must be a member of the BOUND set
 *      facts.jurisdiction.bound[].jurisdiction. serves[] NEVER attaches anything, under any condition.
 *      Codes on both sides are already the canonical vocabulary enum; compared exactly, never folded.
 *   2. SUB-JURISDICTION. null or 'multi' passes. A specific code (state / free zone) requires an entry
 *      in facts.jurisdiction.sub_jurisdictions[] with that code AND status === 'bound' (advisory never
 *      attaches - the Rule 13 doctrine at state level).
 *   3. DISPLACEMENT. If any BOUND sub_jurisdiction entry carries displaces:[...] containing record.id,
 *      the record is excluded, reason naming the displacing code (the DIFC/ADGM-displaces-AE-federal
 *      doctrine; purely data-driven, no law fact authored here).
 *   4. SECTOR. record.sector containing 'universal' passes regardless of the firm sector (jurisdiction
 *      still gates). Otherwise the firm sector must be resolvable and match: both sides are folded
 *      through the vocabulary/sector ONE door (facts/vocabulary.js canonicalSector plus facts/sector.js
 *      familyOf) so a record authored as 'legal' matches a firm resolved to 'law-firms', and a firm
 *      resolved to a child sector ('dental') matches a parent-family record ('healthcare'). Firm sector
 *      null/abstained: sector-specific records are excluded (nexus unproven, fail-closed), universal
 *      records still pass. record.sub_sector[] empty passes; non-empty requires facts.sector.value.
 *      sub_sector to be a member (a null firm sub_sector fails a restricted record, fail-closed).
 *   5. ACTIVITY TAGS. Empty record.activity_tags passes. Non-empty: excluded ONLY when EVERY listed tag
 *      is affirmatively present === false in facts.capabilities.predicates (the record's activity basis
 *      is disproven across the board). Any tag true proves the basis; tags 'unknown'/missing/null-
 *      capabilities leave it unproven but NOT disproven, and the record stays applicable.
 *   6. REQUIRED NEXUS (the mapping this module owns; the judgement core). record.required_nexus lists
 *      ALTERNATIVE bases; at least ONE must be satisfied for the record's jurisdiction J. THE NORMATIVE
 *      TABLE:
 *        established_in         satisfied ONLY when the bound entry for J carries a Tier A ESTABLISHMENT
 *                               evidence kind: register | incorporated_in | registered_office |
 *                               authorisation | freezone_establishment | eu_membership (for J='EU').
 *                               Tier B/C evidence never satisfies establishment. (These kinds are
 *                               emitted ONLY at Tier A by facts/jurisdiction.js, so kind-membership IS
 *                               the Tier-A-establishment test; a defensive tier!=='B'/'C' guard backs it.)
 *        serves_customers_in    satisfied whenever J is bound (bound already requires 1 Tier A or 2
 *                               Tier B; a firm bound to J serves customers there in the sense this
 *                               nexus screens for).
 *        processes_residents_of satisfied whenever J is bound (a bound firm's website processes that
 *                               jurisdiction's residents' data as a screening matter).
 *      A record listing ONLY established_in therefore binds only firms with Tier A establishment
 *      evidence in J. A record listing established_in + serves_customers_in binds any firm bound to J.
 *
 * EXPLICIT SCOPE LIMITS (structural gates only; the applicability-leak class is closed structurally):
 *  - applies_when / excluded_when are free-text prose and are NOT evaluated here (not machine-evaluable;
 *    no LLM in a pure door). They remain context for the adjudicator downstream.
 *  - Supersession is not structurally encoded in the schema today (prose only); conflicts.js does NOT
 *    decide supersession - it only groups same-statute records for counting.
 *
 * DOCTRINE: pure and synchronous over its arguments. No fs, no network, no clock, no env, no module-
 * scope mutable state (the sweep's no-module-state and deadline-audit gates police this). Holds NO law
 * name, fine, regulator or citation literal (Rule 2): every decision reads the record and the envelopes,
 * and every enum it folds against (sector, sub-sector, jurisdiction, nexus) comes from facts/vocabulary.js.
 */

const vocabulary = require('../facts/vocabulary.js');
const sectorFacts = require('../facts/sector.js');
const { SECTOR_UNIVERSAL } = require('../catalogue/schema.js');
const conflicts = require('./conflicts.js');

// The Tier A ESTABLISHMENT evidence kinds (the gate-6 mapping this module owns; see the normative table
// in the header). These are the evidence KINDS facts/jurisdiction.js emits only at Tier A for an
// establishment nexus; they are routing tokens, never law facts. Frozen: read-only module constant.
const ESTABLISHMENT_KINDS = Object.freeze(new Set([
  'register',
  'incorporated_in',
  'registered_office',
  'authorisation',
  'freezone_establishment',
  'eu_membership',
]));

// The three GDPR Art.3-style nexus relations, read from the vocabulary door (Rule 1: one door for the
// enum). Named here only so an unknown nexus string in a record is treated fail-closed (never satisfied).
const NEXUS_SERVES = 'serves_customers_in';
const NEXUS_PROCESSES = 'processes_residents_of';
const NEXUS_ESTABLISHED = 'established_in';

// ── input tolerance (mirrors breach/proposers/propose.js recordsForIndex) ─────────────────────────
// recordsOf(catalogue) -> the records[] array from a bare array OR a { records: [] } wrapper, else [].
function recordsOf(catalogue) {
  if (Array.isArray(catalogue)) return catalogue;
  if (catalogue && Array.isArray(catalogue.records)) return catalogue.records;
  return [];
}

// readJurEnvelope(facts) -> facts.jurisdiction as the whole door envelope, or a synthetic
// fail-closed abstained envelope when it is missing/non-object (Rule 4: absence attaches nothing).
// (This module is a CONSUMER of the jurisdiction fact, not a producer - facts/jurisdiction.js is the one
// door; names here deliberately avoid the producer shapes the one-door gate polices.)
function readJurEnvelope(facts) {
  const j = facts && facts.jurisdiction;
  if (!j || typeof j !== 'object') {
    return { bound: [], serves: [], sub_jurisdictions: [], abstained: true, _missing: true };
  }
  return j;
}

// ── firm-side derivations (computed once per connect() call; passed to each gate as a plain context) ──

// firmSectorIdentitySet(sectorFact) -> the Set of canonical sector keys the firm belongs to: its own
// canonical sector PLUS its family ancestor (via facts/sector.js familyOf over the vocabulary tree), so
// a firm resolved to a child sector ('dental') also matches parent-family records ('healthcare'). Both
// folded to canonical so 'legal'-authored and 'law-firms'-resolved agree. null when the sector fact
// abstained/unresolved (a sector-specific record then cannot attach; universal still passes).
function firmSectorIdentitySet(sectorFact) {
  const value = sectorFact && sectorFact.value;
  const raw = value && value.sector;
  if (!raw) return null;
  const set = new Set();
  const canon = vocabulary.canonicalSector(raw);
  if (canon) set.add(canon);
  // familyOf walks UP the vocabulary tree to the top family (the tree is at most two deep -
  // dental/aesthetics -> healthcare - so self + top-family covers every ancestor). It is pure over the
  // frozen tree and cannot throw on a string key. The fold is ONE-DIRECTIONAL: a child firm inherits a
  // parent-family record, but a parent firm never inherits a child-specific record (no over-attach).
  const family = sectorFacts.familyOf(vocabulary.TREE, raw);
  if (family) set.add(vocabulary.canonicalSector(family) || family);
  return set.size ? set : null;
}

// buildContext(facts) -> the firm-side facts each gate reads, computed ONCE. A plain object, never
// mutated after construction (no module-scope state; the whole context is a local of connect()).
function buildContext(facts) {
  const jurisdiction = readJurEnvelope(facts);
  const bound = Array.isArray(jurisdiction.bound) ? jurisdiction.bound : [];
  const boundSet = new Set(bound.map((b) => b && b.jurisdiction).filter(Boolean));
  // boundByCode: jurisdiction code -> its bound entry (for the gate-6 establishment-evidence read).
  const boundByCode = new Map();
  for (const b of bound) {
    if (b && b.jurisdiction && !boundByCode.has(b.jurisdiction)) boundByCode.set(b.jurisdiction, b);
  }
  const subs = Array.isArray(jurisdiction.sub_jurisdictions) ? jurisdiction.sub_jurisdictions : [];
  const boundSubs = subs.filter((s) => s && s.status === 'bound' && typeof s.code === 'string' && s.code);
  const boundSubCodes = new Set(boundSubs.map((s) => s.code));
  // abstained: the envelope says so, or there is simply no bound jurisdiction. Either attaches nothing.
  const abstained = jurisdiction.abstained === true || boundSet.size === 0;
  const sectorFact = facts && facts.sector;
  const firmSectorSet = firmSectorIdentitySet(sectorFact);
  const firmSubSector = sectorFact && sectorFact.value ? sectorFact.value.sub_sector : null;
  const predicates = facts && facts.capabilities && facts.capabilities.predicates
    ? facts.capabilities.predicates
    : null;
  return {
    boundSet, boundByCode, boundSubs, boundSubCodes, abstained,
    envelopeMissing: jurisdiction._missing === true,
    firmSectorSet, firmSubSector, predicates,
  };
}

// ── the six gates (each returns null on pass, or a reason string naming the failed gate) ──────────

// GATE 1: jurisdiction (Rule 13). No bound jurisdiction anywhere attaches nothing; otherwise the
// record's jurisdiction must be BOUND. serves[] is never consulted.
function gateBound(record, ctx) {
  if (ctx.abstained) {
    const why = ctx.envelopeMissing
      ? 'no jurisdiction envelope was supplied'
      : 'the jurisdiction fact abstained (no bound jurisdiction)';
    return 'gate-1 jurisdiction unbound (' + why + '); no catalogue record can attach (Rule 13: law attaches on evidence, and there is none)';
  }
  if (!ctx.boundSet.has(record.jurisdiction)) {
    return 'gate-1 jurisdiction ' + JSON.stringify(record.jurisdiction)
      + ' is not in the firm bound set [' + Array.from(ctx.boundSet).join(', ')
      + ']; serving a market is never being bound by its law (Rule 13, the applicability-leak class)';
  }
  return null;
}

// GATE 2: sub-jurisdiction. null/'multi'/absent pass (whole-jurisdiction scope). A specific state or
// free-zone code binds ONLY on a bound sub_jurisdiction entry (advisory never attaches).
function gateSubBound(record, ctx) {
  const sj = record.sub_jurisdiction;
  if (sj === null || sj === undefined || sj === 'multi') return null;
  if (!ctx.boundSubCodes.has(sj)) {
    return 'gate-2 sub-jurisdiction: record sub_jurisdiction ' + JSON.stringify(sj)
      + ' has no BOUND entry in the firm sub_jurisdictions (a specific state/free-zone code attaches only'
      + ' on bound status, never advisory; Rule 13 at the sub-national level)';
  }
  return null;
}

// GATE 3: displacement. A bound sub_jurisdiction whose displaces[] lists this record's id excludes it
// (the free-zone-displaces-federal doctrine; the displacing code is named from the data).
function gateDisplacement(record, ctx) {
  for (const sub of ctx.boundSubs) {
    if (Array.isArray(sub.displaces) && sub.displaces.includes(record.id)) {
      return 'gate-3 displacement: record ' + JSON.stringify(record.id)
        + ' is displaced by bound sub-jurisdiction ' + JSON.stringify(sub.code)
        + ' (its displaces set lists this record; at most one regime attaches, never a stack)';
    }
  }
  return null;
}

// recordSectorMatches(record, ctx) -> true when the firm's sector identity set intersects the record's
// (canonicalised) sectors. Universal is handled by the caller before this is reached.
function recordSectorMatches(record, ctx) {
  const sectors = Array.isArray(record.sector) ? record.sector : [];
  for (const s of sectors) {
    if (s === SECTOR_UNIVERSAL) return true;
    const canon = vocabulary.canonicalSector(s);
    if (canon && ctx.firmSectorSet.has(canon)) return true;
  }
  return false;
}

// GATE 4: sector (+ sub-sector). Universal passes the sector half regardless. A sector-specific record
// needs a resolved firm sector that matches (through the vocabulary/sector one door). The sub-sector
// restriction then applies to whatever passed the sector half (empty passes; non-empty needs the firm
// sub-sector to be a member; a null firm sub-sector fails a restricted record, fail-closed).
function gateSector(record, ctx) {
  const sectors = Array.isArray(record.sector) ? record.sector : [];
  const universal = sectors.includes(SECTOR_UNIVERSAL);
  if (!universal) {
    if (!ctx.firmSectorSet) {
      return 'gate-4 sector: the firm sector is unresolved/abstained; a sector-specific record cannot'
        + ' attach (its sector nexus is unproven, fail-closed) while universal records still pass';
    }
    if (!recordSectorMatches(record, ctx)) {
      return 'gate-4 sector: firm sector [' + Array.from(ctx.firmSectorSet).join(', ')
        + '] does not match record sectors [' + sectors.join(', ') + ']';
    }
  }
  return gateSubSector(record, ctx);
}

// gateSubSector(record, ctx) -> the sub-sector half of gate 4. ANCESTOR-AWARE (P6 connection-integrity):
// the classifier only ever emits a detection-tree LEAF sub-sector (injectables, general-practice,
// solicitors), while the catalogue restricts records with the coarse PARENT label (aesthetics, dental,
// law-firms), a SYNONYM (gp-clinic, attorney), or the leaf. Exact set membership therefore stranded 9 of
// 12 uk-healthcare tags and every us-legal record (empirical-healthcare D4). The bind test is folded
// through facts/vocabulary.js#subSectorBinds (the ONE door for the relation): a tag binds when it is the
// firm's exact leaf, a canonical sector/family the firm belongs to (ctx.firmSectorSet, the same set the
// sector half already built), or a synonym of the firm's leaf. This never over-binds across sectors: the
// sector half of gate 4 has already run, so the firm's sector matches the record's. A null firm
// sub-sector still fails a restricted record fail-closed (a restricted record needs a proven sub-sector).
function gateSubSector(record, ctx) {
  const sub = Array.isArray(record.sub_sector) ? record.sub_sector : [];
  if (sub.length === 0) return null;
  if (!ctx.firmSubSector) {
    return 'gate-4 sub-sector: record is restricted to sub-sectors [' + sub.join(', ')
      + '] but the firm sub-sector is unresolved/null (fail-closed: a restricted record needs a proven sub-sector)';
  }
  if (!vocabulary.subSectorBinds(sub, ctx.firmSubSector, ctx.firmSectorSet)) {
    return 'gate-4 sub-sector: firm sub-sector ' + JSON.stringify(ctx.firmSubSector)
      + ' (sector [' + Array.from(ctx.firmSectorSet || []).join(', ') + ']) is not the leaf, a parent'
      + ' sector/family, or a synonym of any record sub-sector [' + sub.join(', ') + ']';
  }
  return null;
}

// GATE 5: activity tags. Empty passes. Non-empty is excluded ONLY when the corpus AFFIRMATIVELY
// disproves EVERY listed tag (present === false for all). 'unknown'/missing/null-capabilities is
// unproven, not disproven, and never excludes (applicability is a scope filter, not an evidence claim).
function gateActivity(record, ctx) {
  const tags = Array.isArray(record.activity_tags) ? record.activity_tags : [];
  if (tags.length === 0) return null;
  const everyTagDisproven = tags.every((tag) => {
    const predicate = ctx.predicates && ctx.predicates[tag];
    return Boolean(predicate) && predicate.present === false;
  });
  if (everyTagDisproven) {
    return 'gate-5 activity: every activity tag [' + tags.join(', ')
      + '] is affirmatively present:false in the firm capabilities; the record activity basis is disproven across the board';
  }
  return null;
}

// hasEstablishmentEvidence(boundEntry) -> true when the bound entry carries a Tier A establishment
// evidence kind (the gate-6 established_in test). Tier B/C is explicitly rejected (defence in depth:
// the establishment KINDS are Tier-A-exclusive in the producer, and a stated B/C tier can never pass).
function hasEstablishmentEvidence(boundEntry) {
  const evidence = boundEntry && Array.isArray(boundEntry.tier_evidence) ? boundEntry.tier_evidence : [];
  return evidence.some((e) => e && ESTABLISHMENT_KINDS.has(e.kind) && e.tier !== 'B' && e.tier !== 'C');
}

// nexusSatisfied(nexus, boundEntry) -> is ONE nexus basis satisfied for the record's (bound) jurisdiction.
// serves_customers_in and processes_residents_of hold whenever J is bound (gate 1 already proved it);
// established_in additionally needs Tier A establishment evidence; any other string is fail-closed.
function nexusSatisfied(nexus, boundEntry) {
  if (nexus === NEXUS_SERVES || nexus === NEXUS_PROCESSES) return true;
  if (nexus === NEXUS_ESTABLISHED) return hasEstablishmentEvidence(boundEntry);
  return false;
}

// GATE 6: required nexus (any-of). At least one listed nexus must be satisfied for the record's
// jurisdiction. Reached only after gate 1 passed, so the bound entry always exists.
function gateNexus(record, ctx) {
  const nexus = Array.isArray(record.required_nexus) ? record.required_nexus : [];
  const boundEntry = ctx.boundByCode.get(record.jurisdiction);
  if (nexus.some((n) => nexusSatisfied(n, boundEntry))) return null;
  return 'gate-6 required-nexus: none of [' + nexus.join(', ') + '] is satisfied for jurisdiction '
    + JSON.stringify(record.jurisdiction) + ' (established_in needs Tier A establishment evidence: '
    + Array.from(ESTABLISHMENT_KINDS).join(' / ') + '; serves_customers_in / processes_residents_of'
    + ' hold on a bound jurisdiction)';
}

// evaluateRecord(record, ctx) -> the reason this record does NOT bind, or null when every gate passes.
// The || chain is the gate order; the FIRST failing gate wins the reason (Constitution: first failure
// wins). Gate 1 is evaluated by the caller because it also decides the frameworksAssessed universe.
function evaluateRemainingGates(record, ctx) {
  return gateSubBound(record, ctx)
    || gateDisplacement(record, ctx)
    || gateSector(record, ctx)
    || gateActivity(record, ctx)
    || gateNexus(record, ctx);
}

// obligationCount(record) -> the number of website_obligations a record carries (what propose will
// actually evaluate). Summed over the applicable set into counts.rulesChecked.
function obligationCount(record) {
  return Array.isArray(record.website_obligations) ? record.website_obligations.length : 0;
}

// recordIdOf(record) -> the record's id for the excluded[] entry, or null for a malformed record.
function recordIdOf(record) {
  return record && typeof record === 'object' && record.id != null ? record.id : null;
}

// ── the door ──────────────────────────────────────────────────────────────────────────────────────
// connect(facts, catalogue) -> { applicable, excluded, counts }. Pure; input order preserved; records
// never mutated. See the header for the gate contract and the nexus mapping table.
function connect(facts, catalogue) {
  const records = recordsOf(catalogue);
  const ctx = buildContext(facts);

  const applicable = [];
  const excluded = [];
  const gate1Passers = []; // records past gate 1 (jurisdiction) - the firm's EXAMINED law landscape

  for (const record of records) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      excluded.push({ record_id: recordIdOf(record), reason: 'gate-0 shape: not a catalogue record object' });
      continue;
    }
    const jurReason = gateBound(record, ctx);
    if (jurReason) {
      excluded.push({ record_id: recordIdOf(record), reason: jurReason });
      continue;
    }
    gate1Passers.push(record);
    const reason = evaluateRemainingGates(record, ctx);
    if (reason) {
      excluded.push({ record_id: recordIdOf(record), reason });
      continue;
    }
    applicable.push(record);
  }

  // Counts, each provable from the inputs (caution.md C-073 dedupe, C-117 one counts object, C-118 no
  // catalogueSize). frameworksAssessed counts distinct families among gate-1 passers; frameworksBinding
  // among the final applicable set; rulesChecked sums the obligations propose will evaluate.
  const frameworksAssessed = conflicts.familyCount(gate1Passers);
  const frameworksBinding = conflicts.familyCount(applicable);
  if (frameworksBinding > frameworksAssessed) {
    // applicable is a subset of gate-1 passers, so its family set is a subset too. A violation here is a
    // construction bug in this module, not possible input - throw rather than emit a false count (Rule 4).
    throw new Error('applicability/connect.js: frameworksBinding (' + frameworksBinding
      + ') exceeds frameworksAssessed (' + frameworksAssessed + '); the binding set is not a subset of the assessed set (construction bug)');
  }
  const rulesChecked = applicable.reduce((sum, record) => sum + obligationCount(record), 0);

  return {
    applicable,
    excluded,
    counts: { frameworksAssessed, frameworksBinding, rulesChecked },
  };
}

module.exports = {
  connect,
  ESTABLISHMENT_KINDS,
  // exported for white-box unit tests + reuse (one door for each gate predicate)
  firmSectorIdentitySet,
  hasEstablishmentEvidence,
  nexusSatisfied,
};
