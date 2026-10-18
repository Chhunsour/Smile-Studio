/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { addCaptions, CAPTION_STYLES, captionTime, cleanCaptionText, duplicateCaption, editCaption, exportSrt, MAX_CAPTIONS, MAX_SUBTITLE_BYTES, parseCaptionTime, parseSubtitles, projectCaptions, segmentCaption, shiftCaptions, styleCaptions, suggestCaptionSegments } from './captions.ts';
import type { Project, TextOverlay } from './types.ts';

const project = (duration = 10): Project => ({ schema: 2, id: 'project', name: 'Khmer reel', createdAt: 1, updatedAt: 1, aspect: '9:16', assets: { asset: { id: 'asset', kind: 'video', path: 'media/test.mp4', name: 'test.mp4', duration, width: 1080, height: 1920 } }, main: [{ id: 'clip', assetId: 'asset', in: 0, out: duration, speed: 1, volume: 1 }], texts: [], audio: [] });
const ids = () => { let next = 0; return () => `caption-${++next}`; };
const captioned = () => addCaptions(project(), [{ start: 1, end: 3, text: 'សួស្តី Smile' }, { start: 4, end: 6, text: 'A second caption' }], { id: ids() }).project;
const legacy = (): TextOverlay => ({ ...CAPTION_STYLES[0].style, id: 'legacy', start: 0, end: 10, text: 'A legacy title' });

test('SRT imports BOM, CRLF, Khmer multiline text and supported markup', () => {
  const source = '\uFEFF1\r\n00:00:01,250 --> 00:00:03,750\r\n<b>សួស្តី</b> &amp; Smile\r\n<i>Second line</i>\r\n\r\n2\r\n00:00:04,000 --> 00:00:05,000\r\n&lt;b&gt;literal&lt;/b&gt;';
  const parsed = parseSubtitles(source);
  assert.equal(parsed.warnings.length, 0);
  assert.deepEqual(parsed.cues, [{ start: 1.25, end: 3.75, text: 'សួស្តី & Smile\nSecond line' }, { start: 4, end: 5, text: '<b>literal</b>' }]);
  const imported = addCaptions(project(), parsed.cues, { id: ids() }).project;
  assert.equal(imported.texts[1].text, '<b>literal</b>', 'decoded literal angle brackets are not interpreted a second time');
  assert.ok(imported.texts.every((caption) => caption.caption === true));
});

test('WebVTT reads short timestamps, identifiers/settings and skips metadata', () => {
  const parsed = parseSubtitles('WEBVTT\n\nNOTE a comment\nignore me\n\nSTYLE\n::cue { color: white; }\n\nfirst-cue\n00:01.5 --> 00:03.250 align:center line:90%\n<v Speaker><c.highlight>កម្ពុជា</c></v>\n\n00:00:04.000 --> 00:00:05.000\nHello');
  assert.equal(parsed.warnings.length, 0);
  assert.deepEqual(parsed.cues, [{ start: 1.5, end: 3.25, text: 'កម្ពុជា' }, { start: 4, end: 5, text: 'Hello' }]);
  assert.equal(parseCaptionTime('01:02:03.45'), 3723.45);
  assert.equal(parseCaptionTime('02:03'), 123);
  assert.equal(parseCaptionTime('2.5'), 2.5);
  assert.equal(captionTime(59.9998, ','), '00:01:00,000', 'millisecond carry produces valid timestamps');
});

