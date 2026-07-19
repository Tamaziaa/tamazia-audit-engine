'use strict';
// facts/vocabulary.test.js - node:test suite for the facts-layer VOCABULARY single door.
// Run: node --test facts/vocabulary.test.js  (or node --test facts/*.test.js)
//
// Proves the contract every consumer (identity/jurisdiction/sector/capabilities) depends on:
//  - the identity word lists are all present and non-empty (identity.js REQUIRED_VOCABULARY_EXPORTS)
//  - the sector TREE carries all served-cells sectors and every detect regex matches a known
//    positive (the C-050 dead-regex guard) and is word-boundary anchored on every alternation (C-059)
//  - no duplicate sector / sub-sector ids
//  - aliases resolve to canonical sectors; canonicalSector never guesses a default
//  - COUNTRY_TOKENS is the code -> RegExp[] shape jurisdiction.js consumes, and adds only new codes
//  - the activity-tag set covers the 14 capability tags
//  - assertVocab FAILS CLOSED: it throws on an unknown value and on an unknown kind
//  - every exported data structure is deep-frozen (a consumer cannot mutate the vocabulary)
//  - the module holds NO catalogue-owned law facts (no regulators / no framework codes) (Rule 2)

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const vocab = require('./vocabulary.js');
const identity = require('./identity.js');
const capabilities = require('./capabilities.js');

// ---------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------

// Split a regex source into its TOP-LEVEL alternation branches, respecting (…) groups and
// [...] classes so an inner alternation like (?:care|treatment) is not mis-split.
function topLevelBranches(source) {
  const branches = [];
  let depth = 0;
  let inClass = false;
  let cur = '';
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    const prev = source[i - 1];
    if (prev !== '\\') {
      if (ch === '[' && !inClass) inClass = true;
      else if (ch === ']' && inClass) inClass = false;
      else if (!inClass && ch === '(') depth += 1;
      else if (!inClass && ch === ')') depth -= 1;
      else if (!inClass && ch === '|' && depth === 0) { branches.push(cur); cur = ''; continue; }
    }
    cur += ch;
  }
  branches.push(cur);
  return branches;
}

function eachSubNode(fn) {
  for (const [parentId, node] of Object.entries(vocab.SECTORS)) {
    for (const [subId, sub] of Object.entries(node.sub || {})) fn(parentId, subId, sub, node);
  }
}

// ---------------------------------------------------------------------------------
// Identity word lists (identity.js REQUIRED_VOCABULARY_EXPORTS)
// ---------------------------------------------------------------------------------

test('every identity REQUIRED_VOCABULARY_EXPORT is present as a non-empty string array', () => {
  for (const key of identity.REQUIRED_VOCABULARY_EXPORTS) {
    assert.ok(Array.isArray(vocab[key]), key + ' must be an array');
    assert.ok(vocab[key].length > 0, key + ' must be non-empty');
    assert.ok(vocab[key].every((s) => typeof s === 'string'), key + ' must be all strings');
  }
});

test('the present vocabulary makes identity.js prefer it (VOCABULARY_SOURCE is the module)', () => {
  assert.equal(identity.VOCABULARY_SOURCE, 'facts/vocabulary.js');
});

test('identity word lists carry no duplicate entries', () => {
  for (const key of identity.REQUIRED_VOCABULARY_EXPORTS) {
    const list = vocab[key];
    assert.equal(new Set(list).size, list.length, key + ' has a duplicate entry');
  }
});

// ---------------------------------------------------------------------------------
// Sector tree: shape, no duplicate ids, detect health, anchoring
// ---------------------------------------------------------------------------------

test('SECTORS and TREE are the same deep-frozen canonical tree', () => {
  assert.equal(vocab.TREE, vocab.SECTORS);
  assert.ok(Object.keys(vocab.SECTORS).length >= 26);
});

test('every canonical sector key is unique and matches CANONICAL_SECTORS', () => {
  const keys = Object.keys(vocab.SECTORS);
  assert.equal(new Set(keys).size, keys.length, 'duplicate top-level sector id');
  assert.deepEqual([...vocab.CANONICAL_SECTORS].sort(), keys.slice().sort());
});

