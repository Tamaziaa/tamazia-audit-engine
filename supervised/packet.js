'use strict';
// supervised/packet.js - THE human review packet (Kimi K3 round-3 spec section 2 row 8, section 5 item 3):
// ONE self-contained HTML page generated from the run manifest. Each finding with its highlighted quote,
// the applicability ledger, the kill-log (Claude's stage-6 mitigation_log entries), the no-orphan lint
// output, and analyst-candidate findings. Per finding: a ship/drop control + reason-code select. A
// SIGN/HOLD control for the whole run. Inline CSS/JS only, no external fetch (must render offline, must be
// reviewable by a human in under 15 minutes per the spec - dense but scannable, not a wall of raw JSON).
//
// The packet is a STATIC review surface in v0: its controls post nothing over the network (there is no
// server here) - a reviewer fills them in and the resulting decisions are recorded via
// signature-store.recordSignature() from the CLI (`engine sign --run-id ...`, documented in bin/engine.js)
// or directly via the API. The HTML embeds a small vanilla-JS helper that serialises the form into a JSON
// blob a reviewer can copy into that CLI call - convenient, but not a hidden network side channel.

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// safeJson(value) -> JSON.stringify(value), with every '<' escaped to its < code unit. Plain
// JSON.stringify never escapes '<', so a value embedded directly inside an inline <script> block (e.g.
// run.runId, which the CLI's --run-id can set to anything) could contain a literal "</script>" and close
// the tag early, letting arbitrary markup run in a reviewer's browser (CodeRabbit review, PR #36) - this
// defeats the packet's own "self-contained, no hidden side channel" guarantee just as surely as the
// unescaped-HTML hole esc() already closes for the rest of the document. The < escape decodes back
// to the exact same '<' once the browser's JS parser reads the script text, so no data is lost.
function safeJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function findingRow(finding, excerptsByFindingId) {
  const ex = excerptsByFindingId.get(finding.finding_id);
  const quoteHtml = ex
    ? esc(ex.excerpt.before) + '<mark>' + esc(ex.excerpt.quote_text) + '</mark>' + esc(ex.excerpt.after)
    : '<em>excerpt unavailable</em>';
  return '<div class="finding" data-finding-id="' + esc(finding.finding_id) + '">'
    + '<div class="finding-head"><span class="badge badge-' + esc(finding.class) + '">' + esc(finding.class) + '</span>'
    + '<code>' + esc(finding.finding_id) + '</code> <strong>' + esc(finding.rule_id) + '</strong>'
    + ' <span class="muted">' + esc(finding.jurisdiction) + '</span></div>'
    + '<div class="quote">' + quoteHtml + '</div>'
    + (ex ? '<div class="muted small">page: ' + esc(ex.excerpt.url) + ' | evidence_id: ' + esc(ex.excerpt.evidence_id) + '</div>' : '')
    + '<div class="decision-row">'
    + 'Decision: <label><input type="radio" name="decision-' + esc(finding.finding_id) + '" value="ship"> ship</label> '
    + '<label><input type="radio" name="decision-' + esc(finding.finding_id) + '" value="drop"> drop</label> '
    + 'Reason: <select name="reason-' + esc(finding.finding_id) + '">'
    + '<option value="">--</option>'
    + '<option value="tp-confirmed">tp-confirmed</option>'
    + '<option value="fp-disclaimer-present">fp-disclaimer-present</option>'
    + '<option value="fp-wrong-jurisdiction">fp-wrong-jurisdiction</option>'
    + '<option value="fp-puffery">fp-puffery</option>'
    + '<option value="fp-other">fp-other</option>'
    + '</select></div>'
    + (finding.mitigation_log.length
      ? '<div class="kill-log"><strong>kill-log:</strong><ul>' + finding.mitigation_log.map((m) => '<li>' + esc(JSON.stringify(m)) + '</li>').join('') + '</ul></div>'
      : '')
    + '</div>';
}

function ledgerTable(ledger) {
  const rows = (ledger.entries || []).map((e) => '<tr><td>' + esc(e.law_id) + '</td><td class="decision-' + esc(e.decision) + '">' + esc(e.decision) + '</td><td>' + esc(e.reason || '') + '</td></tr>').join('');
  return '<table class="ledger"><thead><tr><th>law_id</th><th>decision</th><th>reason</th></tr></thead><tbody>' + rows + '</tbody></table>';
}

function lintSection(lint) {
  if (!lint) return '<p class="muted">no-orphan lint not run for this packet</p>';
  if (lint.ok) return '<p class="ok">no-orphan lint: PASS (0 violations)</p>';
  return '<p class="bad">no-orphan lint: ' + lint.violations.length + ' violation(s)</p><ul>'
    + lint.violations.map((v) => '<li><strong>' + esc(v.type) + '</strong>: ' + esc(v.sentence || v.phrase || '') + '</li>').join('') + '</ul>';
}

