'use strict';
// evidence/browser/dom-assert-predicates.js - the PURE, browser-free grading half of the axe-style DOM
// assertion lane (extracted from dom-assert.js, P6, to keep dom-assert.js under the single-purpose file
// cap: caution.md C-193/C-194/C-254, "a fix that would grow a file past its cap EXTRACTS a module rather
// than grows the file").
//
// Every function here is a small PURE predicate over a plain, serialisable DESCRIPTOR object - no
// document/getComputedStyle/CSS, no browser context. dom-assert.js's in-page collectDescriptors() pass
// (which MUST stay self-contained for page.evaluate() serialisation - see that file's own header) emits
// the descriptors; this module grades them. dom-assert.js requires this module and re-exports everything
// unchanged, so the public API (require('./dom-assert.js')) is byte-identical to before the split; no
// consumer (breach/proposers/propose.js, propose.test.js, dom-assert.test.js) needed to change.

// ── the risk-tier partition (W6, the ONE classification door) ─────────────────────────────────────────
// DOM_RULE_TIER maps each dom-assert rule_id to its FINDING tier. This is the single frozen door that
// decides whether a CONFIRMED node ships as a hard violation or must adjudicate to needs-review:
//   'deterministic'  the DOM fact IS the breach with no legal judgement needed (a missing alt attribute
//                     just IS a WCAG 1.1.1 failure). A confirmed node keeps the observed-fact bypass and
//                     ships as `violation`.
//   'risk'           the DOM fact is a real, deterministic OBSERVATION (the insecure form IS present) but
//                     its LEGAL characterisation is risk-based, not deterministic: an https page whose form
//                     posts to an http action is a transport-security RISK INDICATOR under UK GDPR Art 32
//                     (a risk-based duty needing the controller's own assessment - the C-048 class), and a
//                     pre-ticked consent box is a consent-law risk to review. A confirmed risk node is
//                     evidence-backed (Rule 3) but must route to needs-review (Rule 6/Rule 10), NEVER a
//                     hard accusation. See caution.md C-048 and catalogue/packs/uk-universal.QA.md.
// The tier is a FINDING-STATE classifier only; it does NOT change DOM detection. A risk node is still
// emitted with its true detection state ('violation' for a confirmed insecure form), so it is never
// silently under-reported (dropping it to 'incomplete' would be the opposite error). The downstream
// routing (breach/adjudicator/evidence-kind.js) reads this tier off the artifact.
const DOM_RULE_TIER = Object.freeze({
  'image-alt': 'deterministic',
  'label': 'deterministic',
  'html-has-lang': 'deterministic',
  'link-name': 'deterministic',
  'button-name': 'deterministic',
  'color-contrast': 'deterministic',
  'insecure-form': 'risk',
  'pre-ticked-consent': 'risk',
});
// tierOf(rule_id) -> the finding tier for a rule_id. An unmapped rule_id defaults to 'risk' (fail-closed,
// Rule 6): an unclassified DOM check is never auto-shipped as a hard violation. Every rule this lane
// actually emits is explicitly mapped above, so the default is defensive only.
function tierOf(rule_id) {
  return Object.prototype.hasOwnProperty.call(DOM_RULE_TIER, rule_id) ? DOM_RULE_TIER[rule_id] : 'risk';
}

// WCAG_SC maps each dom-assert rule_id to its WCAG success criterion, or null for the two non-WCAG
// duties (insecure-form is a transport-security concern, pre-ticked-consent a consent-law one). Like
// DOM_RULE_TIER, this is a pure function of rule_id, so nodeOf DERIVES it rather than taking it as a
// separate argument at every one of the ~11 call sites (keeps nodeOf's own argument count low and
// removes a class of typo-drift between a call site's literal and the rule it names).
const WCAG_SC = Object.freeze({
  'image-alt': '1.1.1',
  'label': '1.3.1',
  'html-has-lang': '3.1.1',
  'link-name': '4.1.2',
  'button-name': '4.1.2',
  'color-contrast': '1.4.3',
  'insecure-form': null,
  'pre-ticked-consent': null,
});
function wcagScOf(rule_id) {
  return Object.prototype.hasOwnProperty.call(WCAG_SC, rule_id) ? WCAG_SC[rule_id] : null;
}

