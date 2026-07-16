'use strict';
// CALIBRATION FIXTURE (known-bad, deliberately committed): two-doors class.
// This file is a SECOND PRODUCER of the JURISDICTION fact. The constitution says
// facts/jurisdiction.js is the ONLY door for jurisdiction; the one-door gate MUST
// flag this file when run with --calibrate, or the gate has not earned its zero.
// This is exactly the multiple-producer disease the old repo had (JURISDICTION
// nexus produced in 5 files, HOST anchoring in 8).
// This file is never imported by engine code.

function detectJurisdiction(domain, html) {
  // BAD: keyword-and-TLD jurisdiction inference outside facts/jurisdiction.js,
  // with no tier matrix, no serves-vs-bound split, and a silent default.
  if (/\.co\.uk$|\.uk$/.test(domain) || /united kingdom|england and wales/i.test(html)) return 'UK';
  if (/\.ae$/.test(domain) || /dubai|abu dhabi|difc|adgm/i.test(html)) return 'AE';
  if (/\.ie$/.test(domain) || /republic of ireland/i.test(html)) return 'IE';
  return 'US'; // BAD: confident default - the Miami-under-UK-law bug, inverted
}

function boundJurisdictions(domain, html) {
  // BAD: a second export of the same fact under another name.
  return [detectJurisdiction(domain, html)];
}

module.exports = { detectJurisdiction, boundJurisdictions };
