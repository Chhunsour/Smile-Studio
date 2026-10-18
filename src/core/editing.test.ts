/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { copyLook, loopAudio, mergeMarkers } from './editing.ts';
import type { AudioClip, VideoClip } from './types.ts';

test('looping trimmed audio fills exactly to the movie end and preserves source bounds', () => {
  const clip: AudioClip = { id: 'a', assetId: 'music', start: 1, in: 2, out: 5, volume: .4, fadeOut: .4 };
  let n = 0;
  const copies = loopAudio(clip, 8.2, () => String(++n));
  assert.deepEqual(copies.map(c => [c.start,c.in,c.out]), [[4,2,5],[7,2,3.1999999999999993]]);
  assert.deepEqual(loopAudio(clip, 8.2, () => String(++n), copies), []);
  assert.equal(copies[1].start + copies[1].out - copies[1].in, 8.2);
  assert.deepEqual(loopAudio({ ...clip, out: clip.in }, 100, () => 'x'), []);
  assert.throws(() => loopAudio({ ...clip, out: 2.1 }, 10000, () => 'x'), /longer music/);
});
test('copy look has independent settings and excludes crop, audio and speed', () => {
  const clip: VideoClip = { id:'v',assetId:'a',in:0,out:3,speed:2,volume:0,effects:{grain:.4} };
  const look = copyLook(clip);
  look.effects!.grain = .8;
  assert.equal(clip.effects!.grain, .4);
  assert.deepEqual(Object.keys(look).sort(), ['color','effects']);
});
test('markers reject invalid/outside times and combine without repeated close ticks', () => {
  assert.deepEqual(mergeMarkers([], [0,.05,.1,.15,.2], 1), [0,.1,.2]);
  assert.deepEqual(mergeMarkers([2,1], [1.02,NaN,-1,5,3.12345], 4), [1,2,3.123]);
});
