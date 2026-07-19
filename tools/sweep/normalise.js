#!/usr/bin/env node
'use strict';
/**
 * THE ONE ENTRY POINT for findings.
 *
 * Every tool speaks a different dialect. CodeQL and Semgrep emit SARIF natively. Review bots emit comments.
 * The local analysers (reachability, jscpd, one-door, swallow-gate, fact-lineage, eslint) emit a simple JSON
 * shape. All of them are converted HERE, and nothing else in this system is allowed to be a source of truth
 * about a finding.
 *
 * THE ALGORITHM
 *
 * 1. FINGERPRINT, the identity of a defect:
 *        fp = SHA256( normalise(path) + rule_id + SHA256(strip_ws(snippet)) )
 *    NEVER the line number. Lines shift on every edit; the defect does not. Fingerprint on the line and two
 *    runs a week apart produce different identities for the same defect, so you re-report everything you
 *    already fixed. This is precisely what SARIF's own partialFingerprints exists for.
 *
 * 2. DEDUPE: hash map, fingerprint -> Finding. O(1) per finding. Across tools AND across runs.
 *
 * 3. CLUSTER: Union-Find (union by rank + path compression). Two findings are the SAME DEFECT if they share
 *    a file, their regions overlap (with slack), and their semantic category matches. Different tools describe
 *    the same bug in different words; this is what lets us count how many INDEPENDENT tools agree.
 *
 * 4. NUMBER: sort by (severity DESC, corroboration DESC, fingerprint ASC) -> F-0001, F-0002, ...
 *    Deterministic. Same input, same numbers, forever. The ledger diffs cleanly.
 *
 * THE GATE
 *    corroboration >= 2  ->  ACT.    Two independent tools agreeing is a fact.
 *    corroboration == 1  ->  REVIEW. One tool is a lead, not a fact. Triaged, never auto-fixed.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, 'tools', 'sweep', 'out');

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const normPath = (p) => String(p || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
const stripWs = (s) => String(s || '').replace(/\s+/g, ' ').trim();

const SEV = { error: 'P0', warning: 'P1', note: 'P2', none: 'P3' };
const SEV_RANK = { P0: 0, P1: 1, P2: 2, P3: 3 };

// Semantic category: what lets two tools describing the same bug in different words be UNIONed.
function categorise(ruleId, message) {
  const t = (String(ruleId) + ' ' + String(message)).toLowerCase();
  if (/inject|xss|taint|sqli|command|traversal|ssrf|deserial/.test(t)) return 'injection';
  if (/secret|credential|token|password|api[- ]?key|hardcod/.test(t)) return 'secret';
  if (/two doors|multiple[- ]producers|one[- ]door|second producer/.test(t)) return 'two-doors';
  if (/unused|dead|unreach|never (called|used)|orphan|dormant/.test(t)) return 'dead-code';
  if (/async|await|promise|race|concurren|unhandled/.test(t)) return 'async';
  if (/null|undefined|nullable|no-undef|not defined|tdz|before initial/.test(t)) return 'undefined';
  if (/regex|redos|catastrophic|backtrack|escape/.test(t)) return 'regex';
  if (/duplicat|clone|copy[- ]?paste|\bdry\b/.test(t)) return 'duplication';
  if (/complex|cognitive|nesting|long method|god class|code health/.test(t)) return 'complexity';
  if (/error handl|swallow|empty catch|silent|fail[- ]?open|lineage/.test(t)) return 'error-handling';
  if (/perf|slow|n\+1|memory|leak/.test(t)) return 'performance';
  return 'other';
}

function makeFinding(o) {
  const p = normPath(o.file);
  const rid = String(o.ruleId || 'unknown');
  const snip = stripWs(o.snippet || '');
  return {
    fingerprint: sha([p, rid, sha(snip)].join(' ')),
    tool: String(o.tool),
    rule_id: rid,
    path: p,
    start_line: Number(o.startLine || 0),
    end_line: Number(o.endLine || o.startLine || 0),
    severity: SEV[String(o.level || 'warning').toLowerCase()] || 'P1',
    category: categorise(rid, o.message),
    message: stripWs(o.message).slice(0, 400),
    snippet: snip.slice(0, 200),
  };
}

// ADAPTER: SARIF (CodeQL, Semgrep: native).
function fromSarif(file) {
  const out = [];
  let doc;
  // A parse failure is LOUD. A tool whose output we cannot read has NOT reported zero findings.
  try { doc = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { throw new Error('cannot parse SARIF ' + file + ': ' + e.message + ' (this is NOT zero findings)'); }
  for (const run of doc.runs || []) {
    const tool = ((run.tool || {}).driver || {}).name || path.basename(file, '.sarif');
    const rules = {};
    for (const r of (((run.tool || {}).driver || {}).rules) || []) rules[r.id] = r;
    for (const res of run.results || []) {
      const pl = (((res.locations || [])[0]) || {}).physicalLocation || {};
      const reg = pl.region || {};
      const rule = rules[res.ruleId] || {};
      out.push(makeFinding({
        tool,
        ruleId: res.ruleId,
        file: (pl.artifactLocation || {}).uri,
        startLine: reg.startLine,
        endLine: reg.endLine,
        level: res.level || (rule.defaultConfiguration || {}).level || 'warning',
        message: (res.message || {}).text || '',
        snippet: (reg.snippet || {}).text || (((pl.contextRegion || {}).snippet) || {}).text || '',
      }));
    }
  }
  return out;
}

// ADAPTER: GitHub review comments (CodeRabbit, CodeScene, any PR reviewer). One adapter, here, so the rest
// of the system never has to learn these tools exist. Expects [{tool, body, path, line, diff_hunk}].
function fromReviewComments(file) {
  const LEVEL = [
    [/potential issue|critical|major|security|bug/i, 'error'],
    [/refactor|maintainab|complexity|code health/i, 'warning'],
    [/nitpick|trivial|style/i, 'note'],
  ];
  return JSON.parse(fs.readFileSync(file, 'utf8')).map((c) => {
    // Sanitise the review-comment body for a plain-text markdown ledger cell. First remove HTML comment
    // blocks (both end forms, the standard "-->" and the spec-legal "--!>") for readability, then strip
    // EVERY angle bracket as the final, security-complete step: with no "<" or ">" left, no HTML element
    // or comment can survive or re-form, so this is complete single-character sanitisation (the ledger is
    // plain markdown, never rendered as HTML, and a title has no need for angle brackets).
    const body = String(c.body || '')
      .replace(/<!--[\s\S]*?--!?>/g, '')
      .replace(/[<>]/g, '')
      .trim();
    const lvl = (LEVEL.find((x) => x[0].test(body)) || [null, 'warning'])[1];
    const title = (body.match(/\*\*(.+?)\*\*/) || [null, body.slice(0, 90)])[1];
    return makeFinding({
      tool: c.tool, ruleId: c.tool + ':' + sha(title).slice(0, 8), file: c.path,
      startLine: c.line, endLine: c.line, level: lvl, message: title, snippet: c.diff_hunk || title,
    });
  });
}

