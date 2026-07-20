'use strict';
// facts/entity/lint.js — the NO-NEW-FACTS linter (Kimi KIMI-FINAL-BATCH-2026-07-20.md §2, E3). The
// LLM lens output ("proposal") is a search HINT only; this module is the mechanical guarantee that it
// cannot introduce a fact absent from the crawled bytes. Every non-enum string field the proposal
// returns MUST be a verbatim substring (after Unicode/whitespace normalisation) of the full crawled
// corpus — not just the windows fed to the model, the FULL bytes, so a rejection is never a false
// positive caused by window truncation. A CRN must additionally satisfy the CRN shape and either the
// exact string or its digit-only form is present in the bytes. A candidate binding a name to a number
// must have both co-occur inside its OWN source_quote (the "unbound-candidate" rule) — this is what
// stops the LLM pairing a real name on one page with a real number on another and inventing a
// relationship neither page actually states.
//
// Any single rejection discards the WHOLE proposal (fail closed, Rule: never a partial fact) and the
// resolver above this module treats it as UNRESOLVED. The linter never fixes/repairs a proposal — it
// only accepts or rejects.

const CRN_RE = /^(?:\d{8}|(?:SC|NI|OC|SO|NC|LP|FC|BR|GE|IP|AC|RS|SL|SP|ZC)\d{6})$/;

const ENUM_PATHS = new Set(['sector', 'sub_sector']);
const MAX_QUOTE_LEN = 300;
const MAX_NAME_LEN = 200;
const MAX_EVIDENCE_LEN = 200;
const MAX_CANDIDATES = 3;
const MAX_SECTOR_EVIDENCE = 5;

function norm(s) {
  return String(s == null ? '' : s)
    .normalize('NFC')
    .toLowerCase()
    .replace(/[​-‍﻿]/g, '')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function digitsOnly(s) {
  return String(s || '').replace(/\D+/g, '');
}

// stringFields(proposal) -> [{path, value}] for every leaf string this schema can carry, excluding
// the enum fields (sector/sub_sector are justified via evidence spans, not verbatim self-membership —
// see the reject loop below, which DOES substring-check sector_evidence itself).
function stringFields(proposal) {
  const out = [];
  const candidates = Array.isArray(proposal.candidates) ? proposal.candidates : [];
  candidates.forEach((c, i) => {
    if (!c || typeof c !== 'object') return;
    if (c.legal_name != null) out.push({ path: `candidates[${i}].legal_name`, value: c.legal_name });
    if (c.company_number != null) out.push({ path: `candidates[${i}].company_number`, value: c.company_number });
    if (c.source_quote != null) out.push({ path: `candidates[${i}].source_quote`, value: c.source_quote });
  });
  const pc = proposal.privacy_controller;
  if (pc && typeof pc === 'object') {
    if (pc.legal_name != null) out.push({ path: 'privacy_controller.legal_name', value: pc.legal_name });
    if (pc.company_number != null) out.push({ path: 'privacy_controller.company_number', value: pc.company_number });
    if (pc.source_quote != null) out.push({ path: 'privacy_controller.source_quote', value: pc.source_quote });
  }
  const spans = Array.isArray(proposal.sector_evidence) ? proposal.sector_evidence : [];
  spans.forEach((s, i) => out.push({ path: `sector_evidence[${i}]`, value: s }));
  return out;
}

// lintShape(proposal) -> a shape-error string, or null. A cheap structural pass BEFORE the substring
// walk (a malformed proposal is rejected on shape, never on a crash inside the substring loop).
function lintShape(proposal) {
  if (!proposal || typeof proposal !== 'object') return 'not-an-object';
  const candidates = proposal.candidates;
  if (candidates !== undefined) {
    if (!Array.isArray(candidates)) return 'candidates-not-array';
    if (candidates.length > MAX_CANDIDATES) return 'too-many-candidates';
    for (const c of candidates) {
      if (c == null || typeof c !== 'object') return 'candidate-not-object';
      if (c.legal_name != null && (typeof c.legal_name !== 'string' || c.legal_name.length > MAX_NAME_LEN)) return 'legal-name-shape';
      if (c.company_number != null && typeof c.company_number !== 'string') return 'company-number-shape';
      if (c.source_quote != null && (typeof c.source_quote !== 'string' || c.source_quote.length > MAX_QUOTE_LEN)) return 'source-quote-shape';
    }
  }
  const spans = proposal.sector_evidence;
  if (spans !== undefined) {
    if (!Array.isArray(spans)) return 'sector-evidence-not-array';
    if (spans.length > MAX_SECTOR_EVIDENCE) return 'too-many-sector-evidence';
    for (const s of spans) {
      if (typeof s !== 'string' || s.length > MAX_EVIDENCE_LEN) return 'sector-evidence-shape';
    }
  }
  return null;
}

// lintProposal(proposal, fullCrawledBytes) -> { ok: true } | { ok: false, reason: string }. Pure,
// synchronous, no network. `fullCrawledBytes` MUST be the full corpus (not just windows.js's
// windowsText) — linting against the windows only would reject truthful extractions that happened to
// straddle a window boundary the ±200-char radius trimmed.
function lintProposal(proposal, fullCrawledBytes) {
  const shapeErr = lintShape(proposal);
  if (shapeErr) return { ok: false, reason: 'shape:' + shapeErr };

  const HAY = norm(fullCrawledBytes);
  const HAY_DIGITS = digitsOnly(fullCrawledBytes);

  for (const { path, value } of stringFields(proposal)) {
    if (value == null || ENUM_PATHS.has(path)) continue;
    if (!HAY.includes(norm(value))) return { ok: false, reason: 'fabricated:' + path };
  }

  const candidates = Array.isArray(proposal.candidates) ? proposal.candidates : [];
  for (let i = 0; i < candidates.length; i += 1) {
    const c = candidates[i];
    if (c.company_number) {
      if (!CRN_RE.test(String(c.company_number).toUpperCase())) return { ok: false, reason: 'bad-crn' };
      const crnDigits = digitsOnly(c.company_number);
      const crnOk = (crnDigits && HAY_DIGITS.includes(crnDigits)) || HAY.includes(norm(c.company_number));
      if (!crnOk) return { ok: false, reason: 'crn-not-in-bytes' };
    }
    if (c.legal_name && c.company_number) {
      const q = norm(c.source_quote);
      if (!q || !q.includes(norm(c.legal_name)) || !q.includes(norm(c.company_number))) {
        return { ok: false, reason: 'unbound-candidate' };
      }
    }
  }

  // Enum choices (sector/sub_sector) are exempt from the verbatim-substring rule (they are not
  // copied text) but MUST be backed by at least one substring-verified evidence span whenever the
  // proposal claims a non-'unknown' value — an enum pick with zero grounded evidence is functionally
  // the same fabrication risk as a fabricated string.
  const claimsSector = proposal.sector && proposal.sector !== 'unknown';
  const claimsSubSector = proposal.sub_sector && proposal.sub_sector !== 'unknown';
  if ((claimsSector || claimsSubSector) && !(Array.isArray(proposal.sector_evidence) && proposal.sector_evidence.length > 0)) {
    return { ok: false, reason: 'sector-unevidenced' };
  }

  return { ok: true };
}

module.exports = { lintProposal, lintShape, norm, digitsOnly, CRN_RE, ENUM_PATHS };
