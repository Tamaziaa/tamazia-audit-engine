'use strict';
// evidence/registers/registers.js: THE orchestrator for evidence/registers/ (P3 Wave 1b).
//
// fetchRegisters(identityHints, opts) -> the EvidenceBundle.registers object described in
// facts/README.md: { companiesHouse?, gleif?, sra?, cqc?, fca?, ico?, npi?, rdap?, notes:[...] }.
// npi (NPPES, US healthcare) follows the same C-004 name-match binary semantics as the other five
// register modules; rdap (rdap.org) is structurally different (domain-keyed, not name-keyed) and its
// one field is always Tier C only — see evidence/registers/rdap.js's header. Each register
// key is present ONLY when its module returned a genuine, name-matched row (Constitution C-004); a
// missing key means "no evidence", never "checked and clean", and never a guess. notes[] carries a
// loud, structured entry for every register that was skipped, degraded (missing key/config, a fetch
// error, a timeout) or that answered with no acceptable name match (C-041 doctrine: an evidence
// lane's absence is visible, never silent).
//
// facts/identity.js, facts/jurisdiction.js and facts/sector.js remain PURE consumers of this bundle
// (Rule 1): this module produces no client-facing fact itself, only pre-fetched register rows.
const { lookupCompaniesHouse } = require('./companies-house');
const { lookupGleif } = require('./gleif');
const { lookupSra } = require('./sra');
const { lookupCqc } = require('./cqc');
const { lookupFca } = require('./fca');
const { lookupIco } = require('./ico');
const { lookupNpi } = require('./npi');
const { lookupRdap } = require('./rdap');
const { domainStemFallback } = require('./lib/name-match');
const { runCanary } = require('./lib/canary');
const { makeNote } = require('./lib/notes');

// CANARY_GUARDED_REGISTERS: the register keys the register-establishment lane guards with a
// known-good canary lookup before trusting a real establishment row from them this run (see
// lib/canary.js's header). Only companies_house and cqc are establishment-gating registers today
// (facts/jurisdiction.js's REGISTER_HOMES 'register' kind covers all of them, but companies_house
// and cqc are the two this lane was built to unblock — gate-6's established_in test).
const CANARY_GUARDED_REGISTERS = ['companies_house', 'cqc'];

let canonicalSector = (s) => (s == null ? null : String(s));
try {
  ({ canonicalSector } = require('../../facts/vocabulary.js'));
} catch (_err) {
  // FAIL-OPEN: facts/vocabulary.js is the one door for the sector taxonomy; if it is ever absent
  // this module must still function (a raw, un-canonicalised sector string is a degraded but honest
  // input to the per-register applicability gates below, each of which already treats an
  // unrecognised sector as "try anyway" rather than silently skipping), so this keeps the
  // already-assigned identity fallback above rather than crashing module load.
}

// resolveQuery(hints) -> the best company-name candidate to search registers with. A caller-supplied
// company-name hint always wins; otherwise this falls back to a bare domain-stem guess (a minimal,
// non-authoritative seed, never the identity fact itself; facts/identity.js is the one door for
// that, Rule 1).
function resolveQuery(hints) {
  const company = hints && typeof hints.company === 'string' ? hints.company.trim() : '';
  if (company) return company;
  return domainStemFallback(hints && hints.domain);
}

// tryUkRegisters(hints) -> true unless the caller has told us the firm's country is explicitly
// something other than UK. An unknown/absent country hint still tries: withholding a UK register
// check because jurisdiction is not YET resolved would be circular: a register hit is itself
// Tier-A jurisdiction evidence (facts/README.md's confidence ladder), so registers must run before,
// not after, jurisdiction is settled.
function tryUkRegisters(hints) {
  const country = hints && hints.country ? String(hints.country).toUpperCase() : '';
  return !country || country === 'UK' || country === 'GB';
}

function callArgs(query, hints, opts) {
  return {
    query,
    domain: hints && hints.domain,
    sector: hints && hints.sector ? canonicalSector(hints.sector) : null,
    country: hints && hints.country ? String(hints.country).toUpperCase() : null,
    fetchFn: opts.fetchFn,
    deadlineMs: opts.deadlineMs,
    keys: opts.keys || {},
    log: opts.log,
    // corpusText: the crawled site's own visible text (register-establishment lane). Lets
    // companies-house.js / cqc.js try a DIRECT id resolution (a scraped company number / CQC
    // provider id) before falling back to fuzzy name search — see lib/establishment-id.js.
    corpusText: hints && typeof hints.corpusText === 'string' ? hints.corpusText : '',
  };
}

