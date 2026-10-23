import test from 'node:test';
import assert from 'node:assert/strict';
import { createBoardLoader } from '../board-loader.js';

const query = { period: 'all', version: '', difficulty: 'medium', mode: 'classic', metric: 'best' };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

test('filtering retains the current results while loading and ignores late responses', async () => {
  const requests = [], changes = [];
  const loader = createBoardLoader({ onChange: view => changes.push(view), fetchBoard: (params, options) => { const task = deferred(); requests.push({ ...task, params, ...options }); return task.promise; } });
  const first = loader.load(query); await Promise.resolve();
  const original = { entries: [{ displayName: 'First' }] }; requests[0].resolve(original); await first;
  const second = loader.load({ ...query, metric: 'total' }); await Promise.resolve();
  assert.equal(changes.at(-1).data, original); assert.equal(changes.at(-1).loading, true);
  const third = loader.load({ ...query, difficulty: 'hard' }); await Promise.resolve();
  assert.equal(requests[1].signal.aborted, true);
  const latest = { entries: [{ displayName: 'Latest' }] }; requests[2].resolve(latest); await third;
  const count = changes.length; requests[1].resolve({ entries: [{ displayName: 'Stale' }] }); await second;
  assert.equal(changes.length, count); assert.equal(changes.at(-1).data, latest); assert.equal(changes.at(-1).loading, false);
});

test('identical requests coalesce, all filters have separate cache entries, and refresh bypasses the cache', async () => {
  let calls = 0, time = 0; const task = deferred(), changes = [];
  const loader = createBoardLoader({ now: () => time, onChange: view => changes.push(view), fetchBoard: async () => { calls++; if (calls === 1) return task.promise; return { request: calls, entries: [] }; } });
  const first = loader.load(query), repeated = loader.load(query); assert.equal(first, repeated);
  task.resolve({ request: 1, entries: [] }); await first;
  for (const change of [{ metric: 'total' }, { difficulty: 'hard' }, { mode: 'six-seat' }, { period: 'daily' }, { version: 'other' }]) await loader.load({ ...query, ...change });
  assert.equal(calls, 6);
  await loader.load(query); assert.equal(calls, 6); assert.equal(changes.at(-1).data.request, 1); assert.equal(changes.at(-1).loading, false);
  await loader.load(query, { force: true }); assert.equal(calls, 7);
  time = 30001; await loader.load(query); assert.equal(calls, 8);
});

test('closing cancels pending loads, failures remain retryable, and cancellation never surfaces an error', async () => {
  const changes = [], tasks = [];
  const loader = createBoardLoader({ onChange: view => changes.push(view), fetchBoard: (params, options) => { const task = deferred(); tasks.push({ ...task, ...options }); return task.promise; } });
  const first = loader.load(query); await Promise.resolve(); loader.cancel();
  assert.equal(tasks[0].signal.aborted, true); const count = changes.length;
  tasks[0].reject(new Error('aborted')); await first; assert.equal(changes.length, count);
  const retry = loader.load(query); await Promise.resolve(); tasks[1].reject(new Error('Network unavailable')); await retry;
  assert.equal(changes.at(-1).error, 'Network unavailable'); assert.equal(changes.at(-1).loading, false);
  const recovered = loader.load(query); await Promise.resolve(); tasks[2].resolve({ entries: [] }); await recovered;
  assert.equal(changes.at(-1).error, ''); assert.deepEqual(changes.at(-1).data, { entries: [] });
});
