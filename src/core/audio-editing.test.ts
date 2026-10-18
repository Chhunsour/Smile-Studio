/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyAudioPreset, detachVideoAudio, extractVideoAudio, fitAudioToProject, focusVoice, normalizeAudioGain, repeatAudioToEnd, setAudioFades, setOriginalAudioMuted } from './audio-editing.ts';
import type { AudioAnalysis } from './audio-analysis.ts';
import type { Project } from './types.ts';

function fixture(): Project {
  return {
    schema: 2, id: 'p', name: 'Audio edit', createdAt: 1, updatedAt: 1, aspect: '16:9',
    assets: {
      video: { id: 'video', kind: 'video', path: 'media/video.mov', name: 'Video', duration: 20, width: 1920, height: 1080 },
      music: { id: 'music', kind: 'audio', path: 'media/music.wav', name: 'Music', duration: 20, width: 0, height: 0 },
      image: { id: 'image', kind: 'image', path: 'media/photo.jpg', name: 'Photo', duration: 600, width: 1080, height: 1920 },
    },
    main: [
      { id: 'first', assetId: 'video', in: 0, out: 4, speed: 2, volume: .6 },
      { id: 'second', assetId: 'video', in: 3, out: 11, speed: 1, volume: .7, fadeIn: .2, fadeOut: .4 },
    ],
    texts: [], audio: [{ id: 'music-clip', assetId: 'music', start: 1, in: 2, out: 6, volume: .8, fadeIn: .4, fadeOut: .5 }],
  };
}

test('detach preserves trim, timeline placement, fades and asset while muting only the source', () => {
  const project = fixture();
  const next = detachVideoAudio(project, 'second', () => 'detached');
  assert.deepEqual(next.audio[1], { id: 'detached', assetId: 'video', start: 2, in: 3, out: 11, volume: .7, fadeIn: .2, fadeOut: .4 });
  assert.equal(next.main[0], project.main[0]);
  assert.equal(next.main[1].volume, 0);
  assert.equal(next.assets, project.assets);
  assert.equal(project.main[1].volume, .7);
  assert.equal(detachVideoAudio(project, 'second', () => 'copy', false).main, project.main);
  const muted = { ...project, main: project.main.map(clip => ({ ...clip, volume: 0 })) };
  assert.equal(detachVideoAudio(muted, 'second', () => 'muted-copy').audio[1].volume, 0);
});

test('extract rejects photos, speed mismatches and duplicate IDs before editing', () => {
  const project = fixture();
  assert.throws(() => detachVideoAudio(project, 'first', () => 'detached'), /1× speed/);
  assert.throws(() => detachVideoAudio(project, 'second', () => 'music-clip'), /unique/);
  project.main[1].assetId = 'image';
  assert.throws(() => detachVideoAudio(project, 'second', () => 'detached'), /video clip/);
});

function waveform(peaks: number[]): AudioAnalysis {
  return { duration: 20, peaks, rms: peaks.map(peak => peak / 2), onsets: [], sampleRate: 48000, channels: 1 };
}

test('extract validates the selected sound and preserves source trim, placement, gain and fades', () => {
  const project = fixture();
  const before = structuredClone(project);
  const next = extractVideoAudio(project, 'second', () => 'extracted', waveform(Array(20).fill(.4)));
  assert.deepEqual(next.audio[1], { id: 'extracted', assetId: 'video', start: 2, in: 3, out: 11, volume: .7, fadeIn: .2, fadeOut: .4 });
  assert.equal(next.main[0], project.main[0]);
  assert.equal(next.main[1].volume, 0);
  assert.equal(next.assets, project.assets);
  assert.deepEqual(project, before);
});

test('extract rejects a silent trim even when sound exists elsewhere in the video', () => {
  const project = fixture();
  const before = structuredClone(project);
  let allocated = false;
  const peaks = Array(20).fill(.8);
  peaks.fill(0, 3, 11);
  assert.throws(() => extractVideoAudio(project, 'second', () => { allocated = true; return 'extracted'; }, waveform(peaks)), /trimmed range is silent/);
  assert.equal(allocated, false);
  assert.deepEqual(project, before);
  peaks[5] = .2;
  assert.equal(extractVideoAudio(project, 'second', () => 'audible-trim', waveform(peaks)).audio.at(-1)?.id, 'audible-trim');
});

