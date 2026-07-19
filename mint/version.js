'use strict';
// mint/version.js - THE one frozen ENGINE_VERSION constant (Constitution Rule 15).
//
// The engine version is load-bearing: it rides the mint idempotency key (mint/persist.js writes
// (url, ENGINE_VERSION) as the ON CONFLICT target) and the DB-level `required_engine_version` trigger
// (C-177) is the lock every minter must pass. A legal-evidence engine keeps NO scan cache (a day-old
// scan dated today is not evidence, Rule 15), so any change to scan logic bumps this string and the
// version gate rejects a row minted under a stale version.
//
// ONE producer, ONE consumer surface (Rule 1): every mint module reads ENGINE_VERSION from here; no
// second copy of the string exists anywhere in the engine. Frozen so a consumer cannot mutate it.

// v2.1.6 (Mint Gate v0, ws-mint-gate-v0): adds the supervised/ run harness + hash-chained capture index +
// verify_quote choke point + mint gate as an ADDITIVE layer ahead of persist()/assertMinted(); this bump
// records that the engine's scan-adjacent surface changed (a new deterministic verification spine sits in
// front of the existing mint path), per Rule 15's own doctrine ("any change to scan logic bumps this
// string"). The supervised lane does not alter mint()'s own behaviour or its version-gated idempotency key.
const ENGINE_VERSION = 'engine-v2.1.6-p4';

module.exports = Object.freeze({ ENGINE_VERSION });
