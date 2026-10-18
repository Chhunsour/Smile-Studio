import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createToolHandoff } from './tool-handoff.ts';

test('tool actions wait for dismissal and duplicate dismissal events run them only once', () => {
  const handoff = createToolHandoff();
  let calls = 0;
  handoff.queue(() => { calls += 1; });
  assert.equal(calls, 0);
  assert.equal(handoff.flush(), true);
  assert.equal(handoff.flush(), false);
  assert.equal(calls, 1);
});

test('reopening or unmounting cancels an action before a late dismissal callback', () => {
  const handoff = createToolHandoff();
  let calls = 0;
  handoff.queue(() => { calls += 1; });
  handoff.cancel();
  assert.equal(handoff.flush(), false);
  assert.equal(calls, 0);
  handoff.queue(() => { calls += 1; });
  assert.equal(handoff.flush(), true);
  assert.equal(calls, 1);
});

test('a second selection replaces the pending action while the sheet closes', () => {
  const handoff = createToolHandoff();
  const calls: string[] = [];
  handoff.queue(() => calls.push('media'));
  handoff.queue(() => calls.push('audio'));
  assert.equal(handoff.flush(), true);
  assert.deepEqual(calls, ['audio']);
});

test('a failing action is consumed before it runs and cannot be retried by dismissal', () => {
  const handoff = createToolHandoff();
  let calls = 0;
  handoff.queue(() => { calls += 1; throw new Error('Picker unavailable'); });
  assert.throws(() => handoff.flush(), /Picker unavailable/);
  assert.equal(handoff.flush(), false);
  assert.equal(calls, 1);
});

test('an action can safely trigger another dismissal or queue a later handoff', () => {
  const handoff = createToolHandoff();
  const calls: string[] = [];
  handoff.queue(() => {
    calls.push('first');
    assert.equal(handoff.flush(), false);
    handoff.queue(() => calls.push('next'));
  });
  assert.equal(handoff.flush(), true);
  assert.deepEqual(calls, ['first']);
  assert.equal(handoff.flush(), true);
  assert.deepEqual(calls, ['first', 'next']);
});
