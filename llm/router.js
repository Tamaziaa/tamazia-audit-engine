'use strict';
// llm/router.js - the deterministic provider-routing shell (Constitution Rule 9, Rule 12 gate 5).
//
// NO NETWORK. Providers are INJECTED async callers; this module owns only ordering, the per-call
// hard deadline, the no-retry-storm discipline, and the veto-to-reject quorum. It never opens a
// socket, reads a provider key, or names a secret. The real network callers are supplied by the
// mint layer (ported from cowork-os src/lib/llm/router.js) and passed in as `providers`.
//
// A provider is a plain object:
//   { name: 'groq-8b', family: 'groq', tier?: 'free'|'paid',
//     call: async (task, { signal }) => ({ ok, text, ... }) | throws }
// `family` is the INDEPENDENCE key (caution.md C-133: two Groq models are NOT an independent
// quorum). `call` does the transport; on failure it may throw or return { ok:false, error }.
//
// Exports:
//   route(task, { providers, deadlineMs, log, validate, anchorFamily }) -> a routed response (first success)
//   quorum(task, { providers, n, vetoRule, validate, deadlineMs, log, anchorFamily }) -> a jury verdict
//   orderProviders, distinctFamilyProviders, familyOf, hoistFamilyFirst, anchoredDistinctFamilies,
//   selectJurors, defaultVeto, makeOpenRouterProvider, openRouterAbsence, OPENROUTER_FAMILY,
//   FAMILY_ORDER, DEFAULT_DEADLINE_MS
//
// Design pointers earned by the old estate:
//   - E-238 / caution.md C-138: exhausted free tiers once burned 30s x 3 retries x 3 gate attempts
//     waiting for answers that were never coming. THIS SHELL DOES NOT RETRY: one attempt per
//     provider, then fall over. Retry/backoff, if ever wanted, belongs inside an injected `call`,
//     never here, so a storm can never originate in the router.
//   - caution.md C-040 / Rule 9: every external step is wrapped in a hard Promise.race deadline.
//     `deadlineMs` is a CAP (Rule 8: never a floor - there is no minimum wait anywhere in this file).
//   - caution.md C-133 / Rule 12 gate 5: a quorum is drawn from genuinely distinct provider FAMILIES.
//   - Ministral anchor (founder decision 2026-07-19, delegated): route() and quorum() take an OPTIONAL
//     `anchorFamily` so Gate-3 entailment can PREFER, and the Gate-5 jury can REQUIRE, one specific
//     family - 'mistral' (Ministral-8b) - as the reliable leg. anchorFamily ABSENT leaves the free-first
//     ordering and the distinct-family jury selection byte-for-byte as before (every existing caller is
//     unaffected). This is pure ordering/selection; it opens no socket.
//   - The OpenRouter/Ministral provider FACTORY lives in ./providers/openrouter.js (a fetch-capable,
//     key-reading module kept OUT of this network-free shell, so router.js's body never opens a socket or
//     names a key). It is re-exported below so the routing layer OWNS it and it is reachable (Rule 5).

// The OpenRouter/Ministral provider factory (network-free by injection; see its header). Re-exported from
// the routing layer so it is reachable; requiring it is inert (it opens no socket at load time).
const { makeOpenRouterProvider, openRouterAbsence, OPENROUTER_FAMILY } = require('./providers/openrouter.js');

// Free-first family ranking, ported from the proven chain order in cowork-os src/lib/llm/router.js
// (Cloudflare Workers AI -> Groq -> NIM -> Gemini -> ... -> paid last). This is the ONE place the
// order lives; callers may pass providers in any order and orderProviders() re-imposes free-first.
const FAMILY_ORDER = ['cloudflare', 'groq', 'nim', 'gemini', 'deepseek', 'perplexity', 'openai', 'qwen', 'anthropic'];
const PAID_FAMILIES = new Set(['deepseek', 'perplexity', 'openai', 'qwen', 'anthropic']);

// A short per-call cap by default. The old estate's 30s+ per-provider waits were the hang vector
// (caution.md C-040/C-138); a routed classification/adjudication call is bounded to seconds.
const DEFAULT_DEADLINE_MS = 9000;

// assertDeadline(ms): a budget cap must be a positive finite number. A misconfigured cap must SHOUT,
// not silently degrade (caution.md C-025: sub-floor budgets throw at the boundary, never pass quietly).
function assertDeadline(ms) {
  // Number.isFinite is false for every non-number (and for NaN/Infinity), so it already subsumes the
  // typeof guard: the cap is valid iff it is a finite number greater than zero.
  if (!Number.isFinite(ms) || ms <= 0) {
    throw new Error('llm/router: deadlineMs must be a positive finite number, got ' + JSON.stringify(ms));
  }
}

