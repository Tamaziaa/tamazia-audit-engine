'use strict';
// CALIBRATION FIXTURE (self-driving dialect) for the P6 facts-layer integrity fixes: jurisdiction
// binding for real US/UK address + phone formats (DEFECT-3), the US legal classifier (DEFECT-7) and
// US state-bar authorisation as Tier-A establishment (DEFECT-8). It closes repetition class #5 (the
// jurisdiction anchoring inverted into total over-abstention) under the ONE meta-discipline the
// repetition audit named: no detector earns a green until a fail-closed control has proven it can
// produce the OPPOSITE result. So every capability below carries BOTH a POSITIVE control (the real
// firm binds / classifies) AND a NEGATIVE control (the fix opened no false-binding hole: a .com or a
// lone domestic number never binds, a healthcare/insurance site never classifies legal, a bare bar
// mention never binds). A regression in EITHER direction fails this gate (Constitution Rule 4).
//
// Corpus strings are the empirical sites' ACTUAL captured text (healthcare-US Defect D / legal-US
// Findings 1,3,4 / legal-UK Fix 4). No secrets, no PII beyond a public firm name in a synthetic
// sentence.
//
// The facts-level legs are MANDATORY and self-sufficient (they need no compiled catalogue), so this
// fixture runs on EVERY CI invocation, BEFORE `npm run catalogue`. An OPTIONAL supplementary leg runs
// the whole facts -> applicability/connect pipeline against the real compiled catalogue when its dist
// artifact is present (local runs after `npm run catalogue`), proving the established_in-only state
// record CA_RPC_CH7 binds a bar-authorised firm and is correctly EXCLUDED for a firm without Tier-A
// establishment.
//
// DIALECT (matches p4-applicability-leak.js): calibrate() returns findings on a correct catch, [] (with
// the misses printed to stderr) on any regression. Standalone: `node <this file>` exits 1 on a miss.

const fs = require('fs');
const path = require('path');

// STRING-LITERAL REQUIRES ONLY (tools/one-door reachability discipline): a runtime-built require() path
// is invisible to the reachability gate, which is how correct legal logic once sat dead in production.
const { resolveJurisdiction } = require('../../../facts/jurisdiction.js');
const { resolveSector } = require('../../../facts/sector.js');
const { connect } = require('../../../applicability/connect.js');
const DIST_PATH = path.resolve(__dirname, '..', '..', '..', 'catalogue', 'dist', 'catalogue.v1.json');

function bundle(text, domain) {
  return { domain: domain || 'example.com', corpus: { pages: [{ url: 'https://x/', title: 'x', text, jsonLd: [] }], footerText: '' }, registers: {} };
}
function boundCodes(out) { return out.bound.map((b) => b.jurisdiction); }
function stateStatus(out, code) { const s = out.sub_jurisdictions.find((x) => x.code === code); return s ? s.status : null; }
function hasTierA(out, code, kind) {
  const b = out.bound.find((x) => x.jurisdiction === code);
  return !!(b && b.tier_evidence.some((e) => e.tier === 'A' && e.kind === kind));
}

