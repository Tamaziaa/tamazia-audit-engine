'use strict';
// evidence/browser/dom-assert.test.js - node:test for the axe-style DOM assertion lane.
// Run: node --test evidence/browser/dom-assert.test.js
//
// The DOM extraction (collectDescriptors) NEEDS a real browser and so is not unit-tested here; the graded
// DECISIONS - which is where Rule 10's honesty core lives - are pure predicates over plain descriptor
// objects and ARE tested directly. The orchestration (deadline, lane honesty, fake page) is driven with a
// scripted FAKE page whose evaluate() returns canned descriptors, mirroring observe.test.js's fake browser.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  domAssert, buildNodes, imgNode, controlNode, htmlNode, linkNode, buttonNode,
  contrastNode, formNode, checkboxNode, contrastRatio, isLargeText, DEFAULT_DEADLINE_MS, normaliseOpts,
} = require('./dom-assert.js');

// A fake wrapped page: evaluate(fn) ignores fn (it cannot run the real DOM walk without a browser) and
// returns whatever descriptors the test scripted. `hang` never settles; `throwErr` rejects.
function fakePage(script) {
  const s = script || {};
  return {
    async evaluate() {
      if (s.hang) return new Promise(() => {});
      if (s.throwErr) throw new Error(s.throwErr);
      return s.descriptors || [];
    },
  };
}

const NODE_KEYS = ['rule_id', 'selector', 'snippet', 'state', 'wcag_sc'];

// ── image-alt (WCAG 1.1.1): alt="" is a decorative PASS, a missing alt is the violation ───────────────
test('image-alt: a missing alt attribute is a violation; alt="" (hasAlt:true) is a PASS', () => {
  const v = imgNode({ selector: 'img:nth-of-type(1)', snippet: '<img src="x">', hasAlt: false });
  assert.equal(v.state, 'violation');
  assert.equal(v.rule_id, 'image-alt');
  assert.equal(v.wcag_sc, '1.1.1');
  assert.equal(imgNode({ hasAlt: true }), null, 'alt="" is decorative marking, never a violation');
});

// ── label (WCAG 1.3.1): association satisfied by a label element, aria-label OR aria-labelledby ────────
test('label: an unlabelled input is a violation; any association passes; hidden/submit/button are skipped', () => {
  const bare = { selector: 'input:nth-of-type(1)', snippet: '<input>', controlType: 'text', hasLabelElement: false, hasAriaLabel: false, hasAriaLabelledby: false };
  assert.equal(controlNode(bare).state, 'violation');
  assert.equal(controlNode(bare).wcag_sc, '1.3.1');
  assert.equal(controlNode(Object.assign({}, bare, { hasLabelElement: true })), null);
  assert.equal(controlNode(Object.assign({}, bare, { hasAriaLabel: true })), null);
  assert.equal(controlNode(Object.assign({}, bare, { hasAriaLabelledby: true })), null);
  for (const controlType of ['hidden', 'submit', 'button']) {
    assert.equal(controlNode(Object.assign({}, bare, { controlType })), null, controlType + ' is not a labellable control');
  }
});

// ── html-has-lang (WCAG 3.1.1): present + well-formed passes; empty/malformed is the violation ────────
test('html-has-lang: empty or malformed lang is a violation; a valid tag passes', () => {
  assert.equal(htmlNode({ selector: 'html', snippet: '<html>', lang: '' }).state, 'violation');
  assert.equal(htmlNode({ lang: undefined }).state, 'violation', 'a missing lang attribute is a violation');
  assert.equal(htmlNode({ lang: 'english' }).state, 'violation', 'a non-tag value is malformed');
  assert.equal(htmlNode({ lang: 'en' }), null);
  assert.equal(htmlNode({ lang: 'en-GB' }), null);
  assert.equal(htmlNode({ lang: 'zh-Hant' }), null);
});

// ── link-name / button-name (WCAG 4.1.2): empty accessible name is the violation ──────────────────────
test('link-name / button-name: an empty accessible name is a violation; any name source passes', () => {
  const empty = { selector: 'a:nth-of-type(1)', snippet: '<a href>', text: '', ariaLabel: '', ariaLabelledbyText: '', imgAltInside: '' };
  assert.equal(linkNode(empty).rule_id, 'link-name');
  assert.equal(linkNode(empty).state, 'violation');
  assert.equal(linkNode(Object.assign({}, empty, { text: 'Contact us' })), null);
  assert.equal(linkNode(Object.assign({}, empty, { imgAltInside: 'Home' })), null, 'an <img alt> inside supplies the name');
  const btn = { selector: 'button:nth-of-type(1)', snippet: '<button>', text: '', ariaLabel: '', ariaLabelledbyText: '', imgAltInside: '' };
  assert.equal(buttonNode(btn).rule_id, 'button-name');
  assert.equal(buttonNode(Object.assign({}, btn, { ariaLabel: 'Close' })), null);
});