// CR-36: CANONICAL_SUB_SECTORS / isCanonicalSubSector (catalogue/schema.js's sub_sector enum door).
test('CANONICAL_SUB_SECTORS is a non-empty, deduplicated, lowercase-hyphen-slug array whose members all pass isCanonicalSubSector', () => {
  assert.ok(Array.isArray(vocab.CANONICAL_SUB_SECTORS));
  assert.ok(vocab.CANONICAL_SUB_SECTORS.length > 0);
  assert.equal(new Set(vocab.CANONICAL_SUB_SECTORS).size, vocab.CANONICAL_SUB_SECTORS.length, 'duplicate CANONICAL_SUB_SECTORS entry');
  const SLUG_RX = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
  for (const s of vocab.CANONICAL_SUB_SECTORS) {
    assert.ok(SLUG_RX.test(s), s + ' is not a lowercase-hyphen slug');
    assert.equal(vocab.isCanonicalSubSector(s), true, s + ' must satisfy its own membership test');
  }
});

test('CANONICAL_SUB_SECTORS includes every SECTORS[x].sub detection-tree key (the union, never a narrower replacement)', () => {
  eachSubNode((_parentId, subId) => {
    assert.ok(vocab.isCanonicalSubSector(subId), subId + ' (a real detection-tree sub key) must remain a canonical sub-sector');
  });
});

test('isCanonicalSubSector: rejects an unknown value, is exact (no alias fold, no structural fallback), and never throws on odd input', () => {
  assert.equal(vocab.isCanonicalSubSector('not-a-real-sub-sector'), false);
  assert.equal(vocab.isCanonicalSubSector('Solicitors'), false, 'case must match exactly, no fold');
  assert.equal(vocab.isCanonicalSubSector(null), false);
  assert.equal(vocab.isCanonicalSubSector(undefined), false);
  assert.equal(vocab.isCanonicalSubSector(42), false);
  assert.equal(vocab.isCanonicalSubSector('solicitors'), true);
});

test('no duplicate fully-qualified sub-sector ids across the tree', () => {
  const ids = [];
  eachSubNode((parentId, subId) => ids.push(parentId + '/' + subId));
  assert.equal(new Set(ids).size, ids.length, 'duplicate parent/sub id: ' + ids.join(', '));
});

test('every child sector names a real parent that exists in the tree', () => {
  for (const [id, node] of Object.entries(vocab.SECTORS)) {
    if (node.parent) assert.ok(vocab.SECTORS[node.parent], id + ' names missing parent ' + node.parent);
  }
});

test('every sub-sector detect regex matches its declared positive sample (C-050 dead-regex guard)', () => {
  let checked = 0;
  eachSubNode((parentId, subId, sub) => {
    assert.ok(sub.detect instanceof RegExp, parentId + '/' + subId + ' detect must be a RegExp');
    assert.ok(typeof sub.sample === 'string' && sub.sample.length > 0, parentId + '/' + subId + ' must carry a sample');
    assert.ok(sub.detect.test(sub.sample), parentId + '/' + subId + ' detect must match its own sample: ' + sub.sample);
    checked += 1;
  });
  assert.ok(checked >= 26, 'expected a detect+sample per sub-sector, checked ' + checked);
});

test('every alternation branch of every detect regex is word-boundary anchored (C-059)', () => {
  eachSubNode((parentId, subId, sub) => {
    for (const branch of topLevelBranches(sub.detect.source)) {
      assert.ok(
        branch.includes('\\b'),
        parentId + '/' + subId + ' has an unanchored alternation branch: ' + JSON.stringify(branch)
      );
    }
  });
});

test('detect regexes are anchored: a token embedded in a larger word does not fire', () => {
  // \bgp\b must not match "gpu"; \bbank\b must not match "embankment"; \bclinic\b not "clinical".
  assert.ok(!vocab.SECTORS.healthcare.sub['general-practice'].detect.test('the gpu overheated'));
  assert.ok(!vocab.SECTORS.finance.sub.banking.detect.test('along the embankment'));
  assert.ok(!vocab.SECTORS.healthcare.sub['hospital-care'].detect.test('a purely clinical trial write-up'));
});