// ── DEFECT-3 + DEFECT-8: jurisdiction binding controls ──────────────────────────────────────────────
function jurisdictionMisses() {
  const misses = [];
  const mustBind = (label, text, domain, code, extra) => {
    const out = resolveJurisdiction(bundle(text, domain));
    if (!boundCodes(out).includes(code)) misses.push('[jur+] ' + label + ': expected ' + code + ' to bind, got [' + boundCodes(out).join(', ') + ']');
    else if (extra) { const e = extra(out); if (e) misses.push('[jur+] ' + label + ': ' + e); }
  };
  const mustNotBindUs = (label, text, domain) => {
    const out = resolveJurisdiction(bundle(text, domain));
    if (boundCodes(out).includes('US')) misses.push('[jur-] ' + label + ': US wrongly bound (false-binding hole)');
  };

  // POSITIVE: the three real firms that were refused an entire audit by over-abstention.
  mustBind('vanfamilymedical US (spelled-out state + domestic phone)',
    'Head Office\n\n488 West Main Ste. 101 Van, Texas 75790\n\n903-963-6850', 'vanfamilymedical.com', 'US',
    (o) => stateStatus(o, 'TX') === 'bound' ? null : 'Texas should be a BOUND state nexus');
  mustBind('avidlawyers US (state code + NANP phone)',
    '1925 E 6th Ave Unit 10, Tampa, FL 33605, United States. Call (813) 800-0810.', 'avidlawyers.com', 'US',
    (o) => stateStatus(o, 'FL') === 'bound' ? null : 'Florida should be a BOUND state nexus');
  mustBind('ukimmigration UK (bracketed +44 (0) phone + postcode)',
    '794 Cranbrook Road, Ilford, IG6 1HZ, UK. Call +44 (0) 7896 085 553.', 'ukimmigrationconsulting.com', 'UK');

  // POSITIVE (DEFECT-8): a bar authorisation with a number is Tier-A establishment in the state.
  const barOut = resolveJurisdiction(bundle('John Smith is a member of the State Bar of California, Bar No. 245123.', 'smithlaw.com'));
  if (!boundCodes(barOut).includes('US')) misses.push('[jur+] bar-authorisation: US did not bind at Tier A');
  else if (!hasTierA(barOut, 'US', 'authorisation')) misses.push('[jur+] bar-authorisation: US bound but not via a Tier-A authorisation kind');
  if (stateStatus(barOut, 'CA') !== 'bound') misses.push('[jur+] bar-authorisation: California should be a BOUND state nexus');

  // NEGATIVE: the fix opened no false-binding hole.
  mustNotBindUs('lone NANP phone (no US address)', 'Call us on 903-963-6850 for a quote.', 'acme.com');
  mustNotBindUs('bare .com (no other evidence)', 'Welcome to our website.', 'acme.com');
  mustNotBindUs('a UK "+44 (0)" number never binds US', 'Call +44 (0) 7896 085 553. Office at 794 Cranbrook Road, Ilford, IG6 1HZ.', 'x.co.uk');
  const barMention = resolveJurisdiction(bundle('If you have a concern you may file a complaint with the State Bar of California.', 'acme.com'));
  if (boundCodes(barMention).includes('US')) misses.push('[jur-] bar-mention (no number): US wrongly bound off a bare state-bar mention');
  return misses;
}

// ── DEFECT-7: US legal classifier controls ──────────────────────────────────────────────────────────
function classifierMisses() {
  const misses = [];
  const sectorOf = (text, domain) => { const r = resolveSector(bundle(text, domain)); return r.value ? r.value.sector : null; };

  // POSITIVE: a US attorney site (brand-style domain, US practice terms only) resolves law-firms.
  if (sectorOf('Our attorneys and personal injury lawyers recovered over one billion dollars. Contact our law office for litigation and trial representation. Samuel Miklos, Esq.', 'ask4sam.net') !== 'law-firms') {
    misses.push('[cls+] a US personal-injury attorney site did not resolve law-firms (DEFECT-7)');
  }
  // NEGATIVE: healthcare and insurance sites that mention legal phrases stay in their own sector.
  if (sectorOf('Our physiotherapy clinic offers physio, manual therapy and musculoskeletal rehabilitation. We treat personal injury cases, sports injuries and whiplash.', 'meadow-physio.co.uk') === 'law-firms') {
    misses.push('[cls-] a physiotherapy clinic treating "personal injury" was wrongly pulled into legal');
  }
  if (sectorOf('ShieldSure is an insurance company offering home insurance and car insurance from a leading insurer and underwriter. We provide litigation support and legal counsel for insurance claims.', 'shieldsure.co.uk') === 'law-firms') {
    misses.push('[cls-] an insurer offering "litigation support"/"legal counsel" was wrongly pulled into legal');
  }
  return misses;
}

