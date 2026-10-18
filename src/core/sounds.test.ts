/// <reference types="node" />
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { SOUND_RATE, SOUNDS, filterSounds, synthesizeSound } from './sounds.ts';

test('library WAVs have valid lengths, audible PCM, bounded peaks, and quiet ends', () => {
  for (const sound of SOUNDS) {
    const wav = synthesizeSound(sound.id), view = new DataView(wav.buffer);
    assert.equal(Buffer.from(wav.subarray(0, 4)).toString(), 'RIFF');
    assert.equal(view.getUint32(24, true), SOUND_RATE);
    assert.equal(view.getUint32(40, true), wav.length - 44);
    assert.equal(wav.length, 44 + Math.round(sound.duration * SOUND_RATE) * 2);
    let sum = 0, peak = 0;
    for (let i = 44; i < wav.length; i += 2) { const v = view.getInt16(i, true); sum += v * v; peak = Math.max(peak, Math.abs(v)); }
    assert.ok(Math.sqrt(sum / ((wav.length - 44) / 2)) > 300, sound.id);
    assert.ok(peak < 32767);
    assert.equal(view.getInt16(44, true), 0);
    assert.ok(Math.abs(view.getInt16(wav.length - 2, true)) < 100);
  }
});

test('every library choice has distinct, deterministic audio bytes', () => {
  const fingerprints = new Set<string>();
  for (const sound of SOUNDS) {
    const first = synthesizeSound(sound.id), second = synthesizeSound(sound.id);
    const hash = createHash('sha256').update(first).digest('hex');
    assert.equal(createHash('sha256').update(second).digest('hex'), hash, `${sound.id} changes between imports`);
    assert.ok(!fingerprints.has(hash), `${sound.id} duplicates another library sound`);
    fingerprints.add(hash);
  }
});

test('music note changes preserve quiet oscillator boundaries without large digital clicks', () => {
  for (const sound of SOUNDS.filter((sound) => sound.kind === 'Music')) {
    const bytes = synthesizeSound(sound.id), view = new DataView(bytes.buffer);
    const beat = 60 / sound.bpm;
    let maximum = 0;
    for (let time = beat; time < sound.duration - .001; time += beat) {
      const frame = Math.round(time * SOUND_RATE);
      // Check either side of fractional sample boundaries as well as exact quarter-note cuts.
      for (let sample = frame - 2; sample <= frame + 2; sample++) {
        const jump = Math.abs(view.getInt16(44 + sample * 2, true) - view.getInt16(44 + (sample - 1) * 2, true));
        maximum = Math.max(maximum, jump);
      }
    }
    // Percussive beds include deliberate hat noise. The soft bed isolates the pitched note envelope.
    const limit = (sound.group === 'Calm' && sound.id !== 'lofi') || sound.group === 'Cinematic' ? 128 : 4000;
    assert.ok(maximum < limit, `${sound.id} jumps ${maximum} PCM units at a note change`);
  }
});

test('library search combines category, mood and case-insensitive descriptions', () => {
  assert.equal(SOUNDS.length, 18);
  assert.equal(new Set(SOUNDS.map(sound => sound.id)).size, SOUNDS.length);
  assert.deepEqual(filterSounds('Music', '  LO-FI ').map(sound => sound.id), ['lofi']);
  assert.deepEqual(filterSounds('Effects', 'cinematic').map(sound => sound.id), ['impact']);
  assert.ok(filterSounds('Music', '', 'Calm').every(sound => sound.kind === 'Music' && sound.group === 'Calm'));
  assert.equal(filterSounds('Effects', '', 'Calm').length, 0);
  assert.equal(filterSounds('Music', 'not a known sound').length, 0);
});
