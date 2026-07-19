'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { compose, NOT_LEGAL_ADVICE } = require('./compose.js');
const { validatePayload } = require('../contract');

// ── synthetic fixtures (structural only, no PII, no secrets - Rule 16) ────────────────────────────────
// Catalogue-shaped records: the same field shape the compiled catalogue emits (id, name, citation{act,
// section}, penalty{typical_low,typical_high,statutory_max,currency}, regulator{name}, jurisdiction,
// website_obligations[]). Real-looking law names are illustrative fixtures, not asserted as live law.
function records() {
  return {
    gdpr: { id: 'UK_GDPR_ART13', name: 'UK GDPR Article 13', citation: { act: 'UK GDPR', section: 'Article 13' }, penalty: { typical_low: 5000, typical_high: 20000, statutory_max: 17500000, currency: 'GBP' }, regulator: { name: 'ICO' }, jurisdiction: 'UK', website_obligations: [{ duty: 'a' }, { duty: 'b' }] },
    pecr: { id: 'PECR_R6', name: 'PECR Regulation 6', citation: { act: 'PECR', section: 'Regulation 6' }, penalty: { typical_low: 1000, typical_high: 8000, statutory_max: 500000, currency: 'GBP' }, regulator: { name: 'ICO' }, jurisdiction: 'UK', website_obligations: [{ duty: 'c' }] },
    sra: { id: 'SRA_TX', name: 'SRA Transparency Rules', citation: { act: 'SRA Transparency Rules' }, penalty: { typical_low: null, typical_high: null, statutory_max: null, currency: 'GBP' }, regulator: { name: 'SRA' }, jurisdiction: 'UK', website_obligations: [{ duty: 'd' }] },
  };
}

function facts() {
  return {
    identity: { display_name: { value: 'X Legal LLP' }, legal_name: { value: 'X Legal LLP' }, company_number: { value: '12345678' } },
    jurisdiction: { bound: [{ jurisdiction: 'UK' }] },
    sector: { value: { sector: 'law-firms' } },
  };
}

// A finding with an earning artifact (quote) -> a confident violation.
function quoteViolation(recordId, over) {
  return Object.assign({ record_id: recordId, kind: 'presence-breach', state: 'violation', artifact: { type: 'quote', text: 'evidence span', page_url: 'https://x.test/p' }, page_url: 'https://x.test/p', evidence_quote: 'evidence span' }, over || {});
}

function baseInputs(over) {
  const r = records();
  return Object.assign({
    domain: 'x.test',
    generatedAt: '2026-07-19',
    facts: facts(),
    applicability: { applicable: [r.gdpr, r.pecr, r.sra], excluded: [{ id: 'US_X' }], counts: { frameworksAssessed: 4, frameworksBinding: 3, rulesChecked: 4 } },
    findings: [],
    report: { ran: true },
    coverage: { render_class: 'assessable', reachable: true },
  }, over || {});
}

// ── the brief's mandated tests ────────────────────────────────────────────────────────────────────────

test('full synthetic input composes a contract-valid payload', () => {
  const inputs = baseInputs({
    findings: [quoteViolation('UK_GDPR_ART13'), { record_id: 'PECR_R6', kind: 'observed-behaviour', state: 'violation', artifact: { type: 'network_event', host: 'ga.test', name: '_ga' }, page_url: 'https://x.test/' }],
    seo: { psi: { s: 1 }, cwv: {}, onpage: {}, security: {}, a11y: {}, tech: {}, keywordSummary: {}, psiAudits: {}, keywords: [{ term: 'k' }] },
    geo: { entityReadiness: {}, shareOfVoice: {}, radar: {}, schema: {}, citations: {}, sourceGap: {}, fix: {}, engines: Array.from({ length: 8 }, () => ({})), rootCause: { chain: Array.from({ length: 4 }, () => ({})) } },
    competitors: { bestKeyword: {}, youDr: {}, cols: {}, drBars: {}, rows: [{ name: 'r' }] },
    pricing: [{ tier: 'a' }], trajectory: [{ wk: 1 }], dims: Array.from({ length: 10 }, (_, n) => ({ key: 'd' + n })),
    score: 62, grade: 'C', scoreBand: 'at risk', scoring: { formula: 'f', why: 'w', inputs: 'i', bands: [{ b: 1 }] },
    exec: 'summary', glossary: [{ t: 'x' }], heat: [[1]], heatRows: ['r'], heatCols: ['c'], projected: { wk12: {}, wk24: {} }, fixes: [{ fix: 1 }],
  });
  assert.deepEqual(validatePayload(compose(inputs)), []);
});

