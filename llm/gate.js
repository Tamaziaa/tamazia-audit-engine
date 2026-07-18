'use strict';
// llm/gate.js - THE post-hoc structural gate every LLM response passes before any consumer sees it
// (Constitution Rule 11 + Rule 12 gates 1-2, GAPS.md llm-unverified). Deterministic, no network,
// fail-closed. A rejected response NEVER reaches a consumer: the gate returns ABSTAIN semantics
// (ok:false, value:null), never a repaired or partial answer.
//
//   validateResponse(response, { schema, allowedSourceIds, sources, minQuoteLen }) ->
//     { ok:true,  value, violations:[] }                     (accepted)
//     { ok:false, value:null, abstain:true, violations[] }   (refused; the failure mode is silence)
//
// The three deterministic checks (research grounding: docs/discovery/digest-research-llm-agents.md
// Part A, patterns 1, 2 and 6/7 - schema guarantees SHAPE, not truth, so a separate semantic gate
// must follow):
//   0. PARSE          unparseable JSON = reject. A model reply that is not valid JSON is refused, it
//                     is never coerced (caution.md C-137: the parse-fragile prompt-only-JSON lane).
//   1. SCHEMA         a tiny built-in JSON-Schema subset validates required fields, types, enums and
//                     bounds. No new dependency (Constitution: zero runtime deps); mirrors the pure
//                     path-list validator style of payload/contract/index.js.
//   2. RETRIEVAL-GATE every cited source_id must be a member of allowedSourceIds (Rule 12 gate 1). An
//                     out-of-set citation is a HARD reject - the escape probability of a fabricated
//                     citation is zero, not small (13-21% of legal citations hallucinate, arXiv 2606.00898).
//   3. QUOTE RE-MATCH every quote must survive a normalised exact-substring match against the source
//                     text it cites (Rule 12 gate 2). A paraphrased or fabricated quote drifts and is
//                     rejected (models paraphrase inside quotation marks, Stanford HAI).
//
// This gate checks the citations a response ACTUALLY makes. The stronger policy "a violation MUST
// cite an artifact / a NO_BREACH MUST carry a disproof quote" (caution.md C-080/C-092) is the
// ADJUDICATOR's contract (breach/adjudicator, Wave 2) and composes ON TOP of this structural gate.

const DEFAULT_MIN_QUOTE_LEN = 8;   // caution.md C-089: sub-25-char nav fragments are not evidence; 8 is the H.anchored floor ported from the proven gate, callers (the adjudicator) raise it.
const MAX_WALK_DEPTH = 12;         // adversarial deeply-nested response guard (caution.md C-165 red-team inputs); beyond this we stop walking rather than blow the stack.
const SOURCE_ID_KEY = /^source_ids?$/i;
const QUOTE_FIELDS = ['quote', 'verbatim_quote'];

// ---------------------------------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------------------------------

