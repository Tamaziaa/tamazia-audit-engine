'use strict';
/* global document, getComputedStyle */
// evidence/browser/dom-assert.js - the AXE-STYLE DOM ASSERTION lane (P4 T2a).
//
// WHAT THIS SEES THAT HTML-TEXT CANNOT: a failing DOM node (Constitution Rule 3's fourth artifact) is a
// FACT about the rendered page - an <img> with no alt attribute, a form control with no label, an
// insecure form action - not a reading of prose. This lane loads a page in the browser, runs ONE
// extraction pass, and turns the result into deterministic DOM-fact nodes each carrying its own artifact.
//
// THE HONESTY CORE (Constitution Rule 10, the axe-core doctrine - anything not assertable with certainty
// degrades to needs-review, and every false positive is a bug). This lane asserts ONLY a small closed set
// of checks, each a DETERMINISTIC DOM fact, and it NEVER guesses:
//   image-alt (1.1.1)         an <img> with NO alt attribute at all. alt="" is a PASS (decorative marking).
//   label (1.3.1)             an input/select/textarea (not hidden/submit/button) with no associated label,
//                             aria-label or aria-labelledby.
//   html-has-lang (3.1.1)     <html> with a missing/empty/malformed lang attribute.
//   link-name / button-name   an <a href> or <button> with an EMPTY accessible name (4.1.2).
//   color-contrast (1.4.3)    ONLY on FLAT, fully-opaque colours with a real ratio: < 4.5 (normal) or < 3.0
//                             (large) is a violation. Anything non-flat (gradient/image/alpha/unparseable)
//                             is state 'incomplete' - NEVER a violation, and NEVER a silent pass.
//   insecure-form             a <form> whose resolved action is http: on an https: page.
//   pre-ticked-consent        an <input type=checkbox> pre-checked whose label/name text names consent.
// Everything else (focus-visible, keyboard operability, alt QUALITY, reading order) is deliberately OUT:
// not asserted, not emitted. A check the lane cannot prove deterministically is degraded to 'incomplete'
// (needs-review), never fabricated into a violation.
//
// STRUCTURE (why the graded decisions are pure Node, not in-page): the DOM extraction MUST run in a real
// browser (it needs document/getComputedStyle) and so cannot be unit-tested without one. So the in-page
// pass (collectDescriptors, exported as `checksSource`) does ONLY dumb harvesting: it walks the DOM and
// emits plain, serialisable DESCRIPTORS carrying raw signals (hasAlt, the two colour strings, the label
// booleans, ...) and makes NO graded judgement. Every graded decision - the alt="" pass, the flat-colour
// gate, the lang regex, the consent-token match - is a small PURE predicate over a plain descriptor
// object, exported and unit-tested directly with no browser (dom-assert.test.js). This keeps Rule 10's
// honesty core fully tested and keeps a single source of truth for each decision (no logic duplicated
// between an in-page copy and a Node copy). domAssert() drives page.evaluate(checksSource) under the ONE
// outer deadline and maps the descriptors through the predicates.
//
// LANE DISCIPLINE (mirrors evidence/browser/observe.js exactly): a hard deadline (raceWithDeadline, a CAP
// never a floor - Rule 8/9), lane:{ran,reason} honesty (an unavailable/timed-out/errored lane is RECORDED,
// never silent - C-041), and it NEVER throws into the mint (Rule 4). `page` is the WRAPPED page from
// playwright-adapter.js (or an injected fake with the same `evaluate` surface); this module never touches
// a real browser directly, so node:test drives the whole orchestration with a scripted fake page.

const { raceWithDeadline } = require('./deadline');

// The deadline is a CAP, never a floor (Rule 8): a caller may only ask for a SHORTER wall time. 20s sits
// well under the 120s mint budget and the 45s PECR-lane ceiling; a DOM extraction pass is fast.
const DEFAULT_DEADLINE_MS = 20000;
const MAX_DESCRIPTORS = 2000; // bound on the serialised in-page payload (a cap, never a floor - Rule 8)