test('a compliant firm (zero findings) composes valid; exposure 0, empty waterfall, zero counts', () => {
  const p = compose(baseInputs({ findings: [] }));
  assert.deepEqual(validatePayload(p), []);
  assert.deepEqual(p.findings, []);
  assert.equal(p.exposure.value, 0);
  assert.deepEqual(p.exposureWaterfall, { steps: [], ceiling: null });
  assert.deepEqual(p.counts, { critical: 0, high: 0, standard: 0, total: 0 });
  assert.equal(p.confirmed, 0);
  assert.ok(p.applicability.assessed.every((a) => a.state === 'not_evaluated'));
  assert.deepEqual(p.applicability.assessedCompliant, []);
  assert.equal(p.applicability.excludedCount, 1);
});

test('voice_tier: confident ONLY for a violation carrying a quote/network_event/register_row', () => {
  const earning = ['quote', 'network_event', 'register_row'];
  for (const type of earning) {
    const p = compose(baseInputs({ findings: [{ record_id: 'UK_GDPR_ART13', kind: 'k', state: 'violation', artifact: { type } }] }));
    assert.equal(p.findings[0].voice_tier, 'confident', `${type} violation must be confident`);
  }
  for (const type of ['coverage_proof', 'register_absence']) {
    const p = compose(baseInputs({ findings: [{ record_id: 'UK_GDPR_ART13', kind: 'k', state: 'violation', artifact: { type } }] }));
    assert.equal(p.findings[0].voice_tier, 'observation', `${type} violation is an absence -> observation`);
  }
});

test('voice_tier: a needs_review or pass finding is NEVER confident, whatever its artifact (Rule 10 / C-111)', () => {
  for (const state of ['needs_review', 'pass']) {
    const p = compose(baseInputs({ findings: [{ record_id: 'UK_GDPR_ART13', kind: 'k', state, artifact: { type: 'quote', text: 'q' } }] }));
    assert.equal(p.findings[0].voice_tier, 'observation', `${state} must render observation`);
  }
});

test('counts derivation is deterministic and follows the one mapping (band->critical, no-band->high)', () => {
  const p = compose(baseInputs({ findings: [
    { record_id: 'UK_GDPR_ART13', kind: 'k', state: 'violation', artifact: { type: 'quote', text: 'q' } }, // band -> critical
    { record_id: 'SRA_TX', kind: 'k', state: 'violation', artifact: { type: 'quote', text: 'q' } },        // no band -> high
    { record_id: 'PECR_R6', kind: 'k', state: 'needs_review', artifact: { type: 'coverage_proof' } },       // -> standard
    { record_id: 'PECR_R6', kind: 'k', state: 'pass', artifact: { type: 'quote', text: 'q' } },             // pass -> not counted
  ] }));
  assert.deepEqual(p.counts, { critical: 1, high: 1, standard: 1, total: 3 });
  assert.equal(p.confirmed, 2); // confirmed = number of violations
});

test('not-probed fallbacks: absent probe sections are marked not_probed, noted, and contract-valid', () => {
  const p = compose(baseInputs()); // no seo/geo/competitors/pricing/trajectory/dims/score supplied
  assert.deepEqual(validatePayload(p), []);
  assert.equal(p.seo.keywords[0].state, 'not_probed');
  assert.ok(typeof p.seo.note === 'string' && p.seo.note.length > 0);
  assert.equal(p.geo.engines.length, 8);
  assert.ok(p.geo.engines.every((e) => e.state === 'not_probed'));
  assert.equal(p.geo.rootCause.chain.length, 4);
  assert.equal(p.competitors.rows[0].name, null);
  assert.equal(p.dims.length, 10);
  assert.ok(p.dims.every((d) => d.score === null && d.state === 'not_probed'));
  assert.equal(p.score.state, 'not_probed');
});

