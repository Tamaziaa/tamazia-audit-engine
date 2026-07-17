'use strict';
/**
 * taxonomy.js - the derived failure-class taxonomy for the historical-failure crossref.
 *
 * Every distinct historical defect (the ~256 deduped sweep clusters, the 6 ACT corroborated
 * facts, the 5 domain-gate classes, and the 202 distilled caution.md pointers) belongs to
 * exactly ONE class below. Each class names:
 *
 *   class          the kebab-case class id (stable; referenced by every defect entry)
 *   description    what the mechanism IS, in one line
 *   catching_gate  the ONE file in THIS repo that would catch this class today, or the committed
 *                  planned file the owning phase must land. Never the literal "MISSING" unless a
 *                  class genuinely has no named gate and no plan (that state fails CI on purpose).
 *   status         'guarded' (catching_gate is a live file in the tree) or
 *                  'gap'     (catching_gate is a planned file that does not exist yet)
 *   phase          null for guarded; the phase Pn that lands the gate for a gap
 *   past_severity  the worst severity this class reached in the old estate (for GAPS ranking)
 *   shipped        true if this class is recorded as having reached a client (a false claim in a
 *                  minted audit), false if it was caught internally / is code-hygiene only
 *   caution        the caution.md pointers this class distils (C-nnn), for cross-navigation
 *
 * HONESTY RULE (Constitution Rule 4, caution.md C-163 "a gate that cannot fire is theatre"):
 * a class is marked guarded ONLY when its named gate is a file that exists AND is capable of
 * firing on this class. A class that cannot be guarded until a later phase (render truth-pack,
 * the mint pipeline, the LLM chain) is honestly marked gap with the phase that closes it - never
 * force-fitted to a live gate that does not actually police it.
 */

