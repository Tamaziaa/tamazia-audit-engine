'use strict';
// SEEDED KNOWN-BAD (P3, GAPS.md host-substring / caution.md C-009). DO NOT import or run this.
// It exists so tools/domain-gates/host-parse.js --calibrate proves it can still see the host-substring
// class: deciding "is this URL on this site" by substring instead of a parsed host. The old estate bound
// the wrong company's identity and the wrong country's law off exactly these. A gate that reports zero on
// this file has not earned its green (Constitution Rule 4).

// (1) The classic: url.includes(domain) is TRUE for https://evil.com/linkedin.com.
function sameSiteBad(url, domain) {
  return url.includes(domain);
}

// (2) A hostname string literal compared by substring.
function isLinkedInBad(href) {
  return href.includes('linkedin.com');
}

// (3) endsWith against a host identifier: 'notreed.co.uk'.endsWith('reed.co.uk') is TRUE.
function belongsToBad(host, registrable) {
  return host.endsWith(registrable);
}

module.exports = { sameSiteBad, isLinkedInBad, belongsToBad };
