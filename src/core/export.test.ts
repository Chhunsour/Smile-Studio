/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildExportSpec, exportSize, sliceSpec } from './export.ts';
import type { Project } from './types.ts';
import { effectPrimitives, effectSeed } from './effects.ts';
import { extractVideoAudio } from './audio-editing.ts';

test('export size keeps the short side and even dimensions', () => {
  assert.deepEqual(exportSize(9 / 16, 1080), { width: 1080, height: 1920 });
  assert.deepEqual(exportSize(16 / 9, 720), { width: 1280, height: 720 });
  assert.deepEqual(exportSize(1, 720), { width: 720, height: 720 });
  const odd = exportSize(4 / 3.01, 1080);
  assert.equal(odd.width % 2, 0);
});

test('extracted video sound reaches export as a separate trimmed audio track with original sound muted', () => {
  const project: Project = {
    schema: 2, id: 'extract-project', name: 'Extract audio', createdAt: 0, updatedAt: 0, aspect: '9:16',
    assets: { video: { id: 'video', kind: 'video', path: 'media/source.mp4', name: 'Source', duration: 10, width: 1080, height: 1920 } },
    main: [
      { id: 'intro', assetId: 'video', in: 0, out: 4, speed: 2, volume: .3 },
      { id: 'selected', assetId: 'video', in: 3, out: 7, speed: 1, volume: .6, fadeIn: .5, fadeOut: .25 },
    ],
    texts: [], audio: [],
  };
  const extracted = extractVideoAudio(project, 'selected', () => 'extracted', {
    duration: 10, peaks: Array(10).fill(.5), rms: Array(10).fill(.25), onsets: [], sampleRate: 48000, channels: 1,
  });
  const spec = buildExportSpec(extracted, { resolution: 720, fps: 24, output: 'file:///export.mp4' }, asset => `file:///${asset.path}`);
  assert.equal(spec.clips[0].volume, .3);
  assert.equal(spec.clips[1].volume, 0);
  assert.deepEqual(spec.audio, [{
    uri: 'file:///media/source.mp4', start: 2, sourceIn: 3, sourceOut: 7, volume: .6,
    envelope: [2, 0, 2.5, 1, 5.75, 1, 6, 0],
  }]);
  assert.equal(project.main[1].volume, .6);
  assert.deepEqual(project.audio, []);
});