// ── the canonical node shape (Rule 1: one door for the dom_node artifact fields) ──────────────────────
// nodeOf(d, rule_id, state) -> { rule_id, selector, snippet, wcag_sc, state, tier } and NOTHING else.
// Every predicate below returns exactly this shape (or null for a pass), so the verifier and the
// proposer read one stable shape. `selector`/`snippet` are read off the descriptor `d` (every descriptor
// already carries them, so they are never a repeated positional argument at the call site); `wcag_sc` and
// `tier` are both derived from `rule_id` through their own one-door lookups above.
function nodeOf(d, rule_id, state) {
  return { rule_id, selector: d.selector, snippet: d.snippet, wcag_sc: wcagScOf(rule_id), state, tier: tierOf(rule_id) };
}

// ── pure decision predicates (the honesty core; each is a pure function of ONE plain descriptor) ───────

// image-alt (WCAG 1.1.1): a violation ONLY when the alt attribute is entirely absent. alt="" is a PASS
// (the decorative-image marking), so hasAlt:true -> null even for an empty alt.
function imgNode(d) {
  return d.hasAlt ? null : nodeOf(d, 'image-alt', 'violation');
}

// label (WCAG 1.3.1): input/select/textarea with no label association.
//
// ROOT CAUSE of the false-positive class (legal-uk.md Fix 2: 6/6 false "missing label" violations on a
// real WPForms/Elementor contact form whose inputs all carried a correct <label for="id">): the ORIGINAL
// predicate trusted a SINGLE signal - the browser's native `el.labels` collection - for the "wrapping OR
// for/id" route. `el.labels` is ID-RESOLUTION-based (per the WHATWG spec it associates a control only via
// `getElementById`-style lookup), so it silently returns EMPTY for a control whose `id` is duplicated
// elsewhere in the document (a known page-builder/Elementor pattern: the same form markup re-rendered for
// a second breakpoint or a hidden preview copy) even though a textually-matching `<label for="...">`
// genuinely exists and a sighted/AT user would see it associated. A single unreliable signal shipping
// straight to a hard `violation` (this rule is deterministic-tier: no adjudicator safety net) is exactly
// the worst class this project tracks - accusing the compliant.
//
// THE FIX is defence-in-depth, never a single signal: every valid WCAG 1.3.1/4.1.2 labelling route is
// checked INDEPENDENTLY and the control is labelled if ANY resolves to real text -
//   (a) the native `.labels` association (wrapping label OR for/id, when the browser resolves it),
//   (b) an EXPLICIT `label[for="id"]` document query (independent of `.labels`'s id-resolution quirk -
//       this is the direct fix for the duplicate-id false-positive above),
//   (c) an EXPLICIT ancestor walk for a wrapping `<label>` (independent of (a)'s native resolution too),
//   (d) aria-label,
//   (e) aria-labelledby resolved to text,
//   (f) title (WCAG technique H65 - the weakest valid route, but a real one; omitting it was itself a
//       source of false accusation).
// hidden/submit/button/reset/image are not labellable controls (their accessible name comes from
// value/alt, not a <label>) and are skipped entirely (null), matching axe-core's own `label` rule scope.
//
// THE CONSERVATIVE SPLIT (Constitution Rule 6/Rule 10 - ambiguity defaults to withholding the
// accusation): a control with NO labelling route of ANY kind (none of a/b/c/d/e/f present at all) is
// genuinely unlabelled and still ships as a hard `violation` (the positive control below must keep
// firing). A control where a labelling route STRUCTURALLY EXISTS (a label element/aria-labelledby/title
// attribute is present) but resolves to EMPTY text (an authored-but-blank `<label for="x"></label>`, an
// `aria-labelledby` pointing at a missing/empty node, a whitespace-only `title`) is ambiguous - it may be
// a genuine authoring bug or content the lane could not read - and degrades to `incomplete` (needs-review;
// propose.js's dom_node router only proposes a candidate on `state==='violation'`, so `incomplete` never
// becomes a shipped finding: "do not flag", never a confident accusation on an edge case).
const EXCLUDED_CONTROL_TYPES = new Set(['hidden', 'submit', 'button', 'reset', 'image']);
// labelTextOf(d) -> the first NON-EMPTY resolved text across every valid labelling route. A real,
// non-empty accessible name from ANY route is a pass; reused firstNonEmpty (already the link/button name
// resolver) so the "first source that actually has content wins" rule is not duplicated.
function labelTextOf(d) {
  return firstNonEmpty([d.labelElementText, d.forIdLabelText, d.wrappingLabelText, d.ariaLabelText, d.ariaLabelledbyText, d.titleText]);
}
// hasAnyLabelRoute(d) -> true when SOME labelling mechanism is structurally present, even if its resolved
// text turned out empty above. Distinguishes "nothing associated at all" (violation) from "something is
// associated but reads as blank" (incomplete/ambiguous) - the conservative split described above.
function hasAnyLabelRoute(d) {
  return Boolean(d.hasLabelElementRef || d.hasForIdLabelRef || d.hasWrappingLabelRef || d.hasAriaLabelAttr || d.hasAriaLabelledbyAttr || d.hasTitleAttr);
}
function controlNode(d) {
  if (EXCLUDED_CONTROL_TYPES.has(d.controlType)) return null;
  if (labelTextOf(d) !== '') return null; // a real, resolved accessible name from any valid route -> pass.
  if (hasAnyLabelRoute(d)) return nodeOf(d, 'label', 'incomplete'); // ambiguous, never a confident accusation.
  return nodeOf(d, 'label', 'violation'); // no association of any kind: genuinely unlabelled.
}

