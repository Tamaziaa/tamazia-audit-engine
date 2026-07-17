'use strict';
// catalogue/valid-date.js - the ONE door for "is this an actual calendar date / UTC instant".
//
// A regex proves SHAPE only: "2026-02-30" and "2026-13-01" match \d{4}-\d{2}-\d{2} yet name no real
// day, and "2026-01-01T25:00:00Z" is ISO-shaped but no real instant. These validators round-trip the
// value through a UTC Date so an impossible calendar value is rejected, not merely mis-shaped.
//
// Single door (Constitution Rule 1 applied to a build-tooling concept): catalogue/schema.js
// (verified_date, last_synced, pack.generated), catalogue/qa-approval.js (the QA reviewed date) and
// catalogue/compile-args.js (the compiler --stamp instant) all import from here, so every catalogue
// date is judged by exactly the same semantics rather than each re-deriving them. Split out of
// schema.js when that file crossed the health-gate file-length cap; this is the natural home.

// isRealYmd(year, month, day) -> the (year, month, day) triple is an actual calendar date (correct
// month length, leap years included). Feb 30 and month 13 fail because the constructed UTC Date rolls
// over and its components no longer equal the inputs.
function isRealYmd(year, month, day) {
  const dt = new Date(Date.UTC(year, month - 1, day));
  return dt.getUTCFullYear() === year && dt.getUTCMonth() === month - 1 && dt.getUTCDate() === day;
}

// isRealDate(s) -> true when s is a YYYY-MM-DD string naming a date that actually exists.
function isRealDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s));
  if (!m) return false;
  return isRealYmd(Number(m[1]), Number(m[2]), Number(m[3]));
}

// isRealTimestamp(s) -> true when s is a YYYY-MM-DDTHH:MM:SS(.sss)Z string naming a UTC instant that
// actually exists (a real calendar date AND 00..23 h, 00..59 m, 00..59 s).
function isRealTimestamp(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z$/.exec(String(s));
  if (!m) return false;
  if (!isRealYmd(Number(m[1]), Number(m[2]), Number(m[3]))) return false;
  return Number(m[4]) <= 23 && Number(m[5]) <= 59 && Number(m[6]) <= 59;
}

module.exports = { isRealDate, isRealTimestamp };