// ---------------------------------------------------------------------------------
// Domain self-identity (C-013): high-precision own-identity tokens -> sector family
// ---------------------------------------------------------------------------------

test('DOMAIN_SELF_IDENTITY maps every token to a real canonical sector family and is frozen', () => {
  assert.ok(Array.isArray(vocab.DOMAIN_SELF_IDENTITY) && vocab.DOMAIN_SELF_IDENTITY.length > 0);
  assert.ok(Object.isFrozen(vocab.DOMAIN_SELF_IDENTITY));
  for (const entry of vocab.DOMAIN_SELF_IDENTITY) {
    assert.ok(Array.isArray(entry) && entry.length === 2, 'each entry is [token, family]: ' + JSON.stringify(entry));
    const [token, fam] = entry;
    assert.ok(typeof token === 'string' && token.length > 0, 'token must be a non-empty string');
    assert.ok(vocab.SECTORS[fam], 'family ' + fam + ' must be a canonical sector node');
    // the family key must be a TOP family (no parent), so it compares equal to familyOf() output.
    assert.ok(!vocab.SECTORS[fam].parent, 'self-identity family ' + fam + ' must be a top-level family, not a child node');
  }
});

test('sectorSelfIdFromDomain recognises a firm naming itself in its domain, and only then', () => {
  assert.deepEqual(vocab.sectorSelfIdFromDomain('immigrationlawyersusa.com'), ['law-firms']);
  assert.deepEqual(vocab.sectorSelfIdFromDomain('smith-solicitors.co.uk'), ['law-firms']);
  assert.deepEqual(vocab.sectorSelfIdFromDomain('brightsmile-dental.co.uk'), ['healthcare']);
  // no self-identity token: a multi-disciplinary or unrelated brand yields nothing.
  assert.deepEqual(vocab.sectorSelfIdFromDomain('knightsbridge.ae'), []);
  assert.deepEqual(vocab.sectorSelfIdFromDomain(''), []);
  assert.deepEqual(vocab.sectorSelfIdFromDomain(null), []);
});

// ---------------------------------------------------------------------------------
// Sector keys stay in sync with the served-cells manifest
// ---------------------------------------------------------------------------------

test('every served-cells served sector is a canonical sector key', () => {
  const served = JSON.parse(fs.readFileSync(path.join(__dirname, 'served-cells.json'), 'utf8'));
  const missing = served.cells
    .filter((c) => c.served === true && c.sector !== '*')
    .map((c) => c.sector)
    .filter((s) => !vocab.isCanonicalSector(s));
  assert.deepEqual(missing, [], 'served sectors missing from the tree: ' + missing.join(', '));
});

// ---------------------------------------------------------------------------------
// Aliases resolve; canonicalSector never guesses a default
// ---------------------------------------------------------------------------------

test('sector aliases resolve to canonical sectors that exist in the tree', () => {
  for (const [alias, target] of Object.entries(vocab.SECTOR_ALIASES)) {
    assert.ok(vocab.SECTORS[target], 'alias ' + alias + ' -> ' + target + ' is not a canonical sector');
    assert.equal(vocab.canonicalSector(alias), target, 'alias ' + alias + ' must resolve to ' + target);
  }
});

test('canonicalSector: known canonical resolves to itself, spacing/case normalise', () => {
  assert.equal(vocab.canonicalSector('law-firms'), 'law-firms');
  assert.equal(vocab.canonicalSector('Law Firms'), 'law-firms');
  assert.equal(vocab.canonicalSector('  REAL ESTATE '), 'real-estate');
  assert.equal(vocab.canonicalSector('solicitor'), 'law-firms');
  assert.equal(vocab.canonicalSector('aesthetic'), 'aesthetics');
});

test('canonicalSector returns null on an unknown sector: it never guesses a default', () => {
  assert.equal(vocab.canonicalSector('astrology'), null);
  assert.equal(vocab.canonicalSector(''), null);
  assert.equal(vocab.canonicalSector(null), null);
  assert.equal(vocab.canonicalSector(undefined), null);
});

