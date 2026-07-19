'use strict';
// enforcement/derive/precedent.js - derives penalty PRECEDENT RANGES per law_id from the
// EnforcementAction store (blueprint B5: "the report displays two sourced numbers ... statutory
// maximum ... and enforcement precedent range from the EnforcementAction table"). This module
// produces the second number; the statutory maximum stays a catalogue-owned fact (Rule 2).
//
// PURE ARITHMETIC OVER STORED, VALIDATED ROWS. No LLM, no estimation, no interpolation: a law_id
// with fewer than 3 penalised rows is flagged low_confidence (per B5: "Where n<3 precedents, say
// 'few published precedents'") rather than presented as a settled range.

const fs = require('fs');
const path = require('path');

const { loadStore } = require('../store/store');

const DEFAULT_OUTPUT_PATH = path.join(__dirname, 'out', 'precedent-ranges.json');
const LOW_CONFIDENCE_THRESHOLD = 3;

function median(sortedNumbers) {
  const n = sortedNumbers.length;
  const mid = Math.floor(n / 2);
  return n % 2 === 0 ? (sortedNumbers[mid - 1] + sortedNumbers[mid]) / 2 : sortedNumbers[mid];
}

// hasMonetaryPenalty(row) -> boolean. Only rows carrying a penalty_amount AND a currency contribute
// to a MONETARY precedent range; a row with no fine (e.g. an ASA "upheld, no fine" ruling) is
// correctly excluded rather than counted as a zero (which would silently drag every median toward
// zero and misrepresent the true penalty distribution).
function hasMonetaryPenalty(row) {
  if (typeof row.penalty_amount !== 'number') return false;
  return Boolean(row.currency);
}

// bucketFor(byKey, lawId, currency) -> the amounts/sources/dates accumulator for one
// `${law_id}::${currency}` key, creating it on first use.
function bucketFor(byKey, lawId, currency) {
  const key = `${lawId}::${currency}`;
  if (!byKey.has(key)) byKey.set(key, { law_id: lawId, currency, amounts: [], sources: [], dates: [] });
  return byKey.get(key);
}

// addRowToBuckets(byKey, row) -> void. Pushes row's amount/source/date onto every law_id::currency
// bucket it carries. The one place that touches byKey's Map API, kept out of
// groupRowsByLawIdAndCurrency's own body so that function nests only one level deep (CodeScene
// Bumpy Road Ahead: a loop-inside-a-loop is two nested-conditional chunks in one function).
function addRowToBuckets(byKey, row) {
  for (const lawId of row.law_ids) {
    const bucket = bucketFor(byKey, lawId, row.currency);
    bucket.amounts.push(row.penalty_amount);
    bucket.sources.push({ entity_name: row.entity_name, url: row.url, sha256: row.sha256, decision_date: row.decision_date, penalty_amount: row.penalty_amount });
    bucket.dates.push(row.decision_date);
  }
}

// groupRowsByLawIdAndCurrency(rows) -> Map<`${law_id}::${currency}`, bucket>. Multi-currency
// law_ids are kept SEPARATE per currency (never summed/converted - a currency conversion is itself a
// fact this module has no authority to invent), so a mixed UK/EU law_id produces one bucket per
// currency observed.
function groupRowsByLawIdAndCurrency(rows) {
  const byKey = new Map();
  for (const row of rows) {
    if (!hasMonetaryPenalty(row)) continue;
    addRowToBuckets(byKey, row);
  }
  return byKey;
}

// rangeFromBucket(bucket, generatedAt) -> one PrecedentRange, computed from a single
// law_id/currency bucket's accumulated amounts and dates.
function rangeFromBucket(bucket, generatedAt) {
  const sorted = [...bucket.amounts].sort((a, b) => a - b);
  const sortedDates = [...bucket.dates].sort();
  return {
    law_id: bucket.law_id,
    currency: bucket.currency,
    n: sorted.length,
    min: sorted[0],
    median: median(sorted),
    max: sorted[sorted.length - 1],
    date_range: { from: sortedDates[0], to: sortedDates[sortedDates.length - 1] },
    low_confidence: sorted.length < LOW_CONFIDENCE_THRESHOLD,
    sources: bucket.sources,
    generated_at: generatedAt,
  };
}

// buildPrecedentRanges(rows) -> Map<`${law_id}::${currency}`, PrecedentRange>. See
// groupRowsByLawIdAndCurrency and rangeFromBucket above for the two halves of this pure arithmetic
// pass. The key is currency-qualified (never a bare law_id) because a mixed-currency law_id keeps
// its ranges separate per currency (see groupRowsByLawIdAndCurrency); a caller must look up
// `${lawId}::${currency}`, not `ranges.get(lawId)`.
function buildPrecedentRanges(rows, generatedAt) {
  const byKey = groupRowsByLawIdAndCurrency(rows);
  const ranges = new Map();
  for (const [key, bucket] of byKey) {
    ranges.set(key, rangeFromBucket(bucket, generatedAt));
  }
  return ranges;
}

function writePrecedentRanges(ranges, outPath = DEFAULT_OUTPUT_PATH) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const body = { ranges: [...ranges.values()] };
  fs.writeFileSync(outPath, `${JSON.stringify(body, null, 2)}\n`, 'utf8');
  return outPath;
}

function run(opts = {}) {
  const rows = loadStore(opts.storePath);
  const generatedAt = opts.generatedAt || new Date().toISOString();
  const ranges = buildPrecedentRanges(rows, generatedAt);
  const written = writePrecedentRanges(ranges, opts.outPath);
  return { ranges, written };
}

if (require.main === module) {
  const { ranges, written } = run();
  process.stdout.write(`wrote ${written} (${ranges.size} law_id/currency ranges)\n`);
}

module.exports = { buildPrecedentRanges, writePrecedentRanges, run, DEFAULT_OUTPUT_PATH, LOW_CONFIDENCE_THRESHOLD };
