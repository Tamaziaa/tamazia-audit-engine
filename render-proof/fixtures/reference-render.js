'use strict';
// render-proof/fixtures/reference-render.js - the FAITHFUL REFERENCE RENDERER: a v1.1 payload -> the visible
// text of the audit page, per the render contract the truth-pack polices.
//
// WHY THIS EXISTS (read this before assuming it is the production renderer - it is NOT):
//   The task's canonical fixture source is the WEBSITE luxury renderer
//   (tamazia-website public/audit/audit-lux.js + functions/audit/_lux.js + _qa/qa_lux.mjs) executed in jsdom
//   against the golden _qa/fixtures/v11/lomond-realestate-uk-v11.json. At THIS commit none of those files
//   exist in the website repo (the p4-t4 lux renderer is a separate in-flight prototype - only
//   src/components/atoms/LuxuryBrackets.astro is on its branch), and jsdom, though declared in the website's
//   devDependencies, is not installed there. So the website lux render cannot be executed to record a fixture.
//   This module is the honest stand-in: it projects a v1.1 payload to the page's VISIBLE TEXT (the DOM text
//   content a browser truth-pass extracts) exactly as the render CONTRACT requires - the not-legal-advice
//   line verbatim, the headline exposure, the statutory ceiling shown ONLY in a ceiling-labelled context,
//   every finding's framework name, review items in observation voice, the counts line, the screened label.
//   The truth-pack (render-proof/truth-pack.js) is renderer-AGNOSTIC: it reads visible text, never this file.
//   When the website lux renderer lands, repoint gen-fixtures.js at it and re-record the .txt; nothing in
//   truth-pack.js changes. At mint time the REAL page text arrives from the live browser truth-pass, injected
//   as opts.renderedText / the opts.truthPackFn seam (C-124: the browser, not the JSON, defines shipped).
//
// It authors NO law fact: every name, regulator, citation, penalty band and figure is READ off the payload
// (Rule 2). Its only string literals are UI labels. formatGBP is imported from the checker so the renderer
// and the checker share ONE money formatter and can never drift.

const { formatGBP } = require('../truth-pack.js');

function str(v) { return typeof v === 'string' ? v : (v == null ? '' : String(v)); }
function num(v) { return typeof v === 'number' && Number.isFinite(v) ? v : null; }

// bandLine(penalty, forReview) -> the enforcement-band line for a card, or '' when the record carries no
// band. A violation card shows the typical band; a review card shows the same band explicitly framed FOR
// REVIEW (observation voice), never as a confirmed exposure. Never prints the statutory maximum on a card:
// the single ceiling is a distinct, ceiling-labelled figure in the headline block only (C-094).
function bandLine(penalty, forReview) {
  const lo = num(penalty && penalty.typical_low);
  const hi = num(penalty && penalty.typical_high);
  if (lo == null && hi == null) return '';
  const range = (lo != null ? formatGBP(lo) : '') + (lo != null && hi != null ? ' to ' : '') + (hi != null ? formatGBP(hi) : '');
  return (forReview ? 'Indicative enforcement band (for review): ' : 'Typical enforcement band: ') + range;
}

// renderFinding(f) -> the visible lines for one finding. Confident (a violation on an earning artifact)
// renders as an evidenced observation; everything else renders in review/observation voice - never a
// confident-breach phrasing on a review item (Rule 10 / C-111).
function renderFinding(f) {
  const url = str(f && f.page_url);
  if (f && f.voice_tier === 'confident') {
    const quote = str(f.evidence_quote || (f.artifact && f.artifact.text));
    return 'Evidenced on your live site: "' + quote + '"' + (url ? ' detected on ' + url : '') + '.';
  }
  const what = str(f && f.description) || 'a potential gap was detected';
  return 'Under review: ' + what + (url ? ' (seen on ' + url + ')' : '') + '; this may implicate the framework above and is flagged for your verification.';
}

// renderCard(card) -> the visible lines for one framework card. Name/regulator/jurisdiction/citation/band all
// read off the payload card (Rule 2). A review card is framed distinctly from a confirmed-breach card.
function renderCard(card) {
  const lines = [''];
  const meta = [str(card && card.regulator), str(card && card.jurisdiction)].filter(Boolean).join(', ');
  lines.push(str(card && card.name) + (meta ? ' - ' + meta : ''));
  const citation = str(card && card.citation);
  if (citation) lines.push('Citation: ' + citation);
  const band = bandLine(card && card.penalty, card && card.state === 'needs_review');
  if (band) lines.push(band);
  for (const f of (Array.isArray(card && card.findings) ? card.findings : [])) lines.push(renderFinding(f));
  return lines;
}

// headlineBlock(payload) -> the exposure headline + the single statutory ceiling. The ceiling figure is shown
// ONLY here and ONLY immediately after the word 'ceiling', so it can never read as a bare headline (C-094/
// C-096). The headline exposure is the median-of-typical-band figure, never the ceiling.
function headlineBlock(payload) {
  const lines = [];
  const exposure = num(payload && payload.exposure && payload.exposure.value);
  if (exposure != null) {
    lines.push('Median enforcement exposure: ' + formatGBP(exposure));
    lines.push('This is the midpoint of the typical enforcement band across the confirmed breaches, de-duplicated to one figure per statute family and never a sum of maxima.');
  }
  const ceiling = num(payload && payload.exposureWaterfall && payload.exposureWaterfall.ceiling && payload.exposureWaterfall.ceiling.value);
  if (ceiling != null) {
    lines.push('Single statutory ceiling: ' + formatGBP(ceiling) + ' - the highest maximum across the breached families, shown once and never summed.');
  }
  return lines;
}

// coverageLine(payload) -> the C-118 coverage sentence: the screened label plus the live counts
// (frameworksBinding of frameworksAssessed, rulesChecked). Data-driven, never a magic total.
function coverageLine(payload) {
  const label = str(payload && payload.screenedLabel);
  const binding = num(payload && payload.frameworksBinding);
  const assessed = num(payload && payload.frameworksAssessed);
  const rules = num(payload && payload.rulesChecked);
  const parts = [];
  if (label) parts.push(label + '.');
  if (binding != null) parts.push(binding + (assessed != null ? ' of ' + assessed + ' assessed frameworks' : ' frameworks') + ' bind you.');
  if (rules != null) parts.push('Rules checked: ' + rules + '.');
  return parts.join(' ');
}

/**
 * renderAuditText(payload) -> the visible text of the rendered audit page for a v1.1 payload. Deterministic,
 * pure, no clock. This is the render CONTRACT projection the truth-pack asserts against; see the file header.
 */
function renderAuditText(payload) {
  const p = payload || {};
  const meta = p.meta || {};
  const lines = [];
  lines.push(str(meta.company) + ' - compliance, SEO and GEO audit');
  if (meta.date) lines.push('Prepared ' + str(meta.date));
  lines.push('');
  for (const l of headlineBlock(p)) lines.push(l);
  lines.push('');
  lines.push('Frameworks that bind you');
  for (const card of (Array.isArray(p.frameworks) ? p.frameworks : [])) {
    for (const l of renderCard(card)) lines.push(l);
  }
  lines.push('');
  lines.push('Coverage');
  const cov = coverageLine(p);
  if (cov) lines.push(cov);
  lines.push('');
  const nla = str(p.notLegalAdvice);
  if (nla) lines.push(nla);
  return lines.join('\n') + '\n';
}

module.exports = { renderAuditText };
