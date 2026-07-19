'use strict';
// CALIBRATION FIXTURE (self-driving dialect) for the WINNER-MARGIN fix to facts/sector.js. The #28
// multidisciplinary-conflict gate (`_rivalFamiliesAtFloor`) abstained whenever two or more rival sector
// families cleared the two-cue floor, IGNORING the winner's margin. So any content-rich real firm that
// merely mentioned a rival domain's words (a GP group scoring healthcare 32 against a stray hospitality 7)
// was refused the whole audit at the sector door: 8 of 11 replay sites and 2 of 3 fresh sites refused,
// masking every downstream win (EMPIRICAL-BREACH-AUDITS/RETEST-2026-07-19.md). The fix makes the gate
// respect the winner's dominance on TWO axes: PROPORTIONAL (>= DOMINANCE_RATIO 1.5x the nearest rival) AND
// ABSOLUTE (>= DOMINANCE_MIN_CUES 7 distinct cues). A dominant family classifies; only a GENUINE tie
// abstains. Each axis has its own negative control: a high-count near-tie (8/6, ratio 1.33) and a THIN
// winner (knightsbridge 6/2/2, ratio 3.0 but only 6 cues - the real reference-set conglomerate).
//
// Earn-your-zero discipline (Constitution Rule 4): the detector earns a green ONLY by proving it can produce
// BOTH outcomes on the SAME gate. POSITIVE controls (a dominant winner classifies) AND NEGATIVE controls (a
// genuine conglomerate still abstains). A regression in EITHER direction - the fix over-abstaining again on
// a clear winner, OR over-classifying a real tie - fails this gate. The synthetic `_textWinner` legs carry
// the REAL empirical scores (londondoctorsclinic healthcare 32/7, ask4sam.net law-firms 19/12) and are pure
// (no vocabulary, no catalogue), so they always run; the real-vocabulary `resolveSector` legs run whenever
// facts/vocabulary.js is present. Self-sufficient: runs on EVERY CI invocation, BEFORE `npm run catalogue`.
//
// DIALECT (matches p6-facts-binding-controls.js): calibrate() returns findings on a correct catch, [] (with
// the misses printed to stderr) on any regression. Standalone: `node <this file>` exits 1 on a miss.

// STRING-LITERAL REQUIRE ONLY (tools/one-door reachability discipline): a runtime-built require() path is
// invisible to the reachability gate, which is how correct logic once sat dead in production.
const sector = require('../../../facts/sector.js');

let REAL_VOCAB = null;
try {
  REAL_VOCAB = require('../../../facts/vocabulary.js');
} catch (_e) {
  // FAIL-OPEN: the vocabulary sibling is OPTIONAL for this fixture. The synthetic _textWinner legs are
  // self-sufficient and always run, so the earn-your-zero gate still catches the #28 regression without it;
  // the real-vocab legs are supplementary and their skip is reported explicitly in calibrate()'s message.
  // Swallowing here never masks a defect (a genuinely broken module still fails the mandatory synthetic legs).
  REAL_VOCAB = null;
}
const REAL_VOCAB_PRESENT = !!(REAL_VOCAB && (REAL_VOCAB.TREE || REAL_VOCAB.tree));

// A candidate as facts/sector.js#_scoreSectors emits it (sorted by distinct desc before _textWinner sees it).
function cand(family, distinct) { return { family, sector: family, depth: 0, distinct, cues: [] }; }
function winnerFamily(cands) { const w = sector._textWinner(cands, 2, new Set()); return w.winner ? w.winner.family : null; }

function bundle(text, domain) {
  return { domain: domain || 'example.com', corpus: { pages: [{ url: 'https://x/', title: 'x', text, jsonLd: [] }], footerText: '' }, registers: {} };
}

