import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyTransitionPreset, splitAtMarkers, trimAtPlayhead } from './quick-edit.ts';
import { EDIT_TEMPLATES, applyEditTemplate } from './templates.ts';
import { buildExportSpec } from './export.ts';
import { totalDuration } from './timeline.ts';
import type { Project } from './types.ts';

const fixture = (): Project => ({
  schema: 2, id: 'p', name: 'Test', createdAt: 0, updatedAt: 0, aspect: 'original',
  assets: { video: { id: 'video', kind: 'video', path: 'media/test.mp4', name: 'Video', width: 1920, height: 1080, duration: 30 } },
  main: [{ id: 'a', assetId: 'video', in: 2, out: 10, speed: 2, volume: .5, fadeIn: .5, fadeOut: 1, transition: .5 }],
  texts: [], audio: [],
});

test('quick trims convert timeline position to source time and retain appropriate outer fades', () => {
  const project = fixture();
  const before = trimAtPlayhead(project, 'a', 1, 'before');
  assert.equal(before.main[0].in, 4);
  assert.equal(before.main[0].fadeIn, undefined);
  assert.equal(before.main[0].fadeOut, 1);
  assert.equal(before.main[0].transition, undefined);
  const after = trimAtPlayhead(project, 'a', 1, 'after');
  assert.equal(after.main[0].out, 4);
  assert.equal(after.main[0].fadeOut, undefined);
  assert.equal(project.main[0].in, 2);
  assert.throws(() => trimAtPlayhead(project, 'a', 0, 'before'));
  assert.throws(() => trimAtPlayhead(project, 'a', NaN, 'after'));
  assert.equal(trimAtPlayhead(project, 'missing', 2, 'before'), project);
});

test('marker cutting is bounded, keeps timing, skips close markers and preserves only outer treatments', () => {
  const project = { ...fixture(), markers: [0, 1, 1.01, 2, 4, 100, NaN, 1] };
  let next = 0;
  const result = splitAtMarkers(project, () => `new-${++next}`);
  assert.equal(result.added, 2);
  assert.deepEqual(result.project.main.map(clip => [clip.in, clip.out]), [[2, 4], [4, 6], [6, 10]]);
  assert.equal(totalDuration(result.project.main), totalDuration(project.main));
  assert.deepEqual(result.project.main.map(clip => clip.fadeIn), [.5, undefined, undefined]);
  assert.deepEqual(result.project.main.map(clip => clip.fadeOut), [undefined, undefined, 1]);
  assert.deepEqual(result.project.main.map(clip => clip.transition), [.5, undefined, undefined]);
  assert.equal(splitAtMarkers(result.project, () => 'unused').added, 0);
  const large = fixture(); large.main[0] = { ...large.main[0], in: 0, out: 20, speed: 1 };
  large.markers = Array.from({ length: 150 }, (_, index) => .11 * (index + 1));
  assert.throws(() => splitAtMarkers(large, () => 'id'), /128/);
  assert.equal(large.main.length, 1);
});

test('each template produces exportable editable treatments and preserves existing content', () => {
  let next = 0;
  for (const template of EDIT_TEMPLATES) {
    const project = fixture();
    const result = applyEditTemplate(project, template.id, '  Hello 🇰🇭  ', () => `title-${++next}`);
    assert.equal(totalDuration(result.main), totalDuration(project.main));
    assert.equal(result.main[0].volume, .5);
    assert.equal(result.main[0].in, 2);
    assert.equal(result.texts[0].text, 'Hello 🇰🇭');
    assert.equal(result.texts[0].end, 3);
    const spec = buildExportSpec(result, { resolution: 720, fps: 30, output: 'file:///out.mp4' }, asset => `file:///${asset.path}`);
    assert.equal(spec.texts.length, 1);
    assert.ok(spec.width > 0 && spec.height > 0);
    assert.equal(project.texts.length, 0);
    const twice = applyEditTemplate(result, template.id, '', () => 'unused');
    assert.equal(twice.texts.length, 0);
  }
  assert.throws(() => applyEditTemplate(fixture(), 'unknown', 'Title', () => 'id'));
  assert.throws(() => applyEditTemplate({ ...fixture(), main: [] }, 'daily', '', () => 'id'));
  const short = fixture(); short.main[0] = { ...short.main[0], in: 0, out: .04, speed: 1 };
  assert.equal(applyEditTemplate(short, 'daily', 'A frame', () => 'short-title').texts[0].end, .04);
});

test('switching templates replaces its opening title and preserves authored text', () => {
  const project = fixture();
  let next = 0;
  const first = applyEditTemplate(project, 'daily', 'My day', () => `title-${++next}`);
  const authored = { ...first.texts[0], id: 'authored', text: 'My subtitle', templateTitle: undefined };
  first.texts.push(authored);
  const second = applyEditTemplate(first, 'cinema', 'My film', () => `title-${++next}`);
  assert.equal(second.texts.length, 2);
  assert.equal(second.texts.find(text => text.templateTitle)!.id, first.texts[0].id);
  assert.equal(second.texts.find(text => text.templateTitle)!.text, 'My film');
  assert.equal(second.texts.find(text => text.id === 'authored'), authored);
  const third = applyEditTemplate(second, 'daily', '', () => 'unused');
  assert.deepEqual(third.texts, [authored]);
  assert.equal(first.texts[0].text, 'My day');
});

test('transition presets remove both sides of their dip when switching back to a cut or dissolve', () => {
  const project = fixture(); project.main.push({ ...project.main[0], id: 'b', fadeIn: undefined });
  const dip = applyTransitionPreset(project, 'b', 'dip');
  assert.equal(dip.main[0].fadeOut, .3);
  assert.equal(dip.main[1].fadeIn, .3);
  assert.equal(dip.main[1].transition, undefined);
  for (const duration of [0, .5]) {
    const result = applyTransitionPreset(dip, 'b', duration);
    assert.equal(result.main[0].fadeOut, undefined);
    assert.equal(result.main[1].fadeIn, undefined);
    assert.equal(result.main[1].transition, duration || undefined);
  }
  assert.equal(applyTransitionPreset(project, 'a', 'dip'), project);
  assert.equal(project.main[0].fadeOut, 1);
  assert.throws(() => applyTransitionPreset(project, 'b', Infinity));
});