// normaliseOpts(opts) -> the two knobs this lane honours. deadlineMs is a hard CAP, never a floor (Rule
// 8): a positive finite override is CLAMPED to the ceiling, and anything else falls back to the ceiling, so
// a caller may only ask for a SHORTER wall time. (observe.js keeps its own capOr clamp for the same reason;
// the clamp is inlined here so there is one obvious ceiling with no cross-lane shared internal.)
function clampDeadline(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.min(n, DEFAULT_DEADLINE_MS) : DEFAULT_DEADLINE_MS;
}
function normaliseOpts(opts) {
  const o = opts || {};
  return { deadlineMs: clampDeadline(o.deadlineMs), now: typeof o.now === 'function' ? o.now : Date.now };
}

// ── the canonical node shape (Rule 1: one door for the dom_node artifact fields) ──────────────────────
// nodeOf(...) -> { rule_id, selector, snippet, wcag_sc, state } and NOTHING else. Every predicate below
// returns exactly this shape (or null for a pass), so the verifier and the proposer read one stable shape.
function nodeOf(rule_id, selector, snippet, wcag_sc, state) {
  return { rule_id, selector, snippet, wcag_sc, state };
}

// ── pure decision predicates (the honesty core; each is a pure function of ONE plain descriptor) ───────

// image-alt (WCAG 1.1.1): a violation ONLY when the alt attribute is entirely absent. alt="" is a PASS
// (the decorative-image marking), so hasAlt:true -> null even for an empty alt.
function imgNode(d) {
  return d.hasAlt ? null : nodeOf('image-alt', d.selector, d.snippet, '1.1.1', 'violation');
}

// label (WCAG 1.3.1): input/select/textarea with no label association. hidden/submit/button types are not
// labellable controls and are skipped (null). A label element (via for= OR a wrapping label), an aria-label
// or an aria-labelledby that resolves to text all satisfy the association.
const EXCLUDED_CONTROL_TYPES = new Set(['hidden', 'submit', 'button']);
function controlIsLabelled(d) {
  return Boolean(d.hasLabelElement) || Boolean(d.hasAriaLabel) || Boolean(d.hasAriaLabelledby);
}
function controlNode(d) {
  if (EXCLUDED_CONTROL_TYPES.has(d.controlType)) return null;
  return controlIsLabelled(d) ? null : nodeOf('label', d.selector, d.snippet, '1.3.1', 'violation');
}

// html-has-lang (WCAG 3.1.1): the <html> lang attribute must be present and a well-formed language tag.
const VALID_LANG = /^[a-z]{2}(-[A-Za-z0-9]+)*$/i;
function htmlNode(d) {
  const lang = typeof d.lang === 'string' ? d.lang.trim() : '';
  if (lang !== '' && VALID_LANG.test(lang)) return null;
  return nodeOf('html-has-lang', d.selector, d.snippet, '3.1.1', 'violation');
}

// link-name / button-name (WCAG 4.1.2): an empty accessible name. The name is the first non-empty of the
// element's text, its aria-label, its resolved aria-labelledby text, or the alt of an <img> inside it.
function firstNonEmpty(parts) {
  for (const s of parts) {
    const t = typeof s === 'string' ? s.trim() : '';
    if (t) return t;
  }
  return '';
}
function accessibleNameEmpty(d) {
  return firstNonEmpty([d.text, d.ariaLabel, d.ariaLabelledbyText, d.imgAltInside]) === '';
}
function linkNode(d) {
  return accessibleNameEmpty(d) ? nodeOf('link-name', d.selector, d.snippet, '4.1.2', 'violation') : null;
}
function buttonNode(d) {
  return accessibleNameEmpty(d) ? nodeOf('button-name', d.selector, d.snippet, '4.1.2', 'violation') : null;
}