// providerFamily(p): the provider's declared family, or '' when absent. Shared by familyRank and
// providerTier so neither re-derives the same defaulting logic.
function providerFamily(p) {
  return (p && p.family) || '';
}

// familyRank(p): the free-first index of a provider's family (unknown families sort last-but-stable).
function familyRank(p) {
  const idx = FAMILY_ORDER.indexOf(String(providerFamily(p)));
  return idx === -1 ? FAMILY_ORDER.length : idx;
}

// declaresTier(p): true when the provider states its own tier explicitly. Named so the conjunction is
// not its own "Complex Conditional" inline in providerTier.
function declaresTier(p) {
  return Boolean(p) && (p.tier === 'paid' || p.tier === 'free');
}
// providerTier(p): 'free' unless the provider declares 'paid' or belongs to a known paid family.
function providerTier(p) {
  if (declaresTier(p)) return p.tier;
  return PAID_FAMILIES.has(String(providerFamily(p))) ? 'paid' : 'free';
}

// orderProviders(list): stable free-first ordering (free before paid, then family rank, then the
// caller's original index). Pure; returns a new array and never mutates the input.
function orderProviders(list) {
  const arr = Array.isArray(list) ? list.slice() : [];
  return arr
    .map((p, idx) => ({ p, idx }))
    .sort((a, b) => {
      const ta = providerTier(a.p) === 'paid' ? 1 : 0;
      const tb = providerTier(b.p) === 'paid' ? 1 : 0;
      if (ta !== tb) return ta - tb;
      const fa = familyRank(a.p);
      const fb = familyRank(b.p);
      if (fa !== fb) return fa - fb;
      return a.idx - b.idx;
    })
    .map((x) => x.p);
}

// familyOf(p): a provider's trimmed, non-empty family, or '' when absent. The ONE door for reading the
// independence key (caution.md C-133), shared by distinctFamilyProviders and the anchor helpers so the
// "empty family is not a real family" rule cannot drift between them.
function familyOf(p) {
  return (p && typeof p.family === 'string') ? p.family.trim() : '';
}

// distinctFamilyProviders(ordered, n): the first provider of each distinct family, up to n. This is
// the structural independence guarantee for a quorum (caution.md C-133): two models from the same
// family can never both sit on the jury. A provider with no explicit, non-empty `family` cannot
// establish independence, so it is NOT a juror: admitting the empty-string family as if it were a real
// family let one un-declared provider sit alongside a named family and fake a quorum. Skipping it means
// too few genuinely distinct families falls the quorum CLOSED (Rule 12 gate 5).
function distinctFamilyProviders(ordered, n) {
  const seen = new Set();
  const jurors = [];
  for (const p of ordered) {
    const fam = familyOf(p);
    if (!fam || seen.has(fam)) continue;
    seen.add(fam);
    jurors.push(p);
    if (jurors.length >= n) break;
  }
  return jurors;
}

// hoistFamilyFirst(ordered, anchorFamily): the same providers, stable, with every provider of anchorFamily
// moved to the FRONT (Ministral-primary for Gate-3, founder decision). Pure; a new array, never mutates
// the input. An absent/empty anchorFamily returns the list unchanged, so the free-first default stands.
function hoistFamilyFirst(ordered, anchorFamily) {
  const fam = anchorFamily ? String(anchorFamily).trim() : '';
  if (!fam) return ordered.slice();
  const anchor = [];
  const rest = [];
  for (const p of ordered) {
    if (familyOf(p) === fam) anchor.push(p); else rest.push(p);
  }
  return anchor.concat(rest);
}

// anchoredDistinctFamilies(ordered, n, anchorFamily): distinct-family jurors that MUST include the anchor
// family (Rule 12 gate 5 as the founder anchored it: the jury is convened only around Ministral). Returns
// { jurors, anchorMissing }. When no provider carries the anchor family, anchorMissing is true and the
// caller rejects fail-closed (a violation never ships on a jury the reliable leg could not join). The
// anchor is always juror[0]; the remaining slots are filled by the first provider of each OTHER family.
function anchoredDistinctFamilies(ordered, n, anchorFamily) {
  const fam = String(anchorFamily).trim();
  const anchorProvider = fam ? ordered.find((p) => familyOf(p) === fam) : null;
  if (!anchorProvider) return { jurors: [], anchorMissing: true };
  const seen = new Set([fam]);
  const jurors = [anchorProvider];
  for (const p of ordered) {
    const f = familyOf(p);
    if (!f || seen.has(f)) continue;
    seen.add(f);
    jurors.push(p);
    if (jurors.length >= n) break;
  }
  return { jurors, anchorMissing: false };
}

