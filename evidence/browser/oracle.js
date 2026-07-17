'use strict';
// evidence/browser/oracle.js - the licence-clean tracker + cookie classifier for the PECR
// pre-consent lane (Constitution Rule 3 / caution.md C-043).
//
// LICENCE DECISION (C-043): the port source read a bundled data file whose upstream tracker-host
// list carried a copyleft / share-alike limb (unsafe to redistribute verbatim inside a proprietary,
// paid product shipped from a PUBLIC repo). Rather than adjudicate that limb, this module bundles NO
// third-party dataset at all. The lists below are authored FRESH from first-hand, licence-clean
// knowledge: well-known tracker registrable domains, and cookie naming conventions the vendors
// themselves publish. The exact upstream sources the port used, and why each was declined or was
// unnecessary, are recorded in this builder's port report (not restated here so no banned source
// name ships as a literal). ORACLE_META below is the machine-checkable provenance carried onto the
// lane output; its licence value is a positive own-authored statement CI can assert on.
//
// DOCTRINE (Constitution Rule 6, ported from the source's own comment): over-claiming a legal
// breach is the one thing we cannot afford. An UNKNOWN cookie is NEVER assumed non-essential; it
// abstains (verdict 'unknown') and never becomes a breach candidate. Only a cookie that matches a
// known non-essential pattern, OR whose domain is a known tracker host, is flagged.

// The provenance carried onto the lane output (C-043: every bundled source carries a licence field,
// CI-checkable). This bundle is 100% own-authored: no third-party dataset is shipped.
const ORACLE_META = Object.freeze({
  source: 'tamazia-authored (evidence/browser/oracle.js)',
  licence: 'own-authored (no third-party dataset bundled)',
  note: 'minimal well-known tracker hosts and vendor-published cookie name patterns, authored fresh for licence hygiene',
});

// Well-known third-party TRACKING registrable domains (and a few exact tracker subdomains where the
// parent domain has legitimate non-tracking use, e.g. bat.bing.com but not bing.com search). Authored
// from first-hand knowledge of analytics/advertising vendors; deliberately conservative to avoid
// false positives (Rule 10: every false positive is a bug).
const TRACKER_HOSTS = Object.freeze(new Set([
  // Google analytics + ads
  'google-analytics.com', 'googletagmanager.com', 'doubleclick.net', 'googlesyndication.com',
  'googleadservices.com', 'g.doubleclick.net', 'analytics.google.com', 'stats.g.doubleclick.net',
  // Meta
  'facebook.net', 'connect.facebook.net',
  // Microsoft
  'clarity.ms', 'bat.bing.com',
  // LinkedIn ads/insight
  'snap.licdn.com', 'px.ads.linkedin.com', 'ads.linkedin.com',
  // Behaviour / session-replay analytics
  'hotjar.com', 'hotjar.io', 'fullstory.com', 'mouseflow.com', 'crazyegg.com', 'inspectlet.com',
  'mc.yandex.ru', 'luckyorange.com',
  // Product analytics / CDPs
  'mixpanel.com', 'mxpnl.com', 'amplitude.com', 'segment.com', 'segment.io', 'heap.io', 'heapanalytics.com',
  // Ad exchanges / DSPs / measurement
  'criteo.com', 'criteo.net', 'adnxs.com', 'adsrvr.org', 'pubmatic.com', 'rubiconproject.com',
  'casalemedia.com', 'scorecardresearch.com', 'quantserve.com', 'quantcount.com',
  'taboola.com', 'outbrain.com', 'adroll.com',
  // Social pixels
  'analytics.tiktok.com', 'ct.pinterest.com', 'tr.snapchat.com', 'sc-static.net',
]));

// Cookie-NAME patterns that are NON-ESSENTIAL (require consent under PECR reg.6). Authored from
// vendor-published cookie naming; each is word-anchored to the family it names.
const TRACKER_COOKIE_PATTERNS = Object.freeze([
  { rx: /^_ga($|_)/, category: 'analytics', platform: 'Google Analytics' },
  { rx: /^_gid$/, category: 'analytics', platform: 'Google Analytics' },
  { rx: /^_gat($|_)/, category: 'analytics', platform: 'Google Analytics' },
  { rx: /^__utm[a-z]?$/, category: 'analytics', platform: 'Google Analytics (legacy urchin)' },
  { rx: /^_gcl_/, category: 'marketing', platform: 'Google Ads' },
  { rx: /^_fbp$|^_fbc$/, category: 'marketing', platform: 'Meta Pixel' },
  { rx: /^fr$/, category: 'marketing', platform: 'Meta' },
  { rx: /^_hj[a-z]/i, category: 'analytics', platform: 'Hotjar' },
  { rx: /^_clck$|^_clsk$/, category: 'analytics', platform: 'Microsoft Clarity' },
  { rx: /^muid$/i, category: 'marketing', platform: 'Microsoft Advertising' },
  { rx: /^_uetsid$|^_uetvid$/, category: 'marketing', platform: 'Microsoft Advertising' },
  { rx: /^ide$/i, category: 'marketing', platform: 'Google DoubleClick' },
  { rx: /^bcookie$|^lidc$|^li_sugr$|^usermatchhistory$/i, category: 'marketing', platform: 'LinkedIn' },
  { rx: /^personalization_id$/, category: 'marketing', platform: 'X/Twitter' },
  { rx: /^_pin_unauth$|^_pinterest_/, category: 'marketing', platform: 'Pinterest' },
  { rx: /^_scid$|^_sctr$/, category: 'marketing', platform: 'Snap' },
  { rx: /^_tt_/, category: 'marketing', platform: 'TikTok' },
]);