test('extract rejects fully silent and unreadable audio before allocating or muting a track', () => {
  const project = fixture();
  const before = structuredClone(project);
  let allocated = false;
  const makeId = () => { allocated = true; return 'extracted'; };
  assert.throws(() => extractVideoAudio(project, 'second', makeId, waveform(Array(20).fill(0))), /silent/);
  assert.throws(() => extractVideoAudio(project, 'second', makeId, waveform([])), /readable audio waveform/);
  assert.throws(() => extractVideoAudio(project, 'second', makeId, { ...waveform([.4]), rms: [] }), /readable audio waveform/);
  assert.equal(allocated, false);
  assert.deepEqual(project, before);
});

test('extract requires an existing video source, a valid trim and 1× speed without changing the project', () => {
  const project = fixture();
  const analysis = waveform(Array(20).fill(.4));
  let allocated = false;
  const makeId = () => { allocated = true; return 'extracted'; };
  assert.throws(() => extractVideoAudio(project, 'missing', makeId, analysis), /video clip/);
  assert.throws(() => extractVideoAudio(project, 'music-clip', makeId, analysis), /video clip/);
  assert.throws(() => extractVideoAudio(project, 'first', makeId, analysis), /1× speed/);
  for (const invalid of [
    { ...project, assets: { ...project.assets, video: project.assets.image } },
    { ...project, assets: { music: project.assets.music } },
    { ...project, main: project.main.map(clip => clip.id === 'second' ? { ...clip, out: 25 } : clip) },
  ]) {
    const before = structuredClone(invalid);
    assert.throws(() => extractVideoAudio(invalid, 'second', makeId, analysis), /video clip|invalid trim/);
    assert.deepEqual(invalid, before);
  }
  assert.equal(allocated, false);
  assert.equal(project.main[1].volume, .7);
  assert.equal(project.audio.length, 1);
});

test('repeating trimmed music fills the project exactly and keeps fades at the outer edges', () => {
  const project = fixture();
  let counter = 0;
  const next = repeatAudioToEnd(project, 'music-clip', () => `repeat-${++counter}`);
  assert.deepEqual(next.audio.map(audio => [audio.start, audio.in, audio.out]), [[1, 2, 6], [5, 2, 6], [9, 2, 3]]);
  assert.deepEqual(next.audio.map(audio => [audio.fadeIn, audio.fadeOut]), [[.4, 0], [0, 0], [0, .5]]);
  assert.equal(next.audio[2].start + next.audio[2].out - next.audio[2].in, 10);
  assert.equal(project.audio.length, 1);
  assert.throws(() => repeatAudioToEnd(project, 'music-clip', () => 'second'), /unique/);
  assert.equal(repeatAudioToEnd(next, 'music-clip', () => 'unused'), next);
  const edited = { ...next, audio: next.audio.map(audio => audio.id === 'repeat-1' ? { ...audio, volume: .1 } : audio) };
  assert.equal(repeatAudioToEnd(edited, 'music-clip', () => 'unused'), edited);
});

test('repeating preserves an existing partial run and includes an editable short final tail', () => {
  const project = fixture();
  project.main[1].out = 11.04;
  project.audio.push({ ...project.audio[0], id: 'existing', start: 5, volume: .2 });
  let counter = 0;
  const next = repeatAudioToEnd(project, 'music-clip', () => `repeat-${++counter}`);
  assert.equal(next.audio.filter(audio => audio.start === 5).length, 1);
  assert.equal(next.audio.find(audio => audio.id === 'existing')!.volume, .2);
  assert.equal(next.audio.find(audio => audio.start === 9)!.out, 3.039999999999999);
  const withTail = fixture();
  withTail.main[1].out = 10.04;
  const repeated = repeatAudioToEnd(withTail, 'music-clip', () => `tail-${++counter}`);
  const tail = repeated.audio.at(-1)!;
  assert.ok(Math.abs(tail.out - tail.in - .04) < 1e-8);
  assert.doesNotThrow(() => applyAudioPreset(repeated, tail.id, 'music'));
});

