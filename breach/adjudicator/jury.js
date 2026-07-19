'use strict';
// breach/adjudicator/jury.js - GATE 5: the diverse-jury, veto-to-reject quorum for a would-ship
// `violation` (Constitution Rule 12 gate 5, Rule 11; caution.md C-131/C-132/C-133/C-083).
//
// WHERE THIS SITS. A text-derived candidate the adjudicator ruled `breach` AND that passed Gate 3 (the
// NLI entailment step) is the highest-stakes output the engine produces. Before it may ship as a
// `violation`, breach/adjudicator/adjudicate.js convenes this jury. The jury re-adjudicates THIS finding
// across >= n genuinely distinct provider families (the C-133 independence key), ANCHORED by Ministral-8b
// (family 'mistral', the founder-anchored reliable leg). Any single leg voting no_breach/insufficient
// VETOES the violation, which then demotes to needs_review (veto-to-reject: a weak judge's REJECTION is
// the trustworthy signal, docs/discovery/digest-research-llm-agents.md Part A Pattern 5). A unanimous,
// un-vetoed jury ships the violation.
//
// IMMUNITY (Rule 12 gate 5, C-131). A curated/immune catalogue fact - register-verified, or
// SECTOR_CORE / SECTOR_AGNOSTIC - is NEVER juried: the jury has no authority to veto a catalogue fact
// (the LLM was once allowed to veto the SRA off an SRA-regulated firm). Such a finding bypasses the jury
// and keeps its violation. The jury judges ONLY the model-adjudicated TEXT breach.
//
// FAIL-CLOSED (C-083). Too few distinct families, the anchor (Ministral) absent from the estate, too few
// valid votes, or a jury error all demote to needs_review - a violation NEVER ships un-juried.
//
// NO NETWORK. The jurors are INJECTED router providers; the quorum, the per-juror hard deadline (Rule 9)
// and the distinct-family / anchored selection all live in llm/router.js. This module owns only: the jury
// TASK (a single-candidate adjudication request built from the ONE prompt door, breach/adjudicator/
// prompt.js), the affirm-on-breach veto polarity, the structural gate applied to each vote (llm/gate.js),
// the immunity predicate, and the keep/demote decision. It authors no fact (Rule 11).

const { quorum } = require('../../llm/router.js');
const { validateResponse } = require('../../llm/gate.js');
const { briefOf, systemPrompt, buildPrompt } = require('./prompt.js');
const { LLM_VERDICTS } = require('./verdict.js');

const JURY_MIN = 3;                    // >= 3 legs across distinct families (the spec's quorum size).
const ANCHOR_FAMILY = 'mistral';       // Ministral-8b anchors the jury (founder decision 2026-07-19).
const AFFIRM = 'breach';               // the ONLY affirming verdict; anything else vetoes (veto-to-reject).
const DEFAULT_JURY_DEADLINE_MS = 9000; // a per-juror CAP, never a floor (Rule 8); the adjudicator passes
//                                        the remaining shared adjudication budget in practice.
const IMMUNE_RELEVANCE = new Set(['SECTOR_CORE', 'SECTOR_AGNOSTIC']);

// numOr(v, d): a positive finite value, else the default (a misconfigured/absent deadline falls back to
// the cap; the adjudicator's own remaining-budget guard demotes BEFORE calling when the budget is spent).
function numOr(v, d) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
}

// ctxOrDefault(ctx): a prompt ctx with the three fields buildPrompt reads, defaulted so no `undefined`
// ever leaks into the model-facing prompt (the adjudicator passes ctxFromBundle, already defaulted).
function ctxOrDefault(ctx) {
  const c = ctx || {};
  return { domain: c.domain || 'unknown', sector: c.sector || 'unknown', country: c.country || 'unknown' };
}

// isImmune(finding): a curated/immune catalogue fact the jury may never veto (Rule 12 gate 5 / C-131). A
// register-verified finding carries `curated`/`immune`; a SECTOR_CORE / SECTOR_AGNOSTIC finding is immune
// by relevance. (Register/observed facts bypass text adjudication entirely and never reach here; this is
// the belt-and-braces door for a text-derived finding that is nonetheless catalogue-immune.)
function isImmune(finding) {
  if (!finding) return false;
  if (finding.immune === true || finding.curated === true) return true;
  const rel = typeof finding.sector_relevance === 'string' ? finding.sector_relevance.toUpperCase().trim() : '';
  return IMMUNE_RELEVANCE.has(rel);
}

