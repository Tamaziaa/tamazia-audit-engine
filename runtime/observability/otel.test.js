'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { initOtel } = require('./otel.js');

test('initOtel is a safe no-op without an OTLP endpoint (staged default)', () => {
  const result = initOtel({ endpoint: undefined });
  assert.equal(result.active, false);
});

test('initOtel never throws even when @opentelemetry/sdk-node is not installed', () => {
  assert.doesNotThrow(() => initOtel({ endpoint: 'http://collector:4318' }));
});
