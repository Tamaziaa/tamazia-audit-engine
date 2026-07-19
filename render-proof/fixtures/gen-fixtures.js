'use strict';
// render-proof/fixtures/gen-fixtures.js - regenerate the render-proof golden fixtures. ONE command records
// both, deterministically (no clock, no network):
//
//   node render-proof/fixtures/gen-fixtures.js
//
//   1. reads render-proof/fixtures/golden-inputs.json (the compose inputs; law names/penalties live HERE, in
//      JSON the one-door fine/law-literal scan never reads, not in any scanned .js).
//   2. runs the ENGINE'S OWN payload/composer/compose.js over them -> a genuine, contract-valid v1.1 payload
//      (never a hand-mocked shape), written to render-proof/fixtures/audit-golden-v11.json.
//   3. renders that payload to the audit page's visible text via reference-render.js (the render-contract
//      stand-in for the absent website lux renderer; see its header) -> audit-golden-v11.rendered.txt.
//
// The spec (render-proof/truth-pack.spec.js) reads the two RECORDED artifacts, never re-composes/re-renders at
// test time except for one drift-lock test that re-renders and asserts equality with the committed .txt. When
// the website lux renderer lands, repoint step 3 at it (executed in jsdom) and re-record; truth-pack.js is
// renderer-agnostic and does not change.

const fs = require('fs');
const path = require('path');

const { compose } = require('../../payload/composer/compose.js');
const { renderAuditText } = require('./reference-render.js');

const DIR = __dirname;
const INPUTS = path.join(DIR, 'golden-inputs.json');
const GOLDEN = path.join(DIR, 'audit-golden-v11.json');
const RENDERED = path.join(DIR, 'audit-golden-v11.rendered.txt');

// stripUnderscored(obj) -> a shallow clone with the fixture-only _keys removed, so the compose INPUT is a
// clean engine input (the _fixtureNote lives in the JSON for the reader, never reaches compose()).
function stripUnderscored(obj) {
  const out = {};
  for (const k of Object.keys(obj)) if (!k.startsWith('_')) out[k] = obj[k];
  return out;
}

function main() {
  const rawInputs = JSON.parse(fs.readFileSync(INPUTS, 'utf8'));
  const inputs = stripUnderscored(rawInputs);
  const payload = compose(inputs); // throws (fail closed) if it would emit a contract-invalid payload
  fs.writeFileSync(GOLDEN, JSON.stringify(payload, null, 2) + '\n');
  const text = renderAuditText(payload);
  fs.writeFileSync(RENDERED, text);
  console.log('wrote ' + path.relative(path.join(DIR, '..', '..'), GOLDEN) + ' (' + JSON.stringify(payload).length + ' bytes of payload)');
  console.log('wrote ' + path.relative(path.join(DIR, '..', '..'), RENDERED) + ' (' + text.length + ' chars of rendered text)');
  console.log('exposure headline: ' + (payload.exposure && payload.exposure.value) + '; ceiling: ' + (payload.exposureWaterfall && payload.exposureWaterfall.ceiling && payload.exposureWaterfall.ceiling.value));
}

if (require.main === module) main();
module.exports = { main };