// normalise(s): the canonical form for the verbatim-quote substring match. Lowercase, collapse all
// whitespace runs to a single space, fold curly quotes to straight (both sides of the compare get the
// same folding, so the comparison stays exact, never fuzzy). caution.md C-035: detection surface and
// evidence surface must be the SAME normalised corpus.
function normalise(s) {
  return String(s == null ? '' : s)
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// toSet(arr): a Set of trimmed string ids. A non-array yields the EMPTY set, so a caller that forgot
// to supply the retrieval set can cite NOTHING (fail-closed): every id is then out-of-set.
function toSet(arr) {
  const s = new Set();
  for (const x of Array.isArray(arr) ? arr : []) s.add(String(x).trim());
  return s;
}

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

function sv(path, message) {
  return { code: 'schema', path, message: 'schema ' + path + ': ' + message };
}

// safeRegex(pattern): compile a schema `pattern`. An invalid pattern cannot validate anything, so we
// return a never-match regex - the field is then flagged as not matching, keeping the gate fail-closed.
function safeRegex(pattern) {
  try {
    return new RegExp(pattern);
  } catch (_e) {
    // FAIL-OPEN: an invalid schema pattern is a config error; the never-match keeps the field flagged
    // and the SYSTEM fail-closed (the value is reported as a schema violation, never silently passed).
    return /$.^/;
  }
}

// ---------------------------------------------------------------------------------------------------
// Step 0: parse
// ---------------------------------------------------------------------------------------------------

// pickText(response): the text payload to parse. Accepts a raw string, a router response object with a
// string `.text`, or null when neither is present (the caller may then treat an object as pre-parsed).
function pickText(response) {
  if (typeof response === 'string') return response;
  if (response && typeof response.text === 'string') return response.text;
  return null;
}

// extractJson(text): the substring from the first JSON opener to the last closer, or null. A model that
// wraps JSON in prose or ```fences still yields its object; genuinely non-JSON text yields null.
function extractJson(text) {
  const s = String(text);
  const starts = [s.indexOf('{'), s.indexOf('[')].filter((i) => i !== -1);
  if (!starts.length) return null;
  const start = Math.min(...starts);
  const end = Math.max(s.lastIndexOf('}'), s.lastIndexOf(']'));
  if (end <= start) return null;
  return s.slice(start, end + 1);
}

// rejectResponse(code, message): the one shape for a typed parse reject, so parseResponse and its two
// helpers below do not each spell out { ok:false, violation:{...} } (one door for the reject envelope).
function rejectResponse(code, message) {
  return { ok: false, violation: { code, message } };
}

// responseEnvelopeError(response): a typed reject when the router envelope itself is unusable (absent,
// or an explicit ok:false), else null. Split out so parseResponse carries no envelope branch of its own.
function responseEnvelopeError(response) {
  if (response == null) return rejectResponse('empty_response', 'no response supplied');
  if (typeof response === 'object' && response.ok === false) {
    return rejectResponse('provider_unavailable', 'router returned ok:false (' + String(response.reason || response.error || 'unknown') + ')');
  }
  return null;
}

// parseJsonSlice(text): extract and JSON.parse the first object/array in the text, or a typed reject.
function parseJsonSlice(text) {
  const slice = extractJson(text);
  if (slice === null) return rejectResponse('unparseable_json', 'no JSON object or array found in the response text');
  try {
    return { ok: true, value: JSON.parse(slice) };
  } catch (_e) {
    // FAIL-OPEN: a JSON.parse throw is caught HERE and converted to a typed reject; validateResponse
    // then returns abstain (ok:false), so the SYSTEM fails closed - a malformed reply never ships.
    return rejectResponse('unparseable_json', 'the response text is not valid JSON');
  }
}

// parseResponse(response): { ok:true, value } or { ok:false, violation }. A failed router response
// (ok:false) and an unparseable body both route to a typed reject, so the gate can abstain cleanly.
function parseResponse(response) {
  const envelopeError = responseEnvelopeError(response);
  if (envelopeError) return envelopeError;
  const text = pickText(response);
  if (text === null) {
    if (typeof response === 'object') return { ok: true, value: response };
    return rejectResponse('empty_response', 'response carried no text');
  }
  return parseJsonSlice(text);
}

// ---------------------------------------------------------------------------------------------------
// Step 1: schema (a tiny JSON-Schema subset, zero dependencies)
// ---------------------------------------------------------------------------------------------------

function oneTypeMatches(value, t) {
  if (t === 'integer') return typeof value === 'number' && Number.isInteger(value);
  if (t === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (t === 'object') return typeOf(value) === 'object';
  if (t === 'array') return Array.isArray(value);
  if (t === 'null') return value === null;
  return typeof value === t;
}

function typeMatches(value, t) {
  const types = Array.isArray(t) ? t : [t];
  return types.some((one) => oneTypeMatches(value, one));
}

function checkStringConstraints(value, schema, path) {
  const out = [];
  if (Number.isFinite(schema.minLength) && value.length < schema.minLength) out.push(sv(path, 'string shorter than minLength ' + schema.minLength));
  if (Number.isFinite(schema.maxLength) && value.length > schema.maxLength) out.push(sv(path, 'string longer than maxLength ' + schema.maxLength));
  if (schema.pattern && !safeRegex(schema.pattern).test(value)) out.push(sv(path, 'string does not match pattern ' + JSON.stringify(schema.pattern)));
  return out;
}

function checkNumberConstraints(value, schema, path) {
  const out = [];
  if (Number.isFinite(schema.minimum) && value < schema.minimum) out.push(sv(path, 'number below minimum ' + schema.minimum));
  if (Number.isFinite(schema.maximum) && value > schema.maximum) out.push(sv(path, 'number above maximum ' + schema.maximum));
  return out;
}

function checkScalarConstraints(value, schema, path) {
  const out = [];
  if (schema.enum && !schema.enum.some((e) => e === value)) out.push(sv(path, 'value ' + JSON.stringify(value) + ' not in enum ' + JSON.stringify(schema.enum)));
  if ('const' in schema && schema.const !== value) out.push(sv(path, 'value must equal ' + JSON.stringify(schema.const)));
  if (typeof value === 'string') out.push(...checkStringConstraints(value, schema, path));
  if (typeof value === 'number') out.push(...checkNumberConstraints(value, schema, path));
  return out;
}

// checkObject's three concerns (required fields present, declared properties recurse, no stray
// property when closed) are each their own named helper, so the composed function has no independent
// branch structure of its own left to fold into (the health-gate "Bumpy Road" cap: one conditional
// block per function).
function checkRequiredProperties(value, schema, path) {
  const out = [];
  for (const key of schema.required || []) {
    if (!(key in value) || value[key] === undefined) out.push(sv(path + '.' + key, 'required property missing'));
  }
  return out;
}
function checkDeclaredProperties(value, props, path) {
  const out = [];
  for (const [key, sub] of Object.entries(props)) {
    if (key in value) out.push(...validateSchema(value[key], sub, path + '.' + key));
  }
  return out;
}
function checkNoAdditionalProperties(value, schema, props, path) {
  const out = [];
  if (schema.additionalProperties !== false) return out;
  for (const key of Object.keys(value)) {
    if (!(key in props)) out.push(sv(path + '.' + key, 'additional property not permitted'));
  }
  return out;
}
function checkObject(value, schema, path) {
  const props = schema.properties || {};
  return [
    ...checkRequiredProperties(value, schema, path),
    ...checkDeclaredProperties(value, props, path),
    ...checkNoAdditionalProperties(value, schema, props, path),
  ];
}

function checkArray(value, schema, path) {
  const out = [];
  if (Number.isFinite(schema.minItems) && value.length < schema.minItems) out.push(sv(path, 'array shorter than minItems ' + schema.minItems));
  if (Number.isFinite(schema.maxItems) && value.length > schema.maxItems) out.push(sv(path, 'array longer than maxItems ' + schema.maxItems));
  if (schema.items) value.forEach((el, i) => out.push(...validateSchema(el, schema.items, path + '[' + i + ']')));
  return out;
}

// validateSchema(value, schema, path): the recursive shape check. A type mismatch short-circuits (deeper
// checks on the wrong shape are noise); otherwise scalar bounds, object and array rules all apply.
function validateSchema(value, schema, path) {
  if (!schema || typeof schema !== 'object') return [];
  if (schema.nullable && value === null) return [];
  if (schema.type && !typeMatches(value, schema.type)) {
    return [sv(path, 'expected ' + JSON.stringify(schema.type) + ', got ' + typeOf(value))];
  }
  const out = checkScalarConstraints(value, schema, path);
  if (typeOf(value) === 'object') out.push(...checkObject(value, schema, path));
  else if (Array.isArray(value)) out.push(...checkArray(value, schema, path));
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Step 2/3: collect citations, then retrieval-gate and quote-match them
// ---------------------------------------------------------------------------------------------------

function pushSourceIds(v, path, acc) {
  if (typeof v === 'string') { acc.sourceIds.push({ id: v, path }); return; }
  if (Array.isArray(v)) {
    v.forEach((el, i) => { if (typeof el === 'string') acc.sourceIds.push({ id: el, path: path + '[' + i + ']' }); });
  }
}

function firstQuoteField(node) {
  for (const key of QUOTE_FIELDS) {
    if (typeof node[key] === 'string') return node[key];
  }
  return null;
}

// gatherNodeCitations(node, path, acc): pull the source_id citations and any quote+source_id pair out
// of ONE object node. A quote is bound to the source_id declared on the SAME object (Rule 12 gate 2:
// a quote must cite the document it came from).
function gatherNodeCitations(node, path, acc) {
  for (const [k, v] of Object.entries(node)) {
    if (SOURCE_ID_KEY.test(k)) pushSourceIds(v, path ? path + '.' + k : k, acc);
  }
  const quote = firstQuoteField(node);
  const sid = typeof node.source_id === 'string' ? node.source_id : null;
  if (quote != null && sid != null) acc.quotes.push({ quote, sourceId: sid, path });
}

// walkCitations(node, path, depth, acc): a single depth-bounded walk of the parsed value, gathering
// every cited source_id and every quote/source_id pair for the flat checks that follow. A response
// nested deeper than MAX_WALK_DEPTH is NOT silently trusted: the unwalked subtree could hide an
// out-of-set citation, so the walk records depthExceeded and validateResponse turns that into a hard
// max_depth_exceeded violation (Rule 4: an incomplete inspection must fail closed, never pass as clean;
// caution.md C-165 adversarial deep-nesting input).
function walkCitations(node, path, depth, acc) {
  if (depth > MAX_WALK_DEPTH) { acc.depthExceeded = true; return; }
  if (node == null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach((el, i) => walkCitations(el, path + '[' + i + ']', depth + 1, acc));
    return;
  }
  gatherNodeCitations(node, path, acc);
  for (const [k, v] of Object.entries(node)) walkCitations(v, path ? path + '.' + k : k, depth + 1, acc);
}

function collectCitations(value) {
  const acc = { sourceIds: [], quotes: [], depthExceeded: false };
  walkCitations(value, '$', 0, acc);
  return acc;
}

// checkSourceIds(sourceIds, allowedSet): Rule 12 gate 1. Every cited id must be in the retrieval set.
function checkSourceIds(sourceIds, allowedSet) {
  const out = [];
  for (const { id, path } of sourceIds) {
    const norm = String(id).trim();
    if (!allowedSet.has(norm)) {
      out.push({ code: 'out_of_set_source_id', path, id: norm, message: 'cited source_id "' + norm + '" is not in the retrieval set (Rule 12 gate 1)' });
    }
  }
  return out;
}

// checkOneQuote(q, sources, minQuoteLen, allowedSet): Rule 12 gate 2 for one quote/source_id pair. The
// order of checks is deliberate: too-short, then in-set, then source-present, then verbatim substring.
function checkOneQuote(q, sources, minQuoteLen, allowedSet) {
  const sid = String(q.sourceId).trim();
  const text = String(q.quote || '');
  if (text.trim().length < minQuoteLen) return [{ code: 'quote_too_short', path: q.path, sourceId: sid, message: 'quote is shorter than the ' + minQuoteLen + '-char floor (caution.md C-089)' }];
  if (!allowedSet.has(sid)) return [{ code: 'out_of_set_source_id', path: q.path, id: sid, message: 'quote cites source_id "' + sid + '" not in the retrieval set (Rule 12 gate 1)' }];
  const src = sources ? sources[sid] : null;
  if (src == null) return [{ code: 'quote_source_missing', path: q.path, sourceId: sid, message: 'no source text supplied for "' + sid + '"; the quote cannot be verified, so the claim is refused' }];
  if (!normalise(src).includes(normalise(text))) return [{ code: 'quote_drift', path: q.path, sourceId: sid, message: 'quote is not a verbatim substring of source "' + sid + '" (Rule 12 gate 2)' }];
  return [];
}

function checkQuotes(quotes, sources, minQuoteLen, allowedSet) {
  const out = [];
  for (const q of quotes) out.push(...checkOneQuote(q, sources, minQuoteLen, allowedSet));
  return out;
}

// ---------------------------------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------------------------------

function abstain(violations) {
  return { ok: false, value: null, abstain: true, violations: violations.filter(Boolean) };
}

// validateResponse(response, opts): the one door every LLM response passes through. Runs parse ->
// schema -> retrieval-gate -> quote-match and AND-composes them. Any violation abstains.
function validateResponse(response, opts = {}) {
  const schema = opts.schema || null;
  const allowedSet = toSet(opts.allowedSourceIds);
  const sources = opts.sources || {};
  const minQuoteLen = Number.isFinite(opts.minQuoteLen) ? opts.minQuoteLen : DEFAULT_MIN_QUOTE_LEN;
  const parsed = parseResponse(response);
  if (!parsed.ok) return abstain([parsed.violation]);
  const value = parsed.value;
  const violations = [];
  if (schema) violations.push(...validateSchema(value, schema, '$'));
  const cites = collectCitations(value);
  if (cites.depthExceeded) {
    violations.push({ code: 'max_depth_exceeded', path: '$', message: 'response nests deeper than the ' + MAX_WALK_DEPTH + '-level citation-walk cap; the unwalked subtree cannot be retrieval-gated, so the response is refused (Rule 4/12 gate 1)' });
  }
  violations.push(...checkSourceIds(cites.sourceIds, allowedSet));
  violations.push(...checkQuotes(cites.quotes, sources, minQuoteLen, allowedSet));
  if (violations.length) return abstain(violations);
  return { ok: true, value, violations: [] };
}

// ---------------------------------------------------------------------------------------------------
// Calibration CLI (the earn-your-zero contract in eval/calibration-known-bad/run.js).
// `node llm/gate.js --calibrate [--json <path>]` replays every p3-llm-*.json fixture. A FINDING is
// emitted ONLY when the gate correctly REFUSES the poisoned response (and, if the fixture pins an
// expected code, that code is present). Zero findings on a fixture means the gate FAILED to catch its
// planted disease, and the calibration runner fails CI (Constitution Rule 4: a zero you did not earn).
// ---------------------------------------------------------------------------------------------------

function judgeFixture(abs, fx) {
  const result = validateResponse(fx.response, {
    schema: fx.schema, allowedSourceIds: fx.allowedSourceIds, sources: fx.sources, minQuoteLen: fx.minQuoteLen,
  });
  const wantCode = (fx.poison && fx.poison.expect_violation) || null;
  const codeHit = !wantCode || (result.violations || []).some((v) => v.code === wantCode);
  if (result.ok === false && codeHit) {
    return { file: abs, line: 1, rule: 'llm-gate-reject', message: 'correctly refused poisoned response: ' + ((result.violations || []).map((v) => v.code).join(',') || 'reject') };
  }
  // The gate WRONGLY ACCEPTED (or refused for the wrong reason): emit NO finding for this fixture, so
  // eval/calibration-known-bad/run.js sees the fixture uncaught and FAILS (earn-your-zero).
  return null;
}

function runCalibration(fixturesDir) {
  const fs = require('fs');
  const path = require('path');
  const dir = fixturesDir || path.join(__dirname, '..', 'eval', 'calibration-known-bad', 'fixtures');
  const findings = [];
  const files = fs.readdirSync(dir).filter((f) => /^p3-llm-.*\.json$/.test(f)).sort();
  for (const f of files) {
    if (!/^[a-z0-9][a-z0-9.-]{0,251}$/i.test(f)) throw new Error('unsafe path component: ' + JSON.stringify(f));
    const abs = path.join(dir, f);
    const finding = judgeFixture(abs, JSON.parse(fs.readFileSync(abs, 'utf8')));
    if (finding) findings.push(finding);
  }
  return findings;
}

function calibrateMain(argv) {
  const fs = require('fs');
  const args = argv.slice(2);
  const jsonIdx = args.indexOf('--json');
  const jsonPath = jsonIdx !== -1 ? args[jsonIdx + 1] : null;
  const findings = runCalibration();
  if (jsonPath) fs.writeFileSync(jsonPath, JSON.stringify(findings, null, 2));
  process.stdout.write(JSON.stringify({ checker: 'llm-gate', findings }) + '\n');
  return 0;
}

if (require.main === module) {
  if (process.argv.includes('--calibrate')) {
    process.exit(calibrateMain(process.argv));
  } else {
    process.stderr.write('llm/gate.js is a library (validateResponse). Only --calibrate is runnable from the CLI.\n');
    process.exit(2);
  }
}

module.exports = {
  validateResponse,
  validateSchema,
  collectCitations,
  checkSourceIds,
  checkQuotes,
  normalise,
  runCalibration,
  DEFAULT_MIN_QUOTE_LEN,
};