// buildLookups(query, hints, opts) -> [{key, run}], the applicable register calls for this hint set.
// GLEIF and NPI are worldwide-reachable/self-gating and always attempted; RDAP is domain-keyed (not
// name-keyed) and always attempted when a domain is present; the other five are UK-specific and
// gated by tryUkRegisters (each also self-gates on sector where relevant, e.g. SRA/CQC/FCA).
function buildLookups(query, hints, opts) {
  const args = callArgs(query, hints, opts);
  const lookups = [
    { key: 'gleif', run: () => lookupGleif(args) },
    // NPI (NPPES, US healthcare providers only): self-gates on sector/country inside lookupNpi
    // (Rule 8: an irrelevant call never fires), so it is always offered here, like GLEIF.
    { key: 'npi', run: () => lookupNpi(args) },
  ];
  if (hints && hints.domain) {
    // Reuses the shared `args` object (same fetchFn/deadlineMs/log/domain every other lookup
    // receives from callArgs) rather than re-reading opts/hints directly, so RDAP cannot silently
    // diverge if callArgs ever normalises these fields (CodeRabbit PR #30).
    lookups.push({
      key: 'rdap',
      run: () => lookupRdap({ domain: args.domain, fetchFn: args.fetchFn, deadlineMs: args.deadlineMs, log: args.log }),
    });
  }
  if (tryUkRegisters(hints)) {
    lookups.push(
      { key: 'companiesHouse', run: () => lookupCompaniesHouse(args) },
      { key: 'sra', run: () => lookupSra(args) },
      { key: 'cqc', run: () => lookupCqc(args) },
      { key: 'fca', run: () => lookupFca(args) },
      { key: 'ico', run: () => lookupIco(args) }
    );
  }
  return lookups;
}

// fetchRegisters(identityHints, opts) -> Promise<EvidenceBundle.registers>. `identityHints` is
// {domain, company?, country?, sector?}; `opts` is {fetchFn, deadlineMs?, keys?, log?}. Every
// applicable register is looked up IN PARALLEL (Rule 8: no serial rounds where width can widen; each
// call is independently deadline-bound, so total wall time is bound by the slowest single call, not
// their sum).
// assembleBundle(settled) -> the {key: row, notes:[...]} bundle from every settled lookup. Split out of
// fetchRegisters so the accumulation loop is its own single-purpose unit.
function assembleBundle(settled) {
  const bundle = { notes: [] };
  for (const { key, result } of settled) {
    if (result.row) bundle[key] = result.row;
    if (result.note) bundle.notes.push(result.note);
  }
  return bundle;
}

// BUNDLE_KEY_TO_CANARY_REGISTER: buildLookups' bundle key (camelCase, matches REGISTER_HOMES in
// facts/jurisdiction.js) -> the canary/lookup-runner register id (snake_case, matches row.source).
const BUNDLE_KEY_TO_CANARY_REGISTER = { companiesHouse: 'companies_house', cqc: 'cqc' };

// runCanaries(options) -> Promise<{register: canaryResult}> for every CANARY_GUARDED_REGISTERS
// entry. THE non-negotiable safety gate (CLAUDE.md §7.9 / this lane's brief): a register outage or
// an expired key must never render as "established" nor as "no issue found" — a canary failure
// marks that register DEGRADED for the whole run, BEFORE any real establishment row from it is
// trusted (see applyCanaryGate below).
async function runCanaries(options) {
  const out = {};
  await Promise.all(CANARY_GUARDED_REGISTERS.map(async (register) => {
    out[register] = await runCanary(register, { fetchFn: options.fetchFn, deadlineMs: options.deadlineMs, keys: options.keys || {} });
  }));
  return out;
}

// applyCanaryGate(bundle, canaries) -> bundle, mutated in place: any establishment-gating register
// row whose canary did NOT pass is stripped from the bundle (never trusted this run, however clean
// its own real lookup looked) and replaced with a loud DEGRADED note; bundle.laneStatus records
// 'OK' | 'DEGRADED' | 'not_attempted' per guarded register so the run manifest can surface it.
function applyCanaryGate(bundle, canaries) {
  bundle.laneStatus = {};
  for (const [bundleKey, register] of Object.entries(BUNDLE_KEY_TO_CANARY_REGISTER)) {
    const canary = canaries[register];
    if (!canary || canary.message === 'missing_key: no canary attempted (same as a real lookup with no key)') {
      bundle.laneStatus[register] = 'not_attempted';
      continue;
    }
    if (canary.ok) {
      bundle.laneStatus[register] = 'OK';
      continue;
    }
    bundle.laneStatus[register] = 'DEGRADED';
    if (bundle[bundleKey]) delete bundle[bundleKey];
    bundle.notes.push(makeNote({
      register,
      kind: 'degraded',
      reason: 'canary_failed',
      detail: 'the ' + register + ' canary (' + canary.label + ') did not pass this run (' + canary.message
        + '); establishment is NOT resolved from this register this run, even if the real lookup itself '
        + 'returned a candidate — a register outage/expired key must never render as established or as '
        + 'no-issue-found (see evidence/registers/lib/canary.js)',
    }));
  }
  return bundle;
}