// Live gate files (present in the tree at authoring time). check.js verifies each still exists;
// if a guarded class's gate is ever deleted, CI goes red. This list is the human-readable intent;
// the mechanical check reads catching_gate off each class and stats() the path.
const TAXONOMY = [
  // ── GUARDED: a live gate polices this class today ─────────────────────────────────────────────
  {
    class: 'two-doors',
    description: 'One client-facing fact produced by multiple modules; the stale door is the one the client sees.',
    catching_gate: 'tools/one-door/check.js',
    status: 'guarded', phase: null, past_severity: 'P0', shipped: true,
    caution: ['C-001', 'C-018', 'C-052', 'C-102', 'C-188'],
  },
  {
    class: 'resolution-error',
    description: 'Firm identity/name/slug derived wrongly (domain stem, page heading, entity-leaking slug).',
    catching_gate: 'facts/identity.js',
    status: 'guarded', phase: null, past_severity: 'P0', shipped: true,
    caution: ['C-001', 'C-002', 'C-003'],
  },
  {
    class: 'jurisdiction-nexus',
    description: 'A jurisdiction attached on no evidence, or serving a market conflated with being bound by its law (the ghost-jurisdiction / Mills & Reeve class, DG-05).',
    catching_gate: 'facts/jurisdiction.js',
    status: 'guarded', phase: null, past_severity: 'P0', shipped: true,
    caution: ['C-006', 'C-007', 'C-008', 'C-009', 'C-010', 'C-011', 'C-020', 'C-021'],
  },
  {
    class: 'sector-misclassification',
    description: 'Sector decided on HTML/CSS noise, a stray keyword, or after attachment, so the wrong regulated pack is checked.',
    catching_gate: 'facts/sector.js',
    status: 'guarded', phase: null, past_severity: 'P0', shipped: true,
    caution: ['C-012', 'C-013', 'C-014', 'C-015', 'C-016', 'C-017'],
  },
  {
    class: 'abstain-unreachable',
    description: 'A bot-walled or unrendered page asserted against instead of abstaining (jarir.com empty corpus, SPA shell).',
    catching_gate: 'tools/facts-abstain/check.js',
    status: 'guarded', phase: null, past_severity: 'P0', shipped: true,
    caution: ['C-022', 'C-032', 'C-037', 'C-038'],
  },
  {
    class: 'dead-regex',
    description: 'Over-escaped / corrupted stored patterns that compile, run, and match nothing forever while reporting compliance (DG-01).',
    catching_gate: 'catalogue/linters/regex-health.js',
    status: 'guarded', phase: null, past_severity: 'P0', shipped: true,
    caution: ['C-050'],
  },
  {
    class: 'unanchored-regex',
    description: 'Missing anchors / word boundaries so a pattern over-matches (/^EU/ matches EUROPEAN, unescaped . before co.uk, bare "limited").',
    catching_gate: 'catalogue/linters/regex-health.js',
    status: 'guarded', phase: null, past_severity: 'P1', shipped: true,
    caution: ['C-019', 'C-057', 'C-059'],
  },
  {
    class: 'polarity',
    description: 'A prohibition typed/tested as a requirement (or vice-versa), so clean firms are breached and non-compliant firms pass (DG-02/DG-03).',
    catching_gate: 'catalogue/linters/polarity.js',
    status: 'guarded', phase: null, past_severity: 'P0', shipped: true,
    caution: ['C-046', 'C-047', 'C-048', 'C-060'],
  },
  {
    class: 'threshold-attachment',
    description: 'Size/residency/volume-gated laws attached with no nexus (Modern Slavery Act on sub-GBP36m SMEs, CCPA on every US firm).',
    catching_gate: 'catalogue/linters/threshold-guard.js',
    status: 'guarded', phase: null, past_severity: 'P1', shipped: true,
    caution: ['C-055', 'C-058', 'C-070', 'C-071', 'C-072'],
  },
  {
    class: 'catalogue-integrity',
    description: 'Catalogue rows mislabelled (trade body as statute, superseded twin alongside successor, citation-presence pseudo-rules, universal law dropped).',
    catching_gate: 'catalogue/linters/citation-completeness.js',
    status: 'guarded', phase: null, past_severity: 'P1', shipped: true,
    caution: ['C-056', 'C-065', 'C-066', 'C-067', 'C-068', 'C-069', 'C-073', 'C-074', 'C-075'],
  },
  {
    class: 'provenance-fabrication',
    description: 'A catalogue row (law, fine, citation) with no fetched-and-content-verified official source; a bare number nobody can trace.',
    catching_gate: 'catalogue/linters/citation-completeness.js',
    status: 'guarded', phase: null, past_severity: 'P0', shipped: true,
    caution: ['C-104'],
  },
  {
    class: 'fail-open-gate',
    description: 'A mandatory gate that errors/times out/receives bad input and PASSES: gates after R2 persist, llmPreflight fail-open, stage marked ran unconditionally, safety floors env-zeroed.',
    catching_gate: 'eval/calibration-known-bad/run.js',
    status: 'guarded', phase: null, past_severity: 'P0', shipped: true,
    caution: ['C-025', 'C-151', 'C-152'],
  },
  {
    class: 'silent-swallow',
    description: 'A catch that swallows without rethrow/record/justification, so a failure reports success (55 silent catches an earlier regex reported as 0).',
    catching_gate: 'tools/swallow-gate/check.js',
    status: 'guarded', phase: null, past_severity: 'P0', shipped: true,
    caution: ['C-149', 'C-151'],
  },
  {
    class: 'host-substring',
    description: 'Host/URL compared by substring or token without parsing (sharesTokenWithDomain one-sided, hasLinkedin persisted-socials bypass, ACT F-0004).',
    catching_gate: 'tools/lib/safe-path.js',
    status: 'guarded', phase: null, past_severity: 'P0', shipped: false,
    caution: ['C-057'],
  },
  {
    class: 'injection',
    description: 'An unescaped HTML/SQL sink, decode-after-strip re-introducing <>, XSS via var-in-href, or path traversal into path.join/resolve.',
    catching_gate: '.github/workflows/semgrep.yml',
    status: 'guarded', phase: null, past_severity: 'P1', shipped: false,
    caution: ['C-120'],
  },
  {
    class: 'secret-leak',
    description: 'A credential-shaped string committed to the public repo (leaked webhook secret in a harvested snapshot; PII in golden fixtures).',
    catching_gate: '.github/workflows/semgrep.yml',
    status: 'guarded', phase: null, past_severity: 'P1', shipped: false,
    caution: ['C-160', 'C-196'],
  },
  {
    class: 'law-fact-literal',
    description: 'A law name, fine amount or regulator string hardcoded in engine/renderer code instead of the catalogue (the frozen FW_NAME_CAT / three-copy £17.5M class).',
    catching_gate: 'tools/one-door/check.js',
    status: 'guarded', phase: null, past_severity: 'P0', shipped: true,
    caution: ['C-102', 'C-112'],
  },
  {
    class: 'contract-drift',
    description: 'Engine and renderer change-coupled with no shared schema; the payload contract lived in prose comments and defensive reads.',
    catching_gate: 'payload/contract/index.js',
    status: 'guarded', phase: null, past_severity: 'P0', shipped: true,
    caution: ['C-107', 'C-108'],
  },
  {
    class: 'render-no-facts',
    description: 'The renderer re-deriving a fact at render time (craftFix keyword substring, decodeDeep) instead of formatting a typed payload field.',
    catching_gate: 'tools/fact-lineage/check.js',
    status: 'guarded', phase: null, past_severity: 'P1', shipped: true,
    caution: ['C-109', 'C-110'],
  },
  {
    class: 'golden-regression',
    description: 'A silent product change (finding counts, fines, firm names drifting) with no regression pin to catch it.',
    catching_gate: 'eval/golden/run.js',
    status: 'guarded', phase: null, past_severity: 'P0', shipped: true,
    caution: ['C-164'],
  },
  {
    class: 'reference-contradiction',
    description: 'A resolved fact (jurisdiction, sector, identity) that contradicts a hand-verified reference firm.',
    catching_gate: 'eval/reference-set/verify.js',
    status: 'guarded', phase: null, past_severity: 'P0', shipped: true,
    caution: ['C-006', 'C-158'],
  },
  {
    class: 'duplication',
    description: 'Textual clones of load-bearing logic (a fact re-derived per copy; the version-guard block repeated 7x).',
    catching_gate: '.github/workflows/ci.yml',
    status: 'guarded', phase: null, past_severity: 'P2', shipped: false,
    caution: ['C-188'],
  },
  {
    class: 'dead-code',
    description: 'Modules/branches merged, tested and never called (citation-gate.js never executed once; 7 live orphans).',
    catching_gate: '.github/workflows/ci.yml',
    status: 'guarded', phase: null, past_severity: 'P1', shipped: false,
    caution: ['C-154', 'C-195'],
  },
  {
    class: 'ci-supply-chain',
    description: 'CI/workflow hygiene: mutable action tags, ${{ }} shell injection in run:, missing minimum-release-age, curl-pipe-bash.',
    catching_gate: '.github/workflows/semgrep.yml',
    status: 'guarded', phase: null, past_severity: 'P2', shipped: false,
    caution: ['C-196'],
  },
  {
    class: 'corroboration-discipline',
    description: 'A lone-tool finding treated as a fact, or a blanket dismissal defended in aggregate (160 SRI alerts in one sweep).',
    catching_gate: 'tools/sweep/run.js',
    status: 'guarded', phase: null, past_severity: 'P1', shipped: false,
    caution: ['C-161', 'C-162'],
  },
  {
    class: 'tree-divergence',
    description: 'CI checked out a different tree than the one verified locally (untracked empty scaffold dirs), so the first CI run failed on divergence local never saw.',
    catching_gate: '.github/workflows/ci.yml',
    status: 'guarded', phase: null, past_severity: 'P0', shipped: false,
    caution: ['C-201'],
  },
  {
    class: 'tooling-hygiene',
    description: 'A defect in the sweep\'s own tooling, a test-file gap, or CI-config housekeeping (parser-aware counters, harvest error handling, next-line directive placement, node_modules noise).',
    catching_gate: 'tools/sweep/run.js',
    status: 'guarded', phase: null, past_severity: 'P1', shipped: false,
    caution: ['C-148', 'C-163'],
  },

  // ── GAP: no live gate yet; the named file lands in the stated phase ───────────────────────────
  {
    class: 'applicability-leak',
    description: 'National law leaking via a supranational code or bare-token trigger; the single attachment authority (resolveLaws) was an orphan while a weaker connect() shipped.',
    catching_gate: 'applicability/attach.js',
    status: 'gap', phase: 'P2', past_severity: 'P0', shipped: true,
    caution: ['C-051', 'C-053', 'C-054', 'C-061', 'C-062', 'C-063', 'C-064', 'C-076', 'C-077'],
  },
  {
    class: 'crawl-poverty',
    description: 'Absence claimed on content that was never read: corpus cut before footers, unfetched policy pages, SPAs not rendered, PDFs never followed, archive snapshots sold as live.',
    catching_gate: 'evidence/crawler/coverage-contract.js',
    status: 'gap', phase: 'P3', past_severity: 'P0', shipped: true,
    caution: ['C-024', 'C-026', 'C-027', 'C-028', 'C-029', 'C-030', 'C-031', 'C-033', 'C-034', 'C-035', 'C-036', 'C-039', 'C-042', 'C-044', 'C-045'],
  },
  {
    class: 'deadline-hang',
    description: 'An external step with no hard outer deadline holding a mint hostage (752s stuck Chromium; 30s x 3 x 3 rate-limited chains).',
    catching_gate: 'tools/domain-gates/deadline-audit.js',
    status: 'gap', phase: 'P3', past_severity: 'P0', shipped: false,
    caution: ['C-040', 'C-138'],
  },
  {
    class: 'evidence-lane-silent',
    description: 'An evidence-lane dependency that throws and silently does nothing (require playwright fails; the cookie lane dead for whole versions).',
    catching_gate: 'evidence/browser/observe.js',
    status: 'gap', phase: 'P3', past_severity: 'P0', shipped: true,
    caution: ['C-041', 'C-043'],
  },
  {
    class: 'breach-artifact',
    description: 'A breach with no deterministic artifact: an unreviewed regex match, a sub-25-char quote, a testimonial read as the firm\'s claim, a hacking accusation from body prose.',
    catching_gate: 'breach/verifiers/quote-match.js',
    status: 'gap', phase: 'P3', past_severity: 'P0', shipped: true,
    caution: ['C-078', 'C-079', 'C-080', 'C-087', 'C-088', 'C-089', 'C-090', 'C-091'],
  },
  {
    class: 'absence-vs-observation',
    description: 'Evidence KIND conflated: _kindOf mapped every finding to absence so browser observations could never confirm; observed facts routed through text adjudication.',
    catching_gate: 'breach/adjudicator/evidence-kind.js',
    status: 'gap', phase: 'P3', past_severity: 'P0', shipped: true,
    caution: ['C-084', 'C-085'],
  },
  {
    class: 'adjudication-abstention',
    description: 'Uncertainty shipped as a hard breach: ambiguous verdict stayed CONFIRMED, unadjudicated P0 reached the client, NO_BREACH accepted without disproof, verdict died at a whitelist seam.',
    catching_gate: 'breach/adjudicator/verdict.js',
    status: 'gap', phase: 'P3', past_severity: 'P0', shipped: true,
    caution: ['C-081', 'C-082', 'C-083', 'C-086', 'C-092', 'C-093', 'C-200'],
  },
  {
    class: 'llm-unverified',
    description: 'The LLM authoring facts: invented statutes with fake URLs, correlated quorum, veto over the catalogue, prompt injection, temp-0 assumed deterministic, ungrounded geo-probe.',
    catching_gate: 'llm/gate.js',
    status: 'gap', phase: 'P3', past_severity: 'P0', shipped: true,
    caution: ['C-127', 'C-128', 'C-129', 'C-130', 'C-131', 'C-132', 'C-133', 'C-134', 'C-135', 'C-136', 'C-137', 'C-141', 'C-142', 'C-143', 'C-144', 'C-145', 'C-146', 'C-147'],
  },
  {
    class: 'module-scope-state',
    description: 'Module-scope mutable singletons never reset between builds (_WARN/_SWARN), so warning counts were wrong for every audit after the first.',
    catching_gate: 'tools/no-module-state/check.js',
    status: 'gap', phase: 'P3', past_severity: 'P0', shipped: true,
    caution: ['C-153'],
  },
  {
    class: 'exposure-error',
    description: 'Fine maths wrong: statutory maxima summed, cross-law cap borrow, wrong currency, hardcoded fine-rate regexes, £0 collapse after a field rename, voluntary code showing a statutory fine.',
    catching_gate: 'render-proof/truth-pack.spec.js',
    status: 'gap', phase: 'P4', past_severity: 'P0', shipped: true,
    caution: ['C-094', 'C-095', 'C-096', 'C-097', 'C-098', 'C-099', 'C-100', 'C-101', 'C-103', 'C-105', 'C-106'],
  },
  {
    class: 'consistency-error',
    description: 'The rendered page disagreeing with the payload: three different framework counts, headline number on no card, hollow cards, invented enforcement filler, jurisdiction claimed with 0 frameworks.',
    catching_gate: 'render-proof/truth-pack.spec.js',
    status: 'gap', phase: 'P4', past_severity: 'P0', shipped: true,
    caution: ['C-111', 'C-113', 'C-114', 'C-115', 'C-116', 'C-117', 'C-118', 'C-119', 'C-124', 'C-125'],
  },
  {
    class: 'render-security-freshness',
    description: 'Stale/insecure render surface: hand-maintained asset version served stale bundles, HMAC gated on an unbound secret, superseded pages served 200 as current.',
    catching_gate: 'render-proof/truth-pack.spec.js',
    status: 'gap', phase: 'P4', past_severity: 'P0', shipped: true,
    caution: ['C-121', 'C-122', 'C-123', 'C-126'],
  },
  {
    class: 'phantom-data',
    description: 'A mint reported done that never produced a page: 1,004 phantom done rows, ON CONFLICT DO NOTHING adopting a stale row, a stub payload writable, queue/pages divergence.',
    catching_gate: 'mint/post-write-assertions.js',
    status: 'gap', phase: 'P4', past_severity: 'P0', shipped: true,
    caution: ['C-176', 'C-177', 'C-178', 'C-179', 'C-180', 'C-181', 'C-182', 'C-183', 'C-187', 'C-189', 'C-190'],
  },
  {
    class: 'cache-version',
    description: 'Stale scans replayed as current: scanner_cache keyed on an unbumped ENGINE_VERSION, a partial catalogue cached process-wide, pg() returning null indistinguishable from no-rows.',
    catching_gate: '.github/workflows/engine-version-guard.yml',
    status: 'gap', phase: 'P4', past_severity: 'P0', shipped: true,
    caution: ['C-166', 'C-167', 'C-168', 'C-169', 'C-170', 'C-171', 'C-172', 'C-173', 'C-174', 'C-175', 'C-184', 'C-185', 'C-186'],
  },
  {
    class: 'budget-floor',
    description: 'A budget behaving as a floor not a cap: a 45s Math.max on the SPA-render tail made every mint slow regardless of the site (fix: 43s -> 6.9s, identical accuracy).',
    catching_gate: 'tools/domain-gates/budget-caps.js',
    status: 'gap', phase: 'P3', past_severity: 'P1', shipped: false,
    caution: ['C-185'],
  },
  {
    class: 'coverage-truth',
    description: 'Coverage claimed that was never computed: "all 400+ frameworks screened", a compliance_unassessed flag nothing read, a rule falling back to the whole corpus when its target page was unfetched.',
    catching_gate: 'render-proof/truth-pack.spec.js',
    status: 'gap', phase: 'P4', past_severity: 'P1', shipped: true,
    caution: ['C-118', 'C-125'],
  },
];

