'use strict';
// mint/worker.js - THE thin, queue-shaped entry the reachability walk names (Constitution Rule 5, Rule 9,
// Rule 17). It is one of the two mint entry points (mint/index.js is the other); requiring mint() here is
// what makes the whole audit path reachable and ARMS the Rule-5 walk (C-154/C-250). This is DELIBERATELY
// thin: the real queue integration (claim -> lease -> ack, the DB required_engine_version gate) is T6. Here
// a run is a list of urls minted SEQUENTIALLY, each under a HARD per-mint deadline (Rule 9: one slow site
// never hangs the batch), one JSON result line per url on stdout - honest and inspectable, never a phantom.
//
//   node mint/worker.js <url> [url...]        mint each url given on the argv
//   node mint/worker.js --file <path>         mint each non-empty, non-'#' line of a newline-delimited file
//   node mint/worker.js --deadline-ms <n>     override the per-mint wall-clock ceiling (default 180000)
//
// Each result line is JSON: { url, status, done, slug, hash, refusal, error }. It carries NO payload (too
// large for a log line) and NO secret (Rule 16): the payload lives in R2, the row in Neon, and this line is
// the queue's own honest record of what happened - status is the post-write state, done is true ONLY when
// row + live-200 + truth-pack all pass (Rule 7), never on a missing leg (the phantom-data class).

const fs = require('fs');
const { mint } = require('./index.js');
const { raceWithDeadline } = require('../evidence/browser/deadline.js');
const { assertSafePathComponent } = require('../tools/lib/safe-path.js');

const DEFAULT_PER_MINT_MS = 180000; // per-mint wall-clock ceiling (Rule 8/9): a CAP, never a floor.

// parseArgs(argv) -> { urls, deadlineMs }. Reads urls from --file (one per line, '#' comments skipped) or
// the positional argv. A --deadline-ms override is clamped to a sane ceiling (never negative/absurd).
function parseArgs(argv) {
  const args = argv.slice(2);
  const fileIdx = args.indexOf('--file');
  const dlIdx = args.indexOf('--deadline-ms');
  const deadlineMs = dlIdx !== -1 ? clampDeadline(args[dlIdx + 1]) : DEFAULT_PER_MINT_MS;
  if (fileIdx !== -1) return { urls: urlsFromFile(args[fileIdx + 1]), deadlineMs };
  const urls = args.filter((a, i) => !a.startsWith('--') && !(dlIdx !== -1 && i === dlIdx + 1));
  return { urls, deadlineMs };
}
function clampDeadline(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 600000) : DEFAULT_PER_MINT_MS;
}
// urlsFromFile(p) -> the non-empty, non-comment lines of a url-list file. A safe path component is required
// so a crafted --file value cannot traverse (defence in depth; this is an ops CLI, not a network surface).
function urlsFromFile(p) {
  if (!p) return [];
  const abs = require('path').resolve(String(p));
  assertSafePathComponent(require('path').basename(abs), { label: 'mint worker --file' });
  return fs.readFileSync(abs, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
}

// mintOne(url, deadlineMs, mintFn) -> the per-url result line object. NEVER throws: a per-mint deadline or a
// thrown mint is a recorded { error } line, never a crash of the batch (Rule 4/9). A timeout is its own
// state. `mintFn` defaults to the real mint (the reachability edge); a test injects a fake so node:test
// drives the batch loop, the timeout leg and the error leg with no network.
async function mintOne(url, deadlineMs, mintFn) {
  const run = typeof mintFn === 'function' ? mintFn : mint;
  try {
    const raced = await raceWithDeadline(run(url), deadlineMs);
    if (raced.timedOut) return { url, status: 'timeout', done: false, slug: null, hash: null, refusal: null, error: 'per-mint deadline ' + deadlineMs + 'ms exceeded (Rule 9)' };
    const r = raced.value || {};
    return { url, status: r.status || 'unknown', done: Boolean(r.done), slug: r.slug || null, hash: r.hash || null, refusal: r.refusal || null, error: null };
  } catch (e) {
    // FAIL-OPEN: a thrown mint becomes a RECORDED error line, never a crash of the batch (Rule 4); the queue
    // keeps an honest record and the remaining urls still mint.
    return { url, status: 'error', done: false, slug: null, hash: null, refusal: null, error: String((e && e.message) || e).slice(0, 200) };
  }
}

// runWorker(argv, out, mintFn) -> the array of result lines, each also written to `out` (default
// process.stdout) as one JSON line. Sequential by design (T6 owns real concurrency + the DB claim lease).
// Returns 0 lines for an empty run (a no-op, honestly reported), never an error. `mintFn` defaults to the
// real mint; a test injects a fake to drive the loop with no network.
async function runWorker(argv, out, mintFn) {
  const write = typeof out === 'function' ? out : (s) => process.stdout.write(s);
  const { urls, deadlineMs } = parseArgs(argv);
  if (!urls.length) { write(JSON.stringify({ worker: 'mint', urls: 0, note: 'no urls supplied; nothing to mint' }) + '\n'); return []; }
  const results = [];
  for (const url of urls) {
    const line = await mintOne(url, deadlineMs, mintFn);
    write(JSON.stringify(line) + '\n');
    results.push(line);
  }
  return results;
}

if (require.main === module) {
  runWorker(process.argv).then(
    (results) => process.exit(results.some((r) => r.status === 'error') ? 1 : 0),
    (e) => { process.stderr.write('mint/worker.js fatal: ' + String((e && e.stack) || e) + '\n'); process.exit(2); }
  );
}

module.exports = { runWorker, mintOne, parseArgs, DEFAULT_PER_MINT_MS };
