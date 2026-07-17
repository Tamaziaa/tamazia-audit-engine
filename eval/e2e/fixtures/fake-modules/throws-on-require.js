'use strict';
// Test fixture ONLY (eval/e2e/lib/breach-stages.test.js). Throws at require() time - proves
// loadOptionalModule() catches a require-time failure and reports it as {available:false, reason}
// rather than crashing the whole harness run.
throw new Error('synthetic require-time failure (eval/e2e/lib/breach-stages.test.js fixture)');