test('isCanonicalSector is a pure membership test', () => {
  assert.ok(vocab.isCanonicalSector('healthcare'));
  assert.ok(vocab.isCanonicalSector('dental'));
  assert.ok(!vocab.isCanonicalSector('gambling'));
  assert.ok(!vocab.isCanonicalSector('solicitor'));
});

// ---------------------------------------------------------------------------------
// Jurisdiction: COUNTRY_TOKENS shape, family alias fold, isJurisdiction
// ---------------------------------------------------------------------------------

test('COUNTRY_TOKENS is a code -> RegExp[] map that each regex matches its intent', () => {
  for (const [code, list] of Object.entries(vocab.COUNTRY_TOKENS)) {
    assert.ok(Object.prototype.hasOwnProperty.call(vocab.JURISDICTIONS, code), code + ' must be a known jurisdiction');
    assert.ok(Array.isArray(list) && list.length > 0, code + ' must carry a non-empty token list');
    assert.ok(list.every((r) => r instanceof RegExp), code + ' tokens must all be RegExp (jurisdiction.js filters to RegExp)');
    for (const branch of list.flatMap((r) => topLevelBranches(r.source))) {
      assert.ok(branch.includes('\\b'), code + ' has an unanchored country token: ' + JSON.stringify(branch));
    }
  }
  assert.ok(vocab.COUNTRY_TOKENS.SA.some((r) => r.test('based in Saudi Arabia')));
  assert.ok(vocab.COUNTRY_TOKENS.CA.some((r) => r.test('offices in Canada')));
});

test('COUNTRY_TOKENS extends only NEW codes: it never overrides the modelled internal set', () => {
  // jurisdiction.js models UK/IE/US/AE/DE/FR/NL/ES/IT internally; extending those risks loosening
  // the establishment anchoring. The vocabulary must add only additional jurisdictions.
  const internal = new Set(['UK', 'IE', 'US', 'AE', 'DE', 'FR', 'NL', 'ES', 'IT']);
  for (const code of Object.keys(vocab.COUNTRY_TOKENS)) {
    assert.ok(!internal.has(code), 'COUNTRY_TOKENS must not override internal code ' + code);
  }
});

test('famCanon folds country variants to the canonical family code', () => {
  assert.equal(vocab.famCanon('GB'), 'UK');
  assert.equal(vocab.famCanon('gbr'), 'UK');
  assert.equal(vocab.famCanon('UAE'), 'AE');
  assert.equal(vocab.famCanon('usa'), 'US');
  assert.equal(vocab.famCanon('KSA'), 'SA');
  assert.equal(vocab.famCanon('UK'), 'UK');
});

test('isJurisdiction accepts canonical codes and their aliases, rejects the unknown', () => {
  assert.ok(vocab.isJurisdiction('UK'));
  assert.ok(vocab.isJurisdiction('GB'));
  assert.ok(vocab.isJurisdiction('UAE'));
  assert.ok(vocab.isJurisdiction('US'));
  assert.ok(!vocab.isJurisdiction('ZZ'));
  assert.ok(!vocab.isJurisdiction(''));
});

// ---------------------------------------------------------------------------------
// Sub-jurisdictions: US states (incl CA/NY/TX/FL/IL), UK nations, DIFC/ADGM displacement
// ---------------------------------------------------------------------------------

test('SUB_JURISDICTIONS carries the P5 US-wave states and the UK nations', () => {
  for (const st of ['CA', 'NY', 'TX', 'FL', 'IL']) {
    assert.ok(vocab.SUB_JURISDICTIONS.US.states[st], 'US state ' + st + ' missing');
  }
  for (const nation of ['England', 'Scotland', 'Wales', 'Northern Ireland']) {
    assert.ok(vocab.SUB_JURISDICTIONS.UK.nations[nation], 'UK nation ' + nation + ' missing');
  }
});

