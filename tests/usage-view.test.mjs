import test from 'node:test';
import assert from 'node:assert/strict';
import { FREE_USAGE_LIMITS, usageMeter, usageMeters } from '../usage-view.js';

test('quota comparisons use account totals and the separate per-database storage limit', () => {
  const rows = usageMeters({
    workers: { status: 'ok', requests: 10, accountRequests: 640 },
    d1: { status: 'ok', rowsRead: 20, accountRowsRead: 25846, rowsWritten: 3, accountRowsWritten: 565 },
    d1Storage: { status: 'ok', bytes: 428000 },
  });
  assert.deepEqual(rows.map(row => row.value), [640, 25846, 565, 428000]);
  assert.deepEqual(rows.map(row => row.limit), [100000, 5000000, 100000, 500000000]);
  assert.equal(rows[3].scope, '本项目单库');
  assert.equal(rows[0].project, 10);
  assert.equal(FREE_USAGE_LIMITS.databaseBytes, 500 * 1000 ** 2, 'MB and KB use decimal units consistently');
});

test('missing or failed analytics never become zero usage or fall back to project counts', () => {
  for (const report of [{}, { workers: { status: 'ok', requests: 10 } }, { workers: { status: 'unavailable', accountRequests: 640 } }]) {
    const row = usageMeters(report)[0];
    assert.equal(row.value, null); assert.equal(row.percent, null); assert.equal(row.level, 'unknown');
  }
  for (const value of [null, undefined, NaN, Infinity, -1, '10']) assert.equal(usageMeter(value, 100).level, 'unknown');
  assert.equal(usageMeter(0, 100).percent, 0);
  assert.equal(usageMeter(0, 100).level, 'normal');
});

test('progress preserves tiny values, warns near quota, and bounds the bar without hiding overuse', () => {
  assert.equal(usageMeter(1, 100000).fill, .001);
  assert.equal(usageMeter(79, 100).level, 'normal');
  assert.equal(usageMeter(80, 100).level, 'warning');
  assert.equal(usageMeter(100, 100).level, 'danger');
  const over = usageMeter(125, 100);
  assert.equal(over.percent, 125); assert.equal(over.fill, 100); assert.equal(over.value, 125);
});