// selectJurors(providers, n, anchorFamily): the jury panel. With no anchorFamily it is the historical
// free-first distinct-family selection (byte-for-byte unchanged for every existing caller); with an
// anchorFamily it is the anchored selection above.
function selectJurors(providers, n, anchorFamily) {
  const ordered = orderProviders(providers);
  if (!anchorFamily) return { jurors: distinctFamilyProviders(ordered, n), anchorMissing: false };
  return anchoredDistinctFamilies(ordered, n, anchorFamily);
}

// withDeadline(promise, ms, onTimeout): resolve { timedOut:false, value } when `promise` settles
// first, or { timedOut:true } when the cap fires first. The abandoned promise gets a no-op catch so
// a late rejection cannot surface as an unhandled rejection. No floor, no minimum wait (Rule 8).
function withDeadline(promise, ms, onTimeout) {
  let timer = null;
  const settled = promise.then(
    (value) => ({ timedOut: false, value }),
    (error) => ({ timedOut: false, value: null, error })
  );
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => { if (onTimeout) onTimeout(); resolve({ timedOut: true }); }, ms);
    if (timer && typeof timer.unref === 'function') timer.unref();
  });
  return Promise.race([settled, timeout]).finally(() => { if (timer) clearTimeout(timer); });
}

// interpretStringResponse/interpretObjectResponse split out of interpretResponse so neither the string
// nor the object shape folds every check into one function (the health-gate Complex Method cap).
function interpretStringResponse(response) {
  return response.trim() ? { ok: true, text: response } : { ok: false, text: '', error: 'empty_text' };
}
function interpretObjectResponse(response) {
  if (response.ok === false) return { ok: false, text: '', error: String(response.error || 'provider_error') };
  const text = typeof response.text === 'string' ? response.text : '';
  if (!text.trim()) return { ok: false, text: '', error: 'empty_text' };
  return { ok: true, text };
}
// interpretResponse(response): reduce an injected caller's return to { ok, text, error } at the
// transport level. { ok:false } or empty text is a provider-level failure the chain falls over.
function interpretResponse(response) {
  if (response == null) return { ok: false, text: '', error: 'null_response' };
  if (typeof response === 'string') return interpretStringResponse(response);
  return interpretObjectResponse(response);
}

// errText(e): a short message for a rejected provider call (the injected caller threw or its promise
// rejected). withDeadline already converts a rejection into a resolved { error } result, so no catch
// is needed in callProvider - the failure is a first-class value, never an uncaught throw.
function errText(e) {
  return String((e && e.message) || e).slice(0, 60);
}

// callProvider(options): one deadline-bounded attempt at one provider. options = {provider, task,
// deadlineMs, validate, log} (an options object per the <=4-positional-arg house style; five distinct
// per-call inputs). Returns { ok, value?, text?, response?, record }. `record` is always populated for
// the attempts ledger (Part B Rule 9: log every routing decision). A structural `validate` (llm/gate.js)
// turns a transport success into a routing success ONLY when the response also passes the gate - a
// fluent-but-hallucinated answer must not win just because the socket returned 200.
async function callProvider(options) {
  const { provider, task, deadlineMs, validate, log } = options;
  const t0 = Date.now();
  const controller = new AbortController();
  // withDeadline converts BOTH a fulfilment and a rejection into a resolved result, so a throwing
  // injected caller is a first-class value here (raced.error), never an uncaught throw - no catch
  // is needed, and a rejection cleanly falls the chain OVER to the next provider (fail-closed system).
  const raced = await withDeadline(
    Promise.resolve().then(() => provider.call(task, { signal: controller.signal })),
    deadlineMs,
    () => controller.abort()
  );
  const ms = Date.now() - t0;
  const base = { provider: provider.name, family: provider.family, ms };
  if (raced.timedOut) return finalize(base, 'timeout', null, log);
  if (raced.error !== undefined) return finalize(base, 'threw:' + errText(raced.error), null, log);
  const interp = interpretResponse(raced.value);
  if (!interp.ok) return finalize(base, interp.error, null, log);
  if (typeof validate === 'function') return validated({ base, interp, raw: raced.value, validate, log });
  return { ok: true, text: interp.text, response: raced.value, record: logged(base, 'ok', log) };
}