// The 5 domain-gate classes from digest §12 (the engine-semantic defects no marketplace tool
// found), mapped to the taxonomy class each belongs to. These seed explicit crossref entries.
const DOMAIN_GATES = [
  { id: 'DG-01', name: 'regex-health', past_severity: 'P0', class: 'dead-regex',
    note: 'dpo[@\\s], vat\\s*(no), \\bPOM\\b, FRN ?\\d{6}: over-escaped regexes that compile, run and match nothing forever while reporting compliance.' },
  { id: 'DG-02', name: 'rule-polarity', past_severity: 'P1', class: 'polarity',
    note: '5 rules breached firms for NOT advertising what the regulator prohibits; MED_CLAIMS fired on any page containing clinic/dental/treatment.' },
  { id: 'DG-03', name: 'prohibition-calibration', past_severity: 'P0', class: 'polarity',
    note: '6 prohibitions had no pattern and could never fire; UK_BOTOX_FILLERS_U18 (a criminal offence) among them.' },
  { id: 'DG-04', name: 'reachability', past_severity: 'P1', class: 'dead-code',
    note: '13 modules / 691 lines of correct legal logic unreachable from the mint, including citation-gate.js which never executed once.' },
  { id: 'DG-05', name: 'nexus-anchoring', past_severity: 'P0', class: 'jurisdiction-nexus',
    note: '/incorporated in/ anchored to no country; 6 of 7 real UK/EU/UAE footers judged "established in the United States"; Mills & Reeve served US ABA rules.' },
];

