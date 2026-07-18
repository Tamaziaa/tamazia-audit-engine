'use strict';
// llm/entailment.js - GATE 3: the NLI entailment step (Constitution Rule 12 gate 3, Rule 11;
// caution.md C-147; GAPS.md llm-unverified). The deterministic shell that turns each atomic claim
// into a hypothesis, its cited span into a premise, and runs an INJECTED model as an NLI verifier.
// Anything not labelled `entailment` is refused; the failure mode is abstention, never a guess.
//
// NO NETWORK. The model caller is INJECTED (`llmCall`), exactly like breach/adjudicator/adjudicate.js;
// this module owns only: prompt assembly (llm/prompts/entailment.js), a HARD per-call deadline
// (Rule 9, reusing llm/router.js withDeadline), the post-hoc structural gate (llm/gate.js
// validateResponse: schema + retrieval-gate + quote-match), and the verdict -> ok reduction.
//
// checkEntailment(claims, { llmCall, deadlineMs, now, log }) -> Promise<Array<{
//   claim, premise_source_id, verdict: 'entailment'|'neutral'|'contradiction', ok:boolean, reason
// }>>
//   - one result per input claim, IN ORDER (the array is built by mapping the INPUT, never the model
//     output: like the adjudicator, this shell is filter-only and can neither add nor drop a claim).
//   - ok:true ONLY when the gate-validated verdict is exactly 'entailment'. neutral, contradiction,
//     a gate rejection (out-of-set source_id, bad schema, unparseable), a timeout or a throw all
//     yield ok:false with verdict defaulted to the conservative 'neutral' (abstain-by-default,
//     Rule 12 gate 4). The consumer (the adjudicator, wired by Rob) demotes any ok:false to
//     needs_review; it NEVER ships as a violation.
//
// WIRING NOTE FOR ROB (do not wire here; R3 owns breach/adjudicator/adjudicate.js): after a text
// candidate is ruled `breach` and before stampFromVerdict writes `violation`, gate it through
//   const [e] = await checkEntailment(
//     [{ claim: f.description, premise_source_id: f.evidence_source_id || f.evidence_url,
//        premise: f.evidence_quote }],
//     { llmCall: opts.llmCall, deadlineMs: remaining });
//   if (!e || !e.ok) demote the finding to needs_review (adjudication_reason: 'nli:' + e.verdict).
// The premise MUST be the exact verbatim span the quote-match verifier already string-matched to the
// corpus (Rule 12 gate 2 feeds gate 3), so the NLI premise is grounded, not paraphrased.

const { withDeadline } = require('./router.js');
const { validateResponse } = require('./gate.js');
const { buildEntailmentPrompt, LABELS } = require('./prompts/entailment.js');

const DEFAULT_DEADLINE_MS = 9000; // a CAP, never a floor (Rule 8); one NLI call is bounded to seconds.
const ENTAILMENT = 'entailment';
const ABSTAIN_LABEL = 'neutral'; // the conservative default label on any refusal (not entailment).

// numOr(v, d): a positive finite override CLAMPED to the cap `d`, else the default `d`. `d` is the hard
// ceiling (DEFAULT_DEADLINE_MS), never a floor: a caller may only ask for a SHORTER deadline, never a
// longer one, so an override of an hour cannot defeat the documented seconds-scale cap (Rule 8/9). A
// misconfigured deadline (NaN, <=0) falls back to the cap default.
function numOr(v, d) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.min(n, d) : d;
}

// normaliseClaim(claim): read the hypothesis, its premise span and that span's source_id off one
// input claim, tolerating the field spellings the proposer/verifier flow uses. Never re-derives a
// fact; it only reads the fields it was handed (Rule 1).
function normaliseClaim(claim) {
  const c = claim || {};
  const hypothesis = firstString([c.claim, c.hypothesis, c.text, c.description]);
  const sourceId = firstString([c.premise_source_id, c.source_id, c.sourceId, c.evidence_source_id, c.evidence_url]);
  const premise = firstString([c.premise, c.premise_text, c.span, c.evidence_quote, c.quote]);
  return { hypothesis, sourceId, premise };
}