test('exposure never sums statutory maxima: headline is the band-midpoint sum, far below the single ceiling (C-094)', () => {
  const hugeA = { id: 'A', name: 'Act A', citation: { act: 'Act A' }, penalty: { typical_low: 1000, typical_high: 2000, statutory_max: 20000000, currency: 'GBP' }, regulator: { name: 'RA' }, jurisdiction: 'UK', website_obligations: [{ duty: 'x' }] };
  const hugeB = { id: 'B', name: 'Act B', citation: { act: 'Act B' }, penalty: { typical_low: 500, typical_high: 1500, statutory_max: 10000000, currency: 'GBP' }, regulator: { name: 'RB' }, jurisdiction: 'UK', website_obligations: [{ duty: 'y' }] };
  const p = compose(baseInputs({
    applicability: { applicable: [hugeA, hugeB], excluded: [], counts: {} },
    findings: [
      { record_id: 'A', kind: 'k', state: 'violation', artifact: { type: 'quote', text: 'q' } },
      { record_id: 'B', kind: 'k', state: 'violation', artifact: { type: 'quote', text: 'q' } },
    ],
  }));
  const headline = p.exposure.value;
  const ceiling = p.exposureWaterfall.ceiling.value;
  assert.equal(headline, 1500 + 1000); // mid(1000,2000)=1500 + mid(500,1500)=1000
  assert.equal(ceiling, 20000000);     // the SINGLE highest maximum, never 20M + 10M
  assert.ok(headline < ceiling);
  assert.notEqual(headline, 30000000); // not the sum of maxima
  assert.notEqual(headline, 20000000); // not a raw statutory cap
});

test('exposure de-dupes to one figure per family (two records, same citation.act -> one step)', () => {
  const a1 = { id: 'GDPR_13', name: 'UK GDPR Art 13', citation: { act: 'UK GDPR', section: 'Art 13' }, penalty: { typical_low: 2000, typical_high: 4000, statutory_max: 17500000, currency: 'GBP' }, regulator: { name: 'ICO' }, jurisdiction: 'UK', website_obligations: [{ duty: 'x' }] };
  const a2 = { id: 'GDPR_14', name: 'UK GDPR Art 14', citation: { act: 'UK GDPR', section: 'Art 14' }, penalty: { typical_low: 3000, typical_high: 9000, statutory_max: 17500000, currency: 'GBP' }, regulator: { name: 'ICO' }, jurisdiction: 'UK', website_obligations: [{ duty: 'y' }] };
  const p = compose(baseInputs({
    applicability: { applicable: [a1, a2], excluded: [], counts: {} },
    findings: [
      { record_id: 'GDPR_13', kind: 'k', state: 'violation', artifact: { type: 'quote', text: 'q' } },
      { record_id: 'GDPR_14', kind: 'k', state: 'violation', artifact: { type: 'quote', text: 'q' } },
    ],
  }));
  assert.equal(p.exposureWaterfall.steps.length, 1); // one family "uk gdpr"
  // the family's band is the worst (max) across its de-duped records; the ceiling is one, not two
  assert.equal(p.exposureWaterfall.ceiling.value, 17500000);
});

test('familyKeyFn injection: a custom family door overrides the default citation.act key', () => {
  const p = compose(baseInputs({
    familyKeyFn: () => 'one-family',
    findings: [quoteViolation('UK_GDPR_ART13'), { record_id: 'PECR_R6', kind: 'k', state: 'violation', artifact: { type: 'quote', text: 'q' } }],
  }));
  assert.equal(p.exposureWaterfall.steps.length, 1); // both collapsed into one injected family
});

test('applicability.assessed carries the worst finding state; assessedCompliant is the pass subset', () => {
  const p = compose(baseInputs({ findings: [
    { record_id: 'UK_GDPR_ART13', kind: 'k', state: 'needs_review', artifact: { type: 'coverage_proof' } },
    { record_id: 'UK_GDPR_ART13', kind: 'k', state: 'violation', artifact: { type: 'quote', text: 'q' } }, // worst wins
    { record_id: 'PECR_R6', kind: 'k', state: 'pass', artifact: { type: 'quote', text: 'q' } },
  ] }));
  const byId = Object.fromEntries(p.applicability.assessed.map((a) => [a.record_id, a.state]));
  assert.equal(byId.UK_GDPR_ART13, 'violation');
  assert.equal(byId.PECR_R6, 'pass');
  assert.equal(byId.SRA_TX, 'not_evaluated'); // no finding -> not_evaluated
  assert.deepEqual(p.applicability.assessedCompliant.map((a) => a.record_id), ['PECR_R6']);
});

