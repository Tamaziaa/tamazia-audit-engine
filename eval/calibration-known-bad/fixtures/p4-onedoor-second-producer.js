'use strict';
// CALIBRATION FIXTURE (known-bad INPUT, self-driving dialect) for tools/one-door/check.js.
//
// THE DISEASE (Constitution Rule 1, one door per fact; the multiple-producer class that shipped a P0
// three times on the old estate): a SECOND producer of a client-facing fact, authored anywhere outside
// that fact's one allowed door, is the stale door the client ends up seeing. This fixture proves the
// one-door gate BOTH ways at once, so a
// regression in EITHER direction is caught (the C-207 gate fix taught the gate to exempt consumer call
// sites, and an over-eager exemption would be just as dangerous as the original false positive):
//   1. it flags a `function resolveSector(...)` DEFINITION smuggled into the mint path (a second SECTOR door);
//   2. it flags an `exports.resolveIdentity = ...` EXPORT smuggled into the mint path (a second IDENTITY
//      door - the false-negative trap: a leading dot but followed by ' =', not '(', so NOT a call site);
//   3. USEFULNESS / OVER-EXEMPTION CONTROL: it does NOT flag a legitimate consumer member-call
//      `sector.resolveSector(bundle)` - the mint is allowed to CALL the one door, it just may not BE a
//      second one. A gate that flags this is the false positive the C-207 fix removed; a gate that stops
//      flagging legs 1-2 has over-exempted and no longer earns its zero (Constitution Rule 4).
//
// SELF-SUFFICIENT, NO CATALOGUE: the gate is driven over in-memory synthetic content through one-door's
// own exported loadFacts()/scanContent() (loadFacts reads only tools/one-door/facts.json). Nothing here
// needs the compiled catalogue, so this calibration runs safely BEFORE `npm run catalogue` in ci.yml.
//
// DIALECT (matches eval/calibration-known-bad/fixtures/p4-applicability-leak.js): calibrate() returns
// findings on a correct catch, [] (misses printed to stderr) on any regression. Standalone:
// `node eval/calibration-known-bad/fixtures/p4-onedoor-second-producer.js` exits 1 on a miss.

const path = require('path');

const { loadFacts, scanContent } = require(path.resolve(__dirname, '..', '..', '..', 'tools', 'one-door', 'check.js'));

// A rogue SECOND producer of two client-facing facts, on a mint/-shaped path (a real consumer file that
// must never grow its own producer). facts/sector.js and facts/identity.js are the ONLY doors for these.
function badProducerSource() {
  return [
    "'use strict';",
    '// smuggled into the mint path: two facts re-derived where only the one door may produce them.',
    'function resolveSector(bundle) { return { fact: \'sector\', value: bundle }; }',
    'exports.resolveIdentity = function (bundle) { return bundle; };',
    '',
  ].join('\n');
}

// The legitimate CONSUMER: the mint is entitled to CALL the one door on the imported module. This is the
// exact member-call shape the C-207 fix exempts; it must produce ZERO violations.
function legitConsumerSource() {
  return [
    "'use strict';",
    "const sector = require('../facts/sector.js');",
    'module.exports = function run(bundle) { return sector.resolveSector(bundle); };',
    '',
  ].join('\n');
}

// runTrials() -> misses[]. Empty means the gate is sound in both directions.
function runTrials() {
  const misses = [];
  const facts = loadFacts();

  const producerViolations = scanContent('mint/rogue-second-producer.js', badProducerSource(), facts);
  if (!producerViolations.some((v) => v.fact === 'sector')) {
    misses.push('the `function resolveSector(...)` definition in the mint path was NOT flagged as a second '
      + 'SECTOR door (Rule 1); one-door has stopped catching a real second producer');
  }
  if (!producerViolations.some((v) => v.fact === 'identity')) {
    misses.push('the `exports.resolveIdentity = ...` export in the mint path was NOT flagged as a second '
      + 'IDENTITY door - the false-negative trap: a leading dot must never exempt an export (followed by \'=\', not \'(\'))');
  }

  const consumerViolations = scanContent('mint/legit-consumer.js', legitConsumerSource(), facts);
  if (consumerViolations.length !== 0) {
    misses.push('OVER-EXEMPTION: the consumer member-call `sector.resolveSector(bundle)` was WRONGLY flagged ('
      + consumerViolations.map((v) => v.fact).join(', ') + '); a legitimate caller of the one door is not a second door (C-207)');
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
    rule: 'p4-onedoor-second-producer',
    message: 'trap caught: one-door flags a function resolveSector() definition AND an exports.resolveIdentity '
      + 'export smuggled into the mint path, while the sector.resolveSector(bundle) consumer member-call stays '
      + 'exempt (Constitution Rule 1 / C-207)',
  }];
}

module.exports = { badProducerSource, legitConsumerSource, runTrials, calibrate };

if (require.main === module) {
  const findings = calibrate();
  if (findings.length === 0) {
    console.error('p4-onedoor-second-producer: trap MISSED - one-door no longer distinguishes a second-producer '
      + 'definition from a consumer call site (see MISSED TRAP lines above)');
    process.exit(1);
  }
  console.log(JSON.stringify({ checker: 'p4-onedoor-second-producer', findings }));
  process.exit(0);
}