// ── Synthetic _textWinner legs (pure; carry the real empirical scores) ────────────────────────────────
function marginMisses() {
  const misses = [];
  // POSITIVE: a dominant winner classifies despite two or more rival families at the floor.
  const mustWin = (label, cands, fam) => { const w = winnerFamily(cands); if (w !== fam) misses.push('[margin+] ' + label + ': expected ' + fam + ', got ' + (w || 'ABSTAIN')); };
  // NEGATIVE: a genuine tie abstains.
  const mustAbstain = (label, cands) => { const w = winnerFamily(cands); if (w !== null) misses.push('[margin-] ' + label + ': expected ABSTAIN, got ' + w); };

  mustWin('londondoctors 32/7/5 (the smoking gun: 4.57x, refused by #28)', [cand('healthcare', 32), cand('hospitality', 7), cand('education', 5)], 'healthcare');
  mustWin('ask4sam 19/12/3 (tightest correct ratio, 1.58)', [cand('law-firms', 19), cand('healthcare', 12), cand('finance', 3)], 'law-firms');
  mustWin('vanfamily 8/3/2 (tightest correct absolute winner, 8 cues)', [cand('healthcare', 8), cand('hospitality', 3), cand('finance', 2)], 'healthcare');
  mustWin('boundary 7/4/2 (absolute floor met exactly, dominant ratio)', [cand('law-firms', 7), cand('finance', 4), cand('real-estate', 2)], 'law-firms');

  mustAbstain('conglomerate 7/6/6 (comparable top-two, RATIO axis, C-007)', [cand('finance', 7), cand('law-firms', 6), cand('accounting', 6)]);
  mustAbstain('near-tie 8/6 (botoxclinic shape, RATIO axis, 1.33 < 1.5)', [cand('aesthetics', 8), cand('hospitality', 6), cand('finance', 2)]);
  mustAbstain('knightsbridge 6/2/2 (real conglomerate, ABSOLUTE floor: ratio 3.0 but only 6 cues)', [cand('law-firms', 6), cand('finance', 2), cand('hospitality', 2)]);
  mustAbstain('thin low-count 3/2/2 (ABSOLUTE floor: a three-cue winner is not substantial)', [cand('finance', 3), cand('law-firms', 2), cand('real-estate', 2)]);
  return misses;
}

// ── Real-vocabulary resolveSector legs (end-to-end on the shipped tree) ────────────────────────────────
function realVocabMisses() {
  const misses = [];
  if (!REAL_VOCAB_PRESENT) return misses; // reported once by the caller; the synthetic legs already ran
  const tree = REAL_VOCAB.TREE || REAL_VOCAB.tree;

  // POSITIVE: a dominant healthcare clinic with incidental cafe (hospitality) and teaching (education)
  // words must classify healthcare, not refuse at the sector door (the londondoctors class).
  const pos = sector.resolveSector(bundle(
    'Our GP clinic and medical centre provide general practice care. Book a private GP appointment at our '
    + 'clinic for physiotherapy, mental health counselling and pharmacy services. As a teaching practice we '
    + 'are affiliated with the university and the Royal College. Our on-site cafe serves a dining menu for '
    + 'patients and visitors.', 'ldnclinic.co.uk'));
  if (!pos.value) misses.push('[vocab+] a dominant healthcare clinic abstained at the sector door (the #28 over-abstention regressed)');
  else if (sector.familyOf(tree, pos.value.sector) !== 'healthcare') misses.push('[vocab+] a healthcare clinic resolved the wrong family: ' + pos.value.sector);

  // NEGATIVE: a genuine law + finance + accounting conglomerate (comparable families) must still abstain.
  const neg = sector.resolveSector(bundle(
    'Meridian Group is a law firm, a wealth management practice and a chartered accountancy firm. Our '
    + 'solicitors provide legal advice, conveyancing and probate. Our advisers offer wealth management, '
    + 'investment management, insurance and IFA services. Our accountants handle bookkeeping as chartered '
    + 'accountants.', 'meridiangroup.example'));
  if (neg.value) misses.push('[vocab-] a genuine comparable-families conglomerate resolved ' + neg.value.sector + ' instead of abstaining (C-007 broken: the margin threshold is too permissive)');
  return misses;
}

function runTrials() {
  return [...marginMisses(), ...realVocabMisses()];
}

function calibrate() {
  const misses = runTrials();
  if (misses.length > 0) {
    for (const m of misses) console.error('MISSED TRAP ' + m);
    return [];
  }
  return [{
    file: __filename,
    rule: 'p6-sector-winner-margin',
    message: 'trap caught: the winner-dominance gate classifies a dominant winner despite 2+ rival families '
      + 'at floor (londondoctors 32/7, ask4sam 19/12) AND still abstains a genuine conglomerate (7/6/6, ratio '
      + 'axis), a near-tie (8/6, ratio axis), the real knightsbridge shape (6/2/2, absolute-floor axis) and a '
      + 'thin winner (3/2/2)'
      + (REAL_VOCAB_PRESENT ? ' - verified end-to-end on the real vocabulary (a healthcare clinic resolves, a law/finance/accounting conglomerate abstains)' : ' (facts/vocabulary.js absent: real-vocab legs skipped)'),
  }];
}

module.exports = { runTrials, calibrate, marginMisses, realVocabMisses };

if (require.main === module) {
  const findings = calibrate();
  if (findings.length === 0) {
    console.error('p6-sector-winner-margin: trap MISSED - the winner-margin gate regressed (see MISSED TRAP lines above)');
    process.exit(1);
  }
  console.log(JSON.stringify({ checker: 'p6-sector-winner-margin', findings }));
  process.exit(0);
}