test('DIFC and ADGM are free zones that displace the AE federal DP regime, DIFC first', () => {
  const fz = vocab.SUB_JURISDICTIONS.AE.free_zones;
  assert.ok(fz.DIFC && fz.ADGM);
  assert.ok(fz.DIFC.precedence < fz.ADGM.precedence, 'DIFC must take precedence over ADGM');
  assert.deepEqual(fz.DIFC.displaces, [vocab.AE_FEDERAL_DP_TOKEN]);
  assert.deepEqual(fz.ADGM.displaces, [vocab.AE_FEDERAL_DP_TOKEN]);
  assert.match(vocab.SUB_JURISDICTIONS.AE.displacement_note, /displaces/i);
});

// ---------------------------------------------------------------------------------
// Activity tags cover the 14 capability tags
// ---------------------------------------------------------------------------------

test('ACTIVITY_TAGS covers every capability tag capabilities.js emits', () => {
  for (const tag of capabilities.CAPABILITY_TAGS) {
    assert.ok(vocab.ACTIVITY_TAGS.includes(tag), 'ACTIVITY_TAGS missing capability tag ' + tag);
  }
  assert.equal(new Set(vocab.ACTIVITY_TAGS).size, vocab.ACTIVITY_TAGS.length, 'duplicate activity tag');
  assert.equal(capabilities.VOCABULARY_LINKED, true, 'capabilities.js must link cleanly to this vocabulary');
});

// ---------------------------------------------------------------------------------
// Shared enums
// ---------------------------------------------------------------------------------

test('CONFIDENCE_LEVELS and FINDING_STATES are the closed enums the facts layer grades on', () => {
  assert.deepEqual(vocab.CONFIDENCE_LEVELS, ['register', 'corroborated', 'weak', 'abstain']);
  assert.deepEqual(vocab.FINDING_STATES, ['violation', 'needs_review', 'pass']);
  assert.deepEqual(vocab.NEXUS_TYPES, ['established_in', 'serves_customers_in', 'processes_residents_of']);
});

// ---------------------------------------------------------------------------------
// assertVocab FAILS CLOSED (Constitution Rule 4)
// ---------------------------------------------------------------------------------

test('assertVocab returns the value on a known-good input', () => {
  assert.equal(vocab.assertVocab('sector', 'law-firms'), 'law-firms');
  assert.equal(vocab.assertVocab('jurisdiction', 'GB'), 'GB');
  assert.equal(vocab.assertVocab('activity_tag', 'uses_ai'), 'uses_ai');
  assert.equal(vocab.assertVocab('confidence', 'register'), 'register');
  assert.equal(vocab.assertVocab('finding_state', 'needs_review'), 'needs_review');
  assert.equal(vocab.assertVocab('nexus', 'established_in'), 'established_in');
});

test('assertVocab THROWS on an unknown value (fail closed, never defaulted)', () => {
  assert.throws(() => vocab.assertVocab('sector', 'gambling'), /not a valid sector/);
  assert.throws(() => vocab.assertVocab('activity_tag', 'mind_reading'), /not a valid activity_tag/);
  assert.throws(() => vocab.assertVocab('confidence', 'probably'), /not a valid confidence/);
  assert.throws(() => vocab.assertVocab('finding_state', 'maybe'), /not a valid finding_state/);
  assert.throws(() => vocab.assertVocab('jurisdiction', 'ZZ'), /not a valid jurisdiction/);
});

test('assertVocab THROWS on an unknown vocabulary kind', () => {
  assert.throws(() => vocab.assertVocab('planet', 'mars'), /unknown vocabulary kind/);
  assert.throws(() => vocab.assertVocab('', 'x'), /unknown vocabulary kind/);
});

// ---------------------------------------------------------------------------------
// Everything exported is deep-frozen
// ---------------------------------------------------------------------------------

test('the sector tree is deep-frozen: a consumer cannot mutate it', () => {
  assert.ok(Object.isFrozen(vocab.SECTORS));
  assert.ok(Object.isFrozen(vocab.SECTORS['law-firms']));
  assert.ok(Object.isFrozen(vocab.SECTORS['law-firms'].sub));
  assert.ok(Object.isFrozen(vocab.SECTORS['law-firms'].sub.solicitors));
  assert.throws(() => { vocab.SECTORS.newsector = {}; }, TypeError);
  assert.throws(() => { vocab.SECTORS['law-firms'].label = 'x'; }, TypeError);
});

