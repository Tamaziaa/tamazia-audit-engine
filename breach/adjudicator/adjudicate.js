'use strict';
// breach/adjudicator/adjudicate.js - THE breach adjudication gate (P3 Wave-2c).
//
// PROPOSE (regex/DOM/register) -> VERIFY (deterministic artifact, Rule 3) -> ADJUDICATE (here). This is
// the last check before a legal claim reaches a client. Ported from the proven cowork-os breach
// adjudicator (E-253/E-272, filter-only, dropped 2 false positives live on mills-reeke) and hardened to
// the new constitution.
//
// THE SAFETY CONTRACT (why this cannot fabricate a breach):
//   1. FILTER-ONLY, ENFORCED STRUCTURALLY. The returned findings array is built by mapping over the
//      INPUT candidates and stamping each one in place. It is NEVER built from the model's returned
//      verdicts. A verdict is consumed only via a Map lookup keyed by an id THIS module assigned to its
//      own candidate. A verdict for an id no input owns is never looked up; an invented finding cannot
//      exist in the output. Proven by p3-adjudicator-invented-finding.js: |output| == |input|, always.
//   2. OBSERVED FACTS BYPASS THE MODEL (C-084). A browser-observed event or a register row is a FACT,
//      not a reading of a page. evidence-kind.js routes it straight to `violation` with its artifact;
//      the model, which structurally cannot see a cookie jar, never gets to "insufficient" it away.
//   3. ABSTAIN BY DEFAULT (Rule 6 + Rule 12 gate 4). A text-derived candidate becomes a `violation`
//      ONLY on an explicit, well-formed `breach` verdict for its exact id. LLM absent, timed out,
//      errored, silent on this id, or ambiguous -> needs_review. Never violation, never pass by default.
//      This is STRICTER than the port (which left non-high-risk unadjudicated findings as-is); the new
//      constitution forbids any text claim shipping as a violation without an adjudicated breach.
//   4. THE LLM CALLER IS INJECTED. This module never touches a network. `llmCall` (the real one is
//      llm/gate.js's gateLLM) is passed in; every call is wrapped in a HARD deadline (Rule 9) so a slow
//      or hanging caller degrades the mint, never hangs it.

const { raceWithDeadline } = require('../../evidence/browser/deadline.js');
const { classifyEvidenceKind } = require('./evidence-kind.js');
const { parseVerdict, LLM_VERDICTS, disproofMatches } = require('./verdict.js');
const { checkEntailment } = require('../../llm/entailment.js'); // Rule 12 gate 3 (NLI), wired below
// C-134 completion + C-211/C-222 record-key unification (P3-tail Wave-2 Builder B), extracted to
// ./prompt.js (caution.md C-254: this seam's growth had pushed this file over the 500-line health-gate
// cap; the fix is to extract a module, never grow the file further - see prompt.js's own header for the
// full C-134/C-211/C-222 rationale this used to carry inline here). fieldStr is re-imported because
// this file's own claimFor()/premiseQuote() (the entailment-claim builder, a different seam) also use
// it; briefOf/systemPrompt/buildPrompt/candidateRefsFor are re-exported below unchanged so every
// existing caller of this module (adjudicate.test.js, callGate()) sees no shape change at all.
const { fieldStr, briefOf, systemPrompt, buildPrompt, candidateRefsFor } = require('./prompt.js');

const BATCH = 10;                    // findings per LLM call (evidence truncated); a UK firm ~= 3 calls
const DEFAULT_DEADLINE_MS = 60000;   // total adjudication ceiling; a CAP, never a floor (Rule 8)

function numOr(v, d) { return Number.isFinite(Number(v)) ? Number(v) : d; }

function normaliseOptions(options) {
  const o = options || {};
  return {
    llmCall: typeof o.llmCall === 'function' ? o.llmCall : null,
    deadlineMs: numOr(o.deadlineMs, DEFAULT_DEADLINE_MS),
    now: typeof o.now === 'function' ? o.now : Date.now,
    log: typeof o.log === 'function' ? o.log : null,
  };
}

