'use strict';
// catalogue/qa-approval.js - the CR-2/CR-3 QA-approval-sidecar verification helpers.
//
// Split out of catalogue/compile.js purely to keep compile.js under the health-gate file-length
// cap (tools/health-gate/check.js): this is a cohesive, single-purpose concern (a .QA.md sidecar's
// machine-readable sign-off header, and what proves it is CURRENT), so it earns its own module
// rather than padding out compile.js once the earlier long-function extractions already reduced it.
//
// Every export here is required straight back into catalogue/compile.js and re-exported unchanged
// under the exact same names (sha256Hex, computePackSha, QA_APPROVAL_RX, parseQaApprovalHeader) -
// this split changes no external behaviour, no export name and no error message. catalogue/
// compile.test.js exercises these exclusively through `compile.*`, never through this file
// directly, precisely so that contract holds.
//
// verifyQaApproval takes the error class to throw as a parameter rather than importing
// CompileError from compile.js: compile.js requires this module, so a reverse require would be a
// cycle. Injecting the class is the same pattern tools/lib/safe-path.js already uses for its own
// callers (an { ErrorClass } option), so this is not a new convention.

const fs = require('fs');
const crypto = require('crypto');

function sha256Hex(s) {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

// computePackSha(absPath) -> sha256 hex digest of a pack file's exact committed bytes. THE one
// function that decides what "the pack's hash" means, so the QA-approval check below, the
// --print-hashes utility mode, and any future stamping tool all agree with each other by
// construction (Constitution Rule 1 applied to a build-tooling concept, not just a client fact).
function computePackSha(absPath) {
  return sha256Hex(fs.readFileSync(absPath, 'utf8'));
}

// QA_APPROVAL_RX: the machine-readable sign-off header CR-2 requires every .QA.md sidecar to START
// with, verbatim: <!-- qa-approval pack_sha256=<hex> verdict=approved reviewed=<date> -->. Binding
// the literal token "verdict=approved" into the pattern itself (rather than capturing any verdict
// value) means a sidecar that has been authored but not yet actually signed off (or one whose
// verdict was downgraded) simply does not match - it is treated exactly like a missing header, not
// specially parsed and then rejected on a second check.
const QA_APPROVAL_RX = /^\s*<!--\s*qa-approval\s+pack_sha256=([0-9a-f]{64})\s+verdict=approved\s+reviewed=(\d{4}-\d{2}-\d{2})\s*-->/;

// parseQaApprovalHeader(sidecarText) -> {pack_sha256, verdict: 'approved', reviewed} | null. Pure;
// never throws. A sidecar that does not start with the block, or whose hash is not a lowercase-hex
// sha256, simply fails to match and this returns null - the caller (discoverPacks) decides what a
// null means (a CompileError, since a sidecar exists but claims no verifiable sign-off).
function parseQaApprovalHeader(sidecarText) {
  const m = QA_APPROVAL_RX.exec(String(sidecarText == null ? '' : sidecarText));
  if (!m) return null;
  return { pack_sha256: m[1], verdict: 'approved', reviewed: m[2] };
}

// verifyQaApproval(absPath, qaSidecarAbs, relPath, relQaPath, ErrorClass) -> throws ErrorClass on
// any failure, returns nothing on success. CR-2: the sidecar must START with a machine-readable
// qa-approval header binding it to the EXACT pack bytes it approved. A sidecar with no such header
// at all (every sidecar committed before this gate landed, deliberately - see
// catalogue/README.md) is refused exactly like an unreadable pack: it claims sign-off but carries
// nothing this compiler can verify.
function verifyQaApproval(absPath, qaSidecarAbs, relPath, relQaPath, ErrorClass) {
  let qaRaw;
  try {
    qaRaw = fs.readFileSync(qaSidecarAbs, 'utf8');
  } catch (e) {
    throw new ErrorClass(relQaPath + ': failed to read QA sidecar: ' + e.message);
  }
  const approval = parseQaApprovalHeader(qaRaw);
  if (!approval) {
    throw new ErrorClass(
      relQaPath + ': QA sidecar does not START with the required machine-readable approval block '
      + '<!-- qa-approval pack_sha256=<hex> verdict=approved reviewed=<date> --> (see catalogue/README.md). '
      + 'Run `node catalogue/compile.js --print-hashes` for the current sha256 and stamp the sidecar.'
    );
  }
  const actualSha = computePackSha(absPath);
  if (approval.pack_sha256 !== actualSha) {
    throw new ErrorClass(
      relPath + ': QA approval stale: pack changed since sign-off (sidecar ' + relQaPath
      + ' approved pack_sha256=' + approval.pack_sha256 + ' but the pack now hashes to ' + actualSha
      + ') - re-review the pack and re-stamp its approval header'
    );
  }
}

module.exports = {
  sha256Hex,
  computePackSha,
  QA_APPROVAL_RX,
  parseQaApprovalHeader,
  verifyQaApproval,
};