// ADAPTER: the local analysers. Expects [{tool, ruleId, file, startLine, endLine, level, message, snippet}].
function fromLocal(file) { return JSON.parse(fs.readFileSync(file, 'utf8')).map(makeFinding); }

// UNION-FIND
class DSU {
  constructor(n) { this.p = Array.from({ length: n }, (_, i) => i); this.r = new Array(n).fill(0); }
  find(x) { while (this.p[x] !== x) { this.p[x] = this.p[this.p[x]]; x = this.p[x]; } return x; }
  union(a, b) {
    let ra = this.find(a); let rb = this.find(b);
    if (ra === rb) return;
    if (this.r[ra] < this.r[rb]) { const t = ra; ra = rb; rb = t; }
    this.p[rb] = ra;
    if (this.r[ra] === this.r[rb]) this.r[ra]++;
  }
}

const SLACK = Number(process.env.CLUSTER_SLACK || 6);   // tools disagree by a few lines about the same defect
const overlaps = (a, b) => a.start_line === 0 || b.start_line === 0 ||
  (a.start_line - SLACK <= b.end_line && b.start_line - SLACK <= a.end_line);

function cluster(findings) {
  const dsu = new DSU(findings.length);
  // Bucket by (path, category): never compare across files. A naive all-pairs O(n^2) over 10^4 findings is
  // 10^8 comparisons; bucketing makes it ~10^5. This is the whole reason the sweep runs in milliseconds.
  const buckets = new Map();
  findings.forEach((f, i) => {
    const k = f.path + ' ' + f.category;
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(i);
  });
  for (const idxs of buckets.values()) {
    for (let a = 0; a < idxs.length; a++) {
      for (let b = a + 1; b < idxs.length; b++) {
        if (overlaps(findings[idxs[a]], findings[idxs[b]])) dsu.union(idxs[a], idxs[b]);
      }
    }
  }
  const groups = new Map();
  findings.forEach((f, i) => {
    const root = dsu.find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(f);
  });
  return [...groups.values()];
}

