'use strict';
/**
 * applicability/conflicts.js - the family-dedupe door (caution.md C-073).
 *
 * THE DISEASE (C-073): PECR and "ICO Cookies Guidance" were counted as TWO breached regimes for ONE
 * statute, so a firm's law landscape was overstated at the count and again on the rendered page. The
 * fix is one door that groups same-statute records into a FAMILY before anything is counted or grouped
 * for render. This module is that door; applicability/connect.js reads it for its counts and a later
 * render-grouping consumer reads the SAME door, so no two places can drift (Constitution Rule 1).
 *
 * A family is keyed on the record's own citation.act string, normalised (trim, lower-case, collapse
 * internal whitespace) so two rows citing the same Act under trivially different spacing/case collapse
 * to one family. When a record carries no citation.act (a malformed or citation-less row), the record's
 * own id is the fallback key, so a record can never silently merge into another family on an empty key.
 *
 * DOCTRINE:
 *  - Pure and synchronous. No I/O, no network, no clock, no env, no module-scope mutable state.
 *  - Holds NO law name, fine, regulator or citation literal (Rule 2): the family key is derived from
 *    the record argument at call time, never authored here.
 *  - dedupeFamilies NEVER drops a record. Families exist for COUNTS and render grouping only; the
 *    applicable set that connect.js returns keeps every record (C-073 counts, never a silent removal).
 *  - Supersession is NOT decided here. The schema does not structurally encode supersession today
 *    (prose only), so this door only GROUPS same-statute records; it never picks a survivor.
 */

// familyKey(record) -> the deterministic family key for one record: the normalised citation.act
// string, or the record id when act is absent. Normalisation is trim + lower-case + single-space
// collapse, so two rows citing one statute under trivially different spacing or case are one family.
function familyKey(record) {
  const act = record && record.citation && record.citation.act;
  if (typeof act === 'string' && act.trim() !== '') {
    return act.trim().toLowerCase().replace(/\s+/g, ' ');
  }
  // Fallback: the record's own id keeps a citation-less record in its OWN family rather than merging
  // every such record onto one empty key. A record with neither act nor id degrades to '' (a single
  // malformed-family bucket), which is the honest floor for genuinely unidentifiable input.
  return record && record.id ? String(record.id) : '';
}

// dedupeFamilies(records) -> [{ key, records }] groups in first-seen key order. Every input record
// appears in exactly one group; no record is dropped. Insertion order within a group is input order.
function dedupeFamilies(records) {
  const groups = new Map(); // key -> { key, records: [] }
  for (const record of Array.isArray(records) ? records : []) {
    const key = familyKey(record);
    let group = groups.get(key);
    if (!group) {
      group = { key, records: [] };
      groups.set(key, group);
    }
    group.records.push(record);
  }
  return Array.from(groups.values());
}

// familyCount(records) -> the number of DISTINCT families among `records`. The single number
// connect.js's frameworksAssessed / frameworksBinding counts are built from (C-073: dedupe first).
function familyCount(records) {
  return dedupeFamilies(records).length;
}

module.exports = { familyKey, dedupeFamilies, familyCount };