test('malformed cues produce explicit warnings and unsafe sizes/counts fail', () => {
  const mixed = parseSubtitles('1\n00:99:00,000 --> 00:00:02,000\nInvalid\n\n2\n00:00:02,000 --> 00:00:03,000\nValid\n\n3\n00:00:04,000 --> 00:00:04,001\nToo short\n\nmissing timing');
  assert.equal(mixed.cues.length, 1);
  assert.equal(mixed.warnings.length, 3);
  assert.throws(() => parseSubtitles('plain text'), /No readable/);
  assert.throws(() => parseSubtitles('1\n00:00:03,000 --> 00:00:02,000\nBackwards'), /No readable/);
  assert.throws(() => parseSubtitles('x'.repeat(MAX_SUBTITLE_BYTES + 1)), /1 MB/);
  assert.throws(() => parseSubtitles('ក'.repeat(Math.ceil(MAX_SUBTITLE_BYTES / 3) + 1)), /1 MB/, 'limits count UTF-8 bytes for Khmer files');
  assert.throws(() => parseSubtitles(Array.from({ length: MAX_CAPTIONS + 1 }, (_, i) => `${i}\n00:00:01,000 --> 00:00:02,000\nCaption`).join('\n\n')), /up to 500/);
  for (const value of ['Infinity', '-1', '00:60.000', '99:00:00.000', '', 'NaN']) assert.throws(() => parseCaptionTime(value));
  assert.throws(() => cleanCaptionText('x'.repeat(2001)), /2000/);
  assert.equal(cleanCaptionText('A&#x1F600;&#0;\u0000B'), 'A😀B');
});

test('append imports clips to video bounds with counts while preserving legacy titles', () => {
  const original = { ...project(), texts: [legacy()] };
  const result = addCaptions(original, [{ start: 1, end: 2, text: 'First' }, { start: 9, end: 12, text: 'Clipped' }, { start: 14, end: 15, text: 'Skipped' }], { id: ids() });
  assert.equal(result.added, 2); assert.equal(result.clipped, 1); assert.equal(result.skipped, 1);
  assert.equal(result.project.texts[0], original.texts[0], 'ordinary saved texts remain unchanged');
  assert.equal(result.project.texts[2].end, 10);
  assert.equal(original.texts.length, 1, 'the old undo snapshot remains immutable');
  const shifted = addCaptions(project(), [{ start: 1, end: 3, text: 'Shifted' }], { offset: -2, id: ids() });
  assert.deepEqual([shifted.project.texts[0].start, shifted.project.texts[0].end, shifted.clipped], [0, 1, 1]);
  assert.throws(() => addCaptions(project(), [{ start: 11, end: 12, text: 'Outside' }]), /All captions are outside/);
  assert.throws(() => addCaptions({ ...project(), main: [] }, [{ start: 1, end: 2, text: 'No footage' }]), /Add video/);
});

test('collisions and duplicate identifiers fail atomically instead of replacing captions', () => {
  const original = captioned(), snapshot = JSON.stringify(original);
  assert.throws(() => addCaptions(original, [{ start: 2, end: 3.5, text: 'Collision' }]), /overlap/);
  assert.throws(() => addCaptions(project(), [{ start: 0, end: 2, text: 'First' }, { start: 1, end: 3, text: 'Overlap' }]), /overlap/);
  assert.throws(() => addCaptions(original, [{ start: 7, end: 8, text: 'Duplicate ID' }], { id: () => original.texts[0].id }), /identifier/);
  assert.throws(() => addCaptions(project(), [{ start: 1, end: 2, text: 'One' }, { start: 2, end: 3, text: 'Two' }], { id: () => 'same' }), /identifier/);
  assert.equal(JSON.stringify(original), snapshot);
  const touching = addCaptions(project(), [{ start: 0, end: 1, text: 'One' }, { start: 1, end: 2, text: 'Two' }]);
  assert.equal(touching.added, 2, 'adjacent cues can share a cut boundary');
});

