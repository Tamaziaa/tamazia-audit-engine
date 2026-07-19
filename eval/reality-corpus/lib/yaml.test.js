'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parse } = require('./yaml.js');

test('scalars: strings, numbers, booleans, null', () => {
  const doc = parse([
    'slug: rothwellandevans',
    'count: 3',
    'active: true',
    'ratio: 2.94',
    'note: ~',
    'quoted: "a: b # not a comment"',
    "single: 'it''s fine'",
  ].join('\n'));
  assert.equal(doc.slug, 'rothwellandevans');
  assert.equal(doc.count, 3);
  assert.equal(doc.active, true);
  assert.equal(doc.ratio, 2.94);
  assert.equal(doc.note, null);
  assert.equal(doc.quoted, 'a: b # not a comment');
  assert.equal(doc.single, "it's fine");
});

test('nested mapping and list of scalars', () => {
  const doc = parse([
    'brand:',
    '  legal: "Rothwell and Evans Limited"',
    '  trading: "Rothwell & Evans Solicitors"',
    'applicable_law_ids:',
    '  - UK_SRA_TRANSPARENCY',
    '  - UK_PECR_COOKIES_MARKETING',
  ].join('\n'));
  assert.deepEqual(doc.brand, { legal: 'Rothwell and Evans Limited', trading: 'Rothwell & Evans Solicitors' });
  assert.deepEqual(doc.applicable_law_ids, ['UK_SRA_TRANSPARENCY', 'UK_PECR_COOKIES_MARKETING']);
});

test('list of mappings, inline first key then nested siblings', () => {
  const doc = parse([
    'labelled_breaches:',
    '  - law_id: UK_SRA_TRANSPARENCY',
    '    quote_substring: "no pricing"',
    '    url: "https://example.com/fees/"',
    '  - law_id: UK_PECR_COOKIES_MARKETING',
    '    quote_substring: "google-analytics.com/analytics.js"',
    '    url: "https://example.com/"',
  ].join('\n'));
  assert.equal(doc.labelled_breaches.length, 2);
  assert.equal(doc.labelled_breaches[0].law_id, 'UK_SRA_TRANSPARENCY');
  assert.equal(doc.labelled_breaches[0].quote_substring, 'no pricing');
  assert.equal(doc.labelled_breaches[1].url, 'https://example.com/');
});

test('comments and blank lines are ignored', () => {
  const doc = parse([
    '# a top comment',
    'slug: site',
    '',
    '  # not really nested, still ignored as a whole-line comment',
    'name: value # trailing comment',
  ].join('\n'));
  assert.equal(doc.slug, 'site');
  assert.equal(doc.name, 'value');
});

test('deeply nested list of mappings with multi-field siblings', () => {
  const doc = parse([
    'establishment:',
    '  - jurisdiction: UK',
    '    tier: A',
    '    basis: "Companies House 07743894"',
    'audience:',
    '  - jurisdiction: UK',
    '    tier: C',
  ].join('\n'));
  assert.equal(doc.establishment[0].jurisdiction, 'UK');
  assert.equal(doc.establishment[0].tier, 'A');
  assert.equal(doc.audience[0].tier, 'C');
});

test('flow-style empty collections: [] and {}', () => {
  const doc = parse(['known_clean_laws: []', 'meta: {}', 'name: value'].join('\n'));
  assert.deepEqual(doc.known_clean_laws, []);
  assert.deepEqual(doc.meta, {});
  assert.equal(doc.name, 'value');
});

test('empty document returns null', () => {
  assert.equal(parse(''), null);
  assert.equal(parse('# only a comment'), null);
});