// juryRequest(finding, ctx): the single-candidate adjudication request each juror answers. Built from the
// ONE prompt door (prompt.js) so a juror sees the IDENTICAL question the adjudicator asked - no second
// prompt to drift (C-216). The injected juror provider .call reads system/prompt/max_tokens off this.
function juryRequest(finding, ctx) {
  const c = ctxOrDefault(ctx);
  return {
    role: 'extract',
    system: systemPrompt(),
    prompt: buildPrompt(c, [briefOf(finding, 0)]),
    temperature: 0,
    max_tokens: 900,
    scan_id: String(c.domain) + ':jury',
  };
}

// juryTask(finding, ctx, immune): the quorum task = the juror request PLUS the curated flag quorum() reads
// for immunity (task.curated). The provider .call ignores .curated; quorum() honours it (never convenes
// the jury for a curated fact).
function juryTask(finding, ctx, immune) {
  const task = juryRequest(finding, ctx);
  task.curated = Boolean(immune);
  return task;
}

// parseJuryVote(raw): the parsed vote object, via llm/gate.js's OWN parse (no schema, no retrieval set:
// parse-only), or null when unparseable. Reusing the one gate door rather than a second JSON parser
// (C-216).
function parseJuryVote(raw) {
  const text = typeof raw === 'string' ? raw : (raw && raw.text) || '';
  const gated = validateResponse(text, {});
  return gated.ok ? gated.value : null;
}

// verdictOfVote(parsed): the closed-enum verdict this juror returned for the single candidate (id 0),
// lowercased and trimmed, or '' when absent.
function verdictOfVote(parsed) {
  const arr = parsed && Array.isArray(parsed.verdicts) ? parsed.verdicts : null;
  if (!arr) return '';
  const entry = arr.find((v) => Number(v && v.id) === 0) || arr[0];
  return String((entry && entry.verdict) || '').toLowerCase().trim();
}

// juryValidate(raw): the router `validate` applied to each juror's raw reply BEFORE it may vote (Rule 12:
// the structural gate runs per response). An unparseable reply or a verdict outside the closed enum is a
// FAILED vote (too few valid votes -> quorum rejects -> demote, fail-closed). A valid reply yields the
// vote value { verdict } the veto rule reads.
function juryValidate(raw) {
  const parsed = parseJuryVote(raw);
  if (!parsed) return { ok: false, violations: [{ code: 'unparseable_json' }] };
  const verdict = verdictOfVote(parsed);
  if (!LLM_VERDICTS.has(verdict)) return { ok: false, violations: [{ code: 'verdict_not_in_enum' }] };
  return { ok: true, value: { verdict } };
}

// juryVeto(vote): the veto-to-reject polarity for the adjudication vocabulary. A juror AFFIRMS only on
// `breach`; no_breach, insufficient or anything else VETOES (a rejection is the trustworthy signal).
function juryVeto(vote) {
  const v = (vote && vote.value) || {};
  if (v.verdict === AFFIRM) return { veto: false };
  return { veto: true, reason: 'verdict=' + (v.verdict || 'unknown') };
}

// normaliseJury(o) -> the Gate-5 jury config for adjudicate.js's options, or null when the jury is not
// engaged. OPT-IN (o.jury truthy): the scripted/replay e2e and the llm-evals harness pass NO jury, so a
// would-ship violation ships exactly as before there; PRODUCTION passes o.jury so every would-ship
// violation is juried (a violation never ships un-juried). o.jury may be `true` (use o.providers +
// defaults) or an object { providers?, n?, anchorFamily? } that falls back to o.providers for the panel.
// It lives here (not in adjudicate.js) so the jury-config shape has ONE home (Rule 1) and adjudicate.js
// stays under the health-gate 500-line cap (C-254: extract, never grow the file).
function normaliseJury(o) {
  const opts = o || {};
  if (!opts.jury) return null;
  const j = (typeof opts.jury === 'object') ? opts.jury : {};
  const providers = Array.isArray(j.providers) ? j.providers : (Array.isArray(opts.providers) ? opts.providers : []);
  return { providers, n: j.n, anchorFamily: j.anchorFamily };
}

