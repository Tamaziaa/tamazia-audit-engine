'use strict';
// render-proof/truth-pack.test.js - discovery SHIM ONLY. The real render truth-pack suite lives in
// render-proof/truth-pack.spec.js (the name the failure-ledger and CONSTITUTION Part III bind as the gate for
// the render classes, and the name the render-truth lane runs explicitly). Node's default test runner
// discovers `*.test.js` but NOT `*.spec.js`, so `npm test` would silently skip the suite; requiring the spec
// here registers its node:test cases under a discovered file, so the suite runs under `npm test` too and is
// never a hollow green. No assertions of its own - it is one require by design.
require('./truth-pack.spec.js');
