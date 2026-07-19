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
//
// Every section below is a SMALL named function (repo health-gate / CodeScene code-health discipline): each
// renderX dispatcher just sequences calls into single-purpose helpers, so no function's cyclomatic complexity
// grows past the health caps as this fixture inevitably grows more render-contract detail over time.

const { formatGBP } = require('../truth-pack.js');

function str(v) { return typeof v === 'string' ? v : (v == null ? '' : String(v)); }
function num(v) { return typeof v === 'number' && Number.isFinite(v) ? v : null; }

// ── enforcement band line ─────────────────────────────────────────────────────────────────────────────────
// penaltyNum(penalty, key) -> the numeric field of a penalty band, or null.
function penaltyNum(penalty, key) { return num(penalty && penalty[key]); }
// formatBandRange(lo, hi) -> "£lo to £hi" when both bounds exist, else whichever single bound is present.
// Callers only invoke this once at least one of lo/hi is known non-null.
function formatBandRange(lo, hi) {
  const from = lo != null ? formatGBP(lo) : '';
  const to = hi != null ? formatGBP(hi) : '';
  if (lo != null && hi != null) return from + ' to ' + to;
  return from + to;
}
// bandLabel(forReview) -> the enforcement-band lead-in phrase, framed FOR REVIEW on a needs_review card
// (observation voice), never as a confirmed exposure.
function bandLabel(forReview) { return forReview ? 'Indicative enforcement band (for review): ' : 'Typical enforcement band: '; }
// bandLine(penalty, forReview) -> the enforcement-band line for a card, or '' when the record carries no
// band. A violation card shows the typical band; a review card shows the same band explicitly framed FOR
// REVIEW (observation voice), never as a confirmed exposure. Never prints the statutory maximum on a card:
// the single ceiling is a distinct, ceiling-labelled figure in the headline block only (C-094).
function bandLine(penalty, forReview) {
  const lo = penaltyNum(penalty, 'typical_low');
  const hi = penaltyNum(penalty, 'typical_high');
  if (lo == null && hi == null) return '';
  return bandLabel(forReview) + formatBandRange(lo, hi);
}

// ── one finding's visible lines ───────────────────────────────────────────────────────────────────────────
// findingUrl(f) -> the finding's page_url, or ''.
function findingUrl(f) { return str(f && f.page_url); }
// urlSuffix(url, prefix, suffix) -> "" when url is absent, else prefix + url + suffix (suffix optional).
function urlSuffix(url, prefix, suffix) { return url ? prefix + url + (suffix || '') : ''; }
// isConfidentFinding(f) -> the finding is a violation carrying an earning artifact (Rule 10 / C-111).
function isConfidentFinding(f) { return Boolean(f) && f.voice_tier === 'confident'; }
// findingQuote(f) -> the verbatim evidence span a confident finding renders.
function findingQuote(f) {
  if (!f) return '';
  return str(f.evidence_quote || (f.artifact && f.artifact.text));
}
// renderConfidentFinding(f, url) -> an evidenced observation, never a bare accusation with no artifact.
function renderConfidentFinding(f, url) {
  const quote = findingQuote(f);
  return 'Evidenced on your live site: "' + quote + '"' + urlSuffix(url, ' detected on ') + '.';
}
// findingDescription(f) -> the finding's own description, or the honest fallback when none was supplied.
function findingDescription(f) {
  const desc = str(f && f.description);
  return desc || 'a potential gap was detected';
}
// renderReviewFinding(f, url) -> observation voice - never a confident-breach phrasing on a review item.
function renderReviewFinding(f, url) {
  const what = findingDescription(f);
  return 'Under review: ' + what + urlSuffix(url, ' (seen on ', ')') + '; this may implicate the framework above and is flagged for your verification.';
}
// renderFinding(f) -> the visible lines for one finding. Confident (a violation on an earning artifact)
// renders as an evidenced observation; everything else renders in review/observation voice - never a
// confident-breach phrasing on a review item (Rule 10 / C-111).
function renderFinding(f) {
  const url = findingUrl(f);
  if (isConfidentFinding(f)) return renderConfidentFinding(f, url);
  return renderReviewFinding(f, url);
}

