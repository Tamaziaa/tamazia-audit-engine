'use strict';
// eval/reality-corpus/lib/metrics.js - pure scoring functions over ONE site's corpus label + engine
// output. No I/O, no LLM, no network: every function here is a pure function of its arguments, so the
// scorer itself is unit-testable (metrics.test.js) independently of the engine and of the corpus files.
//
// This is the empirical half of caution.md #258 ("a margin-blind abstain gate passed 1,699 unit tests,
// two reviewers and CodeScene, and destroyed 8 of 11 real audits. Oracles measure the map. Only the
// corpus measures the territory."): eval/calibration-known-bad/ and the rest of the fleet are the map;
// this file is one of the two pieces of machinery (with run.js) that measures the territory.

// SECTOR_FAMILY_ALIAS - the corpus YAML records an informal `sector_paths` entry like
// "legal.solicitors" or "financial-services.claims-management"; facts/sector.js emits a canonical
// FAMILY key off facts/vocabulary.js's tree ('law-firms', 'healthcare', 'finance', ...). The alias
// table is the one place that maps corpus-label vocabulary to engine vocabulary; it does not invent a
// second vocabulary door (Rule 1 is about CLIENT-FACING facts - this is a test-fixture label mapping).
const SECTOR_FAMILY_ALIAS = {
  legal: 'law-firms',
  healthcare: 'healthcare',
  'financial-services': 'finance',
  finance: 'finance',
};

function expectedFamilyOf(site) {
  const first = Array.isArray(site.sector_paths) && site.sector_paths.length > 0 ? site.sector_paths[0] : null;
  if (!first) return null;
  const head = String(first).split('.')[0];
  return SECTOR_FAMILY_ALIAS[head] || head;
}

// sectorTop1(site, emittedSector) -> 'correct' | 'abstain' | 'wrong' | 'not_labelled'
// emittedSector is facts.sector.value ({sector, sub_sector}) or null (the door's own abstain signal).
function sectorTop1(site, emittedSector, familyOf) {
  const expected = expectedFamilyOf(site);
  if (!expected) return 'not_labelled';
  if (!emittedSector || !emittedSector.sector) return 'abstain';
  const family = familyOf(emittedSector.sector);
  return family === expected ? 'correct' : 'wrong';
}

// jurisdictionEstablishmentBind(site, boundList) -> {expected:[...], bound:[...], recall, precision}
// boundList is facts.jurisdiction.bound.map(b => b.jurisdiction) (country/sub-jurisdiction codes the
// engine actually bound). Establishment recall/precision, per the corpus's `establishment[]` labels.
function jurisdictionEstablishmentBind(site, boundList) {
  const expected = (Array.isArray(site.establishment) ? site.establishment : [])
    .map((e) => e && e.jurisdiction).filter(Boolean);
  const bound = Array.isArray(boundList) ? boundList.filter(Boolean) : [];
  const expectedSet = new Set(expected);
  const boundSet = new Set(bound);
  const hit = expected.filter((j) => boundSet.has(j));
  const wrongAttach = bound.filter((j) => !expectedSet.has(j));
  return {
    expected,
    bound,
    recall: expected.length === 0 ? null : hit.length / expected.length,
    wrong_attach_count: wrongAttach.length,
    wrong_attach: wrongAttach,
  };
}

// applicabilityRecall(site, applicableRecordIds, catalogueIds) -> per-site applicability numbers,
// splitting labelled law_ids into three buckets so a Layer-1 catalogue gap (the law does not exist yet)
// is never counted as a Layer-2 applicability miss (the engine had a record and failed to bind it) -
// the 6-layer taxonomy the empirical audits use throughout EMPIRICAL-BREACH-AUDITS/*.md.
function applicabilityRecall(site, applicableRecordIds, catalogueIds) {
  const labelled = Array.isArray(site.applicable_law_ids) ? [...new Set(site.applicable_law_ids)] : [];
  const catalogueSet = new Set(catalogueIds || []);
  const applicableSet = new Set(applicableRecordIds || []);
  const catalogueGaps = labelled.filter((id) => !catalogueSet.has(id));
  const assessable = labelled.filter((id) => catalogueSet.has(id));
  const bound = assessable.filter((id) => applicableSet.has(id));
  const notBound = assessable.filter((id) => !applicableSet.has(id));
  return {
    labelled_count: labelled.length,
    catalogue_gaps: catalogueGaps,
    assessable_count: assessable.length,
    bound,
    not_bound: notBound,
    recall: assessable.length === 0 ? null : bound.length / assessable.length,
  };
}

