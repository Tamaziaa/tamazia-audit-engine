'use strict';
// breach/verifiers/index.js - ergonomic re-export only. The constitutionally-named entry point is
// quote-match.js (Constitution Rule 3, Rule 12 Gate 2; GAPS.md's `breach-artifact` row); this file
// exists purely so a directory import (`require('../verifiers')`) resolves to the same public API,
// with nothing added, removed or renamed. It introduces no logic of its own.
module.exports = require('./quote-match.js');