// color-contrast (WCAG 1.4.3): parse two CSS colour strings. A ratio is only REAL when both are fully
// opaque and the background carries no gradient/image; anything else is honestly unmeasurable -> incomplete
// (needs-review), never a violation and never a silent pass (Rule 10).
function parseColour(str) {
  const s = String(str == null ? '' : str).trim();
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i.exec(s);
  if (rgb) return { r: +rgb[1], g: +rgb[2], b: +rgb[3], a: alphaOf(rgb[4]) };
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
  if (hex) return hexColour(hex[1]);
  return null; // an unparseable colour (named, transparent keyword, gradient token) is not a flat measure.
}
function alphaOf(raw) {
  if (raw == null) return 1;
  const a = String(raw).endsWith('%') ? Number(String(raw).slice(0, -1)) / 100 : Number(raw);
  return Number.isFinite(a) ? a : 1;
}
function hexColour(h) {
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return { r: parseInt(full.slice(0, 2), 16), g: parseInt(full.slice(2, 4), 16), b: parseInt(full.slice(4, 6), 16), a: 1 };
}
function channelLuminance(c) {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}
function relativeLuminance(rgb) {
  return 0.2126 * channelLuminance(rgb.r) + 0.7152 * channelLuminance(rgb.g) + 0.0722 * channelLuminance(rgb.b);
}
function contrastRatio(fg, bg) {
  if (!fg || !bg) return 0;
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}
// isLargeText: >=24px, or >=18.66px when bold (the WCAG 1.4.3 large-text thresholds).
function isLargeText(fontPx, bold) {
  const px = Number(fontPx);
  if (!Number.isFinite(px)) return false;
  return px >= 24 || (px >= 18.66 && Boolean(bold));
}
// contrastIsFlat: both colours parse to a fully-opaque rgb AND the background carries no image/gradient.
function contrastIsFlat(d) {
  if (d.bgImage && d.bgImage !== 'none') return false;
  const fg = parseColour(d.fg);
  const bg = parseColour(d.bg);
  return Boolean(fg) && Boolean(bg) && fg.a === 1 && bg.a === 1;
}
function contrastNode(d) {
  if (!contrastIsFlat(d)) return nodeOf('color-contrast', d.selector, d.snippet, '1.4.3', 'incomplete');
  const ratio = contrastRatio(parseColour(d.fg), parseColour(d.bg));
  const threshold = isLargeText(d.fontPx, d.bold) ? 3.0 : 4.5;
  if (ratio < threshold) return nodeOf('color-contrast', d.selector, d.snippet, '1.4.3', 'violation');
  return null; // a real, measured, sufficient ratio -> a genuine pass (not a silent one).
}

// insecure-form: an https: page whose form posts to an http: action (wcag_sc null - a security duty, not a
// WCAG success criterion).
function formNode(d) {
  const insecure = d.pageScheme === 'https:' && d.actionScheme === 'http:';
  return insecure ? nodeOf('insecure-form', d.selector, d.snippet, null, 'violation') : null;
}

// pre-ticked-consent: a checkbox pre-checked (the checked ATTRIBUTE, the initial state) whose associated
// label/name text names consent/marketing (wcag_sc null - a consent-law duty, not a WCAG criterion).
const CONSENT_TOKENS = ['consent', 'marketing', 'newsletter', 'offers'];
function namesConsent(text) {
  const t = String(text == null ? '' : text).toLowerCase();
  return CONSENT_TOKENS.some((tok) => t.includes(tok));
}
function checkboxNode(d) {
  const preTicked = Boolean(d.checkedAttr) && namesConsent(d.labelText);
  return preTicked ? nodeOf('pre-ticked-consent', d.selector, d.snippet, null, 'violation') : null;
}

// CHECK_PREDICATE: the one dispatch table from a descriptor's `check` tag to its pure predicate.
const CHECK_PREDICATE = Object.freeze({
  img: imgNode,
  control: controlNode,
  html: htmlNode,
  link: linkNode,
  button: buttonNode,
  contrast: contrastNode,
  form: formNode,
  checkbox: checkboxNode,
});

// buildNodes(descriptors) -> nodes[]. Maps each in-page descriptor through its predicate and keeps the
// non-null results. A descriptor with an unknown `check` tag is skipped (fail-closed: the lane never emits
// a node it has no predicate for). Pure and synchronous over plain objects; exported for direct testing.
function buildNodes(descriptors) {
  const out = [];
  for (const d of Array.isArray(descriptors) ? descriptors : []) {
    const predicate = d && CHECK_PREDICATE[d.check];
    if (!predicate) continue;
    const node = predicate(d);
    if (node) out.push(node);
  }
  return out;
}

