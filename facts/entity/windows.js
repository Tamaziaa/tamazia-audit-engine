'use strict';
// facts/entity/windows.js — deterministic pre-pass for the entity-resolution lane (Kimi
// KIMI-FINAL-BATCH-2026-07-20.md §1a/E2). Runs BEFORE the LLM ever sees a byte: extracts a UK
// company-number candidate and a UK postcode from the crawled corpus with the SAME extractor the
// register-establishment lane already uses (evidence/registers/lib/establishment-id.js — one door,
// Rule 1, never a second regex for the same fact), then builds small ±200-char windows around
// entity markers so the LLM is fed a bounded, targeted slice rather than the full crawl (keeps the
// prompt small AND keeps the "copy, never infer" doctrine honest — nothing outside a marked window
// reaches the model).
//
// Hidden-DOM stripping: callers pass already-rendered VISIBLE text (the crawler's own extraction
// already drops script/style/noscript/display:none nodes — see evidence/crawler). This module additionally
// strips any residual `display:none`/`aria-hidden="true"` inline-styled fragments that a caller's
// visible-text pass may not model at the block level, and any HTML comments, as defence in depth
// against a page attempting to plant an invisible company name for the lens to pick up (caution.md
// prompt-injection class, §5.4 of the batch doc).

const { extractCompanyNumber } = require('../../evidence/registers/lib/establishment-id.js');

// UK postcode: the standard documented shape (outward + inward code), case-insensitive.
const UK_POSTCODE_RX = /\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i;

// Entity markers: the terms the batch spec names as footer/legal-page anchors worth windowing.
const MARKER_RX = /(ltd\.?|limited|llp\b|registered|company\s*no\.?|company\s*number|crn\b|gdc\b|cqc\b|data\s*controller|vat\b)/gi;

const WINDOW_RADIUS = 200;
const PAGE_KIND_PRIORITY = ['footer', 'privacy', 'terms', 'about', 'contact', 'imprint'];

function stripHidden(html) {
  const s = String(html || '');
  return s
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+style=["'][^"']*display\s*:\s*none[^"']*["'][^>]*>[\s\S]*?<\/[a-z0-9]+>/gi, ' ')
    .replace(/<[^>]+aria-hidden=["']true["'][^>]*>[\s\S]*?<\/[a-z0-9]+>/gi, ' ');
}

// normaliseText(raw) -> visible-text-ish string: strip any residual tags/hidden fragments, collapse
// whitespace. Callers may pass either raw text or lightly-tagged text; this is defensive, not a full
// HTML parser (the crawler already extracts visible text upstream — see evidence/crawler).
function normaliseText(raw) {
  return stripHidden(raw)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// windowsAround(text) -> [{quote, index}] — one ±WINDOW_RADIUS-char slice per marker match,
// deduplicated when windows overlap (merged, never double-counted) so the LLM prompt does not repeat
// the same span twice.
function windowsAround(text) {
  const spans = [];
  let m;
  MARKER_RX.lastIndex = 0;
  while ((m = MARKER_RX.exec(text))) {
    const start = Math.max(0, m.index - WINDOW_RADIUS);
    const end = Math.min(text.length, m.index + m[0].length + WINDOW_RADIUS);
    spans.push([start, end]);
  }
  if (!spans.length) return [];
  spans.sort((a, b) => a[0] - b[0]);
  const merged = [spans[0]];
  for (const [s, e] of spans.slice(1)) {
    const last = merged[merged.length - 1];
    if (s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  return merged.map(([s, e]) => text.slice(s, e).trim());
}

// buildWindows(pages) -> { windows: string[], windowsText, crn, postcode, pageOrder }
//   pages: [{ kind: 'footer'|'privacy'|'terms'|'about'|'contact'|'imprint'|string, text: string }]
// Deterministic, pure, no network. `windowsText` is the joined string handed to the LLM prompt.
function buildWindows(pages) {
  const list = Array.isArray(pages) ? pages : [];
  const ordered = list.slice().sort((a, b) => {
    const ai = PAGE_KIND_PRIORITY.indexOf(a && a.kind);
    const bi = PAGE_KIND_PRIORITY.indexOf(b && b.kind);
    return (ai === -1 ? PAGE_KIND_PRIORITY.length : ai) - (bi === -1 ? PAGE_KIND_PRIORITY.length : bi);
  });

  const allWindows = [];
  const fullTextParts = [];
  let crn = null;
  let postcode = null;

  for (const page of ordered) {
    const text = normaliseText(page && page.text);
    if (!text) continue;
    fullTextParts.push(text);
    if (!crn) crn = extractCompanyNumber(text);
    if (!postcode) {
      const pm = text.match(UK_POSTCODE_RX);
      if (pm) postcode = pm[1].toUpperCase().replace(/\s+/g, ' ').trim();
    }
    for (const w of windowsAround(text)) allWindows.push(w);
  }

  return {
    windows: allWindows,
    windowsText: allWindows.join('\n---\n'),
    crn,
    postcode,
    fullText: fullTextParts.join('\n'),
  };
}

module.exports = { buildWindows, windowsAround, normaliseText, UK_POSTCODE_RX };
