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

// buildPrecedentRanges(rows) -> Map<law_id, PrecedentRange>. Only rows carrying a penalty_amount AND
// a currency contribute; a row with no monetary penalty (e.g. an ASA "upheld, no fine" ruling) is
// correctly excluded from a MONETARY precedent range rather than counted as a zero (which would
// silently drag every median toward zero and misrepresent the true penalty distribution).
//
// Multi-currency law_ids are kept SEPARATE per currency (never summed/converted - a currency
// conversion is itself a fact this module has no authority to invent) so a mixed UK/EU law_id
// produces one PrecedentRange per currency observed.
function buildPrecedentRanges(rows, generatedAt) {
  const byKey = new Map(); // key = `${law_id}::${currency}`
  for (const row of rows) {
    if (typeof row.penalty_amount !== 'number' || !row.currency) continue;
    for (const lawId of row.law_ids) {
      const key = `${lawId}::${row.currency}`;
      if (!byKey.has(key)) byKey.set(key, { law_id: lawId, currency: row.currency, amounts: [], sources: [], dates: [] });
      const bucket = byKey.get(key);
      bucket.amounts.push(row.penalty_amount);
      bucket.sources.push({ entity_name: row.entity_name, url: row.url, sha256: row.sha256, decision_date: row.decision_date, penalty_amount: row.penalty_amount });
      bucket.dates.push(row.decision_date);
    }
  }

  const ranges = new Map();
  for (const [key, bucket] of byKey) {
    const sorted = [...bucket.amounts].sort((a, b) => a - b);
    const sortedDates = [...bucket.dates].sort();
    ranges.set(key, {
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
    });
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