// ── ctx: READ facts off the bundle for the prompt; never re-derive them (Rule 1, one door). ───────────
// firstStringField(source, keys) -> the first non-empty string value among keys on source, or ''. The
// one shared loop readField calls twice (bundle, then bundle.facts) so neither call is its own
// "Bumpy Road" (health-gate decision cap).
function firstStringField(source, keys) {
  if (!source) return '';
  for (const k of keys) {
    const v = source[k];
    if (typeof v === 'string' && v) return v;
  }
  return '';
}
function readField(bundle, keys) {
  return firstStringField(bundle, keys) || firstStringField(bundle && bundle.facts, keys);
}
function ctxFromBundle(bundle) {
  return {
    domain: readField(bundle, ['domain', 'host']) || 'unknown',
    sector: readField(bundle, ['sector']) || 'unknown',
    country: readField(bundle, ['country', 'jurisdiction']) || 'unknown',
  };
}

// evidenceText(f) -> the exact haystack the disproof must be anchored in: what the model was shown.
function evidenceText(f) {
  const quote = String((f && f.evidence_quote) || '');
  const absence = f && f.absence_evidence ? JSON.stringify(f.absence_evidence) : '';
  return quote + ' ' + absence;
}

// briefOf/systemPrompt/buildPrompt (the compact per-candidate brief + the model-facing prompt text) now
// live in ./prompt.js (imported above) - see this file's header and prompt.js's own header for why.

// ── the deterministic rubric handed to the injected gate: it scores structural validity, NEVER the
//    model's self-reported confidence (C-145). Each sub-check is one small helper (health caps). ────────
function scoreCompleteness(verdicts, briefs, defs) {
  const ids = new Set(verdicts.map((x) => Number(x && x.id)));
  const complete = briefs.every((b) => ids.has(b.id)) && verdicts.length === briefs.length;
  if (complete) return 3;
  defs.push('return EXACTLY one verdict per candidate id (' + briefs.map((b) => b.id).join(',') + '); you returned ' + verdicts.length);
  return 0;
}
function scoreEnum(verdicts, defs) {
  const ok = verdicts.every((x) => LLM_VERDICTS.has(String((x && x.verdict) || '').toLowerCase()));
  if (ok) return 3;
  defs.push('every verdict must be exactly one of: breach, no_breach, insufficient');
  return 0;
}
function verdictClaimsNoBreach(x) {
  return String((x && x.verdict) || '').toLowerCase() === 'no_breach';
}
function noBreachIsAnchored(x, batch) {
  const f = batch[Number(x && x.id)];
  return Boolean(f) && disproofMatches(x && x.disproof, evidenceText(f));
}
function scoreAnchoring(verdicts, batch, defs) {
  let anchored = true;
  for (const x of verdicts) {
    if (!verdictClaimsNoBreach(x)) continue;
    if (noBreachIsAnchored(x, batch)) continue;
    anchored = false;
    defs.push('id ' + (x && x.id) + ': a "no_breach" needs a VERBATIM disproof quoted from the evidence shown');
  }
  return anchored ? 4 : 0;
}
function rubricFor(briefs, batch) {
  return function rubric(parsed) {
    if (!parsed || !Array.isArray(parsed.verdicts)) return { score: 0, deficiencies: ['no "verdicts" array in the JSON'], hard_fail: true };
    const defs = [];
    const v = parsed.verdicts;
    const score = scoreCompleteness(v, briefs, defs) + scoreEnum(v, defs) + scoreAnchoring(v, batch, defs);
    return { score, deficiencies: defs.slice(0, 6) };
  };
}

// ── stampers: write the three-state + adjudication fields onto ONE finding, in place. ─────────────────
function baseAdj(f, state, adjudicated, adjudication) {
  f.state = state;
  f.adjudicated = adjudicated;
  f.adjudication = adjudication;
}
function stampBypass(f, kind) {
  baseAdj(f, 'violation', true, 'observed_fact');
  f.adjudication_reason = kind + ' fact bypasses text adjudication (C-084)';
}
function stampReject(f, reason) {
  baseAdj(f, 'needs_review', false, 'kind_rejected');
  f.adjudication_reason = String(reason || 'evidence-kind rejected').slice(0, 160);
}
function stampAbstain(f, reason) {
  baseAdj(f, 'needs_review', false, 'unadjudicated');
  f.adjudication_reason = String(reason || 'not adjudicated -> abstain (Rule 12 gate 4)').slice(0, 160);
}
function stampFromVerdict(f, parsed) {
  baseAdj(f, parsed.state, true, parsed.verdict || 'unparseable');
  f.adjudication_reason = parsed.reason;
  if (parsed.disproof) f.adjudication_disproof = parsed.disproof;
}
// stampNliDemote(f, e): Rule 12 gate 3. A text candidate the model ruled `breach` whose verified quote
// (Gate 2's output) does NOT ENTAIL the claim is demoted to needs_review - it was adjudicated, but the
// NLI gate withheld the violation (neutral/contradiction/gate-reject/timeout/no-premise/no result).
function stampNliDemote(f, e) {
  baseAdj(f, 'needs_review', true, 'nli_demoted');
  f.adjudication_reason = 'nli:' + ((e && e.verdict) || 'no_result');
}

