'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { aiReadinessProbe, robotsBlocks, AI_BOTS } = require('./ai-readiness.js');

const originalFetch = global.fetch;
function withFetch(router, fn) {
  global.fetch = async (url) => router(String(url));
  return fn().finally(() => { global.fetch = originalFetch; });
}
function textOk(body) { return { ok: true, status: 200, headers: { forEach() {} }, text: async () => body }; }
function jsonOk(body) { return { ok: true, status: 200, headers: { forEach() {} }, text: async () => JSON.stringify(body) }; }
function notFound() { return { ok: false, status: 404, headers: { forEach() {} }, text: async () => '' }; }

test('aiReadinessProbe abstains with reason no_domain on an empty domain', async () => {
  const r = await aiReadinessProbe({ domain: '' });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'no_domain');
});

test('robotsBlocks: a Disallow: / under a named AI bot user-agent fully blocks it; an unrelated bot is unaffected', () => {
  const { fullBlock } = robotsBlocks('User-agent: GPTBot\nDisallow: /\n\nUser-agent: ClaudeBot\nDisallow: /private/\n');
  assert.strictEqual(fullBlock('gptbot'), true);
  assert.strictEqual(fullBlock('claudebot'), false, 'a partial disallow does not fully block');
});

test('aiReadinessProbe scores down and lists the blocked bots when robots.txt disallows AI crawlers (zero key required)', async () => {
  await withFetch((url) => {
    if (url.includes('/robots.txt')) return textOk('User-agent: GPTBot\nDisallow: /\n');
    if (url.includes('/llms.txt')) return notFound();
    if (url.includes('wikidata')) return jsonOk({ search: [] });
    return notFound();
  }, async () => {
    const r = await aiReadinessProbe({ domain: 'acme.co.uk', company: 'Acme Ltd', corpus: { pages: [] } });
    assert.strictEqual(r.ok, true);
    assert.ok(r.blocked_ai_bots.includes('GPTBot'));
    assert.strictEqual(r.has_llms_txt, false);
    assert.ok(r.score < 100);
  });
});

test('aiReadinessProbe reads Organization schema from the corpus jsonLd (Rule 1: no second parse of raw markup)', async () => {
  await withFetch((url) => {
    if (url.includes('/robots.txt')) return textOk('User-agent: *\nDisallow:\n');
    if (url.includes('/llms.txt')) return textOk('# llms.txt\nAcme Ltd is a solicitors firm.');
    if (url.includes('wikidata')) return jsonOk({ search: [] });
    return notFound();
  }, async () => {
    const corpus = { pages: [{ url: 'https://acme.co.uk/', jsonLd: [{ '@type': 'Organization', sameAs: ['https://x.com/acme'] }] }] };
    const r = await aiReadinessProbe({ domain: 'acme.co.uk', company: 'Acme Ltd', corpus });
    assert.strictEqual(r.has_org_schema, true);
    assert.strictEqual(r.has_llms_txt, true);
  });
});

test('KNOWN-BAD calibration: every fetch failing (network down) still resolves ok:true with an honest, maximally-degraded score, never throws', async () => {
  await withFetch(() => { throw new Error('ECONNREFUSED'); }, async () => {
    const r = await aiReadinessProbe({ domain: 'acme.co.uk', company: 'Acme Ltd', corpus: { pages: [] } });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.blocked_ai_bots.length, 0, 'an unreadable robots.txt is never treated as a block');
    assert.strictEqual(r.has_org_schema, false);
  });
});

test('AI_BOTS names at least the four bots the mission calls out (GPTBot, ClaudeBot, PerplexityBot, Google-Extended)', () => {
  const uas = AI_BOTS.map((b) => b.ua);
  for (const bot of ['GPTBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended']) assert.ok(uas.includes(bot), bot + ' missing');
});
