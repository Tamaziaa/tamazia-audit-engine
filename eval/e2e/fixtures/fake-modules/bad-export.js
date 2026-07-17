'use strict';
// Test fixture ONLY (eval/e2e/lib/breach-stages.test.js). A module that IS present but does not export
// any of the function names loadOptionalModule() looks for - proves it reports {available:false}
// honestly rather than crashing or guessing at a different export name.
module.exports = { somethingElse: function somethingElse() { return null; } };