function build(raw) {
  const uniq = new Map();
  for (const f of raw) if (!uniq.has(f.fingerprint + f.tool)) uniq.set(f.fingerprint + f.tool, f);
  const findings = [...uniq.values()];

  const clusters = cluster(findings).map((members) => {
    const tools = [...new Set(members.map((m) => m.tool))].sort();
    const lead = members.slice().sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity])[0];
    return {
      severity: lead.severity,                 // MAX severity across the cluster wins
      corroboration: tools.length,
      tools,
      path: lead.path,
      start_line: lead.start_line,
      end_line: lead.end_line,
      category: lead.category,
      message: lead.message,
      fingerprint: members.map((m) => m.fingerprint).sort()[0],
      members: members.map((m) => ({ tool: m.tool, rule_id: m.rule_id, message: m.message })),
      status: tools.length >= 2 ? 'ACT' : 'REVIEW',
    };
  });

  clusters.sort((a, b) =>
    (SEV_RANK[a.severity] - SEV_RANK[b.severity]) ||
    (b.corroboration - a.corroboration) ||
    a.fingerprint.localeCompare(b.fingerprint));
  clusters.forEach((c, i) => { c.id = 'F-' + String(i + 1).padStart(4, '0'); });

  return {
    generated_at: new Date().toISOString(),
    raw_findings: raw.length,
    after_dedupe: findings.length,
    clusters: clusters.length,
    act: clusters.filter((c) => c.status === 'ACT').length,
    review: clusters.filter((c) => c.status === 'REVIEW').length,
    by_tool: Object.fromEntries([...new Set(findings.map((f) => f.tool))].sort()
      .map((t) => [t, findings.filter((f) => f.tool === t).length])),
    by_severity: Object.fromEntries(['P0', 'P1', 'P2', 'P3']
      .map((s) => [s, clusters.filter((c) => c.severity === s).length])),
    findings: clusters,
  };
}

function main() {
  const dir = process.argv[2] || path.join(OUT, 'sarif');
  const raw = [];
  if (!fs.existsSync(dir)) { console.error('no findings dir: ' + dir + ' (run the collectors first)'); process.exit(1); }
  for (const f of fs.readdirSync(dir).sort()) {
    const p = path.join(dir, f);
    if (f.endsWith('.sarif')) raw.push(...fromSarif(p));
    else if (f.endsWith('.reviews.json')) raw.push(...fromReviewComments(p));
    else if (f.endsWith('.local.json')) raw.push(...fromLocal(p));
  }
  const summary = build(raw);
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'ledger.json'), JSON.stringify(summary, null, 2));
  console.log('  raw findings     ' + summary.raw_findings);
  console.log('  after dedupe     ' + summary.after_dedupe);
  console.log('  clusters         ' + summary.clusters);
  console.log('  ACT (>=2 tools)  ' + summary.act);
  console.log('  REVIEW (1 tool)  ' + summary.review);
  console.log('  by tool          ' + JSON.stringify(summary.by_tool));
}
if (require.main === module) main();
module.exports = { makeFinding, cluster, DSU, categorise, fromSarif, fromReviewComments, fromLocal, build };