test('framework cards read catalogue facts off the record and group their findings; screened when clean', () => {
  const p = compose(baseInputs({ findings: [quoteViolation('UK_GDPR_ART13')] }));
  const gdpr = p.frameworks.find((c) => c.code === 'UK_GDPR_ART13');
  assert.equal(gdpr.name, 'UK GDPR Article 13');
  assert.equal(gdpr.regulator, 'ICO');
  assert.equal(gdpr.citation, 'UK GDPR, Article 13');
  assert.equal(gdpr.state, 'violation');
  assert.equal(gdpr.findings.length, 1);
  const sra = p.frameworks.find((c) => c.code === 'SRA_TX');
  assert.equal(sra.state, 'screened'); // assessed, no breach
  assert.deepEqual(sra.findings, []);
});

test('the three framework counts read connect() counts VERBATIM, and fall back to the same door when absent', () => {
  const verbatim = compose(baseInputs());
  assert.equal(verbatim.frameworksAssessed, 4);
  assert.equal(verbatim.frameworksBinding, 3);
  assert.equal(verbatim.rulesChecked, 4);
  const noCounts = compose(baseInputs({ applicability: { applicable: records() && [records().gdpr, records().pecr, records().sra], excluded: [{ id: 'z' }], counts: {} } }));
  assert.equal(noCounts.frameworksBinding, 3);        // applicable.length
  assert.equal(noCounts.frameworksAssessed, 4);       // applicable + excluded
  assert.equal(noCounts.rulesChecked, 2 + 1 + 1);     // sum of website_obligations
});

test('screenedLabel reflects the site-level coverage state (honest limited-read marker)', () => {
  assert.equal(compose(baseInputs({ coverage: { render_class: 'assessable', reachable: true } })).screenedLabel, 'Screened the catalogue');
  assert.equal(compose(baseInputs({ coverage: { render_class: 'screened', reachable: false } })).screenedLabel, 'Screened the catalogue on a limited read of your site');
  assert.equal(compose(baseInputs({ coverage: { site: { reachable: false } } })).screenedLabel, 'Screened the catalogue on a limited read of your site');
});

// ── DEFECT-6: an absent/failed browser lane is a LOUD payload-level caveat, never a silent pass ────────

test('DEFECT-6: no stageManifest supplied -> coverageCaveats is an empty array (never a throw, never a fabricated caveat)', () => {
  const p = compose(baseInputs());
  assert.deepEqual(p.coverageCaveats, []);
});

test('DEFECT-6: both browser lanes ran clean -> coverageCaveats stays empty', () => {
  const p = compose(baseInputs({ stageManifest: [{ stage: 'observe', ran: true, reason: null }, { stage: 'domAssert', ran: true, reason: null }] }));
  assert.deepEqual(p.coverageCaveats, []);
});

test('DEFECT-6: an absent observe lane (playwright-unavailable) projects a LOUD, human-readable caveat into the payload', () => {
  const p = compose(baseInputs({ stageManifest: [{ stage: 'observe', ran: false, reason: 'playwright-unavailable' }, { stage: 'domAssert', ran: true, reason: null }] }));
  assert.equal(p.coverageCaveats.length, 1);
  assert.deepEqual(p.coverageCaveats[0].lane, 'observe');
  assert.equal(p.coverageCaveats[0].reason, 'playwright-unavailable');
  assert.match(p.coverageCaveats[0].message, /did not run/);
  assert.match(p.coverageCaveats[0].message, /not.*read as a clean result/);
});

test('DEFECT-6: both browser lanes failing (goto error, DEFECT-1 class) each produce their own caveat', () => {
  const p = compose(baseInputs({ stageManifest: [
    { stage: 'observe', ran: false, reason: 'error' },
    { stage: 'domAssert', ran: false, reason: 'error' },
    { stage: 'crawl', ran: true, reason: null }, // a non-browser lane is never projected here
  ] }));
  assert.equal(p.coverageCaveats.length, 2);
  assert.deepEqual(p.coverageCaveats.map((c) => c.lane).sort(), ['domAssert', 'observe']);
});