// ── color-contrast (WCAG 1.4.3): the flatness gate is the honesty core (Rule 10) ──────────────────────
test('color-contrast: a gradient/image/alpha/unparseable background is INCOMPLETE, never a violation or silent pass', () => {
  const flatLow = { selector: 'p:nth-of-type(1)', snippet: '<p>', fg: 'rgb(150,150,150)', bg: 'rgb(200,200,200)', bgImage: 'none', fontPx: 16, bold: false };
  assert.equal(contrastNode(flatLow).state, 'violation');
  const gradient = Object.assign({}, flatLow, { bgImage: 'linear-gradient(#fff,#000)' });
  assert.equal(contrastNode(gradient).state, 'incomplete', 'a gradient bg cannot be measured -> incomplete');
  const alpha = Object.assign({}, flatLow, { bg: 'rgba(255,255,255,0)' });
  assert.equal(contrastNode(alpha).state, 'incomplete', 'a transparent bg cannot be measured -> incomplete');
  const named = Object.assign({}, flatLow, { bg: 'transparent' });
  assert.equal(contrastNode(named).state, 'incomplete', 'an unparseable colour keyword -> incomplete, never a silent pass');
});

test('color-contrast: a real ratio on flat opaque colours grades violation/pass by the WCAG thresholds', () => {
  const base = { selector: 'p:nth-of-type(1)', snippet: '<p>', bgImage: 'none' };
  // black on white = 21:1 -> pass (null), regardless of size.
  assert.equal(contrastNode(Object.assign({}, base, { fg: 'rgb(0,0,0)', bg: 'rgb(255,255,255)', fontPx: 16, bold: false })), null);
  // #767676 on white ~= 4.54:1 -> passes normal (>=4.5).
  assert.equal(contrastNode(Object.assign({}, base, { fg: '#767676', bg: '#ffffff', fontPx: 16, bold: false })), null);
  // #777 on white ~= 4.48:1 -> fails normal (<4.5) but the SAME pair passes as large text (>=3.0).
  assert.equal(contrastNode(Object.assign({}, base, { fg: '#777777', bg: '#ffffff', fontPx: 16, bold: false })).state, 'violation');
  assert.equal(contrastNode(Object.assign({}, base, { fg: '#777777', bg: '#ffffff', fontPx: 24, bold: false })), null, 'large text uses the 3.0 threshold');
});

test('contrastRatio and isLargeText are the documented pure helpers', () => {
  assert.equal(Math.round(contrastRatio({ r: 0, g: 0, b: 0, a: 1 }, { r: 255, g: 255, b: 255, a: 1 })), 21);
  assert.equal(contrastRatio(null, { r: 0, g: 0, b: 0 }), 0, 'an unparseable colour yields ratio 0, never a throw');
  assert.equal(isLargeText(24, false), true);
  assert.equal(isLargeText(18.66, true), true, '18.66px bold is large');
  assert.equal(isLargeText(18.66, false), false, '18.66px non-bold is NOT large');
  assert.equal(isLargeText(16, true), false);
});

// ── insecure-form + pre-ticked-consent (wcag_sc null) ─────────────────────────────────────────────────
test('insecure-form: https page + http action is a violation; https action or http page is not', () => {
  const base = { selector: 'form:nth-of-type(1)', snippet: '<form>' };
  assert.equal(formNode(Object.assign({}, base, { pageScheme: 'https:', actionScheme: 'http:' })).state, 'violation');
  assert.equal(formNode(Object.assign({}, base, { pageScheme: 'https:', actionScheme: 'http:' })).wcag_sc, null);
  assert.equal(formNode(Object.assign({}, base, { pageScheme: 'https:', actionScheme: 'https:' })), null);
  assert.equal(formNode(Object.assign({}, base, { pageScheme: 'http:', actionScheme: 'http:' })), null, 'an http page is out of scope for this check');
});

test('pre-ticked-consent: a pre-checked consent checkbox is a violation; unchecked or non-consent is not', () => {
  const base = { selector: 'input:nth-of-type(1)', snippet: '<input type=checkbox checked>' };
  assert.equal(checkboxNode(Object.assign({}, base, { checkedAttr: true, labelText: 'Sign me up for the newsletter' })).state, 'violation');
  assert.equal(checkboxNode(Object.assign({}, base, { checkedAttr: true, labelText: 'I accept the terms' })), null, 'terms consent is not marketing/consent tokens');
  assert.equal(checkboxNode(Object.assign({}, base, { checkedAttr: false, labelText: 'marketing offers' })), null, 'an unchecked box is not pre-ticked');
});