async function fetchRegisters(identityHints, opts) {
  const hints = identityHints || {};
  const options = opts || {};
  if (typeof options.fetchFn !== 'function') {
    throw new Error(
      'evidence/registers/registers.js: fetchRegisters requires opts.fetchFn (dependency-injected '
      + 'fetch; Rule 9, no raw network call is ever made by this module)'
    );
  }
  const query = resolveQuery(hints);
  const lookups = buildLookups(query, hints, options);
  const [settled, canaries] = await Promise.all([
    Promise.all(lookups.map((l) => l.run().then((result) => ({ key: l.key, result })))),
    runCanaries(options),
  ]);
  const bundle = assembleBundle(settled);
  return applyCanaryGate(bundle, canaries);
}

// ---------------------------------------------------------------------------------
// Calibration CLI (the earn-your-zero contract, eval/calibration-known-bad/run.js dialect).
// `node evidence/registers/registers.js --calibrate [--json <path>]` runs every
// p3-register-*.json fixture under eval/calibration-known-bad/fixtures/. Each fixture plants a
// non-empty, HTTP-200 register response that is NOT a real name match (C-004: the old
// register-check.js / register-grounding.js class); a FINDING is emitted only when this module
// correctly refuses to return a row for it. Zero findings means the C-004 gate is broken, and the
// calibration runner (run.js) fails CI.
// ---------------------------------------------------------------------------------
function fakeFetchFn(fixture) {
  return (url, options) => {
    const key = options && options.requestKey;
    const canned = fixture.fetchResponses && key ? fixture.fetchResponses[key] : null;
    return Promise.resolve(canned || null);
  };
}

async function runOneFixture(file, fixture) {
  const result = await fetchRegisters(fixture.hints || {}, {
    fetchFn: fakeFetchFn(fixture),
    deadlineMs: 5000,
    keys: fixture.keys || {},
    log: () => {},
  });
  const poison = fixture.poison || {};
  const forbiddenRegisters = poison.forbidden_registers || [];
  const stillPresent = forbiddenRegisters.filter((r) => result[r] !== undefined);
  if (stillPresent.length > 0 || forbiddenRegisters.length === 0) return [];
  return [{
    file,
    line: 1,
    rule: 'register-nonmatch-rejected',
    message: 'refused the poisoned non-matching candidate for ' + forbiddenRegisters.join(', ') + '; no row returned',
  }];
}

async function runCalibration(fixturesDir) {
  const fs = require('fs');
  const path = require('path');
  const dir = fixturesDir || path.join(__dirname, '..', '..', 'eval', 'calibration-known-bad', 'fixtures');
  const files = fs.readdirSync(dir).filter((f) => /^p3-register-.*\.json$/.test(f)).sort();
  const findings = [];
  for (const f of files) {
    if (!/^[a-z0-9][a-z0-9.-]{0,251}$/i.test(f)) {
      throw new Error('unsafe path component: ' + JSON.stringify(f));
    }
    const abs = path.join(dir, f);
    const fixture = JSON.parse(fs.readFileSync(abs, 'utf8'));
    findings.push(...(await runOneFixture(abs, fixture)));
  }
  return findings;
}

async function calibrateMain(argv) {
  const fs = require('fs');
  const args = argv.slice(2);
  const jsonIdx = args.indexOf('--json');
  const jsonPath = jsonIdx !== -1 ? args[jsonIdx + 1] : null;
  const findings = await runCalibration();
  if (jsonPath) fs.writeFileSync(jsonPath, JSON.stringify(findings, null, 2));
  process.stdout.write(JSON.stringify({ checker: 'registers', findings }) + '\n');
  return 0;
}

if (require.main === module) {
  if (process.argv.includes('--calibrate')) {
    calibrateMain(process.argv).then((code) => process.exit(code));
  } else {
    console.error('evidence/registers/registers.js is a library. Only --calibrate is runnable from the CLI.');
    process.exit(2);
  }
}

module.exports = {
  fetchRegisters,
  resolveQuery,
  tryUkRegisters,
  buildLookups,
  runCalibration,
  calibrateMain,
  runCanaries,
  applyCanaryGate,
  CANARY_GUARDED_REGISTERS,
};