test('editing and batch timing validate bounds/collisions and keep styling', () => {
  const original = captioned(), first = original.texts[0];
  const edited = editCaption(original, first.id, { text: 'A revised caption', start: .5 });
  assert.equal(edited.texts[0].text, 'A revised caption');
  assert.equal(edited.texts[0].box, true);
  assert.equal(edited.texts[1], original.texts[1]);
  assert.equal(editCaption(original, first.id, { text: first.text }), original, 'unchanged edits do not create undo steps');
  assert.throws(() => editCaption(original, first.id, { end: 5 }), /overlap/);
  assert.throws(() => editCaption(original, first.id, { start: -.1 }), /inside the video/);
  assert.throws(() => editCaption(original, first.id, { end: 11 }), /inside the video/);
  assert.throws(() => editCaption(original, first.id, { text: ' ' }), /empty/);
  const shifted = shiftCaptions(original, .5);
  assert.deepEqual(shifted.texts.map((text) => [text.start, text.end]), [[1.5, 3.5], [4.5, 6.5]]);
  assert.throws(() => shiftCaptions(original, -2), /inside the video/);
  assert.throws(() => shiftCaptions(original, Infinity), /offset/);
  assert.deepEqual(original.texts.map((text) => [text.start, text.end]), [[1, 3], [4, 6]]);
});

test('batch styles affect captions only and reject unsafe style properties', () => {
  const original = { ...captioned(), texts: [...captioned().texts, legacy()] };
  const styled = styleCaptions(original, CAPTION_STYLES[2].style);
  assert.equal(styled.texts[0].color, '#FFD23F');
  assert.equal(styled.texts[0].text, original.texts[0].text);
  assert.equal(styled.texts[2], original.texts[2]);
  assert.throws(() => styleCaptions(original, { color: 'url(evil)' }), /color/);
  assert.throws(() => styleCaptions(original, { size: Infinity }), /size/);
  assert.throws(() => styleCaptions(original, { x: -1 }), /x/);
});

test('caption duplication finds the next full free gap, preserves styling and touches exact boundaries', () => {
  const original = { ...captioned(), texts: [...captioned().texts, legacy()] };
  const styled = styleCaptions(original, { color: '#FFD23F', rotation: -4 });
  const duplicated = duplicateCaption(styled, styled.texts[0].id, () => 'caption-copy');
  const copy = duplicated.texts.at(-1)!;
  assert.deepEqual([copy.start, copy.end], [6, 8], 'the 3–4s gap is too short for the 2s caption');
  assert.deepEqual(copy, { ...styled.texts[0], id: 'caption-copy', start: 6, end: 8 });
  assert.equal(duplicated.texts[2], styled.texts[2], 'legacy text can overlap the copy and stays unchanged');
  assert.equal(styled.texts.length, 3, 'the old history snapshot is untouched');
  const atEnd = duplicateCaption(duplicated, 'caption-copy', () => 'caption-at-end');
  assert.deepEqual([atEnd.texts.at(-1)!.start, atEnd.texts.at(-1)!.end], [8, 10]);
  assert.equal(parseSubtitles(exportSrt(atEnd)).cues.length, 4, 'copies remain valid portable captions');
});

test('caption duplication rejects unavailable space, count and duplicate IDs without changing the project', () => {
  const original = captioned(), snapshot = JSON.stringify(original);
  assert.throws(() => duplicateCaption(original, original.texts[0].id, () => original.main[0].id), /identifier/);
  const occupied = addCaptions(project(6), [{ start: 0, end: 2, text: 'One' }, { start: 2, end: 4, text: 'Two' }, { start: 4, end: 6, text: 'Three' }], { id: ids() }).project;
  assert.throws(() => duplicateCaption(occupied, occupied.texts[0].id), /no room/);
  assert.throws(() => duplicateCaption({ ...original, main: [{ ...original.main[0], out: 7 }] }, original.texts[0].id), /no room/, 'copies never silently shorten at the video boundary');
  const full = addCaptions(project(1002), Array.from({ length: MAX_CAPTIONS }, (_, index) => ({ start: index * 2, end: index * 2 + 1, text: 'Caption' })), { id: ids() }).project;
  assert.throws(() => duplicateCaption(full, full.texts[0].id, () => 'one-too-many'), /up to 500/);
  assert.equal(JSON.stringify(original), snapshot);
  assert.equal(occupied.texts.length, 3);
  assert.equal(full.texts.length, MAX_CAPTIONS);
});

