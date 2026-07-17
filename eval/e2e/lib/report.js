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

// summarise(rows, redteam) -> the run's overall counters, used both for the human report and to shape
// the --json output's top-level summary.
function summarise(rows, redteam) {
  const errored = rows.filter((r) => r.error).length;
  const contradicting = rows.filter((r) => !r.error && r.contradiction).length;
  const redTeamRows = redteam.rows || [];
  const redTeamEscapes = redTeamRows.filter((r) => r.status === 'escaped' || r.status === 'error').length;
  return {
    firms: rows.length,
    ok: rows.length - errored - contradicting,
    contradicting,
    errored,
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

function resultLine(summary) {
  const clean = summary.contradicting === 0 && summary.errored === 0 && summary.redTeamEscapes === 0;
  return clean
    ? 'RESULT: OK (zero contradictions, zero red-team escapes among run entries)'
    : 'RESULT: FAIL - see detail above (contradiction, error row, or a red-team escape/error)';
}

function printHumanReport(stageTable, rows, redteam, summary) {
  console.log('eval/e2e/run-pipeline: P3 exit-criteria harness (fixtureBundle -> facts -> coverage -> propose -> verify -> adjudicate -> findings)');
  console.log('stage wiring: ' + stageWiringLine(stageTable));
  console.log('');
  printFirmTable(rows);
  printContradictionDetail(rows);
  console.log('');
  printRedTeamTable(redteam);
  console.log('');
  console.log('summary: ' + summary.firms + ' firms | ' + summary.ok + ' ok | ' + summary.contradicting + ' contradicting | ' + summary.errored + ' errored');
  console.log('         red-team: ' + summary.redTeamEntries + ' entries | ' + summary.redTeamEscapes + ' escaped/error');
  console.log('');
  console.log(resultLine(summary));
}

module.exports = {
  printHumanReport,
  printFirmTable,
  printRedTeamTable,
  summarise,
  stageWiringLine,
  knownBreachSummary,
  knownNonBreachSummary,
  resultLine,
};
