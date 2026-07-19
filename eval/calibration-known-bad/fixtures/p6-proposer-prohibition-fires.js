'use strict';
// CALIBRATION FIXTURE (known-bad INPUT, self-testing dialect) for breach/proposers/propose.js +
// detection-spec.js: the PROHIBITION-FIRES + NEGATION-GUARD guard (hidden-defects.md RANK 1/RANK 2,
// caution.md C-048/C-060).
//
// THE DISEASE (hidden-defects.md RANK 1, the "paper tiger"): an `absence` (prohibition) obligation used to
// compile its match token-set from the LAW'S DESCRIPTIVE PROSE, so it patterned on how the offence is
// DESCRIBED and never on how the VIOLATION APPEARS. UK_MHRA_POM_AD_BAN (reg 284, no advertising a
// prescription-only medicine to the public) compiled to [generic,brand,name] and MISSED "Book your Botox
// treatment"; and even the prose-quoted phrases were gated by isProse, so a Title-Case hero HEADING escaped
// (RANK 2). The fix: a prohibition matches curated `prohibited_phrases[]` (the real violating language),
// prose-exempt (headings/CTAs too), with an UNCONDITIONAL negation guard so a compliant self-declaration
// ("we do not offer Botox") is never read as the prohibited claim being present (C-048/C-060, the Botox-U18
// class). This fixture is the earn-your-zero proof of BOTH directions, driven against the SHIPPED
// UK_MHRA_POM_AD_BAN record read straight from catalogue/packs/uk-healthcare.json:
//   1. the record's obl[0] carries prohibited_phrases including "Botox"                (else the catalogue reverted)
//   2. shipped record + a Title-Case heading "Book Botox Today"       => a presence-breach fires (RANK 1/2 caught)
//   3. shipped record + a compliant "We do not offer Botox ..."       => NO breach     (negation guard holds, C-048)
// A regression that drops the prohibited_phrases wiring, re-enables the descriptive-token paper tiger, or
// re-imposes the isProse gate on a curated phrase makes trial 2 report [] (a miss); a regression that drops
// the negation guard makes trial 3 fire (a false accusation). Either makes calibrate() report [] (a miss).
// Rule 3: every fired candidate carries a verbatim-quote artifact.
//
// DIALECT: calibrate() returns findings on a correct catch, [] (misses to stderr) on any regression.
// Standalone: `node eval/calibration-known-bad/fixtures/p6-proposer-prohibition-fires.js` exits 1 on a miss.

const fs = require('fs');
const path = require('path');
// STRING-LITERAL REQUIRE ONLY (path instructions / reachability gate): a computed require is invisible to
// the tooling that follows literal require() calls, and that is how correct legal logic sat dead in
// production for months. The propose.js module load must stay a literal so the reachability gate sees it.
const { propose } = require('../../../breach/proposers/propose.js');

const RECORD_ID = 'UK_MHRA_POM_AD_BAN';
const PACK = path.resolve(__dirname, '..', '..', '..', 'catalogue', 'packs', 'uk-healthcare.json');
const COVERAGE = { rules: [{ id: RECORD_ID, state: 'covered' }] };

// The prohibited claim as it really appears on an aesthetics page: a short Title-Case hero heading (isProse
// rejects it). And a compliant negated self-declaration that NAMES the POM only to disclaim it.
const VIOLATING_HEADING = 'Book Botox Today';
const COMPLIANT_NEGATED = 'We do not offer Botox or any other prescription-only medicine to members of the public here.';

function shippedRecord() {
  const pack = JSON.parse(fs.readFileSync(PACK, 'utf8'));
  return pack.records.find((r) => r && r.id === RECORD_ID) || null;
}

// bundle(homeText): a small readable corpus (>= the min-pages floor is irrelevant to a presence-breach, but
// three pages keep the bundle realistic). Only the homepage carries the text under test.
function bundle(homeText) {
  return {
    corpus: {
      truncated: false,
      footerText: 'Aesthetics clinic. Registered office and telephone shown for enquiries here today.',
      pages: [
        { url: 'https://clinic.example/', text: homeText },
        { url: 'https://clinic.example/about', text: 'About our friendly aesthetics team who welcome new clients for consultations across the whole city here.' },
        { url: 'https://clinic.example/contact', text: 'Contact our clinic today by telephone or email to arrange an appointment with a member of our team here.' },
      ],
    },
  };
}

function firedPresenceBreaches(record, homeText) {
  return propose(bundle(homeText), { records: [record] }, COVERAGE)
    .filter((c) => c.record_id === RECORD_ID && c.kind === 'presence-breach' && !c.suppressed_reason);
}

function runTrials() {
  const misses = [];
  const record = shippedRecord();
  if (!record) return ['shipped record ' + RECORD_ID + ' not found in ' + path.relative(process.cwd(), PACK)];
  const obl0 = record.website_obligations && record.website_obligations[0];
  // 1. the curated prohibited_phrases must still be present (the catalogue half of the fix).
  const phrases = (obl0 && Array.isArray(obl0.prohibited_phrases)) ? obl0.prohibited_phrases.map((p) => String(p).toLowerCase()) : [];
  if (!phrases.includes('botox')) {
    misses.push(RECORD_ID + ' obl[0] no longer carries a "Botox" prohibited_phrase - the curated prohibition matcher was reverted, so the POM advertising ban is a paper tiger again (hidden-defects.md RANK 1)');
    return misses;
  }
  // 2. the violating Title-Case heading must FIRE a presence-breach carrying the phrase verbatim.
  const fired = firedPresenceBreaches(record, VIOLATING_HEADING);
  const caught = fired.find((c) => c.artifact && c.artifact.type === 'quote' && /botox/i.test(c.artifact.text));
  if (!caught) {
    misses.push('MISSED REAL BREACH: the Title-Case heading ' + JSON.stringify(VIOLATING_HEADING) + ' did NOT fire a presence-breach quoting the POM - the prohibition matcher or its prose-exempt heading path regressed (RANK 1/RANK 2)');
  } else if (!VIOLATING_HEADING.includes(caught.artifact.text)) {
    misses.push('ARTIFACT DRIFT: the fired quote ' + JSON.stringify(caught.artifact.text) + ' is not a verbatim substring of the page (Rule 3 / Gate-2)');
  }
  // 3. the compliant NEGATED self-declaration must NOT fire (the negation guard, C-048/C-060).
  const compliant = firedPresenceBreaches(record, COMPLIANT_NEGATED);
  if (compliant.length > 0) {
    misses.push('FALSE ACCUSATION: the compliant negated statement ' + JSON.stringify(COMPLIANT_NEGATED) + ' fired a prohibition (' + compliant.map((c) => c.kind).join(', ') + ') - the negation guard is gone (the Botox-U18 class, C-048/C-060)');
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
    rule: 'proposer-prohibition-fires',
    message: 'trap caught: the shipped UK_MHRA_POM_AD_BAN prohibition FIRES on the Title-Case heading "Book Botox Today" (RANK 1/2) and does NOT fire on the compliant negated "we do not offer Botox" (negation guard, C-048/C-060 / Rule 3)',
  }];
}

module.exports = { shippedRecord, runTrials, calibrate };

if (require.main === module) {
  calibrate().then((findings) => {
    if (findings.length === 0) {
      console.error('p6-proposer-prohibition-fires: trap MISSED - the prohibition-fires / negation-guard did not hold on planted disease');
      process.exit(1);
    }
    console.log(JSON.stringify({ checker: 'p6-proposer-prohibition-fires', findings }));
    process.exit(0);
  });
}