// firstString(cands): the first non-empty string in a candidate list, else '' (fail-closed: a missing
// field becomes an empty string that the abstain guards below reject, never a fabricated default).
function firstString(cands) {
  for (const v of cands) {
    if (typeof v === 'string' && v.trim()) return v;
  }
  return '';
}

// resultFor({hypothesis, sourceId, verdict, ok, reason}): the one canonical result row shape. An
// options object (the <=4-positional-arg house style; the P2-proven shape) rather than five
// positional arguments.
function resultFor({ hypothesis, sourceId, verdict, ok, reason }) {
  return { claim: hypothesis, premise_source_id: sourceId, verdict, ok, reason };
}

// callModel(prompt, opts): one HARD-deadline-bounded attempt at the injected caller. Returns the raw
// model return on success, or a typed abstain marker ({ _abstain, reason }) on timeout/throw. A
// synchronous throw in llmCall is turned into a rejection by Promise.resolve().then so withDeadline
// captures it as a first-class value (never an uncaught throw into the mint).
async function callModel(pkg, opts) {
  const request = {
    role: 'extract', system: pkg.system, prompt: pkg.prompt, schema: pkg.schema,
    allowedSourceIds: pkg.allowedSourceIds, sources: pkg.sources,
    temperature: 0, max_tokens: 400, deadline_ms: opts.deadlineMs,
  };
  const work = Promise.resolve().then(() => opts.llmCall(request));
  const raced = await withDeadline(work, opts.deadlineMs);
  if (raced.timedOut) return { _abstain: true, reason: 'nli call exceeded the ' + opts.deadlineMs + 'ms deadline -> abstain (Rule 9)' };
  if (raced.error !== undefined) return { _abstain: true, reason: 'nli call threw: ' + String(raced.error).slice(0, 80) + ' -> abstain (Rule 4)' };
  return { value: raced.value };
}

// verdictFromResponse(raw, pkg): run the injected caller's return through llm/gate.js and reduce it
// to { verdict, ok, reason }. A gate rejection (schema, out-of-set source_id, quote drift) or a
// missing/unknown label abstains; only a clean, gate-valid 'entailment' is ok:true.
// gateRejectionCode/labelFromGated split out of verdictFromResponse so neither field derivation is
// folded into its own decision count (the health-gate Complex Method cap).
function gateRejectionCode(gated) {
  return (gated.violations && gated.violations[0] && gated.violations[0].code) || 'gate_reject';
}
function labelFromGated(gated) {
  return String((gated.value && gated.value.verdict) || '').toLowerCase().trim();
}
function verdictFromResponse(raw, pkg) {
  const gated = validateResponse(raw, { schema: pkg.schema, allowedSourceIds: pkg.allowedSourceIds, sources: pkg.sources });
  if (!gated.ok) {
    return { verdict: ABSTAIN_LABEL, ok: false, reason: 'gate rejected the nli response (' + gateRejectionCode(gated) + ') -> abstain' };
  }
  const label = labelFromGated(gated);
  if (!LABELS.includes(label)) return { verdict: ABSTAIN_LABEL, ok: false, reason: 'nli label not in the closed enum -> abstain' };
  if (label === ENTAILMENT) return { verdict: ENTAILMENT, ok: true, reason: 'premise entails the hypothesis' };
  return { verdict: label, ok: false, reason: 'nli label "' + label + '" is not entailment -> abstain (Rule 12 gate 3)' };
}

