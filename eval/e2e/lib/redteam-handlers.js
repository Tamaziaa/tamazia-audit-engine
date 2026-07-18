'use strict';
// eval/e2e/lib/redteam-handlers.js - BESPOKE per-fixture wiring for eval/red-team/fixtures.json entries
// whose `input` is not a plain runnable EvidenceBundle (RT-D, RT-G, RT-H), or whose correct handling
// needs semantics the generic must_not-token evaluator (redteam.js) cannot express (RT-F's known,
// already-tracked xfail).
//
// This is INTENTIONALLY keyed by fixture id, not a generic mechanism: eval/red-team/fixtures.json's
// entries genuinely differ in shape (bundle vs fetch+honest/naive-bundle vs cookies+browser_script vs
// bare corpus strings), and several document their own precise "wired_now_by" instructions that this
// file follows directly, using modules that are ALREADY LIVE (evidence/crawler/extract.js,
// evidence/browser/oracle.js, breach/verifiers/index.js, facts/*). An id with no bespoke handler here
// falls through to redteam.js's generic bundle + must_not-token evaluator; an id that also has no
// generic path there is honestly skipped.
//
// Every handler returns {status, reason?} where status is one of:
//   caught    the live gate held.
//   escaped   the live gate did not hold - a fresh, real finding.
//   skipped   this handler cannot evaluate the entry as given (missing input fields).
//   xfail     the escape reproduced AND the fixture itself already declares it a known, tracked,
//             owned-elsewhere issue (current_status: 'verified_escapes_live_gate') - caution.md C-162
//             ("dismissals are per-item with a written reason") / Fleet Rule 4 (the red team records,
//             it does not fix). xfail counts neither as a fresh escape nor as a clean pass; it does not
//             fail this harness's exit code, but a genuinely NEW escape shape not matching the
//             documented one still reports 'escaped', never silently absorbed into the xfail.
//
// KNOWN, DOCUMENTED SCOPE LIMIT: RT-G's handler below only exercises the LIVE, direct half of that
// fixture's own "wired_now_by" (evidence/browser/oracle.js's classifyCookie() on the supplied
// cookies_pre_consent array). The second half - a full evidence/browser/observe() lane run against a
// scripted fake browser built from input.browser_script - is NOT implemented here. Building a
// contract-conforming fake browser (newPage/goto/settle/cookies/findConsentControl/clickConsent, per
// evidence/browser/observe.js's documented contract) is a real, separate piece of work; this is a
// deliberate, stated limit, not a silent gap.

const extract = require('../../../evidence/crawler/extract.js');
const { classifyCookie } = require('../../../evidence/browser/oracle.js');
const { verifyQuote } = require('../../../breach/verifiers/index.js');
const { runFactsDoors } = require('./pipeline.js');

// abstainedFacts(facts) -> true when identity/jurisdiction/sector ALL abstained (no confident value).
// Deliberately does not check capabilities: RT-D's own expected text names identity/sector/jurisdiction
// only ("no confident sector/identity/jurisdiction"), so this is not a partial check, it is the full
// stated contract.
function abstainedFacts(facts) {
  const idAbstained = !facts.identity || !facts.identity.legal_name || facts.identity.legal_name.value == null;
  const jurAbstained = !facts.jurisdiction || !Array.isArray(facts.jurisdiction.bound) || facts.jurisdiction.bound.length === 0;
  const secAbstained = !facts.sector || facts.sector.value == null;
  return idAbstained && jurAbstained && secAbstained;
}

// buildChallengeHtml(fetchInput) -> a minimal HTML document carrying the fixture's split title/
// body_text fields, so extract.js's real pageContentClass() (which extracts its OWN title from HTML)
// sees a genuine <title> rather than an empty one.
function buildChallengeHtml(fetchInput) {
  return '<html><head><title>' + (fetchInput.title || '') + '</title></head><body>' + (fetchInput.body_text || '') + '</body></html>';
}

// RT-D-BOT-WALL: the challenge page is recognised, AND the facts doors abstain across the board on
// both the honest (unreachable:true) bundle and a naive bundle that stored the wall text as content.
function rtBotWall(entry) {
  const input = entry.input || {};
  const fetchInput = input.fetch || {};
  const klass = extract.pageContentClass(fetchInput.status, buildChallengeHtml(fetchInput));
  if (klass !== 'challenge') {
    return { status: 'escaped', reason: 'pageContentClass did not recognise the challenge page (got "' + klass + '")' };
  }
  const honestFacts = runFactsDoors(input.honest_bundle || {});
  if (!abstainedFacts(honestFacts)) {
    return { status: 'escaped', reason: 'facts doors asserted a value on the honest unreachable bundle instead of abstaining' };
  }
  const naiveFacts = runFactsDoors(input.naive_bundle || {});
  if (!abstainedFacts(naiveFacts)) {
    return { status: 'escaped', reason: 'facts doors asserted a value from challenge-page wall furniture instead of abstaining' };
  }
  return { status: 'caught' };
}