// verdictsFrom(out) -> the verdicts array from the injected caller's return, accepting both the gate.js
// shape ({ ok, out:{ verdicts } }) and a bare { verdicts }. `ok:false` or no array -> null (abstain).
function verdictsFrom(out) {
  if (!out || out.ok === false) return null;
  const v = (out.out && out.out.verdicts) || out.verdicts;
  return Array.isArray(v) ? v : null;
}

// gateEntailment(f, parsed, opts) - Rule 12 GATE 3 (NLI), the last check before a `breach` verdict
// becomes a shipped `violation`. The hypothesis is the claim (the candidate's description); the premise
// is the EXACT verbatim quote the quote-match verifier already string-matched to the corpus (Gate 2
// feeds Gate 3, so the NLI premise is grounded, not paraphrased). Only a gate-valid `entailment` label
// keeps the violation; anything else (neutral, contradiction, gate-reject, timeout, no premise, no
// result) demotes to needs_review. The NLI call is bounded by whatever adjudication budget remains
// (Rule 8/9: a cap, never a floor); an exhausted budget demotes without calling the model.
// remainingBudget(opts) -> ms left on the shared adjudication deadline (a cap, never a floor: Rule 8/9).
function remainingBudget(opts) {
  const deadlineAt = Number.isFinite(opts.deadlineAt) ? opts.deadlineAt : (opts.now() + DEFAULT_DEADLINE_MS);
  return deadlineAt - opts.now();
}
// Premise fields: a P3 candidate carries its verbatim quote on the ARTIFACT (artifact.quote/.text,
// Gate 2's string-matched span) and its locator on artifact.page_url/candidate.page_url; the port-era
// flat fields (evidence_quote/evidence_source_id/evidence_url) are read first for compatibility.
// Missing premise still abstain-demotes inside checkEntailment (never a guess). Split into two named
// lookups (guard-claused, no chained || of mixed truthiness/!=null tests) so neither is its own
// "Complex Conditional".
function premiseSourceId(f, art) {
  return f.evidence_source_id || f.evidence_url || art.page_url || f.page_url;
}
function premiseQuote(f, art) {
  const direct = fieldStr(f, 'evidence_quote');
  if (direct) return direct;
  if (art.quote != null) return String(art.quote);
  if (art.text != null) return String(art.text);
  return '';
}
function claimFor(f) {
  const art = f.artifact || {};
  return { claim: fieldStr(f, 'description'), premise_source_id: premiseSourceId(f, art), premise: premiseQuote(f, art) };
}
// runEntailment(claim, opts, remaining) -> the NLI verdict, or null on throw/no-result. FAIL-OPEN
// (Rule 4/9): a shell that throws demotes the finding to needs_review, never throws into the mint.
// checkEntailment already captures caller throws internally; this catch is belt-and-braces.
async function runEntailment(claim, opts, remaining) {
  try {
    const results = await checkEntailment([claim], { llmCall: opts.llmCall, deadlineMs: remaining, log: opts.log });
    return (results && results[0]) || null;
  } catch (_err) {
    // FAIL-OPEN: (Rule 4/9) a throwing NLI shell yields null, which the caller (gateEntailment) treats as
    // NOT-entailed and demotes the finding to needs_review - it never ships a violation and never throws
    // into the mint. checkEntailment already captures caller throws internally, so this is belt-and-braces.
    return null;
  }
}
async function gateEntailment(f, parsed, opts) {
  const remaining = remainingBudget(opts);
  if (remaining <= 0) { stampNliDemote(f, { verdict: 'deadline' }); return; }
  const e = await runEntailment(claimFor(f), opts, remaining);
  if (!e || !e.ok) { stampNliDemote(f, e); return; }
  stampFromVerdict(f, parsed);
}

