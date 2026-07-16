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

// Returns { frameworkNames: string[], assertedFindings: [{text, framework}] }
function extractFindings(payload) {
  const frameworkNames = [];
  const assertedFindings = [];
  const fws = asArray(payload && payload.frameworks);
  for (const fw of fws) {
    const name = firstNonNull(fw && fw.name, fw && fw.framework, fw && fw.title, fw && fw.law, '');
    if (name) frameworkNames.push(String(name));
    const findings = asArray(fw && (fw.findings || fw.items));
    for (const f of findings) {
      if (findingIsAsserted(f)) {
        assertedFindings.push({ text: findingText(f, name), framework: String(name) });
      }
    }
  }
  // Flat findings list, if the payload carries one.
  for (const f of asArray(payload && payload.findings)) {
    if (findingIsAsserted(f)) {
      assertedFindings.push({ text: findingText(f, firstNonNull(f && f.framework, '')), framework: String(firstNonNull(f && f.framework, '')) });
    }
  }
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

/**
 * verifyPayload(payload, firm) -> { domain, contradictions[], abstentions[], matches[] }
 * Pure function; no I/O. Any entry in contradictions means the engine CONTRADICTED
 * a hand-verified expectation and the harness must fail.
 */
function verifyPayload(payload, firm) {
  const exp = (firm && firm.expected) || {};
  const contradictions = [];
  const abstentions = [];
  const matches = [];

  const say = (list, check, detail) => list.push({ check, detail });

  // 1. legal name
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

  // 2. company number (compared with whitespace stripped, case-insensitive)
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

  // 3. sector / sub_sector (loose token match; a different asserted sector contradicts)
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

  // 4. jurisdictions_bound: asserting a jurisdiction outside the verified list is a contradiction.
  //    (jurisdictions_serves is marketing reach and also acceptable for a claimed nexus.)
  if (Array.isArray(exp.jurisdictions_bound)) {
    const allowed = new Set(
      exp.jurisdictions_bound.concat(Array.isArray(exp.jurisdictions_serves) ? exp.jurisdictions_serves : [])
        .map(toJurisdictionCode)
    );
    const got = extractBound(payload);
    if (got.length === 0) {
      say(abstentions, 'jurisdictions_bound', `expected [${exp.jurisdictions_bound.join(', ')}], engine abstained`);
    } else {
      for (const code of got) {
        if (allowed.has(code)) {
          say(matches, 'jurisdictions_bound', code);
        } else {
          say(contradictions, 'jurisdictions_bound', `engine asserted binding jurisdiction "${code}" which is not in the verified list [${[...allowed].join(', ')}]`);
        }
      }
      for (const code of exp.jurisdictions_bound.map(toJurisdictionCode)) {
        if (!got.includes(code)) say(abstentions, 'jurisdictions_bound', `verified bound jurisdiction "${code}" not asserted by the engine`);
      }
    }
  }

  const { frameworkNames, assertedFindings } = extractFindings(payload);
  const corpus = frameworkNames.join(' \n ');

  // 5. expected_frameworks_min: missing = abstention (allowed, logged)
  if (Array.isArray(exp.expected_frameworks_min)) {
    for (const fw of exp.expected_frameworks_min) {
      const hit = frameworkNames.some((n) => looseMatch(n, fw)) || norm(corpus).includes(norm(fw));
      if (hit) say(matches, 'expected_framework', fw);
      else say(abstentions, 'expected_framework', `verified binding framework not attached: "${fw}"`);
    }
  }

  // 6. known_breaches: found = match, not found = abstention
  if (Array.isArray(exp.known_breaches)) {
    for (const kb of exp.known_breaches) {
      const terms = asArray(kb.match_any);
      const hit = assertedFindings.some((f) => terms.some((t) => norm(f.text).includes(norm(t))));
      if (hit) say(matches, 'known_breach', kb.id || kb.framework);
      else say(abstentions, 'known_breach', `verified real problem not found: ${kb.id || kb.framework} (${kb.description || ''})`);
    }
  }

  // 7. known_non_breaches: ANY asserted finding matching one is a contradiction.
  if (Array.isArray(exp.known_non_breaches)) {
    for (const knb of exp.known_non_breaches) {
      const terms = asArray(knb.match_any);
      const hits = assertedFindings.filter((f) => terms.some((t) => norm(f.text).includes(norm(t))));
      if (hits.length > 0) {
        say(contradictions, 'known_non_breach', `${knb.id || knb.framework}: engine asserted a hand-verified non-breach (${hits.length} finding(s), first in framework "${hits[0].framework}"). ${knb.description || ''}`);
      } else {
        say(matches, 'known_non_breach', `${knb.id || knb.framework} correctly not asserted`);
      }
    }
  }

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

function main(argv) {
  const args = argv.slice(2);
  const opts = { json: false, set: DEFAULT_SET, domain: null, payloadPath: null };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--json') opts.json = true;
    else if (a === '--set') opts.set = args[++i];
    else if (a === '--domain') opts.domain = args[++i];
    else if (!opts.payloadPath) opts.payloadPath = a;
    else { console.error(`Unknown argument: ${a}`); return 2; }
  }
  if (!opts.payloadPath) {
    console.error('Usage: node eval/reference-set/verify.js <payload.json> [--set <reference-set.json>] [--domain <domain>] [--json]');
    return 2;
  }

  let payload;
  let refSet;
  try {
    payload = JSON.parse(fs.readFileSync(opts.payloadPath, 'utf8'));
  } catch (e) {
    console.error(`Cannot read payload ${opts.payloadPath}: ${e.message}`);
    return 2;
  }
  try {
    refSet = loadReferenceSet(opts.set);
  } catch (e) {
    console.error(`Cannot read reference set ${opts.set}: ${e.message}`);
    return 2;
  }

  const domain = opts.domain || extractDomain(payload);
  if (!domain) {
    console.error('Payload carries no meta.domain and no --domain was given.');
    return 2;
  }
  const firm = findFirm(refSet, domain);
  if (!firm) {
    console.error(`Domain "${domain}" is not in the reference set (${refSet.firms.length} firms). Nothing to verify.`);
    return 2;
  }

  const report = verifyPayload(payload, firm);

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`reference-set verify: ${report.domain} (${report.role})`);
    console.log(`  matches:        ${report.matches.length}`);
    for (const m of report.matches) console.log(`    MATCH   [${m.check}] ${m.detail}`);
    console.log(`  abstentions:    ${report.abstentions.length} (allowed)`);
    for (const a of report.abstentions) console.log(`    ABSTAIN [${a.check}] ${a.detail}`);
    console.log(`  contradictions: ${report.contradictions.length}`);
    for (const c of report.contradictions) console.log(`    FAIL    [${c.check}] ${c.detail}`);
    console.log(report.ok ? 'RESULT: OK (no contradictions)' : 'RESULT: CONTRADICTION - the engine contradicted hand-verified ground truth');
  }
  return report.ok ? 0 : 1;
}

if (require.main === module) {
  process.exit(main(process.argv));
}

module.exports = { loadReferenceSet, findFirm, verifyPayload, extractDomain };
