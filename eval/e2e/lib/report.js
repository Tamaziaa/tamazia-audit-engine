'use strict';
// eval/e2e/lib/report.js - human + --json rendering for run-pipeline.js. Kept separate from
// pipeline.js/judge.js/redteam.js so orchestration logic never depends on presentation, and so those
// modules stay testable without ever inspecting console output.

function pad(s, n) {
  s = String(s == null ? '' : s);
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

function stageWiringLine(stageTable) {
  return stageTable.map((s) => s.stage + '=' + s.status.toUpperCase() + (s.reason ? ' (' + s.reason + ')' : '')).join('  ');
}

// countByStatus(list) -> {status: count} over a [{status}] array.
function countByStatus(list) {
  const counts = {};
  for (const item of list) counts[item.status] = (counts[item.status] || 0) + 1;
  return counts;
}

function knownBreachSummary(list) {
  if (!list.length) return '-';
  const counts = countByStatus(list);
  const parts = ['reproduced', 'missed', 'skipped'].filter((k) => counts[k]).map((k) => counts[k] + ' ' + k);
  return list.length + ' (' + parts.join(', ') + ')';
}

function knownNonBreachSummary(list) {
  if (!list.length) return '-';
  const contradictions = list.filter((k) => k.status === 'contradiction').length;
  return contradictions > 0 ? contradictions + ' CONTRADICTION' : list.length + ' clean';
}

function firmResultLabel(row) {
  return row.contradiction ? 'CONTRADICT' : 'OK';
}

const FIRM_TABLE_HEADER = ['domain', 'role', 'known_breaches', 'known_non_breaches', 'result'];
const FIRM_TABLE_WIDTHS = [30, 10, 32, 22, 11];

function printFirmErrorRow(row) {
  const W = FIRM_TABLE_WIDTHS;
  console.log([pad(row.domain, W[0]), pad(row.role || '-', W[1]), pad('-', W[2]), pad('-', W[3]), pad('ERROR', W[4])].join(' '));
  console.log('    ' + row.error);
}

function printFirmOkRow(row) {
  const W = FIRM_TABLE_WIDTHS;
  console.log([
    pad(row.domain, W[0]),
    pad(row.role || '-', W[1]),
    pad(knownBreachSummary(row.knownBreaches), W[2]),
    pad(knownNonBreachSummary(row.knownNonBreaches), W[3]),
    pad(firmResultLabel(row), W[4]),
  ].join(' '));
}

function printFirmTable(rows) {
  const W = FIRM_TABLE_WIDTHS;
  console.log(FIRM_TABLE_HEADER.map((h, i) => pad(h, W[i])).join(' '));
  console.log(W.map((w) => '-'.repeat(w)).join(' '));
  for (const row of rows) {
    if (row.error) printFirmErrorRow(row);
    else printFirmOkRow(row);
  }
}

function printRedTeamTable(redteam) {
  if (!redteam.present) {
    console.log('red-team lane: not landed (eval/red-team/fixtures.json absent) - honestly skipped, 0 entries');
    return;
  }
  if (redteam.parseError) {
    console.log('red-team lane: fixtures file present but unreadable: ' + redteam.parseError);
    return;
  }
  console.log('red-team lane: ' + redteam.rows.length + ' entries');
  for (const r of redteam.rows) console.log('  ' + pad(r.status.toUpperCase(), 10) + r.id + (r.reason ? '  (' + r.reason + ')' : ''));
}

// breachOutcome(row) -> 'complete' | 'errored' | 'skipped' | 'n/a', the per-firm breach-lane outcome
// read off its own stageTable (added by run-pipeline.js's judgedRow). A firm that errored before the
// pipeline ran (no fixture, a facts/coverage throw) has no stageTable -> 'n/a'. This exists so a run
// where the breach lane timed out on every firm (the current propose ReDoS P0) can NEVER be misread as
// a clean full assessment: the summary reports the breach outcomes explicitly.
function breachOutcome(row) {
  const table = row && row.stageTable;
  if (!Array.isArray(table)) return 'n/a';
  const stages = ['propose', 'verify', 'adjudicate'].map((name) => (table.find((s) => s.stage === name) || {}).status);
  if (stages.every((s) => s === 'ran')) return 'complete';
  if (stages.some((s) => s === 'error')) return 'errored';
  return 'skipped';
}

// summarise(rows, redteam) -> the run's overall counters, used both for the human report and to shape
// the --json output's top-level summary.
function summarise(rows, redteam) {
  const errored = rows.filter((r) => r.error).length;
  const contradicting = rows.filter((r) => !r.error && r.contradiction).length;
  const redTeamRows = redteam.rows || [];
  const redTeamEscapes = redTeamRows.filter((r) => r.status === 'escaped' || r.status === 'error').length;
  const breach = { complete: 0, errored: 0, skipped: 0 };
  for (const r of rows) {
    const outcome = breachOutcome(r);
    if (outcome in breach) breach[outcome]++;
  }
  return {
    firms: rows.length,
    ok: rows.length - errored - contradicting,
    contradicting,
    errored,
    breach,
    redTeamEntries: redTeamRows.length,
    redTeamEscapes,
  };
}

function printContradictionDetail(rows) {
  const withContradictions = rows.filter((r) => !r.error && r.contradiction);
  if (!withContradictions.length) return;
  console.log('\ncontradictions (each fails the gate):');
  for (const r of withContradictions) {
    for (const c of r.report.contradictions) console.log('  FAIL  ' + r.domain + '  [' + c.check + ']  ' + c.detail);
  }
}

// resultLine(summary, vacuity) -> the ONE terminal verdict line (P3-tail Wave-2 Builder B, R2/B4:
// caution.md C-236's enforcing half must never be followed by a stale, contradictory OK line printed
// just above it - see this file's own history: run-pipeline.js used to print this function's "RESULT:
// OK" line via printHumanReport() and THEN, separately and later, its own corrective "RESULT: FAIL -
// vacuous..." line when the vacuity clause fired, so a vacuous run showed BOTH lines, OK first). This
// function is now vacuity-aware: when `vacuity` is given and `vacuity.vacuous` is true, this is the
// ONLY branch that can fire, and it returns FAIL with the C-236 reason regardless of how clean
// `summary`'s own contradiction/error/red-team counters look - a vacuous run is never allowed to print
// OK. `vacuity` is optional (omitting it - the pre-existing call shape - preserves the exact prior
// behaviour): only run-pipeline.js knows whether the vacuity clause fired, so it is passed in here
// rather than recomputed.
function resultLine(summary, vacuity) {
  if (vacuity && vacuity.vacuous) {
    return 'RESULT: FAIL - vacuous positive-control bar (caution.md C-236): zero known_breach reproduced across a complete breach lane';
  }
  const clean = summary.contradicting === 0 && summary.errored === 0 && summary.redTeamEscapes === 0;
  return clean
    ? 'RESULT: OK (zero contradictions, zero red-team escapes among run entries)'
    : 'RESULT: FAIL - see detail above (contradiction, error row, or a red-team escape/error)';
}

// printHumanReport(stageTable, rows, redteam, summary, extra) -> the full human report, ending in
// EXACTLY one RESULT line. `extra` is optional ({ totals, vacuity }): when given, the always-on
// "reproduced: k/n" usefulness gauge and (only when it fires) the "vacuous: ..." detail line print
// here, immediately before the final RESULT line - the true home for both the vacuity narrative and the
// single terminal verdict (B4: "fix at the true home of resultLine"). Omitting `extra` preserves the
// exact prior 4-argument call shape and output for any caller that has no vacuity/totals to report.
function printHumanReport(stageTable, rows, redteam, summary, extra) {
  console.log('eval/e2e/run-pipeline: P3 exit-criteria harness (fixtureBundle -> facts -> coverage -> propose -> verify -> adjudicate -> findings)');
  console.log('stage wiring: ' + stageWiringLine(stageTable));
  console.log('');
  printFirmTable(rows);
  printContradictionDetail(rows);
  console.log('');
  printRedTeamTable(redteam);
  console.log('');
  console.log('summary: ' + summary.firms + ' firms | ' + summary.ok + ' ok | ' + summary.contradicting + ' contradicting | ' + summary.errored + ' errored');
  const b = summary.breach || { complete: 0, errored: 0, skipped: 0 };
  console.log('         breach lane: ' + b.complete + ' complete | ' + b.errored + ' errored/timed-out | ' + b.skipped + ' skipped');
  console.log('         red-team: ' + summary.redTeamEntries + ' entries | ' + summary.redTeamEscapes + ' escaped/error');
  const totals = extra && extra.totals;
  const vacuity = extra && extra.vacuity;
  if (totals) console.log('reproduced: ' + totals.reproduced + '/' + totals.total);
  if (vacuity && vacuity.vacuous) {
    console.log('vacuous: 0 known_breach reproduced across ' + vacuity.completeLanes + ' complete lanes');
  }
  console.log('');
  console.log(resultLine(summary, vacuity));
}

module.exports = {
  printHumanReport,
  printFirmTable,
  printRedTeamTable,
  summarise,
  breachOutcome,
  stageWiringLine,
  knownBreachSummary,
  knownNonBreachSummary,
  resultLine,
};
