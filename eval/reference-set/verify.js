#!/usr/bin/env node
'use strict';
// verify.js - reference-set harness: match-or-abstain-never-contradict.
//
// Given an engine output payload, checks it against eval/reference-set/reference-set.json:
//   MATCH        engine asserts a value and it agrees with the verified expectation  -> pass
//   ABSTAIN      engine omits or marks needs-review a value the set expects          -> allowed, logged
//   CONTRADICT   engine asserts a value that disagrees with a verified expectation,
//                asserts a jurisdiction outside the verified bound list, or asserts
//                any known_non_breach as a breach                                    -> FAIL (exit 1)
//
// Usage:
//   node eval/reference-set/verify.js <payload.json> [--set <reference-set.json>] [--domain <domain>] [--json]
//
// Exit codes: 0 = no contradictions (abstentions allowed), 1 = at least one contradiction,
//             2 = usage or data error (unreadable payload, domain not in the set, ...).
//
// Payload shape: the v1 contract (payload/schema/payload.schema.json) plus tolerant fallbacks
// for the legacy window.D shape, so the harness works before and after the P4 seam lands.
// Findings in a non-assertive state (pass / needs-review / unverified / info) never contradict:
// only ASSERTED breaches can contradict a known_non_breach. That is the three-state doctrine.

const fs = require('fs');
const path = require('path');

const DEFAULT_SET = path.join(__dirname, 'reference-set.json');

// ---------- helpers ----------

