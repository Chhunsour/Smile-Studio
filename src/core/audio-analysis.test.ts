/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeSamples, detectOnsets, MAX_ONSETS, onsetsForClip, sampleWaveform, validateAnalysis } from './audio-analysis.ts';

test('decoded silence stays silent and creates no beat candidates', () => {
  const analysis = analyzeSamples(new Float32Array(2000), 1000, 1, 100);
  assert.ok(analysis.rms.every(n => n === 0));
  assert.ok(analysis.peaks.every(n => n === 0));
  assert.deepEqual(analysis.onsets, []);
});

test('synthetic PCM pulses retain real RMS, peak and source onset timing', () => {
  const pcm = new Float32Array(3000);
  for (const at of [500, 1000, 1500, 2000]) pcm.fill(.8, at, at + 40);
  const a = analyzeSamples(pcm, 1000, 1, 300);
  assert.equal(a.duration, 3);
  assert.ok(a.onsets.some(t => Math.abs(t - .5) < .021));
  assert.ok(a.onsets.some(t => Math.abs(t - 2) < .021));
  assert.ok(Math.abs(a.peaks[50] - .8) < .00001);
  assert.equal(a.peaks[20], 0);
});

test('opposite stereo phases do not cancel their visual energy', () => {
  const a = analyzeSamples([.5, -.5, .5, -.5], 2, 2, 1);
  assert.equal(a.rms[0], .5);
  assert.equal(a.peaks[0], .5);
});

test('trim sampling excludes peaks outside the selected source interval', () => {
  const a = { duration: 4, rms: [0, .3, .6, 1], peaks: [0, .4, .8, 1], onsets: [], sampleRate: 1000, channels: 1 };
  assert.deepEqual(sampleWaveform(a, 1, 3, 2), [{ rms: .3, peak: .4 }, { rms: .6, peak: .8 }]);
  assert.equal(sampleWaveform(a, 0, 2, 1)[0].peak, .4);
  assert.ok(Math.abs(sampleWaveform(a, 0, 2, 1)[0].rms - Math.sqrt(.09 / 2)) < .00001);
  assert.deepEqual(sampleWaveform(a, 5, 6, 1), [{ rms: 0, peak: 0 }]);
});

test('source beat candidates respect clip trim, offset and speed', () => {
  const a = { duration: 5, rms: [1], peaks: [1], onsets: [.5, 1, 2, 3, 4], sampleRate: 1000, channels: 1 };
  assert.deepEqual(onsetsForClip(a, { in: 1, out: 4, start: 10, speed: 2 }), [10, 10.5, 11]);
  assert.deepEqual(onsetsForClip(a, { in: 1, out: 4, start: 10, speed: 2 }, 10.6), [10, 10.5]);
});

test('a Reel trimmed twenty minutes into a long source retains its actual later beat candidates', () => {
  const energy = new Array<number>(1500 / .02).fill(0);
  for (let index = 25; index < energy.length; index += 50) energy[index] = .8;
  const analysis = validateAnalysis({ duration: 1500, rms: [1], peaks: [1], onsets: detectOnsets(energy, .02), sampleRate: 12000, channels: 1 });
  assert.equal(analysis.onsets.length, 1500);
  assert.deepEqual(onsetsForClip(analysis, { in: 1200, out: 1203, start: 2, speed: 2 }), [2.25, 2.75, 3.25]);
  const bounded = validateAnalysis({ ...analysis, onsets: Array.from({ length: MAX_ONSETS + 10 }, (_, index) => index * .1) });
  assert.equal(bounded.onsets.length, MAX_ONSETS);
});

test('a steady tone does not invent a tempo and invalid native output is rejected', () => {
  assert.ok(detectOnsets(new Array(100).fill(.5), .02).length <= 1);
  assert.throws(() => validateAnalysis({ duration: NaN } as never));
  assert.throws(() => analyzeSamples([], 1000));
});