// Cookie-NAME patterns that are STRICTLY NECESSARY (essential; never a breach): session, security,
// CSRF, load-balancing, and the consent record itself (a consent cookie is needed to remember the
// choice, so it is exempt under reg.6(4)). Authored from framework/platform conventions.
const ESSENTIAL_COOKIE_PATTERNS = Object.freeze([
  { rx: /^phpsessid$/i, reason: 'PHP session' },
  { rx: /^jsessionid$/i, reason: 'Java session' },
  { rx: /^asp\.net_sessionid$/i, reason: 'ASP.NET session' },
  { rx: /^connect\.sid$/i, reason: 'Express session' },
  { rx: /^sessionid$/i, reason: 'application session' },
  { rx: /^csrftoken$/i, reason: 'CSRF token' },
  { rx: /^xsrf-token$/i, reason: 'CSRF token' },
  { rx: /^__host-/i, reason: 'host-locked security cookie' },
  { rx: /^__secure-/i, reason: 'secure-prefixed security cookie' },
  { rx: /^__cf_bm$|^cf_clearance$/i, reason: 'Cloudflare bot management / security' },
  { rx: /^wordpress_|^wp-settings|^wp_/i, reason: 'WordPress session/settings' },
  { rx: /^cookieconsent|^cookieyes-consent$|^optanonconsent$|^cookie_consent/i, reason: 'consent record (reg.6(4) exempt)' },
]);

// hostLabels(host) -> the lowercased host split into labels, or [] for a non-string/empty host.
function hostLabels(host) {
  const h = String(host || '').toLowerCase().replace(/\.$/, '');
  if (!h) return [];
  return h.split('.');
}

// isTrackerHost(host) -> true when `host` is, or is a subdomain of, a known tracker registrable
// domain. Parsed by label suffix (never a substring match): "www.google-analytics.com" matches the
// "google-analytics.com" entry; "www.bing.com" does NOT match the exact "bat.bing.com" entry.
function isTrackerHost(host) {
  const labels = hostLabels(host);
  if (labels.length === 0) return false;
  for (let i = 0; i < labels.length; i++) {
    if (TRACKER_HOSTS.has(labels.slice(i).join('.'))) return true;
  }
  return false;
}

// matchFirst(name, patterns) -> the first matching pattern object, or null.
function matchFirst(name, patterns) {
  const n = String(name || '');
  for (const p of patterns) {
    if (p.rx.test(n)) return p;
  }
  return null;
}

// classifyCookieName(name) -> { verdict, category, platform }.
//   verdict: 'essential'      strictly necessary; never a breach candidate.
//           'non_essential'  known tracker cookie; a consent-required breach candidate.
//           'unknown'        not recognised; ABSTAIN (Rule 6) - never a breach candidate.
function classifyCookieName(name) {
  if (matchFirst(name, ESSENTIAL_COOKIE_PATTERNS)) {
    return { verdict: 'essential', category: null, platform: null };
  }
  const tracker = matchFirst(name, TRACKER_COOKIE_PATTERNS);
  if (tracker) {
    return { verdict: 'non_essential', category: tracker.category, platform: tracker.platform };
  }
  return { verdict: 'unknown', category: null, platform: null };
}

// classifyCookie(cookie) -> { verdict, category, platform, host }. Combines the name classifier
// with a tracker-host check on the cookie's own domain: an essential-named cookie stays essential,
// but an UNKNOWN-named cookie whose domain is a known tracker host is promoted to non_essential
// (a third-party tracker cookie under a bespoke name). A first-party unknown cookie stays unknown.
function classifyCookie(cookie) {
  const name = cookie && cookie.name;
  const domain = cookie && cookie.domain;
  const base = classifyCookieName(name);
  const host = String(domain || '').replace(/^\./, '');
  if (base.verdict === 'unknown' && isTrackerHost(host)) {
    return { verdict: 'non_essential', category: 'tracking', platform: null, host };
  }
  return { ...base, host };
}

function oracleMeta() {
  return ORACLE_META;
}

module.exports = {
  ORACLE_META,
  TRACKER_HOSTS,
  TRACKER_COOKIE_PATTERNS,
  ESSENTIAL_COOKIE_PATTERNS,
  isTrackerHost,
  classifyCookieName,
  classifyCookie,
  oracleMeta,
};