// RT-G-ESSENTIAL-COOKIE-PRECONSENT (partial - see file header): every pre-consent cookie the fixture
// supplies classifies as essential via the live oracle.
function rtEssentialCookie(entry) {
  const cookies = (entry.input || {}).cookies_pre_consent || [];
  if (cookies.length === 0) return { status: 'skipped', reason: 'no cookies_pre_consent in this entry' };
  const nonEssential = cookies.filter((c) => classifyCookie(c).verdict !== 'essential');
  if (nonEssential.length > 0) {
    return { status: 'escaped', reason: 'classifyCookie flagged an essential cookie as non-essential: ' + nonEssential.map((c) => c.name).join(', ') };
  }
  return {
    status: 'caught',
    reason: 'direct oracle.classifyCookie() check only - the full observe() browser-lane simulation is NOT implemented by this harness (documented scope limit, see file header)',
  };
}

// RT-H-QUOTE-DRIFT: the drifted quote must be REJECTED and the exact quote must be ACCEPTED by
// breach/verifiers' Gate 2 (both directions, C-203 - a verifier that rejects everything is theatre).
function rtQuoteDrift(entry) {
  const input = entry.input || {};
  const url = 'https://rt-h-quote-drift.test/';
  const bundle = { corpus: { pages: [{ url, text: input.corpus_text || '' }] } };
  const artifact = (quote) => ({ page_url: url, quote, surface: 'visible_text' });
  const drifted = verifyQuote(artifact(input.proposed_quote_drifted), bundle);
  if (drifted.verified === true) {
    return { status: 'escaped', reason: 'the drifted quote was accepted as a verbatim match (Gate 2 failed to reject it)' };
  }
  const exact = verifyQuote(artifact(input.exact_quote_control), bundle);
  if (exact.verified !== true) {
    return { status: 'escaped', reason: 'the exact control quote was rejected too (the verifier rejects everything - C-163 theatre, not a working gate)' };
  }
  return { status: 'caught' };
}

// RT-F-CONTRADICTORY-ENTITY: a KNOWN, documented, owned-elsewhere escape (facts/identity.js does not
// yet weigh a contradicting on-page company number/entity form against a name-corroborated register
// row). Wired as xfail-until-fixed per the fixture's own instruction.
// hasWeakOrAbstainedIdentity(legalName, companyNumber) -> true when the identity door held back: the
// legal_name confidence is neither register nor corroborated, AND the company_number abstained. Named
// so the compound test is not inline in rtContradictoryEntity (the health-gate Complex Method cap).
function hasWeakOrAbstainedIdentity(legalName, companyNumber) {
  const confidenceOk = legalName.confidence !== 'register' && legalName.confidence !== 'corroborated';
  return confidenceOk && companyNumber.value == null;
}
function rtContradictoryEntity(entry) {
  const input = entry.input || {};
  const idResult = runFactsDoors(input.bundle || {}).identity;
  const legalName = idResult.legal_name || {};
  const companyNumber = idResult.company_number || {};
  if (hasWeakOrAbstainedIdentity(legalName, companyNumber)) return { status: 'caught' };

  const reason = 'resolveIdentity asserted legal_name at confidence ' + JSON.stringify(legalName.confidence)
    + ' and company_number ' + JSON.stringify(companyNumber.value)
    + ' despite the on-page/register contradiction (expected weak confidence or an abstention, C-004/C-005)';
  if (entry.current_status === 'verified_escapes_live_gate') {
    return { status: 'xfail', reason: reason + ' - matches this fixture\'s own documented, tracked, owned-elsewhere escape (Fleet Rule 4: recorded, not fixed here)' };
  }
  return { status: 'escaped', reason };
}

// RT_HANDLERS: id -> (entry) -> {status, reason?}. An id with no entry here has no bespoke handler and
// falls through to redteam.js's generic bundle + must_not-token evaluator.
const RT_HANDLERS = {
  'RT-D-BOT-WALL': rtBotWall,
  'RT-G-ESSENTIAL-COOKIE-PRECONSENT': rtEssentialCookie,
  'RT-H-QUOTE-DRIFT': rtQuoteDrift,
  'RT-F-CONTRADICTORY-ENTITY': rtContradictoryEntity,
};

module.exports = { RT_HANDLERS, abstainedFacts, buildChallengeHtml, rtBotWall, rtEssentialCookie, rtQuoteDrift, rtContradictoryEntity };
