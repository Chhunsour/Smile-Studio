/// <reference types="node" />
// Run with: npm test  (node --test, native TypeScript type stripping)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AudioClip, TextAnim, TextOverlay, VideoClip } from './types.ts';
import { ANIMATION_PRESETS, TEXT_STYLE_PRESETS } from '../editor/text-presets.ts';
import {
  assignLanes,
  audioEnd,
  centeredCrop,
  clipStarts,
  crossfadeWeight,
  fadeEnvelope,
  fadeGain,
  fitFrame,
  KEN_BURNS_ZOOM,
  kenBurnsScale,
  locate,
  moveItem,
  newClip,
  PHOTO_DURATION,
  PHOTO_MAX,
  snap,
  splitAt,
  splitAudio,
  splitText,
  textAnimAt,
  totalDuration,
  trimAudio,
  trimClip,
  trimText,
  transitionLength,
} from './timeline.ts';

const clip = (id: string, inP: number, out: number, speed = 1): VideoClip => ({
  id,
  assetId: 'a',
  in: inP,
  out,
  speed,
  volume: 1,
});

test('layout and duration respect speed', () => {
  const main = [clip('a', 0, 4), clip('b', 2, 6, 2)];
  assert.deepEqual(clipStarts(main), [0, 4]);
  assert.equal(totalDuration(main), 6);
});

test('locate maps timeline time to source time', () => {
  const main = [clip('a', 1, 5), clip('b', 10, 14, 2)];
  assert.deepEqual(locate(main, 2), { index: 0, clip: main[0], start: 0, source: 3 });
  const hit = locate(main, 5)!;
  assert.equal(hit.index, 1);
  assert.equal(hit.source, 12);
  // Past the end clamps to the last frame of the last clip.
  assert.equal(locate(main, 99)!.source, 14);
  assert.equal(locate([], 1), null);
});

test('split creates two contiguous clips and refuses tiny pieces', () => {
  const main = [clip('a', 0, 4), clip('b', 0, 2)];
  const out = splitAt(main, 1.5, 'n')!;
  assert.equal(out.length, 3);
  assert.deepEqual([out[0].in, out[0].out, out[1].in, out[1].out], [0, 1.5, 1.5, 4]);
  assert.equal(out[1].id, 'n');
  assert.equal(totalDuration(out), totalDuration(main));
  assert.equal(splitAt(main, 0.05, 'x'), null);
  assert.equal(splitAt(main, 4, 'x'), null);
});

test('trim clamps to asset bounds and minimum length', () => {
  const c = clip('a', 1, 3);
  assert.equal(trimClip(c, 'in', -5, 10).in, 0);
  assert.equal(trimClip(c, 'in', 9, 10).in, 2.9);
  assert.equal(trimClip(c, 'out', 50, 10).out, 10);
  assert.ok(Math.abs(trimClip(c, 'out', 0, 10).out - 1.1) < 1e-9);
});

test('moveItem and snap', () => {
  assert.deepEqual(moveItem([1, 2, 3, 4], 0, 2), [2, 3, 1, 4]);
  assert.deepEqual(moveItem([1, 2, 3], 2, 0), [3, 1, 2]);
  assert.equal(snap(4.96, [0, 5, 10], 0.1), 5);
  assert.equal(snap(4.5, [0, 5, 10], 0.1), 4.5);
});

test('lanes stack only overlapping items', () => {
  const { lanes, count } = assignLanes([
    { id: 'a', start: 0, end: 3 },
    { id: 'b', start: 1, end: 2 },
    { id: 'c', start: 3, end: 5 },
  ]);
  assert.deepEqual(lanes, { a: 0, b: 1, c: 0 });
  assert.equal(count, 2);
});

test('text and audio trims respect bounds', () => {
  const t: TextOverlay = {
    id: 't',
    start: 2,
    end: 5,
    text: '',
    font: 'sans',
    color: '#fff',
    opacity: 1,
    box: false,
    x: 0.5,
    y: 0.5,
    size: 0.06,
    rotation: 0,
  };
  assert.equal(trimText(t, 'start', -1).start, 0);
  assert.ok(Math.abs(trimText(t, 'start', 9).start - 4.9) < 1e-9);
  assert.equal(trimText(t, 'end', 8).end, 8);
  const a: AudioClip = { id: 'a', assetId: 'x', start: 4, in: 1, out: 6, volume: 1 };
  // Dragging the left edge earlier can only reveal as much source as exists before the in-point.
  assert.deepEqual(trimAudio(a, 'start', 0, 10), { ...a, start: 3, in: 0 });
  assert.deepEqual(trimAudio(a, 'start', 5, 10), { ...a, start: 5, in: 2 });
  assert.equal(trimAudio(a, 'end', 100, 10).out, 10);
  assert.equal(audioEnd(a), 9);
});