// applyVerdicts(batch, verdicts, opts) - THE FILTER-ONLY CORE. Iterate the INPUT candidates and look up
// each one's verdict by the id THIS module assigned it. Nothing is ever created from `verdicts`; a
// verdict for an unknown id is simply never looked up. This is why an invented finding cannot be
// injected. A `breach` verdict is NOT stamped `violation` directly: it must first survive Rule 12 gate
// 3 (gateEntailment); every other verdict is stamped as-is.
function buildVerdictIndex(verdicts) {
  const byId = new Map();
  for (const v of verdicts) {
    const id = Number(v && v.id);
    if (Number.isInteger(id) && !byId.has(id)) byId.set(id, v);
  }
  return byId;
}
// applyVerdictToOne(finding, raw, opts) -> stamp exactly one finding from its (possibly absent) raw
// verdict. Split out of applyVerdicts so the batch loop is a single delegated call, not a second
// independent branch structure (the "Bumpy Road" health-gate cap: one conditional block per function).
async function applyVerdictToOne(finding, raw, opts) {
  if (raw === undefined) { stampAbstain(finding, 'no verdict returned for this candidate -> abstain'); return; }
  const parsed = parseVerdict(raw, evidenceText(finding));
  if (parsed.state === 'violation') { await gateEntailment(finding, parsed, opts); return; }
  stampFromVerdict(finding, parsed);
}
async function applyVerdicts(batch, verdicts, opts) {
  const byId = buildVerdictIndex(verdicts);
  for (let i = 0; i < batch.length; i++) await applyVerdictToOne(batch[i], byId.get(i), opts);
}

// applyAbstain(batch, reason) - the abstain floor: every candidate in a batch the model could not
// adjudicate defaults to needs_review. Never violation, never pass (Rule 12 gate 4).
function applyAbstain(batch, reason) {
  for (const f of batch) stampAbstain(f, reason);
}

function safeLog(log, event) {
  if (!log) return;
  try { log(event); }
  catch (e) { /* FAIL-OPEN: observability logging must never break adjudication; a broken logger is not a legal-claim failure. Dropped on purpose. */ }
}

// candidateRefsFor (the out-of-band {id, record_id, artifact} channel for replay-llm.js's key
// derivation, C-211/C-222) now lives in ./prompt.js (imported above) alongside briefOf/buildPrompt,
// since it is built from the exact same batch and exists for the exact same seam.

// callGate(batch, ctx, opts) -> the injected caller's raw return, under a HARD deadline (Rule 9).
// Resolves to the return value, or null when it timed out / threw (the caller then abstains the batch).
async function callGate(batch, ctx, opts) {
  const briefs = batch.map((f, i) => briefOf(f, i));
  const request = {
    role: 'extract',
    system: systemPrompt(),
    prompt: buildPrompt(ctx, briefs),
    rubric: rubricFor(briefs, batch),
    threshold: 7, max_attempts: 3, max_tokens: 900, temperature: 0,
    scan_id: String(ctx.domain || '') + ':adjudicate',
    deadline_ms: opts.batchDeadlineMs,
    candidates: candidateRefsFor(batch),
  };
  const work = Promise.resolve().then(() => opts.llmCall(request));
  const raced = await raceWithDeadline(work, opts.batchDeadlineMs, opts.now).catch((e) => ({ _threw: e }));
  if (raced && raced._threw) {
    // FAIL-OPEN (Rule 4 / Rule 9): a caller that throws must abstain the batch, never throw into the
    // mint. The cause is returned to the batch loop and recorded on the report (report.batches).
    return { error: String((raced._threw && raced._threw.message) || raced._threw).slice(0, 120) };
  }
  if (raced.timedOut) return { timedOut: true };
  return { value: raced.value };
}

// adjudicateBatch(batch, ctx, opts) -> a report row for one batch, having stamped every candidate in it.
async function adjudicateBatch(batch, ctx, opts) {
  const res = await callGate(batch, ctx, opts);
  if (res.timedOut) { applyAbstain(batch, 'llm deadline exceeded -> abstain'); return { ranOk: false, reason: 'timeout' }; }
  if (res.error) { applyAbstain(batch, 'llm error -> abstain'); return { ranOk: false, reason: 'error:' + res.error }; }
  const verdicts = verdictsFrom(res.value);
  if (!verdicts) { applyAbstain(batch, 'llm returned no usable verdicts -> abstain'); return { ranOk: false, reason: 'no_verdicts' }; }
  await applyVerdicts(batch, verdicts, opts);
  return { ranOk: true, score: (res.value && res.value.score) || null, provider: (res.value && res.value.provider) || null };
}

