'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildWindows, windowsAround, normaliseText } = require('./windows.js');

test('buildWindows extracts CRN and postcode from footer text', () => {
  const pages = [{ kind: 'footer', text: 'Acme Dental Ltd, Company No. 12345678, 1 High Street, London, SW1A 1AA' }];
  const out = buildWindows(pages);
  assert.equal(out.crn, '12345678');
  assert.equal(out.postcode, 'SW1A 1AA');
  assert.ok(out.windows.length > 0);
});

test('buildWindows returns no crn/postcode when absent', () => {
  const out = buildWindows([{ kind: 'about', text: 'We are a friendly dental practice.' }]);
  assert.equal(out.crn, null);
  assert.equal(out.postcode, null);
});

test('normaliseText strips hidden/display-none fragments', () => {
  const html = '<div>Visible Ltd</div><div style="display:none">Planted Fake Ltd 99999999</div>';
  const text = normaliseText(html);
  assert.ok(text.includes('Visible Ltd'));
  assert.ok(!text.includes('Planted Fake'));
});

test('normaliseText strips aria-hidden fragments', () => {
  const html = '<span aria-hidden="true">Hidden Co Ltd</span><span>Real Co Ltd</span>';
  const text = normaliseText(html);
  assert.ok(!text.includes('Hidden Co'));
  assert.ok(text.includes('Real Co'));
});

test('windowsAround merges overlapping marker windows', () => {
  const text = 'x'.repeat(50) + 'Ltd registered company no' + 'y'.repeat(50);
  const w = windowsAround(text);
  assert.equal(w.length, 1);
});

test('buildWindows prioritises footer/privacy/terms/about/contact ordering', () => {
  const pages = [
    { kind: 'contact', text: 'Call us. Ltd' },
    { kind: 'footer', text: 'Acme Ltd company no 12345678' },
  ];
  const out = buildWindows(pages);
  assert.ok(out.fullText.indexOf('Acme') < out.fullText.indexOf('Call us'));
});