// juryProviders/juryN/juryAnchor: read the jury configuration with the fail-closed defaults (>= 3 legs,
// anchored on Ministral). Each is a guard-claused reader so juryDecision carries no config branch inline.
function juryProviders(cfg) { return Array.isArray(cfg && cfg.providers) ? cfg.providers : []; }
function juryN(cfg) { return (Number.isInteger(cfg && cfg.n) && cfg.n >= 1) ? cfg.n : JURY_MIN; }
function juryAnchor(cfg) { return (cfg && typeof cfg.anchorFamily === 'string' && cfg.anchorFamily) ? cfg.anchorFamily : ANCHOR_FAMILY; }

// voteBriefs(votes): the per-leg vote ledger for the Rule 11 log (provider, family, verdict, invalidity),
// carrying no prompt text or key. juryFamilies(votes): the distinct families that actually voted (the
// jury composition, also for the Rule 11 log).
function voteBriefs(votes) {
  return (Array.isArray(votes) ? votes : []).map((v) => ({
    provider: v.provider || null, family: v.family || null,
    verdict: (v.value && v.value.verdict) || null, invalid: v.invalid || null,
  }));
}
function juryFamilies(votes) {
  const fams = [];
  for (const v of (Array.isArray(votes) ? votes : [])) {
    if (v.family && !fams.includes(v.family)) fams.push(v.family);
  }
  return fams;
}

/**
 * juryDecision(finding, ctx, juryCfg, runOpts) -> { ship, verdict, reason, votes, families }
 *
 * The Gate-5 decision for one would-ship violation. NEVER throws (a jury error demotes, fail-closed).
 *   ship:true   the jury ACCEPTED (unanimous, un-vetoed) OR the finding is curated/immune (bypassed).
 *   ship:false  a veto, too few distinct families, the anchor absent, too few valid votes, or an error -
 *               the caller demotes the finding to needs_review (a violation never ships un-juried).
 *
 * juryCfg  { providers, n?, anchorFamily? } - the injected router-provider jury (Ministral + estate).
 * runOpts  { deadlineMs?, log? } - the per-juror deadline CAP (Rule 9) and optional observability sink.
 */
async function juryDecision(finding, ctx, juryCfg, runOpts = {}) {
  const cfg = (juryCfg && typeof juryCfg === 'object') ? juryCfg : {};
  const task = juryTask(finding, ctx, isImmune(finding));
  let r;
  try {
    r = await quorum(task, {
      providers: juryProviders(cfg), n: juryN(cfg), anchorFamily: juryAnchor(cfg),
      vetoRule: juryVeto, validate: juryValidate,
      deadlineMs: numOr(runOpts.deadlineMs, DEFAULT_JURY_DEADLINE_MS), log: runOpts.log,
    });
  } catch (_err) {
    // FAIL-OPEN: (Rule 4/9) a throwing quorum (e.g. a misconfigured n/deadline) yields a DEMOTE decision,
    // never throws into the mint; the finding falls to needs_review rather than shipping un-juried.
    return { ship: false, verdict: 'reject', reason: 'jury_error', votes: [], families: [] };
  }
  return {
    ship: Boolean(r.ok), verdict: r.verdict, reason: r.reason || null,
    votes: voteBriefs(r.votes), families: juryFamilies(r.votes),
  };
}

if (require.main === module) {
  process.stderr.write('breach/adjudicator/jury.js is a library (juryDecision). Jurors are injected router providers; it makes no network calls and authors no facts.\n');
  process.exit(2);
}

module.exports = {
  juryDecision,
  normaliseJury,
  isImmune,
  juryValidate,
  juryVeto,
  juryRequest,
  juryTask,
  verdictOfVote,
  juryProviders,
  juryN,
  juryAnchor,
  JURY_MIN,
  ANCHOR_FAMILY,
  AFFIRM,
};