test('segmentation preserves caption coverage, identities, style and valid minimum durations', () => {
  const original = captioned(), first = original.texts[0];
  const segmented = segmentCaption(original, first.id, ['សួស្តី', 'Smile'], () => 'new-caption');
  const parts = projectCaptions(segmented).slice(0, 2);
  assert.equal(parts[0].id, first.id); assert.equal(parts[1].id, 'new-caption');
  assert.equal(parts[0].start, first.start); assert.equal(parts[0].end, parts[1].start); assert.equal(parts[1].end, first.end);
  assert.ok(parts.every((part) => part.caption && part.box && part.end - part.start >= .1));
  assert.throws(() => segmentCaption(original, first.id, ['One', 'Two'], () => original.texts[1].id), /identifier/);
  assert.throws(() => segmentCaption(original, first.id, ['One']), /2–20/);
});

test('Khmer and emoji segmentation keeps graphemes intact with native and fallback segmentation', () => {
  const khmer = 'កម្ពុជា'.repeat(20), emoji = '👩🏽‍💻'.repeat(20);
  assert.equal(suggestCaptionSegments(khmer, 12).join(''), khmer);
  assert.equal(suggestCaptionSegments(emoji, 8).join(''), emoji);
  const descriptor = Object.getOwnPropertyDescriptor(Intl, 'Segmenter')!;
  try {
    Object.defineProperty(Intl, 'Segmenter', { configurable: true, value: undefined });
    const parts = suggestCaptionSegments(khmer, 12);
    assert.equal(parts.join(''), khmer);
    assert.ok(parts.every((part) => !/^\p{M}/u.test(part) && !/[\u17d2\u200d]$/.test(part)), 'fallback never separates Khmer coeng or a leading combining mark');
    assert.equal(suggestCaptionSegments(emoji, 8).join(''), emoji);
    assert.ok(suggestCaptionSegments(emoji, 8).every((part) => Array.from(part).length % 4 === 0), 'fallback keeps emoji modifier and ZWJ sequences intact');
    assert.ok(suggestCaptionSegments('🇰🇭'.repeat(20), 8).every((part) => Array.from(part).length % 2 === 0), 'fallback keeps flag pairs intact');
  } finally { Object.defineProperty(Intl, 'Segmenter', descriptor); }
});

test('SRT exports only caption layers and round trips ordering, Khmer and multiline text', () => {
  const original = { ...captioned(), texts: [...captioned().texts.reverse(), legacy()] };
  const output = exportSrt(original), parsed = parseSubtitles(output);
  assert.equal(output.includes('A legacy title'), false);
  assert.deepEqual(parsed.cues, projectCaptions(original).map(({ start, end, text }) => ({ start, end, text })));
  assert.throws(() => exportSrt(project()), /Add or import/);
  assert.throws(() => exportSrt({ ...original, main: [{ ...original.main[0], out: 2 }] }), /inside the video/);
  const literals = addCaptions(project(), [{ start: 1, end: 3, text: '<b>literal</b> &amp; Smile' }]).project;
  assert.equal(parseSubtitles(exportSrt(literals)).cues[0].text, literals.texts[0].text, 'literal markup and ampersands round-trip without being interpreted');
});

test('caption and UTF-8 export limits reject work atomically with actionable errors', () => {
  const original = project(1000);
  const full = addCaptions(original, Array.from({ length: MAX_CAPTIONS }, (_, index) => ({ start: index * 2, end: index * 2 + 1, text: 'ក'.repeat(1000) })), { id: ids() }).project;
  assert.throws(() => addCaptions(full, [{ start: 999, end: 1000, text: 'One too many' }]), /up to 500/);
  assert.throws(() => segmentCaption(full, full.texts[0].id, ['One', 'Two']), /caption limit/);
  assert.throws(() => exportSrt(full), /1 MB SRT/, 'exports never generate a UTF-8 file too large for the importer');
  assert.equal(original.texts.length, 0);
  assert.equal(full.texts.length, MAX_CAPTIONS);
});