// ── the in-page extraction pass (checksSource): DUMB harvesting only, one page.evaluate ───────────────
// collectDescriptors runs in the BROWSER context (document/getComputedStyle). It is fully self-contained
// (all helpers are inner functions) because page.evaluate serialises only the function body - a closure over
// a module-scope helper would be undefined in-page. It makes NO graded decision: it emits plain descriptors
// carrying raw signals, which the pure Node predicates above grade. Returns serialisable data only.
function collectDescriptors() {
  var out = [];
  var CAP = 2000;
  var doc = document;

  function capped() { return out.length >= CAP; }
  function clip(el) {
    try { return String(el.outerHTML || '').slice(0, 300); }
    catch (e) { return ''; /* FAIL-OPEN: an element whose outerHTML throws yields an empty snippet, never a thrown lane. */ }
  }
  function collapse(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
  function cssPath(el) {
    if (el.id) return el.tagName.toLowerCase() + '#' + el.id;
    var parts = [];
    var node = el;
    while (node && node.nodeType === 1 && node.tagName && node.tagName.toLowerCase() !== 'html') {
      var tag = node.tagName.toLowerCase();
      var i = 1;
      var sib = node;
      while ((sib = sib.previousElementSibling)) { if (sib.tagName && sib.tagName.toLowerCase() === tag) i++; }
      parts.unshift(tag + ':nth-of-type(' + i + ')');
      node = node.parentElement;
    }
    return parts.length ? parts.join(' > ') : el.tagName.toLowerCase();
  }
  function labelledbyText(el) {
    var ref = el.getAttribute('aria-labelledby');
    if (!ref) return '';
    var s = '';
    var ids = ref.split(/\s+/);
    for (var i = 0; i < ids.length; i++) {
      var t = doc.getElementById(ids[i]);
      if (t) s += ' ' + (t.textContent || '');
    }
    return collapse(s);
  }
  function imgAltInside(el) {
    var s = '';
    var imgs = el.querySelectorAll('img[alt]');
    for (var i = 0; i < imgs.length; i++) s += ' ' + (imgs[i].getAttribute('alt') || '');
    return collapse(s);
  }
  function labelsText(el) {
    var s = '';
    var labels = el.labels;
    if (labels) for (var i = 0; i < labels.length; i++) s += ' ' + (labels[i].textContent || '');
    return collapse(s);
  }
  function push(desc) { if (!capped()) out.push(desc); }
  function descOf(el, check, extra) {
    var base = { check: check, selector: cssPath(el), snippet: clip(el) };
    for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) base[k] = extra[k];
    return base;
  }
  function tryEach(selector, fn) {
    var nodes;
    try { nodes = doc.querySelectorAll(selector); }
    catch (e) { return; /* FAIL-OPEN: a bad selector yields no descriptors, never a thrown lane. */ }
    for (var i = 0; i < nodes.length && !capped(); i++) {
      try { fn(nodes[i]); } catch (e) { /* FAIL-OPEN: one malformed element yields no descriptor; the pass continues so a single node never blanks the lane. */ }
    }
  }

  function addHtml() {
    var html = doc.documentElement;
    if (html) push({ check: 'html', selector: 'html', snippet: clip(html), lang: html.getAttribute('lang') });
  }
  function addImgs() {
    tryEach('img', function (el) { push(descOf(el, 'img', { hasAlt: el.hasAttribute('alt') })); });
  }
  function addControls() {
    tryEach('input, select, textarea', function (el) {
      var tag = el.tagName.toLowerCase();
      var controlType = tag === 'input' ? (el.getAttribute('type') || 'text').toLowerCase() : tag;
      push(descOf(el, 'control', {
        controlType: controlType,
        hasLabelElement: Boolean(el.labels && el.labels.length),
        hasAriaLabel: collapse(el.getAttribute('aria-label')) !== '',
        hasAriaLabelledby: labelledbyText(el) !== '',
      }));
    });
  }
  function addLinks() {
    tryEach('a[href]', function (el) {
      push(descOf(el, 'link', {
        text: collapse(el.textContent), ariaLabel: collapse(el.getAttribute('aria-label')),
        ariaLabelledbyText: labelledbyText(el), imgAltInside: imgAltInside(el),
      }));
    });
  }
  function addButtons() {
    tryEach('button', function (el) {
      push(descOf(el, 'button', {
        text: collapse(el.textContent), ariaLabel: collapse(el.getAttribute('aria-label')),
        ariaLabelledbyText: labelledbyText(el), imgAltInside: imgAltInside(el),
      }));
    });
  }
  function directText(el) {
    var s = '';
    var kids = el.childNodes;
    for (var i = 0; i < kids.length; i++) if (kids[i].nodeType === 3) s += kids[i].nodeValue;
    return collapse(s);
  }
  function addContrast() {
    tryEach('body *', function (el) {
      if (directText(el) === '') return; // contrast is only meaningful on an element with its own text.
      var cs = getComputedStyle(el);
      push(descOf(el, 'contrast', {
        fg: cs.color, bg: cs.backgroundColor, bgImage: cs.backgroundImage,
        fontPx: parseFloat(cs.fontSize), bold: parseInt(cs.fontWeight, 10) >= 700,
      }));
    });
  }
  function schemeOf(raw) {
    try { return new URL(raw, doc.location.href).protocol; }
    catch (e) { return null; /* FAIL-OPEN: an unparseable action is not an observable insecure-form; it yields a null scheme (no violation). */ }
  }
  function addForms() {
    tryEach('form', function (el) {
      var action = el.getAttribute('action');
      push(descOf(el, 'form', {
        pageScheme: doc.location.protocol,
        actionScheme: action ? schemeOf(action) : doc.location.protocol,
      }));
    });
  }
  function addCheckboxes() {
    tryEach('input[type="checkbox"]', function (el) {
      var labelText = collapse(labelsText(el) + ' ' + (el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('name') || ''));
      push(descOf(el, 'checkbox', { checkedAttr: el.hasAttribute('checked'), labelText: labelText }));
    });
  }

  addHtml();
  addImgs();
  addControls();
  addLinks();
  addButtons();
  addContrast();
  addForms();
  addCheckboxes();
  return out;
}