test('the exported arrays and token maps are frozen', () => {
  assert.ok(Object.isFrozen(vocab.ACTIVITY_TAGS));
  assert.ok(Object.isFrozen(vocab.CONFIDENCE_LEVELS));
  assert.ok(Object.isFrozen(vocab.FINDING_STATES));
  assert.ok(Object.isFrozen(vocab.NEXUS_TYPES));
  assert.ok(Object.isFrozen(vocab.SECTOR_ALIASES));
  assert.ok(Object.isFrozen(vocab.JURISDICTIONS));
  assert.ok(Object.isFrozen(vocab.COUNTRY_TOKENS));
  assert.ok(Object.isFrozen(vocab.COUNTRY_TOKENS.SA));
  assert.ok(Object.isFrozen(vocab.SUB_JURISDICTIONS));
  assert.ok(Object.isFrozen(vocab.SUB_JURISDICTIONS.US.states));
  assert.throws(() => { vocab.ACTIVITY_TAGS.push('x'); }, TypeError);
  assert.throws(() => { vocab.CONFIDENCE_LEVELS[0] = 'x'; }, TypeError);
});

// ---------------------------------------------------------------------------------
// Catalogue-only law facts (Constitution Rule 2): no regulator strings, no framework codes
// ---------------------------------------------------------------------------------

test('the sector tree holds no catalogue-owned law facts (no regulators, no framework codes)', () => {
  eachSubNode((parentId, subId, sub, node) => {
    assert.ok(!('regulators' in node), parentId + ' must not carry regulators (catalogue-owned)');
    assert.ok(!('frameworks' in sub), parentId + '/' + subId + ' must not carry framework codes (catalogue-owned)');
  });
});

// ---------------------------------------------------------------------------------
// Sub-sector binding taxonomy (P6 connection-integrity, empirical-healthcare D4)
// ---------------------------------------------------------------------------------

test('every P6-added detection leaf (healthcare + legal) is real, ships a matching sample, and is classifier-emittable', () => {
  const added = [
    ['healthcare', 'care-home'], ['healthcare', 'optometry'], ['healthcare', 'physiotherapy'],
    ['healthcare', 'veterinary'], ['healthcare', 'pharmaceutical'], ['healthcare', 'medical-devices'],
    ['healthcare', 'supplements'], ['law-firms', 'licensed-conveyancers'], ['law-firms', 'legal-executives'],
  ];
  for (const [parent, leaf] of added) {
    const node = vocab.SECTORS[parent].sub[leaf];
    assert.ok(node, parent + '/' + leaf + ' must be a detection leaf');
    assert.ok(node.detect instanceof RegExp && node.detect.test(node.sample), parent + '/' + leaf + ' detect must match its sample');
    assert.ok(vocab.CLASSIFIER_SUB_SECTORS.includes(leaf), leaf + ' must be classifier-emittable');
  }
});

test('every SUB_SECTOR_SYNONYMS target is a real classifier-emittable leaf (one door integrity)', () => {
  for (const [syn, leaf] of Object.entries(vocab.SUB_SECTOR_SYNONYMS)) {
    assert.ok(vocab.CLASSIFIER_SUB_SECTORS.includes(leaf), 'synonym ' + syn + ' -> ' + leaf + ' must target a real leaf');
    assert.ok(vocab.isCanonicalSubSector(syn), 'synonym key ' + syn + ' must itself be a canonical sub-sector');
  }
});

test('subSectorBinds: exact leaf, coarse parent/family label, and synonym all bind', () => {
  assert.equal(vocab.subSectorBinds(['injectables'], 'injectables', new Set(['aesthetics', 'healthcare'])), true, 'exact leaf');
  assert.equal(vocab.subSectorBinds(['aesthetics'], 'injectables', new Set(['aesthetics', 'healthcare'])), true, 'parent sector label');
  assert.equal(vocab.subSectorBinds(['gp-clinic'], 'general-practice', new Set(['healthcare'])), true, 'synonym');
  assert.equal(vocab.subSectorBinds(['law-firm', 'attorney'], 'solicitors', new Set(['law-firms'])), true, 'US synonyms');
});