// ── OPTIONAL integration leg: facts -> applicability/connect against the real compiled catalogue ──────
function factsFor(text, domain) {
  return {
    jurisdiction: resolveJurisdiction(bundle(text, domain)),
    sector: resolveSector(bundle(text, domain)),
    capabilities: null,
  };
}
function integrationMisses(records) {
  const misses = [];
  const applied = (facts) => new Set(connect(facts, records).applicable.map((r) => r.id));

  // A bar-authorised CA firm: CA_RPC_CH7 (established_in-only, sub_jurisdiction CA) MUST now bind.
  const barFirm = factsFor(
    'Pines Salomon are personal injury attorneys and trial lawyers. Attorney John Smith is a member of the '
    + 'State Bar of California, Bar No. 245123. Office at 100 Main St, San Diego, CA 92101.', 'pineslaw.com');
  const barApplied = applied(barFirm);
  if (!barApplied.has('CA_RPC_CH7')) {
    misses.push('[dist] a bar-authorised CA firm did NOT bind CA_RPC_CH7 (established_in still unsatisfiable - DEFECT-8 regressed)');
  }
  // A CA firm WITHOUT bar credentials (address + domestic phone only): CA_RPC_CH7 (established_in-only)
  // MUST be excluded (no Tier-A establishment), while the serves-fallback US_ABA records still bind
  // (usefulness control: the audit proceeds, we simply do not over-bind the state-specific rule).
  const noBar = factsFor(
    'Pines Salomon are personal injury attorneys and trial lawyers. Office at 100 Main St, San Diego, CA '
    + '92101. Call (619) 555-0100 for a free consultation.', 'pineslaw.com');
  const noBarApplied = applied(noBar);
  if (noBarApplied.has('CA_RPC_CH7')) {
    misses.push('[dist] a CA firm with NO bar credentials wrongly bound CA_RPC_CH7 (established_in must need Tier-A establishment, Rule 13)');
  }
  if (!noBarApplied.has('US_ABA_FEE_ADVERTISING')) {
    misses.push('[dist] usefulness: the serves-fallback US_ABA_FEE_ADVERTISING did not bind a bound US law firm (the filter is vacuously excluding everything)');
  }
  return misses;
}

function runTrials() {
  const misses = [];
  misses.push(...jurisdictionMisses());
  misses.push(...classifierMisses());
  if (fs.existsSync(DIST_PATH)) {
    let records = null;
    try { records = JSON.parse(fs.readFileSync(DIST_PATH, 'utf8')).records; }
    catch (err) {
      // FAIL-CLOSED: a present-but-unreadable compiled catalogue is a real defect for the supplementary
      // leg; record it as a miss rather than swallow it (the mandatory facts legs above already ran).
      misses.push('[dist] the compiled catalogue is present but unreadable: ' + String(err && err.message));
    }
    if (Array.isArray(records) && records.length > 0) misses.push(...integrationMisses(records));
  }
  return misses;
}

function calibrate() {
  const misses = runTrials();
  if (misses.length > 0) {
    for (const m of misses) console.error('MISSED TRAP ' + m);
    return [];
  }
  return [{
    file: __filename,
    rule: 'p6-facts-binding-controls',
    message: 'trap caught: real US/UK address+phone formats bind (DEFECT-3), US attorney sites classify '
      + 'law-firms (DEFECT-7), a US bar authorisation is Tier-A establishment (DEFECT-8); and every '
      + 'negative control held (a .com / lone domestic number never binds, a healthcare/insurance site '
      + 'never classifies legal, a bare bar mention never binds)'
      + (fs.existsSync(DIST_PATH) ? ' - plus CA_RPC_CH7 binds a bar-authorised firm and is excluded without Tier-A establishment on the real catalogue' : ' (no dist artifact present)'),
  }];
}

module.exports = { runTrials, calibrate, jurisdictionMisses, classifierMisses, integrationMisses };

if (require.main === module) {
  const findings = calibrate();
  if (findings.length === 0) {
    console.error('p6-facts-binding-controls: trap MISSED - a facts-layer binding/classifier control regressed (see MISSED TRAP lines above)');
    process.exit(1);
  }
  console.log(JSON.stringify({ checker: 'p6-facts-binding-controls', findings }));
  process.exit(0);
}
