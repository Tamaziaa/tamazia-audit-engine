'use strict';
// eval/e2e/lib/judge.js - judges ONE pipeline run against its reference-set (or synthetic) expectation.
//
// Reuses eval/reference-set/verify.js's verifyPayload() (match-or-abstain-never-contradict, the
// existing facts-only harness's own comparator - NOT modified, only imported) as the base check for
// identity/sector/jurisdiction/expected_frameworks_min/known_breaches/known_non_breaches, and adds the
// one distinction a facts-only harness cannot make: WHY a known_breach was not reproduced.
//
// verify.js's own abstention is silent on that distinction (a missing finding is a missing finding,
// whether the pipeline ran fully and found nothing or never ran at all). This harness is not allowed
// to be silent about it (docs/P3-ACCEPTANCE.md point 4: "a skipped stage can never fabricate a pass").
//
//   reproduced    a known_breach's match_any tokens were found among the pipeline's findings.
//   missed        the FULL breach lane ran (propose+verify+adjudicate all genuinely executed) and
//                 still did not find it - an honest abstention, not a system fault.
//   skipped       one or more of propose/verify/adjudicate did not run for this firm (not landed yet,
//                 or errored), so "missed" would overclaim: the check never really happened.
//
//   contradiction a known_non_breach's match_any tokens were found among the findings (the P3 exit
//                 bar: zero false accusations). ANY hit here is fatal, whether or not the breach lane
//                 is complete - a partially-wired pipeline that already fabricates is not "not tested
//                 enough to fail", it has already failed.
//   clean         no such finding. `trivial:true` flags the case where the breach lane could not
//                 possibly have produced ANY finding (propose/verify/adjudicate not all ran), so the
//                 clean verdict is true by construction rather than because a real check ran.

const { verifyPayload } = require('../../reference-set/verify.js');
const { canonicaliseFirm } = require('../../reference-set/run-facts.js');

// knownBreachStatus(report, label, breachLaneComplete) -> 'reproduced' | 'missed' | 'skipped'.
function knownBreachStatus(report, label, breachLaneComplete) {
  const reproduced = report.matches.some((m) => m.check === 'known_breach' && m.detail === label);
  if (reproduced) return 'reproduced';
  return breachLaneComplete ? 'missed' : 'skipped';
}

// knownNonBreachStatus(report, label) -> 'contradiction' | 'clean'.
function knownNonBreachStatus(report, label) {
  const hit = report.contradictions.some((c) => c.check === 'known_non_breach' && c.detail.startsWith(label + ':'));
  return hit ? 'contradiction' : 'clean';
}

// judgeKnownBreaches(exp, report, breachLaneComplete) -> [{id, framework, status}]
function judgeKnownBreaches(exp, report, breachLaneComplete) {
  const list = Array.isArray(exp && exp.known_breaches) ? exp.known_breaches : [];
  return list.map((kb) => ({
    id: kb.id || null,
    framework: kb.framework || null,
    status: knownBreachStatus(report, kb.id || kb.framework, breachLaneComplete),
  }));
}

// judgeKnownNonBreaches(exp, report, breachLaneComplete) -> [{id, framework, status, trivial}]
function judgeKnownNonBreaches(exp, report, breachLaneComplete) {
  const list = Array.isArray(exp && exp.known_non_breaches) ? exp.known_non_breaches : [];
  return list.map((knb) => {
    const label = knb.id || knb.framework;
    const status = knownNonBreachStatus(report, label);
    return { id: knb.id || null, framework: knb.framework || null, status, trivial: status === 'clean' && !breachLaneComplete };
  });
}

/**
 * judgeFirm(firm, pipelineResult) -> {
 *   domain, role, report, knownBreaches:[{id,framework,status}],
 *   knownNonBreaches:[{id,framework,status,trivial}], contradiction:boolean
 * }
 *
 * `firm` is a reference-set.json entry shape ({domain, role, expected:{...}}) - or a synthetic
 * fixture's equivalent (eval/e2e/lib/synthetic-fixtures.js). `contradiction` is true when
 * verifyPayload found ANY contradiction at all (identity/sector/jurisdiction/framework included, not
 * only known_non_breach), matching the P3 exit bar's "zero false accusations" reading literally.
 *
 * `firm.expected.sector` is canonicalised through eval/reference-set/run-facts.js's exported
 * canonicaliseFirm() BEFORE comparison - the same call the facts-only harness makes and exactly why it
 * exists: reference-set.json records a human alias ("legal"), the sector door emits a canonical family
 * key ("law-firms"), and comparing the raw strings would report a false CONTRADICTION on every aliased
 * sector rather than the vocabulary-equivalent match it actually is.
 */
function judgeFirm(firm, pipelineResult) {
  const canonicalFirm = canonicaliseFirm(firm);
  const report = verifyPayload(pipelineResult.payload, canonicalFirm);
  const breachLaneComplete = pipelineResult.breachLaneComplete;
  return {
    domain: firm.domain,
    role: firm.role || null,
    report,
    knownBreaches: judgeKnownBreaches(canonicalFirm.expected, report, breachLaneComplete),
    knownNonBreaches: judgeKnownNonBreaches(canonicalFirm.expected, report, breachLaneComplete),
    contradiction: !report.ok,
  };
}

module.exports = {
  judgeFirm,
  judgeKnownBreaches,
  judgeKnownNonBreaches,
  knownBreachStatus,
  knownNonBreachStatus,
};
