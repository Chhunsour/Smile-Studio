/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { finishVoiceovers, hasPendingVoiceover, registerVoiceoverSession } from './voiceover-session.ts';

test('navigation waits for all unfinished takes, deduplicates saves and preserves a newer session', async () => {
  let active = true, calls = 0, complete!: () => void;
  const saved = new Promise<void>(resolve => { complete = resolve; });
  const release = registerVoiceoverSession({ pending: () => active, finish: async () => { calls++; await saved; active = false; } });
  const releaseIdle = registerVoiceoverSession({ pending: () => false, finish: async () => { throw new Error('Idle take should not save.'); } });
  try {
    assert.equal(hasPendingVoiceover(), true);
    const first = finishVoiceovers(), duplicate = finishVoiceovers();
    assert.equal(first, duplicate); assert.equal(calls, 1);
    complete(); await first;
    assert.equal(hasPendingVoiceover(), false);
    let next = true;
    const releaseNext = registerVoiceoverSession({ pending: () => next, finish: async () => { next = false; } });
    release();
    assert.equal(hasPendingVoiceover(), true);
    await finishVoiceovers(); assert.equal(next, false); releaseNext();
  } finally { release(); releaseIdle(); }
});

test('navigation drains a take that starts while an earlier take is still importing', async () => {
  let firstPending = true, laterPending = false, laterCalls = 0;
  let finishFirst!: () => void, finishLater!: () => void;
  const firstImport = new Promise<void>(resolve => { finishFirst = resolve; });
  const laterImport = new Promise<void>(resolve => { finishLater = resolve; });
  const releaseFirst = registerVoiceoverSession({ pending: () => firstPending, finish: async () => { await firstImport; firstPending = false; } });
  const releaseLater = registerVoiceoverSession({ pending: () => laterPending, finish: async () => { laterCalls++; await laterImport; laterPending = false; } });
  try {
    const navigation = finishVoiceovers();
    let navigationFinished = false;
    void navigation.then(() => { navigationFinished = true; });
    laterPending = true;
    finishFirst();
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(laterCalls, 1);
    assert.equal(navigationFinished, false);
    assert.equal(hasPendingVoiceover(), true);
    assert.equal(finishVoiceovers(), navigation);
    finishLater();
    await navigation;
    assert.equal(navigationFinished, true);
    assert.equal(hasPendingVoiceover(), false);
  } finally {
    finishFirst(); finishLater(); releaseFirst(); releaseLater();
  }
});