// The 6 ACT items from digest §0 (>=2 independent tools agree = a fact, not a lead), mapped to
// the taxonomy class each belongs to. These correspond to the corroboration>=2 sweep clusters and
// are flagged act:true when the sweep entries are ingested; listed here for the class mapping.
const ACT = [
  { id: 'F-0001', past_severity: 'P0', class: 'fail-open-gate',
    path: 'src/skills/S025-audit-page-builder/scripts/build.js',
    note: 'Mandatory audit gates run AFTER R2 persist; jurisdiction stage marked ran unconditionally; llmPreflight fails open; _WARN singleton never reset.' },
  { id: 'F-0002', past_severity: 'P0', class: 'two-doors',
    path: 'src/skills/S008-personalisation-engine/scanners/compliance.js',
    note: 'Keep _N2C aligned with detectMarkets().bound; stale _ordered snapshot; _SWARN leak; jurisdiction/sector/host/element-checklist multiple producers.' },
  { id: 'F-0003', past_severity: 'P0', class: 'two-doors',
    path: 'src/lib/audit/payload-schema.js',
    note: 'Anchor the engine-version format + enforce the draft gate; REGULATOR NAME has 5 producers.' },
  { id: 'F-0004', past_severity: 'P0', class: 'host-substring',
    path: 'src/lib/util/url-safe.js',
    note: 'Parse inputs before comparing hosts; keep ^ anchor on scheme strip; HOST anchoring has 8 producers.' },
  { id: 'F-0005', past_severity: 'P0', class: 'two-doors',
    path: 'src/lib/compliance/signals.js',
    note: 'Protected compliance library change needs sign-off; freeze NEXUS_PROFILE before export; jurisdiction-nexus + sector producers.' },
  { id: 'F-0090', past_severity: 'P1', class: 'host-substring',
    path: 'src/lib/enrich/lead-quality.js',
    note: 'Persisted socials bypass the host anchor (hasLinkedin still returns true from persisted socials).' },
];

module.exports = { TAXONOMY, DOMAIN_GATES, ACT };
