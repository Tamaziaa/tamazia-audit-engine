'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { buildEntityCard, factSummary } = require('./entity-card.js');

test('buildEntityCard projects the facts doors output without inventing anything', () => {
  const facts = {
    identity: { domain: 'x.com', display_name: { value: 'X Ltd', confidence: 'corroborated' } },
    jurisdiction: { bound: [{ jurisdiction: 'UK', confidence: 'tier-a', tier_evidence: ['companies-house'] }], serves: ['UK', 'EU'] },
    sector: { value: { sector: 'healthcare', sub_sector: 'gp-clinic' }, conflict_flag: false, contradictions: [] },
    capabilities: { has_booking: true },
  };
  const card = buildEntityCard(facts);
  assert.strictEqual(card.domain, 'x.com');
  assert.strictEqual(card.identity.display_name.value, 'X Ltd');
  assert.strictEqual(card.jurisdiction.bound[0].jurisdiction, 'UK');
  assert.strictEqual(card.sector.value.sector, 'healthcare');
  assert.deepStrictEqual(card.capabilities, { has_booking: true });
});

test('buildEntityCard tolerates a fully abstained/empty facts object without throwing', () => {
  const card = buildEntityCard({});
  assert.strictEqual(card.domain, null);
  assert.strictEqual(card.identity.display_name, null);
  assert.deepStrictEqual(card.jurisdiction.bound, []);
  assert.strictEqual(card.sector.value, null);
});

test('factSummary defaults confidence to abstain for a missing fact', () => {
  assert.strictEqual(factSummary(null), null);
  assert.deepStrictEqual(factSummary({ value: 'x' }), { value: 'x', confidence: 'abstain' });
});
