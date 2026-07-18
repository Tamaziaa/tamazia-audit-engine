'use strict';
/**
 * breach/verifiers/network-event.js - verifies a `network_event` artifact (Constitution Rule 3:
 * "a captured network event" is one of the four things a breach finding may carry as its
 * deterministic artifact).
 *
 * Contract (candidate.artifact when type === 'network_event'):
 *   { type: 'network_event', kind, host, name, ts? }
 *
 * `kind`, `host` and `name` mirror the identifying fields of an entry in the PECR pre-consent lane's
 * own output shape, evidence/browser/observe.js's `bundle.browser.observed[]`:
 *   { kind, name, host, essential, networkEvent, artifact, ts }
 * (kind in cookie_pre_consent | tracker_request_pre_consent | consent_control_broken).
 *
 * verifyNetworkEvent never re-derives tracker/cookie classification (that stays evidence/browser's
 * one door, caution.md C-043's licence-clean oracle): it only proves the candidate's cited event is
 * an event the browser lane ACTUALLY observed, by exact field match against bundle.browser.observed.
 * A candidate citing a host/name/kind combination the lane never saw is a fabricated artifact and is
 * rejected (fail closed); it is never accepted on the strength of the claim alone.
 */
const { CODES, accepted, rejected } = require('./result');

function isNonEmptyString(v) {
  return typeof v === 'string' && v.length > 0;
}

// entryMatches(entry, artifact) -> true when one bundle.browser.observed[] entry is the exact event
// the candidate cites: same kind, same host, same name, and (when the candidate pins a timestamp)
// the same ts. This is an EQUALITY check throughout, never a substring/includes test (GAPS.md
// host-substring: a host is compared by parsed/exact identity here, never by token or substring).
function isInvalidEntry(entry) {
  return !entry || typeof entry !== 'object';
}
// tsMismatch(entry, artifact) -> true only when the candidate PINS a timestamp and the entry's differs.
// Named so the conjunction is not its own "Complex Conditional" inline in entryMatches.
function tsMismatch(entry, artifact) {
  return artifact.ts !== undefined && entry.ts !== artifact.ts;
}
function entryMatches(entry, artifact) {
  if (isInvalidEntry(entry)) return false;
  if (entry.kind !== artifact.kind) return false;
  if (entry.host !== artifact.host) return false;
  if (entry.name !== artifact.name) return false;
  if (tsMismatch(entry, artifact)) return false;
  return true;
}

// verifyNetworkEvent(artifact, bundle) -> {verified, code, reason}. Fails closed on: missing
// identifying fields, a browser lane that never ran (nothing to verify against - C-041's "absence is
// visible, never silent" means an un-run lane cannot silently back-fill a claim either), or a cited
// event with no match in bundle.browser.observed (fabricated network event).
function hasMissingIdentityFields(artifact) {
  return !isNonEmptyString(artifact.kind) || !isNonEmptyString(artifact.host) || !isNonEmptyString(artifact.name);
}
function laneDidNotRun(browser) {
  return !browser || !browser.lane || browser.lane.ran !== true;
}
function verifyNetworkEvent(artifact, bundle) {
  if (hasMissingIdentityFields(artifact)) {
    return rejected(
      CODES.NETWORK_EVENT_MISSING_FIELDS,
      'artifact.kind, artifact.host and artifact.name are all required to identify a network_event candidate'
    );
  }
  const browser = bundle && bundle.browser;
  if (laneDidNotRun(browser)) {
    return rejected(
      CODES.NETWORK_EVENT_LANE_NOT_RUN,
      'bundle.browser.lane did not run (ran !== true); there is no observation to verify a network_event against'
    );
  }
  const observed = Array.isArray(browser.observed) ? browser.observed : [];
  const found = observed.some((entry) => entryMatches(entry, artifact));
  if (!found) {
    return rejected(
      CODES.NETWORK_EVENT_NOT_FOUND,
      'no entry in bundle.browser.observed matches kind=' + JSON.stringify(artifact.kind)
        + ' host=' + JSON.stringify(artifact.host) + ' name=' + JSON.stringify(artifact.name)
    );
  }
  return accepted(CODES.NETWORK_EVENT_VERIFIED, 'matched an entry in bundle.browser.observed');
}

module.exports = { verifyNetworkEvent, entryMatches };