// adjudicateText(text, ctx, opts, report) - batch the text-derived candidates to the injected caller
// under the shared deadline. No caller -> abstain them all (zero regression: nothing was removed).
async function adjudicateText(text, ctx, opts, report) {
  if (!opts.llmCall) {
    applyAbstain(text, 'no LLM caller injected -> abstain (Rule 12 gate 4)');
    report.llm_available = false;
    return;
  }
  report.llm_available = true;
  const deadline = opts.now() + opts.deadlineMs;
  for (let start = 0; start < text.length; start += BATCH) {
    const batch = text.slice(start, start + BATCH);
    const remaining = deadline - opts.now();
    if (remaining <= 0) { applyAbstain(batch, 'adjudication deadline exhausted -> abstain'); report.timed_out = true; report.batches.push({ start, ranOk: false, reason: 'deadline' }); continue; }
    const batchOpts = Object.assign({}, opts, { batchDeadlineMs: remaining, deadlineAt: deadline });
    const row = await adjudicateBatch(batch, ctx, batchOpts);
    report.ran = report.ran || row.ranOk;
    report.batches.push(Object.assign({ start }, row));
    safeLog(opts.log, { event: 'adjudicate_batch', start, ranOk: row.ranOk, reason: row.reason || null });
  }
}

// classifyAll(candidates) -> partition into bypass (observation/register), text (absence to adjudicate)
// and rejected (masqueraded kind or no artifact). Attaches a transient _ek deleted before return.
function classifyAll(candidates) {
  const bypass = [];
  const text = [];
  const rejected = [];
  for (const f of candidates) {
    const ek = classifyEvidenceKind(f);
    f._ek = ek;
    if (!ek.valid) rejected.push(f);
    else if (ek.bypass) bypass.push(f);
    else text.push(f);
  }
  return { bypass, text, rejected };
}

function emptyReport(total) {
  return {
    ran: false, llm_available: false, timed_out: false, total,
    observed_fact: 0, register_fact: 0, rejected: 0, text_derived: 0,
    violation: 0, needs_review: 0, pass: 0, batches: [],
  };
}
function tallyState(report, state) {
  if (state === 'violation') report.violation++;
  else if (state === 'pass') report.pass++;
  else report.needs_review++;
}

/**
 * adjudicate(verifiedCandidates, bundle, { llmCall, deadlineMs, log }) -> { findings, report }
 *
 * findings  a NEW array, ONE finding per input candidate (never mutates the input), each stamped with
 *           the three-state `state` (violation|needs_review|pass) and the adjudication fields
 *           { adjudicated, adjudication, adjudication_reason, adjudication_disproof? }. |findings| always
 *           equals |verifiedCandidates|: the adjudicator is filter-only and cannot invent a finding.
 * report    observability + stage-manifest input: counts per bucket/state, per-batch outcomes, whether
 *           the LLM was available and whether the deadline was hit.
 *
 * opts.llmCall   async (request) => { ok, out:{ verdicts:[{id,verdict,reason,disproof}] } } (gate.js
 *                shape) OR { verdicts:[...] }. INJECTED; this module never calls a network. Absent, or a
 *                caller that throws/times out/returns no verdicts -> every text candidate abstains.
 * opts.deadlineMs  the total adjudication ceiling (default 60000); a CAP, never a floor (Rule 8/9).
 * opts.now / opts.log  injected clock + optional observability sink (both optional).
 */
async function adjudicate(verifiedCandidates, bundle, options) {
  const opts = normaliseOptions(options);
  const candidates = (verifiedCandidates || []).map((c) => Object.assign({}, c));
  const report = emptyReport(candidates.length);
  if (candidates.length === 0) return { findings: candidates, report };

  const { bypass, text, rejected } = classifyAll(candidates);
  for (const f of bypass) {
    stampBypass(f, f._ek.kind);
    if (f._ek.kind === 'register') report.register_fact++; else report.observed_fact++;
  }
  for (const f of rejected) { stampReject(f, f._ek.reason); report.rejected++; }

  report.text_derived = text.length;
  if (text.length > 0) await adjudicateText(text, ctxFromBundle(bundle), opts, report);

  for (const f of candidates) { delete f._ek; tallyState(report, f.state); }
  return { findings: candidates, report };
}

module.exports = {
  adjudicate,
  // exported for the node:test suite + the calibration fixtures (helpers, never fact producers):
  classifyAll,
  ctxFromBundle,
  evidenceText,
  briefOf,
  systemPrompt,
  buildPrompt,
  rubricFor,
  verdictsFrom,
  applyVerdicts,
  candidateRefsFor,
  BATCH,
  DEFAULT_DEADLINE_MS,
};
