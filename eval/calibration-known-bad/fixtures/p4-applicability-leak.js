'use strict';
// CALIBRATION FIXTURE (known-bad INPUT, self-driving dialect) for applicability/connect.js.
//
// THE DISEASE (the P2 applicability-leak class, Constitution Rule 13; caution.md C-051/C-053/C-054/
// C-061..C-064): us-legal records firing on a UK firm. On the old estate a weak connect() attached
// national law off a served market (serves[]), so a UK law firm was told US ABA rules and the CCPA
// applied. This fixture hands the ONE applicability door (applicability/connect.js) a synthetic UK-bound
// firm that ALSO serves the US, and PROVES the door:
//   1. attaches ZERO US records to the UK-bound firm (the leak class caught);
//   2. EXCLUDES a US record with a jurisdiction reason (the gate visibly fired, not silently absent);
//   3. USEFULNESS CONTROL (C-236): still attaches at least one UK universal record (the filter is not
//      vacuously safe by excluding everything - an inert filter must never earn a green);
//   4. attaches NOTHING on an abstained jurisdiction envelope, excluding every record.
// A detector that lets any leg through has not earned its zero (Constitution Rule 4).
//
// EMBEDDED CATALOGUE IS THE MANDATORY PRIMARY PATH: .github/workflows/ci.yml runs this calibration
// BEFORE `npm run catalogue`, so the compiled dist artifact does NOT exist at calibration time. The
// embedded two-record catalogue (a UK universal record + a US record; synthetic ids and act strings, no
// real law name/fine/regulator - Rule 2) is therefore evaluated on EVERY run and is what makes this
// fixture impossible to pass vacuously. The real compiled catalogue is an OPTIONAL SUPPLEMENTARY leg,
// run only when catalogue/dist/catalogue.v1.json is present on disk (e.g. local runs after `npm run
// catalogue`, and benchmark B2's `npm run catalogue && ... run.js --strict`).
//
// DIALECT (matches eval/calibration-known-bad/fixtures/p3-adjudicator-invented-finding.js): calibrate()
// returns findings on a correct catch, [] (misses printed to stderr) on any regression. Standalone:
// `node eval/calibration-known-bad/fixtures/p4-applicability-leak.js` exits 1 on a miss.

const fs = require('fs');
const path = require('path');

const { connect } = require(path.resolve(__dirname, '..', '..', '..', 'applicability', 'connect.js'));
const DIST_PATH = path.resolve(__dirname, '..', '..', '..', 'catalogue', 'dist', 'catalogue.v1.json');

// A synthetic UK-bound facts envelope. bound = UK (Tier A register evidence); serves = US (a served
// market, never a bound one - the exact confusion the leak class made). Sector resolves to a law firm.
function ukBoundFacts() {
  return {
    jurisdiction: {
      bound: [{
        jurisdiction: 'UK',
        tier_evidence: [{ tier: 'A', kind: 'register', weight: 5, source: 'registers.companiesHouse' }],
        confidence: 'register',
        score: 5,
      }],
      serves: [{ jurisdiction: 'US', confidence: 'weak', evidence: [] }],
      sub_jurisdictions: [],
      abstained: false,
    },
    sector: { fact: 'sector', value: { sector: 'law-firms', sub_sector: 'solicitors' }, confidence: 'corroborated' },
    capabilities: null,
  };
}

// An abstained jurisdiction envelope: no bound jurisdiction, so NOTHING may attach (Rule 13).
function abstainedFacts() {
  return {
    jurisdiction: { bound: [], serves: [], sub_jurisdictions: [], abstained: true },
    sector: { fact: 'sector', value: null, confidence: 'abstain' },
    capabilities: null,
  };
}

// The MANDATORY embedded minimal catalogue: one UK universal record and one US record. Synthetic ids and
// act strings only (no real law title/fine/regulator - Rule 2). connect() reads only these fields, so
// this is a complete, self-sufficient two-record world that runs with NO compiled dist artifact present.
function embeddedCatalogue() {
  const obligation = { duty: 'display a synthetic disclosure', elements: ['synthetic element'], evidence_type: 'presence' };
  return [
    {
      id: 'SYNTH_UK_UNIVERSAL', jurisdiction: 'UK', sub_jurisdiction: null,
      sector: ['universal'], sub_sector: [], activity_tags: [], required_nexus: ['serves_customers_in'],
      citation: { act: 'Synthetic UK Universal Rule' }, website_obligations: [obligation],
    },
    {
      id: 'SYNTH_US_ONLY', jurisdiction: 'US', sub_jurisdiction: null,
      sector: ['universal'], sub_sector: [], activity_tags: [], required_nexus: ['serves_customers_in'],
      citation: { act: 'Synthetic US Only Rule' }, website_obligations: [obligation],
    },
  ];
}