test('repeat bounds tiny segments and fits audio that already extends past the end', () => {
  const project = fixture();
  project.audio[0].out = 20;
  const next = fitAudioToProject(project, 'music-clip');
  assert.equal(next.audio[0].out, 11);
  assert.deepEqual(repeatAudioToEnd(project, 'music-clip', () => 'unused'), next);
  project.main[1].out = 20;
  project.audio[0].out = 2.1;
  assert.throws(() => repeatAudioToEnd(project, 'music-clip', () => 'x'), /128 pieces/);
});

test('extending a repeated soundtrack resizes its old tail and preserves existing mix edits', () => {
  let counter = 0;
  const repeated = repeatAudioToEnd(fixture(), 'music-clip', () => `repeat-${++counter}`);
  const edited = {
    ...repeated,
    main: repeated.main.map(clip => clip.id === 'second' ? { ...clip, out: 15 } : clip),
    audio: repeated.audio.map(audio => audio.id === 'repeat-1' ? { ...audio, out: 5, volume: .2, fadeIn: .15, fadeOut: .25 } : audio.id === 'repeat-2' ? { ...audio, volume: .12, fadeIn: .1, fadeOut: .7 } : audio),
  };
  const next = repeatAudioToEnd(edited, 'music-clip', () => `repeat-${++counter}`);
  const tail = next.audio.find(audio => audio.id === 'repeat-2')!;
  assert.equal(next.audio.filter(audio => audio.start === 9).length, 1);
  assert.deepEqual([tail.start, tail.in, tail.out, tail.volume, tail.fadeIn, tail.fadeOut], [9, 2, 6, .12, .1, .7]);
  assert.equal(next.audio.find(audio => audio.id === 'repeat-1'), edited.audio.find(audio => audio.id === 'repeat-1'));
  assert.deepEqual(next.audio.find(audio => audio.start === 13), { id: 'repeat-3', assetId: 'music', start: 13, in: 2, out: 3, volume: .8, fadeIn: 0, fadeOut: .7 });
  assert.equal(next.audio.filter(audio => audio.start <= 9.5 && audio.start + audio.out - audio.in > 9.5).length, 1);
  assert.equal(repeatAudioToEnd(next, 'music-clip', () => 'unused'), next);
});

test('shortening a repeated soundtrack trims its boundary instead of adding an overlapping tail', () => {
  let counter = 0;
  const repeated = repeatAudioToEnd(fixture(), 'music-clip', () => `repeat-${++counter}`);
  const edited = {
    ...repeated,
    main: repeated.main.map(clip => clip.id === 'second' ? { ...clip, out: 8 } : clip),
    audio: repeated.audio.map(audio => audio.id === 'repeat-1' ? { ...audio, volume: .2, fadeIn: .1, fadeOut: .3 } : audio),
  };
  edited.audio.push({ id: 'unrelated', assetId: 'video', start: 9, in: 0, out: 1, volume: .4 });
  const next = repeatAudioToEnd(edited, 'music-clip', () => assert.fail('Existing pieces should be reused.'));
  const tail = next.audio.find(audio => audio.id === 'repeat-1')!;
  assert.deepEqual([tail.start, tail.in, tail.out, tail.volume, tail.fadeIn, tail.fadeOut], [5, 2, 4, .2, .1, .3]);
  assert.equal(next.audio.some(audio => audio.id === 'repeat-2'), false);
  assert.equal(next.audio.find(audio => audio.id === 'unrelated'), edited.audio.find(audio => audio.id === 'unrelated'));
  assert.equal(next.audio.filter(audio => audio.start <= 6.5 && audio.start + audio.out - audio.in > 6.5).length, 1);
  assert.equal(repeatAudioToEnd(next, 'music-clip', () => 'unused'), next);
});