test('DEFECT-6: coverageCaveats survives the contract validator (additive, non-required field)', () => {
  const p = compose(baseInputs({ stageManifest: [{ stage: 'observe', ran: false, reason: 'deadline' }] }));
  assert.deepEqual(validatePayload(p), []);
});

test('notLegalAdvice is the one canonical standing line: one sentence, British English, no em dash', () => {
  const p = compose(baseInputs());
  assert.equal(p.notLegalAdvice, NOT_LEGAL_ADVICE);
  assert.ok(p.notLegalAdvice.length > 0);
  assert.ok(!p.notLegalAdvice.includes('—')); // no em dash
  assert.equal((p.notLegalAdvice.match(/\./g) || []).length, 1); // exactly one full stop -> one sentence
});

test('meta reads the facts projection (one door): name, sector, country, and the caller\'s date', () => {
  const p = compose(baseInputs());
  assert.equal(p.meta.company, 'X Legal LLP');
  assert.equal(p.meta.sector, 'law-firms');
  assert.equal(p.meta.country, 'UK');
  assert.equal(p.meta.date, '2026-07-19'); // verbatim generatedAt, no clock
  assert.deepEqual(p.jurisdiction.bound, ['UK']);
});

test('compose does NOT mutate its inputs', () => {
  const inputs = baseInputs({ findings: [quoteViolation('UK_GDPR_ART13')] });
  const snapshot = structuredClone(inputs);
  compose(inputs);
  assert.deepEqual(inputs, snapshot);
});

test('the composer source contains NO clock (no Date.now, no new Date) - determinism (Rule 11 spirit)', () => {
  for (const file of ['compose.js', 'sections.js', 'util.js']) {
    const src = fs.readFileSync(path.join(__dirname, file), 'utf8');
    assert.ok(!/\bDate\.now\b/.test(src), `${file} must not call Date.now`);
    assert.ok(!/\bnew\s+Date\b/.test(src), `${file} must not construct a Date`);
  }
});

test('the schema + contract selftest passes (B1 benchmark, invoked here as a gate)', () => {
  // exits 0 on success; execFileSync throws on a non-zero exit, failing this test.
  const out = execFileSync('node', [path.join(__dirname, '..', 'contract', 'index.js'), '--selftest'], { encoding: 'utf8' });
  assert.match(out, /selftest OK/);
  assert.match(out, /schema v1\.2\.0 in sync/); // v1.2 (P6, DEFECT-6): coverageCaveats[] added, purely additive
});

// ── KNOWN-BAD calibration fixtures (the earn-your-zero cases: compose must FAIL closed, never ship) ─────

test('KNOWN-BAD: a finding with no artifact fails closed (Rule 3: no artifact, no breach)', () => {
  assert.throws(
    () => compose(baseInputs({ findings: [{ record_id: 'UK_GDPR_ART13', kind: 'k', state: 'violation' /* no artifact */ }] })),
    /no artifact, no breach/,
  );
});

test('KNOWN-BAD: a supplied section that breaks an exact-count invariant fails closed at the validator', () => {
  // geo.engines must be exactly 8; a caller handing 5 must not slip through - compose re-validates and throws.
  assert.throws(
    () => compose(baseInputs({ geo: { entityReadiness: {}, shareOfVoice: {}, radar: {}, schema: {}, citations: {}, sourceGap: {}, fix: {}, engines: [{}, {}, {}, {}, {}], rootCause: { chain: [{}, {}, {}, {}] } } })),
    /contract-invalid payload/,
  );
});

test('KNOWN-BAD: a construction that would wear confident voice on a non-violation is impossible (defence in depth)', () => {
  // projectFinding can never assign confident to a non-violation, so this asserts the internal guard by
  // driving a normal needs_review finding and confirming the guard holds end to end.
  const p = compose(baseInputs({ findings: [{ record_id: 'UK_GDPR_ART13', kind: 'k', state: 'needs_review', artifact: { type: 'quote', text: 'q' } }] }));
  assert.equal(p.findings[0].voice_tier, 'observation');
});
