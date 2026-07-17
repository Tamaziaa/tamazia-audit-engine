'use strict';
// coverage-contract.test.js - coverage as blocking data, and the C-044 anchored-classify proof.
//
// The seeded p3-crawl-substring-classify fixture is the load-bearing case: classify() must anchor on path
// tokens (/feedback is not 'fees', /cost-of-living is not 'pricing'), never a loose substring, so coverage
// is not over-credited and a breach never fires on a page the crawl only THOUGHT it had.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const cov = require('./coverage-contract.js');

const FIX = path.join(__dirname, '..', '..', 'eval', 'calibration-known-bad', 'fixtures');
function loadFixture(name) { return JSON.parse(fs.readFileSync(path.join(FIX, name), 'utf8')); }

test('C-044: classify anchors on path tokens, never substrings (p3-crawl-substring-classify)', () => {
  const fx = loadFixture('p3-crawl-substring-classify.json');
  for (const c of fx.cases) {
    assert.equal(cov.classify(c.url), c.expect, c.url + ' must classify as ' + c.expect);
    if (c.trap) assert.notEqual(cov.classify(c.url), c.trap, c.url + ' must NEVER classify as the substring trap ' + c.trap);
  }
});

test('pagePath strips scheme/host/query/fragment to a normalised leading-slash path', () => {
  assert.equal(cov.pagePath('https://x.example/Privacy-Policy?a=1#top'), '/privacy-policy');
  assert.equal(cov.pagePath({ url: 'https://x.example/our/fees' }), '/our/fees');
  assert.equal(cov.pagePath('https://x.example/'), '/');
});

test('classify: the homepage and general pages', () => {
  assert.equal(cov.classify('https://x.example/'), 'homepage');
  assert.equal(cov.classify('https://x.example/index.html'), 'homepage');
  assert.equal(cov.classify('https://x.example/some/random/page'), 'other');
});

test('computeCoverage: enough required classes -> assessable, too few -> screened, none -> screened', () => {
  const assessable = cov.computeCoverage([{ url: 'https://x/' }, { url: 'https://x/privacy' }], null);
  assert.equal(assessable.render_class, 'assessable');
  assert.ok(assessable.fetched_classes.includes('privacy'));
  assert.equal(assessable.reachable, true);

  const screened = cov.computeCoverage([{ url: 'https://x/about' }], 'law-firms');
  assert.equal(screened.render_class, 'screened', 'a law firm with only an about page has too little coverage');

  const empty = cov.computeCoverage([], null);
  assert.equal(empty.render_class, 'screened');
  assert.equal(empty.reachable, false);
});

test('coverageFor: a rule whose needed page-class was crawled is covered; a missing one is screened', () => {
  const rules = [{ id: 'R1', website_obligations: [{ evidence_type: 'presence', duty: 'publish a complaints procedure', elements: ['complaints'] }] }];
  const covered = cov.coverageFor(rules, [{ url: 'https://x/complaints' }]);
  assert.equal(covered.rules[0].state, 'covered');

  const screened = cov.coverageFor(rules, [{ url: 'https://x/' }]);
  assert.equal(screened.rules[0].state, 'screened');
  assert.equal(cov.isScreened(screened, 'R1'), true);
});

test('coverageFor: a register/behavioural rule with no on-page text obligation is never gated by the crawl', () => {
  const rules = [{ id: 'REG', website_obligations: [{ evidence_type: 'register', duty: 'be on the FCA register' }] }];
  const out = cov.coverageFor(rules, []);
  assert.equal(out.rules[0].state, 'covered');
  assert.match(out.rules[0].reason, /non-crawl-evidence/);
});

test('INTERLOCK: a page-class living only in an unparsed document screens the obligation (C-033)', () => {
  const rules = [{ id: 'PRIV', website_obligations: [{ evidence_type: 'absence', duty: 'publish a privacy policy', elements: ['privacy'] }] }];
  const out = cov.coverageFor(rules, [{ url: 'https://x/' }], { unparsedClasses: new Set(['privacy']) });
  assert.equal(out.rules[0].state, 'screened');
  assert.match(out.rules[0].reason, /unparsed document/);
});

test('INTERLOCK: an absence claim on a truncated corpus is demoted to needs-review (C-024)', () => {
  const rules = [{ id: 'PRIV', website_obligations: [{ evidence_type: 'absence', duty: 'privacy policy present', elements: ['privacy'] }] }];
  const out = cov.coverageFor(rules, [{ url: 'https://x/privacy' }], { truncated: true });
  assert.equal(out.rules[0].state, 'screened');
  assert.match(out.rules[0].reason, /truncated/);
});

test('applyCoverage drops breach ("miss") findings when the SITE coverage is screened', () => {
  const findings = [{ id: 'a', status: 'miss' }, { id: 'b', status: 'hit' }];
  const screened = { render_class: 'screened' };
  const assessable = { render_class: 'assessable' };
  assert.deepEqual(cov.applyCoverage(findings, screened).map((f) => f.id), ['b']);
  assert.deepEqual(cov.applyCoverage(findings, assessable).map((f) => f.id), ['a', 'b']);
});