test('shortening inside the first soundtrack piece clears old repeats before a later extension', () => {
  let counter = 0;
  const repeated = repeatAudioToEnd(fixture(), 'music-clip', () => `repeat-${++counter}`);
  const short = { ...repeated, main: repeated.main.map(clip => clip.id === 'second' ? { ...clip, out: 3.5 } : clip) };
  const trimmed = repeatAudioToEnd(short, 'music-clip', () => assert.fail('A first-piece trim creates no copies.'));
  assert.equal(trimmed.audio.length, 1);
  assert.equal(trimmed.audio[0].out, 3.5);
  const longer = { ...trimmed, main: trimmed.main.map(clip => clip.id === 'second' ? { ...clip, out: 15 } : clip) };
  const next = repeatAudioToEnd(longer, 'music-clip', () => `repeat-${++counter}`);
  for (let time = 1.01; time < 14; time += .1) {
    assert.equal(next.audio.filter(audio => audio.start <= time && audio.start + audio.out - audio.in > time).length, 1);
  }
});

test('fades and role presets remain bounded inside short audio clips', () => {
  const project = fixture();
  project.audio[0].out = 2.1;
  const next = applyAudioPreset(project, 'music-clip', 'ambient');
  assert.equal(next.audio[0].volume, .18);
  assert.ok(Math.abs(next.audio[0].fadeIn! + next.audio[0].fadeOut! - .1) < 1e-8);
  assert.ok(Math.abs(setAudioFades(project, 'music-clip', 1).audio[0].fadeIn! - .05) < 1e-8);
  assert.throws(() => setAudioFades(project, 'music-clip', Number.NaN), /fade length/);
});

test('voice focus lowers only overlapping clips and is safe to apply repeatedly', () => {
  const project = fixture();
  project.audio.push({ id: 'voice', assetId: 'music', start: 3, in: 0, out: 2, volume: 1 });
  project.audio.push({ id: 'later', assetId: 'music', start: 6, in: 0, out: 2, volume: .9 });
  const next = focusVoice(project, 'voice');
  assert.equal(next.audio[0].volume, .2);
  assert.equal(next.audio[1].volume, 1);
  assert.equal(next.audio[2].volume, .9);
  assert.equal(next.main[0].volume, .6);
  assert.equal(next.main[1].volume, .2);
  assert.equal(focusVoice(next, 'voice'), next);
});

test('normalization measures only source bins intersecting the trim and never amplifies above 1', () => {
  const project = fixture();
  const analysis: AudioAnalysis = { duration: 20, peaks: [1, .5, .9, 1, 1, 1, 1, 1, 1, 1], rms: [], onsets: [], sampleRate: 48000, channels: 1 };
  const next = normalizeAudioGain(project, 'music-clip', analysis);
  assert.equal(next.audio[0].volume, .85 / .9);
  assert.equal(normalizeAudioGain(project, 'music-clip', { ...analysis, peaks: Array(10).fill(.3) }).audio[0].volume, 1);
  assert.throws(() => normalizeAudioGain(project, 'music-clip', { ...analysis, peaks: Array(10).fill(0) }), /silent/);
  assert.throws(() => normalizeAudioGain(project, 'music-clip', analysis, Number.NaN), /waveform/);
});

test('mute and restore affect original video sound while preserving photos and added tracks', () => {
  const project = fixture();
  project.main.push({ id: 'photo', assetId: 'image', in: 0, out: 3, speed: 1, volume: .8 });
  const muted = setOriginalAudioMuted(project, true);
  assert.deepEqual(muted.main.map(clip => clip.volume), [0, 0, .8]);
  assert.equal(muted.audio, project.audio);
  assert.equal(setOriginalAudioMuted(muted, true), muted);
  assert.deepEqual(setOriginalAudioMuted(muted, false).main.map(clip => clip.volume), [1, 1, .8]);
});