// ── lane result builders (every non-ran outcome is RECORDED, never silent - C-041 / Rule 4) ───────────
function laneRan(nodes) { return { nodes, lane: { ran: true, reason: null } }; }
function laneUnavailable(reason) { return { nodes: [], lane: { ran: false, reason } }; }
function laneDeadline(elapsed) { return { nodes: [], lane: { ran: false, reason: 'deadline', elapsedMs: elapsed } }; }
function laneError(err, elapsed) {
  const message = String((err && err.message) || err).slice(0, 200);
  return { nodes: [], lane: { ran: false, reason: 'error', message, elapsedMs: elapsed } };
}

function pageCanEvaluate(page) {
  return Boolean(page) && typeof page.evaluate === 'function';
}

/**
 * domAssert(page, opts) -> Promise<{ nodes, lane }>. Never throws, never hangs a mint.
 *
 * page   the WRAPPED page from playwright-adapter.js (or an injected fake) exposing evaluate(fn). This
 *        module never touches a real browser: it drives page.evaluate(checksSource) and grades the result.
 * opts   { deadlineMs (default 20000, a CAP never a floor), now (injected clock) }.
 *
 * Returns { nodes, lane } where:
 *   nodes[]  { rule_id, selector, snippet, wcag_sc, state } - state in { violation, incomplete }.
 *   lane     { ran, reason } - always recorded. reason in { null (ran), evaluate-unavailable, deadline,
 *            error }. A lane that could not run carries nodes:[] and a visible reason, never a silent [].
 */
async function domAssert(page, opts) {
  const cfg = normaliseOpts(opts);
  if (!pageCanEvaluate(page)) return laneUnavailable('evaluate-unavailable');
  const started = cfg.now();
  try {
    const raced = await raceWithDeadline(Promise.resolve().then(() => page.evaluate(collectDescriptors)), cfg.deadlineMs, cfg.now);
    if (raced.timedOut) return laneDeadline(raced.elapsed);
    return laneRan(buildNodes(raced.value));
  } catch (e) {
    // FAIL-OPEN (Rule 4): a browser/evaluate failure is RECORDED into lane.reason='error' and returned; a
    // broken DOM lane must degrade the mint, never throw into it. No secret can leak here (message clipped).
    return laneError(e, cfg.now() - started);
  }
}

module.exports = {
  domAssert,
  // the in-page evaluate payload, exported so the lane is testable/inspectable without a browser:
  checksSource: collectDescriptors,
  // pure decision predicates + orchestration (exported for direct unit testing on plain descriptor objects):
  buildNodes,
  nodeOf,
  imgNode,
  controlNode,
  htmlNode,
  linkNode,
  buttonNode,
  contrastNode,
  formNode,
  checkboxNode,
  parseColour,
  contrastRatio,
  isLargeText,
  normaliseOpts,
  DEFAULT_DEADLINE_MS,
  MAX_DESCRIPTORS,
};
