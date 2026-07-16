// The two rules that killed mints in the old engine, now repo-wide from commit 1.
//
// 1. no-undef. The old pipeline contract opened its stage manifest as a local const in buildPayload()
//    and referenced it from build() - a DIFFERENT function. That is a ReferenceError: "_manifest is not
//    defined". It killed every mint. 75 evals were green, because not one of them ever EXECUTED
//    buildPayload() - they asserted on source text and on pure helpers. A test suite that never runs
//    the function cannot see a ReferenceError inside it. no-undef is the cheapest check that would
//    have caught it.
//
// 2. no-use-before-define. TDZ: a `const x` declared AFTER its first use throws "Cannot access 'x'
//    before initialization" at RUNTIME. no-undef cannot see it. It killed the mint a second time
//    (payloadToD TDZ crash froze the deployed render layer at a stale build).
//
// Constitution: these two rules are errors on every JavaScript file in this repo. No exceptions.

const nodeGlobals = {
  // CommonJS
  require: 'readonly',
  module: 'writable',
  exports: 'writable',
  __dirname: 'readonly',
  __filename: 'readonly',
  // Node runtime
  process: 'readonly',
  console: 'readonly',
  Buffer: 'readonly',
  global: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  setImmediate: 'readonly',
  clearImmediate: 'readonly',
  queueMicrotask: 'readonly',
  structuredClone: 'readonly',
  performance: 'readonly',
  crypto: 'readonly',
  // Web platform globals available in Node 24
  fetch: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  AbortController: 'readonly',
  AbortSignal: 'readonly',
  TextEncoder: 'readonly',
  TextDecoder: 'readonly',
  Blob: 'readonly',
  File: 'readonly',
  FormData: 'readonly',
  Headers: 'readonly',
  Request: 'readonly',
  Response: 'readonly',
  WebSocket: 'readonly',
  ReadableStream: 'readonly',
  WritableStream: 'readonly',
  TransformStream: 'readonly',
  atob: 'readonly',
  btoa: 'readonly',
};

const rules = {
  'no-undef': 'error',
  'no-use-before-define': ['error', { functions: false, classes: true, variables: true }],
};

export default [
  {
    ignores: [
      'node_modules/**',
      'docs/**',
      'reports/**',
      '.jscpd-report/**',
      '.stryker-tmp/**',
      'coverage/**',
    ],
  },
  {
    files: ['**/*.js', '**/*.cjs'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'commonjs',
      globals: nodeGlobals,
    },
    rules,
  },
  {
    files: ['**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: nodeGlobals,
    },
    rules,
  },
];
