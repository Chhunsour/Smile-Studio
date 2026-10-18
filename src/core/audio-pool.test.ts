/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_AUDIO_PLAYERS, planAudioPlayers } from './audio-pool.ts';
import type { AudioClip } from './types.ts';

const audio = (id: string, start: number, duration = 1, volume = .5): AudioClip => ({ id, assetId: 'music', start, in: 2, out: 2 + duration, volume });

test('hundreds of sequential loops keep only the current and next two audio players', () => {
  const clips = Array.from({ length: 200 }, (_, i) => audio(String(i), i));
  for (const t of [0, .5, 5, 100, 198, 199, 200]) {
    const plan = planAudioPlayers(clips, t);
    assert.ok(plan.clips.length <= 3, `${t}: ${plan.clips.length}`);
    assert.equal(plan.overflow, 0);
  }
  assert.deepEqual(planAudioPlayers(clips, 100).clips.map(c => c.id), ['100', '101', '102']);
});

test('overlapping voices are bounded with deterministic foreground priority', () => {
  const clips = [audio('bed', 0, 20, .2), ...Array.from({ length: 10 }, (_, i) => audio(`voice-${i}`, i / 100, 20, 1))];
  const plan = planAudioPlayers(clips, 1);
  assert.equal(plan.clips.length, MAX_AUDIO_PLAYERS);
  assert.equal(plan.overflow, 3);
  assert.ok(!plan.clips.some(c => c.id === 'bed'));
  assert.deepEqual(plan.clips, planAudioPlayers([...clips].reverse(), 1).clips);
});

test('muted audio costs no decoder and seeking backward prepares the correct source clips', () => {
  const clips = [audio('muted', 0, 20, 0), audio('first', 0, 2), audio('later', 10, 2)];
  assert.deepEqual(planAudioPlayers(clips, 10).clips.map(c => c.id), ['later']);
  assert.deepEqual(planAudioPlayers(clips, 0).clips.map(c => c.id), ['first']);
  assert.equal(planAudioPlayers(clips, 3).nextChange, 8);
});

test('short sound boundaries and simultaneous future groups are prepared before their start', () => {
  const clips = [audio('tap', .2, .12), audio('a', 1), audio('b', 1), audio('c', 1)];
  assert.deepEqual(planAudioPlayers(clips, .1).clips.map(c => c.id), ['tap', 'a']);
  assert.equal(planAudioPlayers(clips, .21).clips[0].id, 'tap');
  assert.deepEqual(planAudioPlayers(clips, .5).clips.map(c => c.id), ['a', 'b', 'c']);
  assert.ok(Math.abs(planAudioPlayers(clips, .21).nextChange - .3) < .000001);
});
