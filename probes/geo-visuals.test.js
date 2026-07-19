'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { ENGINES, engineGrid, radarAxes } = require('./geo-visuals.js');

test('ENGINES is the fixed exactly-8 list', () => {
  assert.strictEqual(ENGINES.length, 8);
});

test('engineGrid returns exactly 8 rows, each engineEstimate:true (a modelled figure is never dressed as a direct per-engine measurement)', () => {
  const rows = engineGrid({ has_org_schema: true, has_same_as: true, in_wikidata: true, blocked_ai_bots: [] }, 80);
  assert.strictEqual(rows.length, 8);
  assert.ok(rows.every((r) => r.engineEstimate === true));
  assert.ok(rows.every((r) => r.readiness >= 0 && r.readiness <= 100));
  assert.ok(rows.every((r) => r.cited === true), 'a >=50 share of voice reads as cited');
});

test('engineGrid readiness is lower for a firm with no entity schema, no sameAs, no Wikidata entity, blocked bots', () => {
  const strong = engineGrid({ has_org_schema: true, has_same_as: true, in_wikidata: true, blocked_ai_bots: [] }, 100);
  const weak = engineGrid({ has_org_schema: false, has_same_as: false, in_wikidata: false, blocked_ai_bots: ['GPTBot', 'ClaudeBot'] }, 0);
  for (let i = 0; i < 8; i++) assert.ok(weak[i].readiness < strong[i].readiness);
});

test('radarAxes returns the 6 fixed axes the dossier chart binding expects', () => {
  const axes = radarAxes({ has_org_schema: true, has_service: true, has_faq: false }, 40, 5);
  assert.strictEqual(axes.length, 6);
  const labels = axes.map((a) => a.label);
  assert.deepStrictEqual(labels, ['Entity', 'Crawler access', 'Share of voice', 'Schema', 'Knowledge graph', 'Citations']);
  assert.strictEqual(axes[2].v, 40, 'the Share of voice axis carries the REAL probe value, unmodelled');
});

test('KNOWN-BAD calibration: an absent ai-readiness input never throws, degrades to a zeroed radar/grid', () => {
  assert.strictEqual(engineGrid(null, null).length, 8);
  assert.strictEqual(radarAxes(null, null, NaN).length, 6);
});