// findingQuoteText(finding) -> the best-effort evidence string carried on an adjudicated finding, for
// substring-matching against a corpus label's quote_substring. Findings are enriched candidates (see
// eval/e2e/lib/pipeline.js's enrichVerifiedCandidates + breach/adjudicator/adjudicate.js's in-place
// stampers), so the quote can live in several fields depending on artifact kind; this checks them in a
// fixed, documented order and never throws on a missing field.
function findingQuoteText(finding) {
  if (!finding) return '';
  const a = finding.artifact || {};
  return String(finding.evidence_quote || a.text || a.snippet || a.quote || a.host || a.url || '');
}

// breachCoverage(site, findings) -> coverage-adjusted recall per the Kimi blueprint section 3.4:
// recall = caught / (labelled INTERSECT assessable). "Assessable" here means the breach lane actually
// produced SOME candidate/verdict for that law_id (propose+verify+adjudicate all ran for the firm) -
// a labelled breach whose only detection surface is a lane that did not run (e.g. the browser/network
// lane, when this corpus's snapshot carries no bundle.browser) is UNASSESSABLE, not MISSED: scoring it
// as missed would overclaim precision this harness cannot actually measure from a static snapshot (see
// eval/reality-corpus/README.md's replay-mode limitation).
function breachCoverage(site, findings, breachLaneComplete) {
  const labelled = Array.isArray(site.labelled_breaches) ? site.labelled_breaches : [];
  const byRecord = new Map();
  for (const f of (Array.isArray(findings) ? findings : [])) {
    const id = f && f.record_id;
    if (!id) continue;
    if (!byRecord.has(id)) byRecord.set(id, []);
    byRecord.get(id).push(f);
  }
  const rows = labelled.map((lb) => {
    const candidates = byRecord.get(lb.law_id) || [];
    const violationHit = candidates.find((f) => f.state === 'violation'
      && (lb.quote_substring == null || findingQuoteText(f).toLowerCase().includes(String(lb.quote_substring).toLowerCase())));
    let status;
    if (violationHit) status = 'reproduced';
    else if (!breachLaneComplete) status = 'unassessable_lane_incomplete';
    else if (candidates.length === 0) status = lb.quote_substring == null ? 'unassessable_unlabelled_quote' : 'missed';
    else status = 'missed';
    return { law_id: lb.law_id, url: lb.url || null, status };
  });
  const assessable = rows.filter((r) => r.status === 'reproduced' || r.status === 'missed');
  const reproduced = rows.filter((r) => r.status === 'reproduced');
  return {
    rows,
    labelled_count: rows.length,
    assessable_count: assessable.length,
    reproduced_count: reproduced.length,
    coverage_adjusted_recall: assessable.length === 0 ? null : reproduced.length / assessable.length,
  };
}

// falseAccusations(site, findings) -> violations against a law the corpus has verified this firm is
// CLEAN on (known_clean_laws), independent of whether that law is also one of the site's labelled
// breaches for a DIFFERENT record. Any hit here is the hard, zero-tolerance gate (Kimi blueprint
// section 3.4/3.6: "precision = 100% ... any false accusation fails the build outright").
function falseAccusations(site, findings) {
  const cleanSet = new Set(Array.isArray(site.known_clean_laws) ? site.known_clean_laws : []);
  const hits = [];
  for (const f of (Array.isArray(findings) ? findings : [])) {
    if (f && f.state === 'violation' && f.record_id && cleanSet.has(f.record_id)) {
      hits.push({ law_id: f.record_id, quote: findingQuoteText(f).slice(0, 200) });
    }
  }
  return hits;
}

module.exports = {
  SECTOR_FAMILY_ALIAS,
  expectedFamilyOf,
  sectorTop1,
  jurisdictionEstablishmentBind,
  applicabilityRecall,
  findingQuoteText,
  breachCoverage,
  falseAccusations,
};