// ── one framework card's visible lines ────────────────────────────────────────────────────────────────────
// cardMeta(card) -> "regulator, jurisdiction", either part omitted when absent.
function cardMeta(card) {
  return [str(card && card.regulator), str(card && card.jurisdiction)].filter(Boolean).join(', ');
}
// cardHeaderLine(card) -> "Name - regulator, jurisdiction" (meta suffix omitted when there is none).
function cardHeaderLine(card) {
  const name = str(card && card.name);
  const meta = cardMeta(card);
  return name + (meta ? ' - ' + meta : '');
}
// isReviewCard(card) -> the card is framed FOR REVIEW (a needs_review state), distinct from a confirmed-breach card.
function isReviewCard(card) { return Boolean(card) && card.state === 'needs_review'; }
// cardBandLine(card) -> the card's enforcement-band line, framed for review when the card is a review card.
function cardBandLine(card) { return bandLine(card && card.penalty, isReviewCard(card)); }
// cardFindings(card) -> the card's findings array, or [] when absent/malformed.
function cardFindings(card) { return Array.isArray(card && card.findings) ? card.findings : []; }
// renderCard(card) -> the visible lines for one framework card. Name/regulator/jurisdiction/citation/band all
// read off the payload card (Rule 2). A review card is framed distinctly from a confirmed-breach card.
function renderCard(card) {
  const lines = [''];
  lines.push(cardHeaderLine(card));
  const citation = str(card && card.citation);
  if (citation) lines.push('Citation: ' + citation);
  const band = cardBandLine(card);
  if (band) lines.push(band);
  for (const f of cardFindings(card)) lines.push(renderFinding(f));
  return lines;
}

// ── headline exposure block ───────────────────────────────────────────────────────────────────────────────
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

// ── coverage line ──────────────────────────────────────────────────────────────────────────────────────────
// payloadNum(payload, key) -> the numeric field of the payload, or null.
function payloadNum(payload, key) { return num(payload && payload[key]); }
// bindingLine(binding, assessed) -> "N of M assessed frameworks bind you." (or "N frameworks bind you." when
// no assessed total is known).
function bindingLine(binding, assessed) {
  const suffix = assessed != null ? ' of ' + assessed + ' assessed frameworks' : ' frameworks';
  return binding + suffix + ' bind you.';
}
// coverageLine(payload) -> the C-118 coverage sentence: the screened label plus the live counts
// (frameworksBinding of frameworksAssessed, rulesChecked). Data-driven, never a magic total.
function coverageLine(payload) {
  const label = str(payload && payload.screenedLabel);
  const binding = payloadNum(payload, 'frameworksBinding');
  const assessed = payloadNum(payload, 'frameworksAssessed');
  const rules = payloadNum(payload, 'rulesChecked');
  const parts = [];
  if (label) parts.push(label + '.');
  if (binding != null) parts.push(bindingLine(binding, assessed));
  if (rules != null) parts.push('Rules checked: ' + rules + '.');
  return parts.join(' ');
}

// ── the full page ──────────────────────────────────────────────────────────────────────────────────────────
// metaHeaderLines(p) -> the company name + "compliance, SEO and GEO audit" title line, plus the "Prepared"
// date line when the payload carries one.
function metaHeaderLines(p) {
  const meta = p.meta || {};
  const lines = [str(meta.company) + ' - compliance, SEO and GEO audit'];
  if (meta.date) lines.push('Prepared ' + str(meta.date));
  return lines;
}
// cardsOf(p) -> the payload's framework cards array, or [] when absent/malformed.
function cardsOf(p) { return Array.isArray(p.frameworks) ? p.frameworks : []; }
// frameworksSectionLines(p) -> the "Frameworks that bind you" heading plus every card's lines, in order.
function frameworksSectionLines(p) {
  const lines = ['Frameworks that bind you'];
  for (const card of cardsOf(p)) {
    for (const l of renderCard(card)) lines.push(l);
  }
  return lines;
}
// coverageSectionLines(p) -> the "Coverage" heading plus the coverage sentence, when there is one to show.
function coverageSectionLines(p) {
  const lines = ['Coverage'];
  const cov = coverageLine(p);
  if (cov) lines.push(cov);
  return lines;
}
/**
 * renderAuditText(payload) -> the visible text of the rendered audit page for a v1.1 payload. Deterministic,
 * pure, no clock. This is the render CONTRACT projection the truth-pack asserts against; see the file header.
 */
function renderAuditText(payload) {
  const p = payload || {};
  const lines = [];
  for (const l of metaHeaderLines(p)) lines.push(l);
  lines.push('');
  for (const l of headlineBlock(p)) lines.push(l);
  lines.push('');
  for (const l of frameworksSectionLines(p)) lines.push(l);
  lines.push('');
  for (const l of coverageSectionLines(p)) lines.push(l);
  lines.push('');
  const nla = str(p.notLegalAdvice);
  if (nla) lines.push(nla);
  return lines.join('\n') + '\n';
}

module.exports = { renderAuditText };
