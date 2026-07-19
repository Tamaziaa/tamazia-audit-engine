'use strict';
// CALIBRATION FIXTURE (known-bad INPUT, self-testing dialect) for breach/proposers/propose.js.
//
// THE DISEASE (caution.md C-046/C-048; CATALOGUE-VERIFICATION-2026-07-19.md): a REQUIRED DISCLOSURE the
// law compels a firm to SHOW (the New York "Attorney Advertising" label) was typed evidence_type
// "absence". propose.js runs "absence" as a PRESENCE-breach, so the record FIRED against the compliant
// firm that DID show the label (a false accusation, the cardinal sin) and could never catch the real
// violation (the label MISSING). The fix retyped it to "presence" (an ABSENCE-breach when the label is
// missing). This fixture is the earn-your-zero proof of the FIRE DIRECTION, driven against the SHIPPED
// NY_RPC_7_1 record read straight from catalogue/packs/us-legal.json:
//   1. shipped typing + a compliant page that SHOWS "Attorney Advertising" => NO breach (accusation gone)
//   2. shipped typing + a page that OMITS the label                        => an absence-breach (caught)
//   3. the OLD "absence" typing + the SAME compliant page                  => a presence-breach (the
//      false accusation the retype removed - proves this guard is not inert and would catch a revert)
// A regression that reverts NY_RPC_7_1 obl[0] to "absence", or that breaks either fire direction in
// propose.js, makes calibrate() report [] (a miss). Rule 3: every fired candidate carries an artifact.
//
// DIALECT: calibrate() returns findings on a correct catch, [] (misses to stderr) on any regression.
// Standalone: `node eval/calibration-known-bad/fixtures/p3-required-disclosure-breach.js` exits 1 on a miss.

const fs = require('fs');
const path = require('path');
const { propose } = require(path.resolve(__dirname, '..', '..', '..', 'breach', 'proposers', 'propose.js'));

const RECORD_ID = 'NY_RPC_7_1';
const PACK = path.resolve(__dirname, '..', '..', '..', 'catalogue', 'packs', 'us-legal.json');

// The New York label shown inside a genuine prose sentence (>= the C-089 evidence-length floor), the way
// a compliant firm actually carries it; and a page that never shows it.
const COMPLIANT_TEXT = 'This website is designated Attorney Advertising in accordance with New York Rule 7.1(f) and its requirements.';
const MISSING_TEXT = 'Welcome to our firm. We handle injury matters across New York with dedicated counsel for every client and consultation.';

function shippedRecord() {
  const pack = JSON.parse(fs.readFileSync(PACK, 'utf8'));
  return pack.records.find((r) => r && r.id === RECORD_ID) || null;
}
// asAbsence(record) -> a deep copy of the record with obligation 0 forced back to evidence_type
// "absence" (the pre-fix, false-accusing typing), to demonstrate the accusation the retype removed.
function asAbsence(record) {
  const copy = JSON.parse(JSON.stringify(record));
  copy.website_obligations[0].evidence_type = 'absence';
  return copy;
}

function bundle(homeText) {
  return {
    corpus: {
      truncated: false,
      footerText: 'Contact the firm. Registered office and telephone shown for enquiries here.',
      pages: [
        { url: 'https://firm.example/', text: homeText },
        { url: 'https://firm.example/about', text: 'About our attorneys, the firm history and the practice areas we serve across New York State today.' },
        { url: 'https://firm.example/contact', text: 'Contact our team by telephone or email for a consultation about your legal matter in New York today please.' },
      ],
    },
  };
}
const COVERAGE = { rules: [{ id: RECORD_ID, state: 'covered' }] };

function firedCandidates(record, homeText) {
  return propose(bundle(homeText), { records: [record] }, COVERAGE)
    .filter((c) => c.record_id === RECORD_ID && !c.suppressed_reason);
}

function runTrials() {
  const misses = [];
  const record = shippedRecord();
  if (!record) return ['shipped record ' + RECORD_ID + ' not found in ' + path.relative(process.cwd(), PACK)];
  const obl0 = record.website_obligations[0];
  if (obl0.evidence_type !== 'presence') {
    misses.push('NY_RPC_7_1 obl[0] evidence_type is ' + JSON.stringify(obl0.evidence_type) + ', not "presence" - the false-accusation fix was reverted, so a compliant firm that shows the "Attorney Advertising" label is accused again (C-046/C-048)');
    return misses;
  }
  // 1. shipped (presence) + compliant page shows the label => must NOT breach.
  const compliant = firedCandidates(record, COMPLIANT_TEXT);
  if (compliant.length > 0) {
    misses.push('FALSE ACCUSATION: the compliant page that SHOWS "Attorney Advertising" produced a breach under the shipped presence typing (' + compliant.map((c) => c.kind).join(', ') + ') - the cardinal sin is back');
  }
  // 2. shipped (presence) + page omits the label => must breach (absence-breach with a coverage_proof).
  const missing = firedCandidates(record, MISSING_TEXT);
  const caughtReal = missing.find((c) => c.kind === 'absence-breach' && c.artifact && c.artifact.type === 'coverage_proof');
  if (!caughtReal) {
    misses.push('MISSED REAL BREACH: the page that OMITS the "Attorney Advertising" label did NOT produce an absence-breach with a coverage_proof artifact under the shipped presence typing - the real violation is no longer caught');
  }
  // 3. old (absence) typing + SAME compliant page => a presence-breach (the accusation the retype removed).
  const oldAccusation = firedCandidates(asAbsence(record), COMPLIANT_TEXT)
    .find((c) => c.kind === 'presence-breach' && c.artifact && c.artifact.type === 'quote');
  if (!oldAccusation) {
    misses.push('GUARD INERT: the pre-fix "absence" typing no longer false-accuses the compliant page, so this fixture would not catch a revert - propose.js polarity handling changed and must be re-checked');
  }
  return misses;
}

async function calibrate() {
  const misses = runTrials();
  if (misses.length > 0) {
    for (const m of misses) console.error('MISSED TRAP ' + m);
    return [];
  }
  return [{
    file: __filename,
    rule: 'required-disclosure-breach',
    message: 'trap caught: the shipped NY_RPC_7_1 "Attorney Advertising" disclosure (presence) does NOT breach a compliant page and DOES breach a page that omits it; the old absence typing false-accuses the compliant page (C-046/C-048 / Rule 3)',
  }];
}

module.exports = { shippedRecord, asAbsence, runTrials, calibrate };

if (require.main === module) {
  calibrate().then((findings) => {
    if (findings.length === 0) {
      console.error('p3-required-disclosure-breach: trap MISSED - the required-disclosure fire-direction guard did not fire on planted disease');
      process.exit(1);
    }
    console.log(JSON.stringify({ checker: 'p3-required-disclosure-breach', findings }));
    process.exit(0);
  });
}
