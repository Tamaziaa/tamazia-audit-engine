'use strict';
// evidence/registers/lib/establishment-id.js — footer/on-site ID extractors that let the
// register-establishment lane resolve a firm DIRECTLY by a scraped register number, instead of only
// by a fuzzy name search. A number scraped straight off the audited site's own footer/legal page is
// itself a strong signal of WHICH register row to fetch — but it is never trusted as evidence on its
// own: every extracted id here is still resolved through a live register profile/detail call
// (companies-house.js / cqc.js), and the row that call returns is what becomes evidence, never the
// bare regex match. This module does one thing only: turn corpus text into candidate id strings.

// UK Companies House company numbers: 8 digits, OR a 2-letter jurisdiction prefix (SC/NI/OC/LP/etc.)
// followed by 6 digits — the shapes Companies House itself documents. Matched with a loose textual
// anchor ("company no", "company number", "registered in england and wales no", "reg no", "CRN") so
// a bare 8-digit run elsewhere on the page (a phone number, a price) is not mistaken for one; this is
// a RECALL-over-precision extractor (a missed number just means the name-search path is tried
// instead, never a hard failure), but the anchor keeps false positives rare.
const CH_ANCHOR_RX = /(?:company\s*(?:reg(?:istration)?\.?\s*)?no\.?|company\s*number|crn|registered\s+(?:in\s+[a-z &]+\s+)?no\.?)\s*[:.]?\s*((?:SC|NI|OC|LP|SO|SL|SF|GE|FC|R0|RC)?\d{6,8})/i;
const CH_BARE_RX = /\b((?:SC|NI|OC|LP|SO|SL|SF)\d{6})\b/;

// extractCompanyNumber(text) -> a normalised UK company number string, or null. Prefers the
// anchored form; falls back to a bare non-numeric-prefix match (SC/NI/OC.. are distinctive enough to
// not need an anchor — an 8-digit bare run is deliberately NOT matched unanchored, too noisy).
function extractCompanyNumber(text) {
  const s = String(text || '');
  const anchored = s.match(CH_ANCHOR_RX);
  if (anchored) return anchored[1].toUpperCase();
  const bare = s.match(CH_BARE_RX);
  return bare ? bare[1].toUpperCase() : null;
}

// CQC provider ids are documented as "1-" followed by 6-10 digits (facts/README/CLAUDE.md's own
// "site-displayed CQC provider ID (regex 1-\d{6,10})" instruction). No anchor text is required — the
// "1-NNNNNN" shape is distinctive enough on its own that an anchor would only cost recall (CQC
// provider ids are commonly shown bare, e.g. inside a CQC rating widget/badge script embed).
const CQC_PROVIDER_RX = /\b(1-\d{6,10})\b/;

function extractCqcProviderId(text) {
  const s = String(text || '');
  const m = s.match(CQC_PROVIDER_RX);
  return m ? m[1] : null;
}

module.exports = { extractCompanyNumber, extractCqcProviderId };