// buildPacketHtml(run) -> a full, self-contained HTML document string. `run` is a runSupervised() result
// (or an equivalent shape read back from a manifest), optionally carrying `lintResult` and
// `analystCandidates` (Claude's stage-6 additions, both optional at this v0 stage).
function buildPacketHtml(run) {
  const findings = run.candidateFindings || [];
  const excerptsByFindingId = new Map((run.excerpts || []).map((e) => [e.finding_id, e]));
  const findingsHtml = findings.length ? findings.map((f) => findingRow(f, excerptsByFindingId)).join('\n') : '<p class="muted">no candidate findings survived stage 5</p>';
  const analystHtml = (run.analystCandidates || []).length
    ? run.analystCandidates.map((f) => findingRow(f, excerptsByFindingId)).join('\n')
    : '<p class="muted">no analyst-candidate (Claude-spotted) findings for this run</p>';

  return '<!doctype html><html><head><meta charset="utf-8"><title>Mint Gate review packet - ' + esc(run.runId) + '</title>'
    + '<style>'
    + 'body{font-family:system-ui,sans-serif;max-width:960px;margin:0 auto;padding:24px;color:#111}'
    + 'h1,h2{margin-top:1.6em}'
    + '.finding{border:1px solid #ccc;border-radius:8px;padding:12px;margin:12px 0}'
    + '.finding-head{display:flex;gap:10px;align-items:center;margin-bottom:6px}'
    + '.badge{padding:2px 8px;border-radius:12px;font-size:12px;color:#fff}'
    + '.badge-confirmed{background:#b00020}.badge-likely{background:#b06a00}.badge-needs_human{background:#555}'
    + '.quote{background:#fafafa;border-left:3px solid #999;padding:8px;white-space:pre-wrap;font-family:Georgia,serif}'
    + '.quote mark{background:#ffe08a}'
    + '.muted{color:#666}.small{font-size:12px}.ok{color:#0a7a2f}.bad{color:#b00020}'
    + 'table.ledger{border-collapse:collapse;width:100%}table.ledger td,table.ledger th{border:1px solid #ddd;padding:4px 8px;font-size:13px}'
    + '.decision-applies{color:#0a7a2f}.decision-not_applicable{color:#666}.decision-unknown{color:#b06a00}'
    + '.decision-row{margin-top:8px}'
    + '.sign-panel{position:sticky;bottom:0;background:#fff;border-top:2px solid #111;padding:12px 0;margin-top:24px}'
    + '</style></head><body>'
    + '<h1>Mint Gate review packet</h1>'
    + '<p><strong>run_id:</strong> <code>' + esc(run.runId) + '</code> &middot; <strong>site:</strong> ' + esc(run.site) + ' &middot; <strong>engine:</strong> ' + esc(run.engineVersion) + ' &middot; <strong>catalogue:</strong> <code>' + esc(run.catalogueHash) + '</code></p>'
    + (run.refusal ? '<p class="bad"><strong>ICP gate refusal:</strong> ' + esc(run.refusal) + ' (universal/jurisdiction cells may still have run - see the applicability ledger)</p>' : '')
    + '<h2>Entity card</h2><pre>' + esc(JSON.stringify(run.entityCard, null, 2)) + '</pre>'
    + '<h2>Applicability ledger</h2>' + ledgerTable(run.applicabilityLedger || { entries: [] })
    + '<h2>Candidate findings (' + findings.length + ')</h2>' + findingsHtml
    + '<h2>Analyst-candidate findings (Claude-spotted, human-only)</h2>' + analystHtml
    + '<h2>No-orphan-claims lint</h2>' + lintSection(run.lintResult)
    + '<h2>Coverage manifest</h2><pre>' + esc(JSON.stringify(run.coverageManifest, null, 2)) + '</pre>'
    + '<div class="sign-panel"><h2>Sign / hold</h2>'
    + '<label><input type="radio" name="overall" value="SIGN"> SIGN</label> '
    + '<label><input type="radio" name="overall" value="HOLD"> HOLD</label> '
    + '<button id="export-btn" type="button">export decisions as JSON</button>'
    + '<pre id="export-out"></pre></div>'
    + '<script>'
    + 'document.getElementById("export-btn").addEventListener("click", function () {'
    + 'var findingIds = ' + safeJson(findings.map((f) => f.finding_id)) + ';'
    + 'var decisions = findingIds.map(function (id) {'
    + 'var d = document.querySelector(\'input[name="decision-\' + id + \'"]:checked\');'
    + 'var r = document.querySelector(\'select[name="reason-\' + id + \'"]\');'
    + 'return { finding_id: id, decision: d ? d.value : null, reason_code: r ? r.value : null };'
    + '});'
    + 'var overallEl = document.querySelector(\'input[name="overall"]:checked\');'
    + 'var out = { run_id: ' + safeJson(run.runId) + ', overall: overallEl ? overallEl.value : null, findingDecisions: decisions };'
    + 'document.getElementById("export-out").textContent = JSON.stringify(out, null, 2);'
    + '});'
    + '</script>'
    + '</body></html>';
}

module.exports = { buildPacketHtml };