test('spec places clips, texts and audio on the timeline', () => {
  const p: Project = {
    schema: 2,
    id: 'p',
    name: 'P',
    createdAt: 0,
    updatedAt: 0,
    aspect: '9:16',
    assets: {
      v: { id: 'v', kind: 'video', path: 'media/v.mp4', name: 'v', duration: 10, width: 1920, height: 1080 },
      m: { id: 'm', kind: 'audio', path: 'media/m.m4a', name: 'm', duration: 60, width: 0, height: 0 },
    },
    main: [
      { id: 'a', assetId: 'v', in: 0, out: 4, speed: 2, volume: 1 },
      {
        id: 'b',
        assetId: 'v',
        in: 4,
        out: 8,
        speed: 1,
        volume: 0.5,
        fadeIn: 1,
        fadeOut: 5,
        color: { filter: 'mono', intensity: 1, brightness: 0, contrast: 0, saturation: 0, warmth: 0 },
      },
    ],
    texts: [
      {
        id: 't',
        start: 5,
        end: 99,
        text: 'Hi',
        font: 'sans',
        color: '#fff',
        opacity: 1,
        box: false,
        x: 0.5,
        y: 0.25,
        size: 0.1,
        rotation: 0,
        animIn: 'pop',
      },
      {
        id: 'e',
        start: 0,
        end: 1,
        text: '  ',
        font: 'sans',
        color: '#fff',
        opacity: 1,
        box: false,
        x: 0.5,
        y: 0.5,
        size: 0.1,
        rotation: 0,
      },
    ],
    audio: [
      { id: 'x', assetId: 'm', start: 3, in: 10, out: 50, volume: 0.8, fadeIn: 2, fadeOut: 2 },
      { id: 'y', assetId: 'm', start: 7, in: 0, out: 5, volume: 1 },
    ],
  };
  const s = buildExportSpec(p, { resolution: 1080, fps: 30, output: 'file:///out.mp4' }, (a) => `file:///${a.path}`);
  assert.equal(s.width, 1080);
  assert.equal(s.height, 1920);
  assert.equal(s.duration, 6);
  assert.equal(s.background, '#000000');
  assert.equal(buildExportSpec({ ...p, background: 'blur' }, { resolution: 720, fps: 30, output: '' }, () => '').background, 'blur');
  assert.deepEqual(
    s.clips.map((c) => [c.start, c.duration]),
    [
      [0, 2],
      [2, 4],
    ],
  );
  // 16:9 frame fitted in a 1080-wide canvas.
  assert.equal(s.clips[0].frameWidth, 1080);
  assert.ok(Math.abs(s.clips[0].frameHeight - 607.5) < 1e-9);
  assert.equal(s.clips[0].matrix, null);
  assert.equal(s.clips[1].matrix?.length, 20);
  // No fades: no envelope. Fades longer than the clip are scaled down to fit (1 + 5 s on a 4 s clip).
  assert.deepEqual(s.clips[0].envelope, []);
  const expected = [2, 0, 2 + 4 / 6, 1, 2 + 4 / 6, 1, 6, 0];
  assert.ok(s.clips[1].envelope.every((v, i) => Math.abs(v - expected[i]) < 1e-9));
  // Empty text is dropped, the other is placed in pixels; its end isn't clipped so the animation timing matches.
  assert.deepEqual(
    s.texts.map((t) => [t.x, t.y, t.fontSize, t.end, t.animIn, t.animOut, t.animDuration]),
    [[540, 480, 108, 99, 'pop', 'none', 0.5]],
  );
  // Music is cut at the end of the video.
  assert.deepEqual(
    s.audio.map((a) => [a.start, a.sourceIn, a.sourceOut]),
    [[3, 10, 13]],
  );
  // Its fade out belongs to the whole 40 s clip, past the cut.
  assert.deepEqual(s.audio[0].envelope, [3, 0, 5, 1, 41, 1, 43, 0]);
});