function norm(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function looseMatch(a, b) {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

const COUNTRY_TO_CODE = {
  'united kingdom': 'UK', 'uk': 'UK', 'gb': 'UK', 'great britain': 'UK', 'england': 'UK',
  'scotland': 'UK', 'wales': 'UK', 'northern ireland': 'UK',
  'united states': 'US', 'united states of america': 'US', 'usa': 'US', 'us': 'US',
  'united arab emirates': 'AE', 'uae': 'AE', 'ae': 'AE',
  'ireland': 'IE', 'ie': 'IE', 'republic of ireland': 'IE',
  'european union': 'EU', 'eu': 'EU',
};

function toJurisdictionCode(v) {
  const n = norm(v);
  return COUNTRY_TO_CODE[n] || (n ? String(v).toUpperCase().trim() : null);
}

function firstNonNull() {
  for (let i = 0; i < arguments.length; i++) {
    const v = arguments[i];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return null;
}

// ---------- tolerant payload extractors ----------

function extractDomain(payload) {
  return firstNonNull(
    payload && payload.meta && payload.meta.domain,
    payload && payload.domain
  );
}

function extractIdentity(payload) {
  const id = (payload && (payload.identity || payload.firm_profile || payload.firmProfile)) || {};
  return {
    legal_name: firstNonNull(id.legal_name, id.legalName, payload && payload.meta && payload.meta.legal_name),
    company_number: firstNonNull(id.company_number, id.companyNumber, payload && payload.meta && payload.meta.company_number),
  };
}

function extractSector(payload) {
  return {
    sector: firstNonNull(
      payload && payload.meta && payload.meta.sector,
      payload && payload.sector,
      payload && payload.identity && payload.identity.sector
    ),
    sub_sector: firstNonNull(
      payload && payload.meta && payload.meta.sub_sector,
      payload && payload.meta && payload.meta.subSector,
      payload && payload.sub_sector
    ),
  };
}

function asArray(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

// say(list, check, detail): the one shared shape every per-expectation-kind verifier below pushes
// onto its contradictions/abstentions/matches list. Pulled to module scope (it captures nothing
// from any enclosing closure) so each verifier below does not redeclare it.
function say(list, check, detail) {
  list.push({ check, detail });
}

function extractBound(payload) {
  const j = (payload && (payload.jurisdiction || payload.markets)) || {};
  let bound = asArray(firstNonNull(j.bound, payload && payload.jurisdictions_bound));
  if (bound.length === 0) {
    // Legacy shape: meta.country is the single asserted binding country.
    const c = payload && payload.meta && payload.meta.country;
    if (c) bound = [c];
  }
  return bound.map(toJurisdictionCode).filter(Boolean);
}

// A finding is "asserted" unless it carries an explicit non-assertive state.
const NON_ASSERT_STATES = new Set([
  'pass', 'ok', 'compliant', 'needs-review', 'needs_review', 'review',
  'unverified', 'info', 'informational', 'observation', 'not_applicable', 'na', 'abstain',
]);

function findingIsAsserted(f) {
  const state = norm(firstNonNull(f && f.state, f && f.status, f && f.verdict));
  if (!state) return true;
  return !NON_ASSERT_STATES.has(state.replace(/ /g, '_')) && !NON_ASSERT_STATES.has(state);
}

function findingText(f, frameworkName) {
  const parts = [frameworkName || ''];
  (function walk(v, depth) {
    if (depth > 3 || v == null) return;
    if (typeof v === 'string') { parts.push(v); return; }
    if (Array.isArray(v)) { v.forEach((x) => walk(x, depth + 1)); return; }
    if (typeof v === 'object') { Object.keys(v).forEach((k) => walk(v[k], depth + 1)); }
  })(f, 0);
  return parts.join(' \n ');
}

// frameworkDisplayName(fw) -> the best-effort display name for one payload.frameworks[] entry.
function frameworkDisplayName(fw) {
  return firstNonNull(fw && fw.name, fw && fw.framework, fw && fw.title, fw && fw.law, '');
}

// collectFrameworkFindings(fw, name) -> [{text, framework}] for one framework entry's own
// findings/items list, asserted findings only.
function collectFrameworkFindings(fw, name) {
  const out = [];
  const findings = asArray(fw && (fw.findings || fw.items));
  for (const f of findings) {
    if (!findingIsAsserted(f)) continue;
    out.push({ text: findingText(f, name), framework: String(name) });
  }
  return out;
}

// collectFlatFindings(payload) -> [{text, framework}] for the payload's own flat findings[] list
// (if it carries one), asserted findings only.
function collectFlatFindings(payload) {
  const out = [];
  for (const f of asArray(payload && payload.findings)) {
    if (!findingIsAsserted(f)) continue;
    const framework = firstNonNull(f && f.framework, '');
    out.push({ text: findingText(f, framework), framework: String(framework) });
  }
  return out;
}

// Returns { frameworkNames: string[], assertedFindings: [{text, framework}] }
function extractFindings(payload) {
  const frameworkNames = [];
  const assertedFindings = [];
  for (const fw of asArray(payload && payload.frameworks)) {
    const name = frameworkDisplayName(fw);
    if (name) frameworkNames.push(String(name));
    assertedFindings.push(...collectFrameworkFindings(fw, name));
  }
  // Flat findings list, if the payload carries one.
  assertedFindings.push(...collectFlatFindings(payload));
  return { frameworkNames, assertedFindings };
}

// ---------- the verifier ----------

function loadReferenceSet(setPath) {
  const p = setPath || DEFAULT_SET;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function findFirm(refSet, domain) {
  const nd = norm(domain).replace(/ /g, '');
  return (refSet.firms || []).find((f) => norm(f.domain).replace(/ /g, '') === nd) || null;
}

// Every per-expectation-kind verifier below has the exact same shape: (payload/exp/whatever it
// needs) -> { contradictions[], abstentions[], matches[] }. verifyPayload (the aggregator, at the
// foot of this section) just concatenates them. This is the decomposition of the former single
// 121-line/43-branch verifyPayload (Constitution Rule 4/tools/health-gate/check.js caps): each
// expectation kind below is independently readable, and none of the underlying match/abstain/
// contradict LOGIC changed - only where the code lives.

// 1. legal name, 2. company number (compared with whitespace stripped, case-insensitive)
function verifyIdentity(payload, exp) {
  const contradictions = [];
  const abstentions = [];
  const matches = [];

  const identity = extractIdentity(payload);
  if (exp.legal_name != null) {
    if (identity.legal_name == null) {
      say(abstentions, 'legal_name', `expected "${exp.legal_name}", engine abstained`);
    } else if (norm(identity.legal_name) === norm(exp.legal_name)) {
      say(matches, 'legal_name', identity.legal_name);
    } else {
      say(contradictions, 'legal_name', `expected "${exp.legal_name}", engine asserted "${identity.legal_name}"`);
    }
  }

  if (exp.company_number != null) {
    const got = identity.company_number;
    const strip = (v) => String(v).replace(/\s+/g, '').toUpperCase();
    if (got == null) {
      say(abstentions, 'company_number', `expected ${exp.company_number}, engine abstained`);
    } else if (strip(got) === strip(exp.company_number)) {
      say(matches, 'company_number', got);
    } else {
      say(contradictions, 'company_number', `expected ${exp.company_number}, engine asserted ${got}`);
    }
  }

  return { contradictions, abstentions, matches };
}

// 3. sector / sub_sector (loose token match; a different asserted sector contradicts)
function verifySector(payload, exp) {
  const contradictions = [];
  const abstentions = [];
  const matches = [];

  const sec = extractSector(payload);
  if (exp.sector != null) {
    const asserted = firstNonNull(sec.sector, sec.sub_sector);
    if (asserted == null) {
      say(abstentions, 'sector', `expected "${exp.sector}", engine abstained`);
    } else if (looseMatch(asserted, exp.sector) || (exp.sub_sector && looseMatch(asserted, exp.sub_sector))) {
      say(matches, 'sector', asserted);
    } else {
      say(contradictions, 'sector', `expected "${exp.sector}"${exp.sub_sector ? ` / "${exp.sub_sector}"` : ''}, engine asserted "${asserted}"`);
    }
  }
  if (exp.sub_sector != null && sec.sub_sector != null) {
    if (looseMatch(sec.sub_sector, exp.sub_sector) || looseMatch(sec.sub_sector, exp.sector)) {
      say(matches, 'sub_sector', sec.sub_sector);
    } else {
      say(contradictions, 'sub_sector', `expected "${exp.sub_sector}", engine asserted "${sec.sub_sector}"`);
    }
  }

  return { contradictions, abstentions, matches };
}

// 4. jurisdictions_bound: asserting a jurisdiction outside the verified list is a contradiction.
//    (jurisdictions_serves is marketing reach and also acceptable for a claimed nexus.)
function verifyJurisdictions(payload, exp) {
  const contradictions = [];
  const abstentions = [];
  const matches = [];

  if (!Array.isArray(exp.jurisdictions_bound)) return { contradictions, abstentions, matches };

  const allowed = new Set(
    exp.jurisdictions_bound
      .concat(Array.isArray(exp.jurisdictions_serves) ? exp.jurisdictions_serves : [])
      .map(toJurisdictionCode)
  );
  const got = extractBound(payload);
  if (got.length === 0) {
    say(abstentions, 'jurisdictions_bound', `expected [${exp.jurisdictions_bound.join(', ')}], engine abstained`);
    return { contradictions, abstentions, matches };
  }

  for (const code of got) {
    if (allowed.has(code)) say(matches, 'jurisdictions_bound', code);
    else say(contradictions, 'jurisdictions_bound', `engine asserted binding jurisdiction "${code}" which is not in the verified list [${[...allowed].join(', ')}]`);
  }
  for (const code of exp.jurisdictions_bound.map(toJurisdictionCode)) {
    if (!got.includes(code)) say(abstentions, 'jurisdictions_bound', `verified bound jurisdiction "${code}" not asserted by the engine`);
  }

  return { contradictions, abstentions, matches };
}

// 5. expected_frameworks_min: missing = abstention (allowed, logged)
function verifyFrameworks(exp, frameworkNames, corpus) {
  const contradictions = [];
  const abstentions = [];
  const matches = [];

  if (!Array.isArray(exp.expected_frameworks_min)) return { contradictions, abstentions, matches };

  for (const fw of exp.expected_frameworks_min) {
    const hit = frameworkNames.some((n) => looseMatch(n, fw)) || norm(corpus).includes(norm(fw));
    if (hit) say(matches, 'expected_framework', fw);
    else say(abstentions, 'expected_framework', `verified binding framework not attached: "${fw}"`);
  }

  return { contradictions, abstentions, matches };
}

// 6. known_breaches: found = match, not found = abstention
function verifyKnownBreaches(exp, assertedFindings) {
  const contradictions = [];
  const abstentions = [];
  const matches = [];

  if (!Array.isArray(exp.known_breaches)) return { contradictions, abstentions, matches };

  for (const kb of exp.known_breaches) {
    const terms = asArray(kb.match_any);
    const hit = assertedFindings.some((f) => terms.some((t) => norm(f.text).includes(norm(t))));
    const label = kb.id || kb.framework;
    if (hit) say(matches, 'known_breach', label);
    else say(abstentions, 'known_breach', `verified real problem not found: ${label} (${kb.description || ''})`);
  }

  return { contradictions, abstentions, matches };
}

// 7. known_non_breaches: ANY asserted finding matching one is a contradiction.
function verifyKnownNonBreaches(exp, assertedFindings) {
  const contradictions = [];
  const abstentions = [];
  const matches = [];

  if (!Array.isArray(exp.known_non_breaches)) return { contradictions, abstentions, matches };

  for (const knb of exp.known_non_breaches) {
    const terms = asArray(knb.match_any);
    const hits = assertedFindings.filter((f) => terms.some((t) => norm(f.text).includes(norm(t))));
    const label = knb.id || knb.framework;
    if (hits.length > 0) {
      say(contradictions, 'known_non_breach', `${label}: engine asserted a hand-verified non-breach (${hits.length} finding(s), first in framework "${hits[0].framework}"). ${knb.description || ''}`);
    } else {
      say(matches, 'known_non_breach', `${label} correctly not asserted`);
    }
  }

  return { contradictions, abstentions, matches };
}

// verifyBreaches: the small aggregator over 6+7 (both read the same assertedFindings list, so
// they are one "kind" of expectation - known-vs-asserted breach matching - split in two only
// because "found" and "must never be found" are different polarities worth reading separately).
function verifyBreaches(exp, assertedFindings) {
  const kb = verifyKnownBreaches(exp, assertedFindings);
  const knb = verifyKnownNonBreaches(exp, assertedFindings);
  return {
    contradictions: kb.contradictions.concat(knb.contradictions),
    abstentions: kb.abstentions.concat(knb.abstentions),
    matches: kb.matches.concat(knb.matches),
  };
}

/**
 * verifyPayload(payload, firm) -> { domain, contradictions[], abstentions[], matches[] }
 * Pure function; no I/O. Any entry in contradictions means the engine CONTRADICTED
 * a hand-verified expectation and the harness must fail. A small aggregator over the
 * per-expectation-kind verifiers above - it invents no matching/abstaining/contradicting logic
 * of its own.
 */
function verifyPayload(payload, firm) {
  const exp = (firm && firm.expected) || {};
  const { frameworkNames, assertedFindings } = extractFindings(payload);
  const corpus = frameworkNames.join(' \n ');

  const parts = [
    verifyIdentity(payload, exp),
    verifySector(payload, exp),
    verifyJurisdictions(payload, exp),
    verifyFrameworks(exp, frameworkNames, corpus),
    verifyBreaches(exp, assertedFindings),
  ];

  const contradictions = parts.flatMap((p) => p.contradictions);
  const abstentions = parts.flatMap((p) => p.abstentions);
  const matches = parts.flatMap((p) => p.matches);

  return {
    domain: firm ? firm.domain : extractDomain(payload),
    role: firm ? firm.role : null,
    contradictions,
    abstentions,
    matches,
    ok: contradictions.length === 0,
  };
}

// ---------- CLI ----------

// parseCliArgs(argv) -> {opts} on success, or {exitCode} when parsing itself must abort (an
// unrecognised flag, or no payload path given at all). Mirrors the original inline loop exactly:
// an unknown argument prints its own message and aborts immediately, before the payload-path
// check below ever runs.
function parseCliArgs(argv) {
  const args = argv.slice(2);
  const opts = { json: false, set: DEFAULT_SET, domain: null, payloadPath: null };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--json') opts.json = true;
    else if (a === '--set') opts.set = args[++i];
    else if (a === '--domain') opts.domain = args[++i];
    else if (!opts.payloadPath) opts.payloadPath = a;
    else { console.error(`Unknown argument: ${a}`); return { exitCode: 2 }; }
  }
  if (!opts.payloadPath) {
    console.error('Usage: node eval/reference-set/verify.js <payload.json> [--set <reference-set.json>] [--domain <domain>] [--json]');
    return { exitCode: 2 };
  }
  return { opts };
}

// loadPayloadAndRefSet(opts) -> {payload, refSet} on success, or {exitCode} on any read/parse
// failure of either file.
function loadPayloadAndRefSet(opts) {
  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(opts.payloadPath, 'utf8'));
  } catch (e) {
    console.error(`Cannot read payload ${opts.payloadPath}: ${e.message}`);
    return { exitCode: 2 };
  }
  let refSet;
  try {
    refSet = loadReferenceSet(opts.set);
  } catch (e) {
    console.error(`Cannot read reference set ${opts.set}: ${e.message}`);
    return { exitCode: 2 };
  }
  return { payload, refSet };
}

// resolveFirm(opts, payload, refSet) -> {firm} on success, or {exitCode} when the payload carries
// no domain, or the domain is not in the reference set at all.
function resolveFirm(opts, payload, refSet) {
  const domain = opts.domain || extractDomain(payload);
  if (!domain) {
    console.error('Payload carries no meta.domain and no --domain was given.');
    return { exitCode: 2 };
  }
  const firm = findFirm(refSet, domain);
  if (!firm) {
    console.error(`Domain "${domain}" is not in the reference set (${refSet.firms.length} firms). Nothing to verify.`);
    return { exitCode: 2 };
  }
  return { firm };
}

// printReport(report, json) -> the CLI's human/--json output, unchanged from the original inline
// block in main().
function printReport(report, json) {
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(`reference-set verify: ${report.domain} (${report.role})`);
  console.log(`  matches:        ${report.matches.length}`);
  for (const m of report.matches) console.log(`    MATCH   [${m.check}] ${m.detail}`);
  console.log(`  abstentions:    ${report.abstentions.length} (allowed)`);
  for (const a of report.abstentions) console.log(`    ABSTAIN [${a.check}] ${a.detail}`);
  console.log(`  contradictions: ${report.contradictions.length}`);
  for (const c of report.contradictions) console.log(`    FAIL    [${c.check}] ${c.detail}`);
  console.log(report.ok ? 'RESULT: OK (no contradictions)' : 'RESULT: CONTRADICTION - the engine contradicted hand-verified ground truth');
}

function main(argv) {
  const parsed = parseCliArgs(argv);
  if (parsed.exitCode) return parsed.exitCode;
  const { opts } = parsed;

  const loaded = loadPayloadAndRefSet(opts);
  if (loaded.exitCode) return loaded.exitCode;
  const { payload, refSet } = loaded;

  const resolved = resolveFirm(opts, payload, refSet);
  if (resolved.exitCode) return resolved.exitCode;
  const { firm } = resolved;

  const report = verifyPayload(payload, firm);
  printReport(report, opts.json);
  return report.ok ? 0 : 1;
}

if (require.main === module) {
  process.exit(main(process.argv));
}

module.exports = { loadReferenceSet, findFirm, verifyPayload, extractDomain };