test('subSectorBinds does NOT over-bind: a sibling leaf never matches an unrelated coarse label', () => {
  assert.equal(vocab.subSectorBinds(['aesthetics'], 'general-dental', new Set(['dental', 'healthcare'])), false,
    'a dental firm is not aesthetics');
  assert.equal(vocab.subSectorBinds(['injectables'], 'general-practice', new Set(['healthcare'])), false,
    'a GP is not an injectables firm');
  assert.equal(vocab.subSectorBinds([], 'injectables', new Set(['aesthetics'])), false, 'an empty tag list never binds here');
});

test('isReachableSubSector: leaves, sector-node parent labels and synonyms are reachable; a typo and a firm-structure tag are not', () => {
  for (const t of ['injectables', 'care-home', 'veterinary', 'aesthetics', 'dental', 'law-firms', 'gp-clinic', 'attorney']) {
    assert.equal(vocab.isReachableSubSector(t), true, t + ' should be reachable');
  }
  for (const t of ['not-a-real-thing', 'solo-practice', 'wellness', 'conveyancing']) {
    assert.equal(vocab.isReachableSubSector(t), false, t + ' should be unreachable');
  }
});

test('recordSubSectorBindable: empty binds all; one reachable tag suffices; all-unreachable is dead', () => {
  assert.equal(vocab.recordSubSectorBindable([]), true, 'empty = no restriction');
  assert.equal(vocab.recordSubSectorBindable(['wellness', 'supplements']), true, 'one reachable tag (supplements) suffices');
  assert.equal(vocab.recordSubSectorBindable(['wellness']), false, 'a sole unreachable tag is a dead record');
  assert.equal(vocab.recordSubSectorBindable(['conveyancing', 'probate']), false, 'all-unreachable is dead');
});

test('the sub-sector binding taxonomy exports are deep-frozen (a consumer cannot mutate the one door)', () => {
  assert.ok(Object.isFrozen(vocab.SUB_SECTOR_SYNONYMS));
  assert.ok(Object.isFrozen(vocab.CLASSIFIER_SUB_SECTORS));
});

// DEFECT-7 (empirical legal-US Finding 1): each US legal term added to the law-firms/solicitors leaf
// ships a KNOWN-POSITIVE (it fires the detect) AND is proven not to fire on a cross-sector negative,
// so a physiotherapy or insurance page cannot score a legal cue on "personal injury"/"counsel".
test('DEFECT-7: every US legal term is a known-positive on the solicitors detect (no dead branch, C-050)', () => {
  const detect = vocab.SECTORS['law-firms'].sub.solicitors.detect;
  const positives = [
    'call our attorney', 'our attorneys', 'a lawyer', 'personal injury lawyers', 'our law office',
    'we handle litigation', 'John Doe, Esq.', 'a trial attorney', 'of counsel to the firm',
    'independent legal counsel', 'personal injury claim',
  ];
  for (const p of positives) {
    assert.ok(detect.test(p), 'the solicitors detect must fire on the US legal term: ' + JSON.stringify(p));
  }
});

test('DEFECT-7: the US legal terms do NOT fire on cross-sector negatives (personal injury/counsel anchoring)', () => {
  const detect = vocab.SECTORS['law-firms'].sub.solicitors.detect;
  const negatives = [
    'we treat personal injury and sports injuries',   // physiotherapy: "personal injury" not followed by a legal word
    'grief counselling and career counsel',           // "counsel" only binds as "of/legal counsel"
    'the picturesque lakeside clinic',                 // "esque" must never match the \besq\b honorific
    'our attorneyship programme for graduates',        // \battorneys?\b must not fire inside a larger word
  ];
  for (const n of negatives) {
    assert.ok(!detect.test(n), 'the solicitors detect must NOT fire on the non-legal phrase: ' + JSON.stringify(n));
  }
});