test('photos, crossfades and Ken Burns reach the spec; slices start at 0', () => {
  const p: Project = {
    schema: 2,
    id: 'p',
    name: 'P',
    createdAt: 0,
    updatedAt: 0,
    aspect: '1:1',
    assets: {
      v: { id: 'v', kind: 'video', path: 'media/v.mp4', name: 'v', duration: 10, width: 1080, height: 1080 },
      i: { id: 'i', kind: 'image', path: 'media/i.jpg', name: 'i', duration: 600, width: 1080, height: 1080 },
    },
    main: [
      { id: 'a', assetId: 'v', in: 2, out: 6, speed: 1, volume: 1, transition: 1 },
      { id: 'b', assetId: 'i', in: 0, out: 3, speed: 1, volume: 1, transition: 5, kenBurns: true, fadeIn: 1 },
    ],
    texts: [
      { id: 't', start: 3, end: 5, text: 'Hi', font: 'sans', color: '#fff', opacity: 1, box: false, x: 0.5, y: 0.5, size: 0.1, rotation: 0 },
    ],
    audio: [],
  };
  const s = buildExportSpec(p, { resolution: 720, fps: 30, output: 'file:///o.mp4' }, (a) => a.path);
  assert.deepEqual(
    s.clips.map((c) => [c.still, c.transition, c.kenBurns]),
    [
      [false, 0, 0], // the first clip has nothing to fade from
      [true, 3, 0.15], // clamped to the shorter clip
    ],
  );

  // 0.5 s from t = 5.5: the photo only, 1.5 s into it.
  const slice = sliceSpec(s, 5.5, 0.5);
  assert.equal(slice.duration, 0.5);
  assert.deepEqual(slice.audio, []);
  assert.deepEqual(
    slice.clips.map((c) => [c.uri, c.start, c.duration, c.sourceIn, c.sourceOut, c.transition]),
    [['media/i.jpg', 0, 0.5, 1.5, 2, 0]],
  );
  // The fade-in envelope moves with the slice (it began at 4, so -1.5 now).
  assert.deepEqual(slice.clips[0].envelope.slice(0, 4), [-1.5, 0, -0.5, 1]);
  // Ken Burns continues from where the full clip is at 1.5 / 3: same absolute scale at both ends.
  const c = slice.clips[0];
  const scaleAt = (k: number, base: number, p: number) => base * (1 + k * p);
  assert.ok(Math.abs(scaleAt(c.kenBurns, c.transform.scale, 0) - (1 + 0.15 * 0.5)) < 1e-9);
  assert.ok(Math.abs(scaleAt(c.kenBurns, c.transform.scale, 1) - (1 + 0.15 * (2 / 3))) < 1e-9);
  // Texts shift with the slice; ones outside it are dropped.
  assert.deepEqual(slice.texts, []);
  assert.deepEqual(
    sliceSpec(s, 3.5, 0.25).texts.map((t) => [t.start, t.end]),
    [[-0.5, 1.5]],
  );
  // A slice across the cut keeps both clips, trimmed to it.
  assert.deepEqual(
    sliceSpec(s, 3.8, 0.4).clips.map((c) => [Number(c.start.toFixed(9)), Number(c.duration.toFixed(9)), Number(c.sourceIn.toFixed(9))]),
    [
      [0, 0.2, 5.8],
      [0.2, 0.2, 0],
    ],
  );
});

test('effect pixels are resolved once per scene and survive export resolution, slicing and legacy documents', () => {
  const project: Project = {
    schema: 2, id: 'effects', name: 'Effects', createdAt: 0, updatedAt: 0, aspect: '9:16',
    assets: { image: { id: 'image', kind: 'image', path: 'media/test.jpg', name: 'Test', duration: 600, width: 1080, height: 1920 } },
    main: [
      { id: 'one', assetId: 'image', in: 0, out: 3, speed: 1, volume: 0, effects: { vignette: .5, grain: .7, lightLeak: 2 } },
      { id: 'two', assetId: 'image', in: 0, out: 3, speed: 1, volume: 0, transition: 1 },
    ], texts: [], audio: [],
  };
  const spec = buildExportSpec(project, { resolution: 1080, fps: 30, output: '' }, asset => asset.path);
  assert.deepEqual(spec.clips[0].effects, effectPrimitives({ vignette: .5, grain: .7, lightLeak: 1 }, effectSeed('image'), 9 / 16));
  assert.deepEqual(spec.clips[1].effects, [], 'old clips remain unmodified');
  const small = buildExportSpec(project, { resolution: 720, fps: 24, output: '' }, asset => asset.path);
  assert.deepEqual(spec.clips[0].effects, small.clips[0].effects, 'normalized texture is resolution independent');
  assert.deepEqual(sliceSpec(spec, 1.3, .1).clips[0].effects, spec.clips[0].effects, 'saving/freeze-frame slices keep the exact grain seed');
  assert.deepEqual(sliceSpec(spec, 2.8, .4).clips.map(clip => clip.effects), spec.clips.map(clip => clip.effects), 'both scenes keep their own effects across a sliced cut');
  const duplicated = { ...project, main: [...project.main, { ...project.main[0], id: 'new-clip-id' }] };
  const duplicateSpec = buildExportSpec(duplicated, { resolution: 1080, fps: 30, output: '' }, asset => asset.path);
  assert.deepEqual(duplicateSpec.clips[0].effects, duplicateSpec.clips[2].effects, 'new clip IDs after splitting/duplication retain the source texture');
});
