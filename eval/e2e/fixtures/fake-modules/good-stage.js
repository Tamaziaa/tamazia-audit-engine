'use strict';
// Test fixture ONLY (eval/e2e/lib/breach-stages.test.js). A minimal, well-formed "landed module" used
// to prove loadOptionalModule() activates on a real, present module exporting the expected function
// name. Never imported by production code; not a real breach/llm module.
module.exports = {
  propose: function propose() { return []; },
  verifyAll: function verifyAll() { return { verified: [], rejected: [] }; },
  adjudicate: function adjudicate() { return []; },
};