// validated(options): apply the injected structural gate to a transport success. options = {base,
// interp, raw, validate, log}. A rejection is recorded as 'gate_reject' and treated as a provider
// failure (fall over).
function validated(options) {
  const { base, interp, raw, validate, log } = options;
  const verdict = validate(raw != null ? raw : interp.text);
  if (verdict && verdict.ok) {
    return { ok: true, value: verdict.value, text: interp.text, response: raw, record: logged(base, 'ok', log) };
  }
  const reason = 'gate_reject:' + firstViolationCode(verdict);
  return finalize(base, reason, null, log);
}

// firstViolationCode(verdict): the leading violation code from a gate result, for the attempt log.
function firstViolationCode(verdict) {
  const v = verdict && Array.isArray(verdict.violations) ? verdict.violations[0] : null;
  return (v && v.code) ? v.code : 'invalid';
}

// finalize(base, outcome, value, log): shape a FAILED attempt and log it.
function finalize(base, outcome, value, log) {
  return { ok: false, value, record: logged(base, outcome, log) };
}

// logged(base, outcome, log): stamp the outcome on the attempt record and emit it to the injected
// sink if one was supplied (the router never writes anywhere itself).
function logged(base, outcome, log) {
  const record = { provider: base.provider, family: base.family, outcome, ms: base.ms };
  // FAIL-OPEN: a caller-supplied log sink must never break routing; a throwing sink is swallowed
  // here so an observability fault cannot fail a mint. The routing decision itself is unaffected.
  if (typeof log === 'function') { try { log(record); } catch (_e) { /* FAIL-OPEN: log sink faults are non-fatal */ } }
  return record;
}

// route(task, opts): try providers free-first, one deadline-bounded attempt each, and return the
// first success. `validate` (llm/gate.js) is optional but recommended: it makes a hallucinated
// response lose to the next provider instead of winning. Exhaustion returns an abstain, never a guess.
async function route(task, opts = {}) {
  const { providers = [], deadlineMs = DEFAULT_DEADLINE_MS, log = null, validate = null, anchorFamily = null } = opts;
  assertDeadline(deadlineMs);
  // anchorFamily (optional) hoists one family to the front of the free-first order (Ministral-primary for
  // Gate 3); absent, the ordering is the historical free-first, unchanged.
  const ordered = hoistFamilyFirst(orderProviders(providers), anchorFamily);
  const attempts = [];
  if (!ordered.length) return { ok: false, reason: 'no_providers', text: '', attempts };
  for (const provider of ordered) {
    const outcome = await callProvider({ provider, task, deadlineMs, validate, log });
    attempts.push(outcome.record);
    if (outcome.ok) {
      return {
        ok: true, provider: outcome.record.provider, family: outcome.record.family,
        text: outcome.text, value: outcome.value, response: outcome.response, attempts,
      };
    }
  }
  return { ok: false, reason: 'all_providers_exhausted', text: '', attempts };
}

// defaultVeto(vote): the standing veto polarity for a findings jury (Part A Pattern 5: weak judges
// have high true-positive but very low true-negative rates, so a REJECTION is the trustworthy signal
// and veto-to-reject is the correct polarity). A juror vetoes when it declares an explicit veto, or
// when its validated verdict is anything other than the affirmative 'violation'.
function defaultVeto(vote) {
  const v = (vote && vote.value) || {};
  if (v.veto === true) return { veto: true, reason: String(v.reason || 'explicit_veto').slice(0, 80) };
  if (typeof v.verdict === 'string' && v.verdict !== 'violation') {
    return { veto: true, reason: 'verdict=' + v.verdict };
  }
  return { veto: false };
}

// firstVeto(valid, vetoRule): the first juror to veto, or null when the jury is unanimous.
function firstVeto(valid, vetoRule) {
  for (const vote of valid) {
    const r = vetoRule(vote);
    if (r && r.veto) return { provider: vote.provider, reason: String(r.reason || 'veto') };
  }
  return null;
}