test('fitFrame contains the cropped frame', () => {
  assert.deepEqual(fitFrame({ width: 1920, height: 1080 }, undefined, 900, 1600), { w: 900, h: 506.25 });
  assert.deepEqual(fitFrame({ width: 1920, height: 1080 }, { x: 0.25, y: 0, w: 0.5, h: 1 }, 900, 1600).w, 900);
});

test('centeredCrop keeps the largest centered rect', () => {
  assert.deepEqual(centeredCrop(1920, 1080, 1), { x: 0.21875, y: 0, w: 0.5625, h: 1 });
  const c = centeredCrop(1080, 1920, 1);
  assert.ok(Math.abs(c.h - 0.5625) < 1e-9 && Math.abs(c.y - 0.21875) < 1e-9 && c.w === 1);
});

test('split keeps fades and animations at the outer ends', () => {
  const faded = { ...clip('a', 0, 4), fadeIn: 1, fadeOut: 1 };
  const [l, r] = splitAt([faded], 2, 'b')!;
  assert.deepEqual([l.fadeIn, l.fadeOut, r.fadeIn, r.fadeOut], [1, undefined, undefined, 1]);

  const t = { id: 't', start: 1, end: 5, animIn: 'fade', animOut: 'pop' } as TextOverlay;
  const [tl, tr] = splitText(t, 2, 'u')!;
  assert.deepEqual([tl.start, tl.end, tl.animIn, tl.animOut], [1, 2, 'fade', undefined]);
  assert.deepEqual([tr.id, tr.start, tr.end, tr.animIn, tr.animOut], ['u', 2, 5, undefined, 'pop']);
  assert.equal(splitText(t, 1.05, 'u'), null);

  const a: AudioClip = { id: 'a', assetId: 'm', start: 10, in: 3, out: 9, volume: 1, fadeIn: 1, fadeOut: 2 };
  const [al, ar] = splitAudio(a, 12, 'b')!;
  assert.deepEqual([al.start, al.in, al.out, al.fadeOut], [10, 3, 5, undefined]);
  assert.deepEqual([ar.start, ar.in, ar.out, ar.fadeIn, ar.fadeOut], [12, 5, 9, undefined, 2]);
  assert.equal(splitAudio(a, 15.95, 'b'), null);
});

test('fade gain ramps linearly and matches the export envelope', () => {
  assert.equal(fadeGain(0, 10, 2, 4), 0);
  assert.equal(fadeGain(1, 10, 2, 4), 0.5);
  assert.equal(fadeGain(5, 10, 2, 4), 1);
  assert.equal(fadeGain(8, 10, 2, 4), 0.5);
  assert.equal(fadeGain(10, 10, 2, 4), 0);
  assert.equal(fadeGain(3, 10), 1);
  // Overlong fades shrink proportionally so the peak still reaches 1.
  assert.equal(fadeGain(2, 3, 4, 2), 1);
  assert.deepEqual(fadeEnvelope(5, 10, 2, 0), [5, 0, 7, 1, 15, 1, 15, 1]);
  assert.deepEqual(fadeEnvelope(5, 10), []);
});

test('text animations settle to the identity inside the text', () => {
  const o = { start: 2, end: 6, animIn: 'slide', animOut: 'pop' } as const;
  assert.deepEqual(textAnimAt(o, 4), { alpha: 1, scale: 1, dy: 0 });
  const enter = textAnimAt(o, 2);
  assert.equal(enter.alpha, 0);
  assert.ok(enter.dy > 0); // starts below
  const mid = textAnimAt(o, 2.25);
  assert.ok(mid.alpha > 0 && mid.alpha < 1 && mid.dy > 0 && mid.dy < enter.dy);
  const leave = textAnimAt(o, 6);
  assert.equal(leave.alpha, 0);
  assert.ok(Math.abs(leave.scale - 0.4) < 1e-9);
  // Pop overshoots on the way.
  assert.ok(textAnimAt(o, 5.8).scale > 1);
  assert.deepEqual(textAnimAt({ start: 0, end: 1 }, 0), { alpha: 1, scale: 1, dy: 0 });
});

