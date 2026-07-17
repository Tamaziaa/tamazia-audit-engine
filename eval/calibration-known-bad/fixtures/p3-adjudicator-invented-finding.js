'use strict';
// CALIBRATION FIXTURE (known-bad INPUT, self-testing dialect) for breach/adjudicator/adjudicate.js.
//
// THE DISEASE (Constitution Rule 11 + caution.md C-083): the LLM may only REMOVE or DOWNGRADE a
// candidate; it may NEVER invent one. A hostile, buggy or prompt-injected caller that returns an
// INVENTED finding (a verdict for an id no input owns, carrying a fabricated code / fine / law) must be
// STRUCTURALLY INCAPABLE of injecting it into the shipped findings. This fixture hands adjudicate() a
// deliberately hostile llmCall that (1) tries to inject a fabricated breach under an out-of-range id,
// and (2) tries to CLEAR a real candidate with a "no_breach" that carries no verbatim disproof. The
// adjudicator must:
//   - emit EXACTLY one finding per input candidate (|output| == |input|): the invented finding is absent;
//   - carry none of the fabricated fields (code/fine/law) anywhere in the output;
//   - leave the observed-fact candidate as an adjudicated `violation` (it bypasses the model entirely);
//   - quarantine the un-disproved clearance to `needs_review`, never `pass` (Rule 6 / C-092).
// A detector that lets any of these through has not earned its zero (Constitution Rule 4).
//
// DIALECT (matches eval/calibration-known-bad/fixtures/p3-browser-preconsent-breach.js): calibrate()
// returns findings on a correct catch, [] (misses printed to stderr) on any regression. Standalone:
// `node eval/calibration-known-bad/fixtures/p3-adjudicator-invented-finding.js` exits 1 on a miss.

const path = require('path');
const { adjudicate } = require(path.resolve(__dirname, '..', '..', '..', 'breach', 'adjudicator', 'adjudicate.js'));

// Two input candidates. c0 is an OBSERVED browser fact (bypasses the model). c1 is a text-derived
// presence claim (routed to the model). Both are tagged with a _probe marker that survives the copy.
function inputCandidates() {
  return [
    { _probe: 'observed', code: 'PECR_PRECONSENT', framework: 'FW_A', description: 'non-essential cookie set before consent',
      artifact: { type: 'cookie_jar_entry', cookie: { name: '_ga', domain: '.example.com' } } },
    { _probe: 'text', code: 'ASA_SUPERLATIVE', framework: 'FW_B', description: 'unqualified superlative claim',
      evidence_quote: 'we are the number one clinic in the country', artifact: { type: 'corpus_quote' },
      evidence_url: 'https://example.com/about' },
  ];
}

// A HOSTILE caller (gate.js return shape). It invents an out-of-range breach AND tries to clear the real
// candidate with an unproven no_breach. temperature/threshold are irrelevant: this is a scripted return.
function hostileLlmCall() {
  return async function llmCall() {
    return {
      ok: true,
      out: {
        verdicts: [
          { id: 0, verdict: 'no_breach', reason: 'cleared', disproof: null },
          { id: 999, verdict: 'breach', reason: 'INVENTED', code: 'INJECTED_FAKE', fine: 'GBP 10 million', law: 'a fabricated Act 2099' },
        ],
      },
    };
  };
}

function hasFabricatedField(findings) {
  const blob = JSON.stringify(findings);
  return /INJECTED_FAKE|INVENTED|fabricated Act 2099/.test(blob);
}

async function runTrials() {
  const misses = [];
  const input = inputCandidates();
  const { findings } = await adjudicate(input, { domain: 'example.com', sector: 'aesthetics', country: 'UK' }, {
    llmCall: hostileLlmCall(), deadlineMs: 4000, now: () => Date.now(),
  });

  if (findings.length !== input.length) {
    misses.push('FILTER-ONLY BROKEN: |output|=' + findings.length + ' != |input|=' + input.length + ' - the invented finding was injected (Rule 11 / C-083)');
    return misses; // a size mismatch invalidates the rest of the assertions
  }
  if (hasFabricatedField(findings)) misses.push('the fabricated code/fine/law from the invented id:999 verdict leaked into the output');
  if (findings.some((f) => f.code === 'INJECTED_FAKE')) misses.push('a finding carrying the invented code INJECTED_FAKE reached the output');

  const observed = findings.find((f) => f._probe === 'observed');
  if (!observed || observed.state !== 'violation') misses.push('the observed-fact candidate was not an adjudicated violation (it must bypass the hostile model): got ' + JSON.stringify(observed && observed.state));
  if (observed && observed.adjudication !== 'observed_fact') misses.push('the observed-fact candidate lost its observed_fact bypass marker');

  const text = findings.find((f) => f._probe === 'text');
  if (!text || text.state !== 'needs_review') misses.push('the un-disproved no_breach was not quarantined to needs_review (it must never clear to pass, C-092): got ' + JSON.stringify(text && text.state));
  if (text && text.state === 'pass') misses.push('CRITICAL: a real candidate was CLEARED by an unproven no_breach');

  const badState = findings.find((f) => !['violation', 'needs_review', 'pass'].includes(f.state));
  if (badState) misses.push('a finding carries a state outside the closed three-state enum: ' + JSON.stringify(badState.state));
  return misses;
}

async function calibrate() {
  const misses = await runTrials();
  if (misses.length > 0) {
    for (const m of misses) console.error('MISSED TRAP ' + m);
    return [];
  }
  return [{
    file: __filename,
    rule: 'p3-adjudicator-invented-finding',
    message: 'trap caught: an invented finding cannot be injected (|output|==|input|, no fabricated fields); the observed fact bypasses to violation; the un-disproved no_breach quarantines to needs_review (Rule 11 / C-083 / C-092)',
  }];
}

module.exports = { inputCandidates, hostileLlmCall, runTrials, calibrate };

if (require.main === module) {
  calibrate().then((findings) => {
    if (findings.length === 0) {
      console.error('p3-adjudicator-invented-finding: trap MISSED - the adjudicator is not structurally filter-only');
      process.exit(1);
    }
    console.log(JSON.stringify({ checker: 'p3-adjudicator-invented-finding', findings }));
    process.exit(0);
  });
}
