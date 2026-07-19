'use strict';
/* global document, getComputedStyle, CSS */
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

// The pure, browser-free grading predicates (risk-tier partition, nodeOf, image-alt/label/html-has-lang/
// link-name/button-name/color-contrast/insecure-form/pre-ticked-consent, buildNodes) live in
// dom-assert-predicates.js (extracted P6 to keep this file under the single-purpose cap, C-193/C-194/
// C-254): every one of them is re-exported below unchanged, so the public API of this module is
// byte-identical to before the split.
const predicates = require('./dom-assert-predicates');
const { buildNodes } = predicates;

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
  // cssEscape(id) -> a selector-safe id literal. Prefers the platform's own CSS.escape (handles every
  // edge case, e.g. a leading digit); a manual escape of quote/backslash is the FAIL-OPEN fallback for a
  // browser context where CSS.escape is unavailable, so an unusual id degrades to "no match found" rather
  // than throwing the whole extraction pass.
  function cssEscape(id) {
    try { if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(id); }
    catch (e) { /* FAIL-OPEN: fall through to the manual escape below. */ }
    return String(id).replace(/["\\]/g, '\\$&');
  }
  // forIdLabel(id) -> {found, text} for a document-wide `label[for="id"]` query, INDEPENDENT of the
  // native `el.labels` id-resolution (the defence against the duplicate-id false-positive class,
  // legal-uk.md Fix 2: `.labels` associates only the FIRST element with a given id, so a control that is
  // NOT that first element gets nothing from `.labels` even though a real `for`/id-matching label
  // exists). `found` and `text` are reported separately so an authored-but-EMPTY label (found:true,
  // text:'') is distinguishable from no label at all (found:false) - the ambiguous-vs-unlabelled split.
  function forIdLabel(id) {
    if (!id) return { found: false, text: '' };
    var lab;
    try { lab = doc.querySelector('label[for="' + cssEscape(id) + '"]'); }
    catch (e) { return { found: false, text: '' }; /* FAIL-OPEN: an id that breaks the selector yields no match, never a thrown lane. */ }
    return { found: Boolean(lab), text: lab ? collapse(lab.textContent) : '' };
  }
  // wrappingLabel(el) -> {found, text} for an ancestor <label> found by an explicit closest() walk,
  // independent of `.labels`'s own implicit-association resolution (a second, structural route to the
  // same "wrapping label" fact so no single API is the sole gate to a hard violation).
  function wrappingLabel(el) {
    var lab = null;
    try { lab = typeof el.closest === 'function' ? el.closest('label') : null; }
    catch (e) { lab = null; /* FAIL-OPEN: an unsupported/throwing closest() yields no match, never a thrown lane. */ }
    return { found: Boolean(lab), text: lab ? collapse(lab.textContent) : '' };
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
      var id = el.getAttribute('id') || '';
      var forId = forIdLabel(id);
      var wrapping = wrappingLabel(el);
      push(descOf(el, 'control', {
        controlType: controlType,
        // every route resolved INDEPENDENTLY (the false-positive fix: no single API is the sole gate).
        labelElementText: labelsText(el),
        forIdLabelText: forId.text,
        wrappingLabelText: wrapping.text,
        ariaLabelText: collapse(el.getAttribute('aria-label')),
        ariaLabelledbyText: labelledbyText(el),
        titleText: collapse(el.getAttribute('title')),
        // structural presence flags (a route can EXIST but resolve to empty text - the ambiguous case):
        hasLabelElementRef: Boolean(el.labels && el.labels.length),
        hasForIdLabelRef: forId.found,
        hasWrappingLabelRef: wrapping.found,
        hasAriaLabelAttr: el.hasAttribute('aria-label'),
        hasAriaLabelledbyAttr: el.hasAttribute('aria-labelledby'),
        hasTitleAttr: el.hasAttribute('title'),
      }));
    });
  }
  function addLinks() {
    tryEach('a[href]', function (el) {
      push(descOf(el, 'link', {
        text: collapse(el.textContent), ariaLabel: collapse(el.getAttribute('aria-label')),
        ariaLabelledbyText: labelledbyText(el), imgAltInside: imgAltInside(el), titleText: collapse(el.getAttribute('title')),
      }));
    });
  }
  function addButtons() {
    tryEach('button', function (el) {
      push(descOf(el, 'button', {
        text: collapse(el.textContent), ariaLabel: collapse(el.getAttribute('aria-label')),
        ariaLabelledbyText: labelledbyText(el), imgAltInside: imgAltInside(el), titleText: collapse(el.getAttribute('title')),
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

module.exports = Object.assign({}, predicates, {
  domAssert,
  // the in-page evaluate payload, exported so the lane is testable/inspectable without a browser:
  checksSource: collectDescriptors,
  normaliseOpts,
  DEFAULT_DEADLINE_MS,
  // pure decision predicates + orchestration + the risk-tier partition (W6) all come from
  // dom-assert-predicates.js via the spread above: buildNodes, nodeOf, imgNode, controlNode,
  // labelTextOf, hasAnyLabelRoute, EXCLUDED_CONTROL_TYPES, htmlNode, linkNode, buttonNode, contrastNode,
  // formNode, checkboxNode, parseColour, contrastRatio, isLargeText, DOM_RULE_TIER, tierOf.
});