// collectVotes(jurors, opts): call each juror, gate.js-validate each response BEFORE it may vote (Rule
// 12: gates 1-4 run per response), and return the vote ledger. opts = {task, deadlineMs, validate, log}
// - an options object (the <=4-positional-arg house style; the P2-proven shape, mirroring
// callProvider's own options-object) rather than five positional arguments.
async function collectVotes(jurors, opts) {
  const { task, deadlineMs, validate, log } = opts;
  const votes = [];
  for (const juror of jurors) {
    const outcome = await callProvider({ provider: juror, task, deadlineMs, validate, log });
    if (outcome.ok) votes.push({ provider: juror.name, family: juror.family, value: outcome.value != null ? outcome.value : { text: outcome.text } });
    else votes.push({ provider: juror.name, family: juror.family, value: null, invalid: outcome.record.outcome });
  }
  return votes;
}

// quorum(task, opts): the diverse-jury, veto-to-reject gate for P0/P1 findings (Rule 12 gate 5).
//   - A CURATED fact (task.curated: an in-set catalogue assertion) is IMMUNE: the jury has no
//     authority to veto it (caution.md C-131 - the LLM once vetoed the SRA off an SRA-regulated firm).
//   - A finding needs n jurors from n DISTINCT families; too few independent families => fail-closed
//     reject (an unadjudicated P0/P1 is demoted to needs-review by the consumer, caution.md C-083).
//   - Every response is gate.js-validated before voting; too few valid votes => fail-closed reject.
//   - Any single veto rejects; only a unanimous, un-vetoed jury accepts.
// assertValidJurorCount(n): the requested jury size must be a positive integer; a misconfigured n must
// throw at the boundary, never silently degrade (mirrors assertDeadline's C-025 doctrine).
function assertValidJurorCount(n) {
  // Number.isInteger is false for every non-number, so it subsumes the typeof guard: n is valid iff it
  // is an integer of at least 1.
  if (!Number.isInteger(n) || n < 1) {
    throw new Error('llm/router: quorum n must be a positive integer, got ' + JSON.stringify(n));
  }
}
// isCuratedFact(task): a curated catalogue assertion the jury has no authority to veto (C-131).
function isCuratedFact(task) {
  return Boolean(task && task.curated);
}
async function quorum(task, opts = {}) {
  const { providers = [], n = 2, vetoRule = defaultVeto, validate = null, deadlineMs = DEFAULT_DEADLINE_MS, log = null, anchorFamily = null } = opts;
  assertDeadline(deadlineMs);
  assertValidJurorCount(n);
  if (isCuratedFact(task)) {
    return { ok: true, verdict: 'immune', votes: [], reason: 'curated fact: the jury may never veto a catalogue fact (Rule 12 gate 5 immunity)' };
  }
  // anchorFamily (optional) REQUIRES the reliable leg (Ministral) on the jury: absent from the estate, the
  // jury cannot be convened and the finding demotes (a violation never ships on a jury the anchor could not
  // join). No anchorFamily => the historical free-first distinct-family selection, unchanged.
  const selection = selectJurors(providers, n, anchorFamily);
  if (selection.anchorMissing) {
    return { ok: false, verdict: 'reject', reason: 'anchor_family_absent:' + String(anchorFamily), votes: [] };
  }
  const jurors = selection.jurors;
  if (jurors.length < n) {
    return { ok: false, verdict: 'reject', reason: 'insufficient_independent_families:' + jurors.length + '<' + n, votes: [] };
  }
  const votes = await collectVotes(jurors, { task, deadlineMs, validate, log });
  const valid = votes.filter((v) => v.value != null);
  if (valid.length < n) return { ok: false, verdict: 'reject', reason: 'insufficient_valid_votes:' + valid.length + '<' + n, votes };
  const veto = firstVeto(valid, vetoRule);
  if (veto) return { ok: false, verdict: 'reject', reason: 'veto[' + veto.provider + ']:' + veto.reason, votes };
  return { ok: true, verdict: 'accept', votes };
}

if (require.main === module) {
  process.stderr.write('llm/router.js is a library (route/quorum). Providers are injected; it makes no network calls.\n');
  process.exit(2);
}

module.exports = {
  route,
  quorum,
  orderProviders,
  distinctFamilyProviders,
  familyOf,
  hoistFamilyFirst,
  anchoredDistinctFamilies,
  selectJurors,
  withDeadline,
  interpretResponse,
  defaultVeto,
  // Re-exported from ./providers/openrouter.js so the routing layer owns the Ministral provider factory
  // (Rule 5 reachability) while this file's body opens no socket:
  makeOpenRouterProvider,
  openRouterAbsence,
  OPENROUTER_FAMILY,
  FAMILY_ORDER,
  PAID_FAMILIES,
  DEFAULT_DEADLINE_MS,
};