function recordsOf(catalogue) {
  return Array.isArray(catalogue) ? catalogue : (catalogue && Array.isArray(catalogue.records) ? catalogue.records : []);
}

// leakLegs(catalogue, label) -> misses[] for legs 1-3 (leak caught, gate fired, usefulness) against one
// catalogue and the UK-bound firm.
function leakLegs(catalogue, label) {
  const misses = [];
  const { applicable, excluded } = connect(ukBoundFacts(), catalogue);

  const usLeaked = applicable.filter((r) => r && r.jurisdiction === 'US');
  if (usLeaked.length > 0) {
    misses.push('[' + label + '] LEAK: ' + usLeaked.length + ' US record(s) attached to a UK-bound firm (ids: '
      + usLeaked.map((r) => r.id).join(', ') + ') - the applicability-leak class (Rule 13)');
  }

  const jurisdictionFired = excluded.some((e) => /gate-1 jurisdiction/.test(e && e.reason ? e.reason : ''));
  if (!jurisdictionFired) {
    misses.push('[' + label + '] the jurisdiction gate did not visibly fire: no excluded entry names gate-1 jurisdiction '
      + '(a silently-absent gate is an unearned zero, Rule 4)');
  }

  const ukUniversalApplicable = applicable.filter((r) => r && r.jurisdiction === 'UK'
    && Array.isArray(r.sector) && r.sector.includes('universal'));
  if (ukUniversalApplicable.length === 0) {
    misses.push('[' + label + '] USEFULNESS (C-236): no UK universal record is applicable - the filter is vacuously safe '
      + '(it excludes everything); an inert filter must never earn a green');
  }
  return misses;
}

// abstainLeg(catalogue, label) -> misses[] for leg 4 (an abstained firm attaches nothing).
function abstainLeg(catalogue, label) {
  const misses = [];
  const records = recordsOf(catalogue);
  const { applicable, excluded } = connect(abstainedFacts(), catalogue);
  if (applicable.length !== 0) {
    misses.push('[' + label + '] an abstained jurisdiction attached ' + applicable.length + ' record(s); it must attach nothing (Rule 13)');
  }
  if (excluded.length !== records.length) {
    misses.push('[' + label + '] an abstained jurisdiction excluded ' + excluded.length + ' of ' + records.length
      + ' records; every record must be excluded when the firm has no bound jurisdiction');
  }
  return misses;
}

// runTrials() -> the full miss list: the MANDATORY embedded catalogue always, plus the OPTIONAL real
// compiled catalogue when its dist artifact is present.
function runTrials() {
  const misses = [];
  const embedded = embeddedCatalogue();
  misses.push(...leakLegs(embedded, 'embedded'));
  misses.push(...abstainLeg(embedded, 'embedded'));

  if (fs.existsSync(DIST_PATH)) {
    let records = null;
    try {
      records = JSON.parse(fs.readFileSync(DIST_PATH, 'utf8')).records;
    } catch (err) {
      // FAIL-CLOSED: a present-but-unreadable compiled catalogue is a real defect for the supplementary
      // leg; record it as a miss rather than swallow it (the embedded leg above already ran).
      misses.push('[dist] the compiled catalogue is present but unreadable: ' + String(err && err.message));
    }
    if (Array.isArray(records) && records.length > 0) {
      misses.push(...leakLegs(records, 'dist'));
      misses.push(...abstainLeg(records, 'dist'));
    }
  }
  return misses;
}

function calibrate() {
  const misses = runTrials();
  if (misses.length > 0) {
    for (const m of misses) console.error('MISSED TRAP ' + m);
    return [];
  }
  return [{
    file: __filename,
    rule: 'p4-applicability-leak',
    message: 'trap caught: connect() attaches ZERO US records to a UK-bound firm, EXCLUDES the US record '
      + 'with a gate-1 jurisdiction reason, still attaches a UK universal record (usefulness, C-236), and '
      + 'attaches nothing on an abstained envelope - proven on the embedded catalogue'
      + (fs.existsSync(DIST_PATH) ? ' and the real compiled catalogue' : ' (no dist artifact present)'),
  }];
}

module.exports = { ukBoundFacts, abstainedFacts, embeddedCatalogue, leakLegs, abstainLeg, runTrials, calibrate };

if (require.main === module) {
  const findings = calibrate();
  if (findings.length === 0) {
    console.error('p4-applicability-leak: trap MISSED - connect() is not a sound applicability filter (see MISSED TRAP lines above)');
    process.exit(1);
  }
  console.log(JSON.stringify({ checker: 'p4-applicability-leak', findings }));
  process.exit(0);
}