test('all text animations are stable, settle fully, and mirror their exit phase', () => {
  for (const { id } of ANIMATION_PRESETS) {
    const overlay = { start: 2, end: 6, animIn: id, animOut: id };
    assert.deepEqual(textAnimAt(overlay, 2.5), { alpha: 1, scale: 1, dy: 0 }, id);
    assert.deepEqual(textAnimAt(overlay, 5.5), { alpha: 1, scale: 1, dy: 0 }, id);
    assert.equal(textAnimAt(overlay, 2).alpha, id === 'none' ? 1 : 0, id);
    assert.equal(textAnimAt(overlay, 6).alpha, id === 'none' ? 1 : 0, id);
    for (let frame = -10; frame <= 60; frame++) {
      const elapsed = frame / 100;
      const enter = textAnimAt(overlay, 2 + elapsed);
      const leave = textAnimAt(overlay, 6 - elapsed);
      assert.ok(Number.isFinite(enter.alpha) && enter.alpha >= 0 && enter.alpha <= 1, id);
      assert.ok(Number.isFinite(enter.scale) && enter.scale > 0 && enter.scale <= 1.5, id);
      assert.ok(Number.isFinite(enter.dy) && Math.abs(enter.dy) <= 0.1, id);
      assert.ok(Math.abs(enter.alpha - leave.alpha) < 1e-12, id);
      assert.ok(Math.abs(enter.scale - leave.scale) < 1e-12, id);
      assert.ok(Math.abs(enter.dy + leave.dy) < 1e-12, id);
    }
    assert.deepEqual(textAnimAt({ ...overlay, start: 0, end: 0.2 }, 0.1), { alpha: 1, scale: 1, dy: 0 }, id);
    assert.deepEqual(textAnimAt({ ...overlay, end: 2 }, 2), { alpha: 1, scale: 1, dy: 0 }, id);
  }
});

test('new text motions have distinct direction, zoom, bounce, and pulse curves', () => {
  const at = (animation: TextAnim, progress: number) => textAnimAt({ start: 0, end: 4, animIn: animation }, progress * 0.5);
  assert.ok(at('slide', 0.5).dy > 0);
  assert.ok(at('slideDown', 0.5).dy < 0);
  assert.equal(at('slide', 0.5).dy, -at('slideDown', 0.5).dy);
  assert.ok(at('rise', 0.5).dy > at('slide', 0.5).dy);
  assert.ok(at('zoomIn', 0.5).scale < 1);
  assert.ok(at('zoomOut', 0.5).scale > 1);
  assert.ok(at('bounce', 1 / 2.75).scale > at('bounce', 1.5 / 2.75).scale);
  assert.ok(at('pulse', 1 / 6).scale > 1);
  assert.ok(at('pulse', 0.5).scale < 1);
});

test('text preset catalogs are immutable and every style uses an available animation', () => {
  assert.equal(ANIMATION_PRESETS.length, 10);
  assert.equal(TEXT_STYLE_PRESETS.length, 20);
  assert.ok(Object.isFrozen(ANIMATION_PRESETS));
  assert.ok(Object.isFrozen(TEXT_STYLE_PRESETS));
  assert.equal(new Set(ANIMATION_PRESETS.map(({ id }) => id)).size, ANIMATION_PRESETS.length);
  assert.equal(new Set(TEXT_STYLE_PRESETS.map(({ label }) => label)).size, TEXT_STYLE_PRESETS.length);
  const animationIds = new Set<TextAnim>(ANIMATION_PRESETS.map(({ id }) => id));
  for (const preset of ANIMATION_PRESETS) assert.ok(Object.isFrozen(preset));
  for (const preset of TEXT_STYLE_PRESETS) {
    assert.ok(Object.isFrozen(preset));
    assert.ok(Object.isFrozen(preset.style));
    assert.ok(animationIds.has(preset.style.animIn));
    assert.ok(animationIds.has(preset.style.animOut));
    assert.ok(preset.style.size > 0 && preset.style.size <= 0.2);
    assert.ok(preset.style.x >= 0 && preset.style.x <= 1);
    assert.ok(preset.style.y >= 0 && preset.style.y <= 1);
  }
});

test('photos get a default length; crossfades clamp; Ken Burns zooms linearly', () => {
  const img = { id: 'i', kind: 'image' as const, path: 'p', name: 'i', duration: PHOTO_MAX, width: 1, height: 1 };
  assert.equal(newClip(img, 'c').out, PHOTO_DURATION);
  assert.equal(newClip({ ...img, kind: 'video', duration: 7 }, 'c').out, 7);

  const main: VideoClip[] = [clip('a', 0, 4), { ...clip('b', 0, 1), transition: 2 }, { ...clip('c', 0, 5), transition: 0.5 }];
  assert.equal(transitionLength(main, 0), 0);
  assert.equal(transitionLength(main, 1), 1);
  assert.equal(transitionLength(main, 2), 0.5);

  assert.equal(crossfadeWeight(3.4, 4, 1), null);
  assert.equal(crossfadeWeight(3.5, 4, 1), 0);
  assert.equal(crossfadeWeight(4, 4, 1), 0.5);
  assert.equal(crossfadeWeight(4.5, 4, 1), 1);
  assert.equal(crossfadeWeight(4, 4, 0), null);

  assert.equal(kenBurnsScale(0, 2), 1);
  assert.ok(Math.abs(kenBurnsScale(1, 2) - (1 + KEN_BURNS_ZOOM / 2)) < 1e-12);
  assert.equal(kenBurnsScale(5, 2), 1 + KEN_BURNS_ZOOM);
});
