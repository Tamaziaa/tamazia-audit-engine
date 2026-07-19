'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createLogger, createFallbackLogger } = require('./logger.js');

test('createLogger returns an object with the expected level methods regardless of pino availability', () => {
  const logger = createLogger({ service: 'test' });
  for (const level of ['info', 'warn', 'error', 'fatal', 'debug']) {
    assert.equal(typeof logger[level], 'function', `expected logger.${level} to be a function`);
  }
  assert.equal(typeof logger.child, 'function');
});

test('createFallbackLogger emits parseable JSON with bound fields merged in', () => {
  const lines = [];
  const originalLog = console.log;
  console.log = (line) => lines.push(line);
  try {
    const logger = createFallbackLogger({ service: 'cron' });
    logger.info({ jobId: 'abc' }, 'job started');
  } finally {
    console.log = originalLog;
  }
  assert.equal(lines.length, 1);
  const parsed = JSON.parse(lines[0]);
  assert.equal(parsed.service, 'cron');
  assert.equal(parsed.jobId, 'abc');
  assert.equal(parsed.msg, 'job started');
  assert.equal(parsed.level, 'info');
});

test('createFallbackLogger.child merges bindings without mutating the parent', () => {
  const parent = createFallbackLogger({ service: 'worker' });
  const child = parent.child({ stage: 'evidence' });
  const lines = [];
  const originalLog = console.log;
  console.log = (line) => lines.push(line);
  try {
    child.info({}, 'stage started');
  } finally {
    console.log = originalLog;
  }
  const parsed = JSON.parse(lines[0]);
  assert.equal(parsed.service, 'worker');
  assert.equal(parsed.stage, 'evidence');
});

test('createFallbackLogger routes error/fatal to console.error (known-bad fixture: never silent)', () => {
  const errLines = [];
  const originalError = console.error;
  console.error = (line) => errLines.push(line);
  try {
    const logger = createFallbackLogger();
    logger.error({}, 'something broke');
  } finally {
    console.error = originalError;
  }
  assert.equal(errLines.length, 1);
  assert.match(errLines[0], /something broke/);
});