// html-has-lang (WCAG 3.1.1): the <html> lang attribute must be present and a well-formed language tag.
// The primary subtag is 2 OR 3 letters (BCP-47/ISO 639-1 alpha-2 covers most languages, but ISO 639-2/3
// alpha-3 codes are also valid primary subtags - "fil" Filipino, "yue" Cantonese): a 2-letter-only check
// would false-accuse a page correctly tagged lang="fil" of a missing/malformed language, the exact
// false-accusation class this predicate exists to avoid.
const VALID_LANG = /^[a-z]{2,3}(-[A-Za-z0-9]+)*$/i;
function htmlNode(d) {
  const lang = typeof d.lang === 'string' ? d.lang.trim() : '';
  if (lang !== '' && VALID_LANG.test(lang)) return null;
  return nodeOf(d, 'html-has-lang', 'violation');
}

// link-name / button-name (WCAG 4.1.2): an empty accessible name. The name is the first non-empty of the
// element's text, its aria-label, its resolved aria-labelledby text, the alt of an <img> inside it, or
// (weakest, WCAG technique H33/H65) its title attribute. `title` was the SAME omission as the label
// predicate's root cause (a single-signal name computation false-accusing a control that has a real, if
// weak, accessible name) - the sibling-predicate audit the false-accusation fix requires, applied here.
function firstNonEmpty(parts) {
  for (const s of parts) {
    const t = typeof s === 'string' ? s.trim() : '';
    if (t) return t;
  }
  return '';
}
function accessibleNameEmpty(d) {
  return firstNonEmpty([d.text, d.ariaLabel, d.ariaLabelledbyText, d.imgAltInside, d.titleText]) === '';
}
function linkNode(d) {
  return accessibleNameEmpty(d) ? nodeOf(d, 'link-name', 'violation') : null;
}
function buttonNode(d) {
  return accessibleNameEmpty(d) ? nodeOf(d, 'button-name', 'violation') : null;
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
  if (!contrastIsFlat(d)) return nodeOf(d, 'color-contrast', 'incomplete');
  const ratio = contrastRatio(parseColour(d.fg), parseColour(d.bg));
  const threshold = isLargeText(d.fontPx, d.bold) ? 3.0 : 4.5;
  if (ratio < threshold) return nodeOf(d, 'color-contrast', 'violation');
  return null; // a real, measured, sufficient ratio -> a genuine pass (not a silent one).
}

// insecure-form: an https: page whose form posts to an http: action (wcag_sc null - a security duty, not a
// WCAG success criterion).
function formNode(d) {
  const insecure = d.pageScheme === 'https:' && d.actionScheme === 'http:';
  return insecure ? nodeOf(d, 'insecure-form', 'violation') : null;
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
  return preTicked ? nodeOf(d, 'pre-ticked-consent', 'violation') : null;
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

module.exports = {
  buildNodes,
  nodeOf,
  imgNode,
  controlNode,
  labelTextOf,
  hasAnyLabelRoute,
  EXCLUDED_CONTROL_TYPES,
  htmlNode,
  linkNode,
  buttonNode,
  contrastNode,
  formNode,
  checkboxNode,
  parseColour,
  contrastRatio,
  isLargeText,
  DOM_RULE_TIER,
  tierOf,
  WCAG_SC,
  wcagScOf,
  CHECK_PREDICATE,
};