// checkOne(claim, opts): the whole per-claim pipeline. A claim missing its hypothesis, its premise or
// its source_id cannot be verified, so it abstains WITHOUT calling the model. An empty hypothesis is
// no proposition to entail, so a bare 'entailment' reply would be ok:true for nothing checked - that
// escape is closed here (fail-closed, Rule 4).
// claimUnverifiable(parts) -> true when a normalised claim lacks its hypothesis, source_id or premise
// (any one absent means nothing can be entailed). Split out so checkOne carries no 3-term OR inline.
function claimUnverifiable(hypothesis, sourceId, premise) {
  return !hypothesis || !sourceId || !premise;
}
async function checkOne(claim, opts) {
  const { hypothesis, sourceId, premise } = normaliseClaim(claim);
  if (claimUnverifiable(hypothesis, sourceId, premise)) {
    return resultFor({ hypothesis, sourceId, verdict: ABSTAIN_LABEL, ok: false, reason: 'no hypothesis, cited premise span or source_id -> cannot verify, abstain (Rule 3/4)' });
  }
  if (typeof opts.llmCall !== 'function') {
    return resultFor({ hypothesis, sourceId, verdict: ABSTAIN_LABEL, ok: false, reason: 'no llmCall injected -> abstain (Rule 12 gate 4)' });
  }
  const pkg = buildEntailmentPrompt({ hypothesis, premise, sourceId });
  const called = await callModel(pkg, opts);
  if (called._abstain) return resultFor({ hypothesis, sourceId, verdict: ABSTAIN_LABEL, ok: false, reason: called.reason });
  const v = verdictFromResponse(called.value, pkg);
  logSafe(opts.log, { event: 'nli', source_id: sourceId, verdict: v.verdict, ok: v.ok });
  return resultFor({ hypothesis, sourceId, verdict: v.verdict, ok: v.ok, reason: v.reason });
}

// logSafe(log, event): emit to an optional observability sink; a throwing sink can never break a
// verification (FAIL-OPEN: an observability fault is not a legal-claim failure, dropped on purpose).
function logSafe(log, event) {
  if (typeof log !== 'function') return;
  try { log(event); } catch (_e) { /* FAIL-OPEN: log sink faults are non-fatal, deliberately dropped */ }
}

/**
 * checkEntailment(claims, opts) -> Promise<result[]>. Runs each claim through the NLI gate SEQUENTIALLY
 * (so per-claim deadlines compose predictably and a shared free-tier is not stormed). The output array
 * is a strict 1:1 map of the INPUT (filter-only): |result| === |claims|, always.
 *
 * opts.llmCall    async (request) => model response (raw string, {text}, or {ok,text}); INJECTED, this
 *                 module never opens a socket. Absent/throws/times out/unparseable -> the claim abstains.
 * opts.deadlineMs the per-call hard deadline (default 9000); a CAP, never a floor (Rule 8/9).
 * opts.now/opts.log  reserved clock + optional observability sink (both optional).
 */
async function checkEntailment(claims, options = {}) {
  const list = Array.isArray(claims) ? claims : [];
  const opts = {
    llmCall: typeof options.llmCall === 'function' ? options.llmCall : null,
    deadlineMs: numOr(options.deadlineMs, DEFAULT_DEADLINE_MS),
    log: typeof options.log === 'function' ? options.log : null,
  };
  // SEQUENTIAL by design (not Promise.all): bounded per-call deadlines then compose predictably and a
  // shared free tier is never stormed by a fan-out burst (caution.md C-138: free tiers 429 under batch load).
  const out = [];
  for (const claim of list) {
    out.push(await checkOne(claim, opts));
  }
  return out;
}

if (require.main === module) {
  process.stderr.write('llm/entailment.js is a library (checkEntailment). The model caller is injected; it makes no network calls.\n');
  process.exit(2);
}

module.exports = {
  checkEntailment,
  normaliseClaim,
  verdictFromResponse,
  numOr, // exported so the deadline-cap clamp is directly unit-testable (Rule 8/9) without a wall wait
  DEFAULT_DEADLINE_MS,
  ENTAILMENT,
  ABSTAIN_LABEL,
};