// ── node shape + buildNodes dispatch ──────────────────────────────────────────────────────────────────
test('every emitted node has EXACTLY the five contract keys', () => {
  const samples = [
    imgNode({ selector: 'img', snippet: '<img>', hasAlt: false }),
    htmlNode({ selector: 'html', snippet: '<html>', lang: '' }),
    formNode({ selector: 'form', snippet: '<form>', pageScheme: 'https:', actionScheme: 'http:' }),
    contrastNode({ selector: 'p', snippet: '<p>', fg: 'rgb(1,1,1)', bg: 'rgb(2,2,2)', bgImage: 'none', fontPx: 16, bold: false }),
  ];
  for (const node of samples) assert.deepEqual(Object.keys(node).sort(), NODE_KEYS);
});

test('buildNodes maps descriptors through predicates, keeps violations AND incompletes, drops passes and unknowns', () => {
  const descriptors = [
    { check: 'img', selector: 'img:nth-of-type(1)', snippet: '<img src=x>', hasAlt: false },       // violation
    { check: 'img', selector: 'img:nth-of-type(2)', snippet: '<img alt="">', hasAlt: true },        // pass -> dropped
    { check: 'contrast', selector: 'p', snippet: '<p>', fg: 'rgb(0,0,0)', bg: 'transparent', bgImage: 'none', fontPx: 16, bold: false }, // incomplete
    { check: 'not-a-real-check', selector: 'x', snippet: '<x>' },                                    // unknown -> dropped
  ];
  const nodes = buildNodes(descriptors);
  assert.equal(nodes.length, 2, 'the violation and the incomplete survive; the pass and the unknown do not');
  assert.equal(nodes[0].state, 'violation');
  assert.equal(nodes[1].state, 'incomplete');
  assert.deepEqual(buildNodes(null), [], 'a non-array descriptor list yields no nodes, never a throw');
});

// ── orchestration: deadline / lane honesty / fake page (never throws) ──────────────────────────────────
test('domAssert: a fake page returning canned descriptors runs the lane and grades them', async () => {
  const page = fakePage({ descriptors: [{ check: 'img', selector: 'img:nth-of-type(1)', snippet: '<img src=x>', hasAlt: false }] });
  const r = await domAssert(page, { deadlineMs: 1000 });
  assert.equal(r.lane.ran, true);
  assert.equal(r.lane.reason, null);
  assert.equal(r.nodes.length, 1);
  assert.equal(r.nodes[0].rule_id, 'image-alt');
  assert.deepEqual(Object.keys(r.nodes[0]).sort(), NODE_KEYS);
});

test('domAssert: a page with no evaluate method records evaluate-unavailable (C-041), never throws', async () => {
  const r = await domAssert({}, {});
  assert.equal(r.lane.ran, false);
  assert.equal(r.lane.reason, 'evaluate-unavailable');
  assert.deepEqual(r.nodes, []);
});

test('domAssert: a hanging evaluate cannot hold the mint - the lane returns a recorded deadline refusal', async () => {
  const started = Date.now();
  const r = await domAssert(fakePage({ hang: true }), { deadlineMs: 30 });
  const wall = Date.now() - started;
  assert.equal(r.lane.ran, false);
  assert.equal(r.lane.reason, 'deadline');
  assert.equal(typeof r.lane.elapsedMs, 'number');
  assert.deepEqual(r.nodes, []);
  assert.ok(wall < 2000, 'domAssert ran ' + wall + 'ms past a 30ms deadline - the hang class is NOT bounded');
});

test('domAssert: a throwing evaluate is RECORDED as a lane error, never thrown into the mint (Rule 4)', async () => {
  const r = await domAssert(fakePage({ throwErr: 'evaluate-blew-up' }), { deadlineMs: 1000 });
  assert.equal(r.lane.ran, false);
  assert.equal(r.lane.reason, 'error');
  assert.match(r.lane.message, /evaluate-blew-up/);
  assert.deepEqual(r.nodes, []);
});

test('domAssert: the deadline is a hard CAP, never a floor (Rule 8) - an oversized override clamps', () => {
  assert.equal(normaliseOpts({ deadlineMs: 3600000 }).deadlineMs, DEFAULT_DEADLINE_MS);
  assert.equal(normaliseOpts({ deadlineMs: 50 }).deadlineMs, 50, 'a shorter budget is honoured');
  assert.equal(normaliseOpts({ deadlineMs: 0 }).deadlineMs, DEFAULT_DEADLINE_MS, 'a non-positive value falls back to the ceiling');
});
