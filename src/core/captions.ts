import { MIN_CLIP, totalDuration } from './timeline.ts';
import type { Project, TextOverlay } from './types';

export const MAX_CAPTIONS = 500;
export const MAX_CAPTION_TEXT = 2000;
export const MAX_SUBTITLE_BYTES = 1024 * 1024;
export const MAX_CAPTION_TIME = 24 * 60 * 60;
export interface CaptionCue { start: number; end: number; text: string }
export type CaptionStyle = Pick<TextOverlay, 'font' | 'color' | 'opacity' | 'box' | 'x' | 'y' | 'size' | 'rotation' | 'animIn' | 'animOut'>;
export const CAPTION_STYLES: { id: string; name: string; style: CaptionStyle }[] = [
  { id: 'boxed', name: 'Subtitle', style: { font: 'sans', color: '#FFFFFF', opacity: 1, box: true, x: .5, y: .84, size: .05, rotation: 0, animIn: 'none', animOut: 'none' } },
  { id: 'clean', name: 'Clean', style: { font: 'sans', color: '#FFFFFF', opacity: 1, box: false, x: .5, y: .84, size: .055, rotation: 0, animIn: 'none', animOut: 'none' } },
  { id: 'yellow', name: 'Highlight', style: { font: 'rounded', color: '#FFD23F', opacity: 1, box: true, x: .5, y: .82, size: .06, rotation: 0, animIn: 'none', animOut: 'none' } },
  { id: 'bold', name: 'Bold', style: { font: 'condensed', color: '#FFFFFF', opacity: 1, box: true, x: .5, y: .8, size: .075, rotation: 0, animIn: 'none', animOut: 'none' } },
  { id: 'top', name: 'Top', style: { font: 'sans', color: '#FFFFFF', opacity: 1, box: true, x: .5, y: .15, size: .05, rotation: 0, animIn: 'none', animOut: 'none' } },
];

const freshId = () => `caption-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
export const isCaption = (text: TextOverlay) => text.caption === true;
export const projectCaptions = (project: Project) => project.texts.filter(isCaption).sort((a, b) => a.start - b.start || a.end - b.end);

function utf8Bytes(value: string): number {
  let bytes = 0;
  for (const char of value) { const code = char.codePointAt(0)!; bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4; }
  return bytes;
}

/** The native renderer draws plain text; markup is decoded once without touching Khmer clusters. */
export function cleanCaptionText(input: string): string {
  const text = input.replace(/<[^<>\n]{0,256}>/g, '').replace(/&(?:amp|lt|gt|quot|apos|nbsp|lrm|rlm|#\d{1,7}|#x[\da-f]{1,6});/gi, (entity) => {
    const value = entity.slice(1, -1).toLowerCase();
    const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', lrm: '\u200e', rlm: '\u200f' };
    if (named[value] !== undefined) return named[value];
    const number = value.startsWith('#x') ? parseInt(value.slice(2), 16) : parseInt(value.slice(1), 10);
    return number > 0 && number <= 0x10ffff && !(number >= 0xd800 && number <= 0xdfff) ? String.fromCodePoint(number) : '';
  });
  return plainCaptionText(text);
}

function plainCaptionText(input: string): string {
  const text = input.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
  if (!text) throw new Error('Caption text cannot be empty.');
  if (text.length > MAX_CAPTION_TEXT) throw new Error(`Each caption can contain up to ${MAX_CAPTION_TEXT} characters. Split this caption into shorter lines.`);
  return text;
}

export function parseCaptionTime(input: string): number {
  const value = input.trim();
  if (/^\d+(?:\.\d+)?$/.test(value)) {
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds <= MAX_CAPTION_TIME) return seconds;
  }
  const match = value.match(/^(?:(\d{1,3}):)?(\d{2}):(\d{2})(?:[,.](\d{1,3}))?$/);
  if (match && +match[2] < 60 && +match[3] < 60) {
    const seconds = +(match[1] ?? 0) * 3600 + +match[2] * 60 + +match[3] + +(match[4] ?? '0').padEnd(3, '0') / 1000;
    if (seconds <= MAX_CAPTION_TIME) return seconds;
  }
  throw new Error('Use seconds (2.5) or a timestamp such as 00:02.500.');
}

export function captionTime(seconds: number, separator = '.'): string {
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > MAX_CAPTION_TIME) throw new Error('Caption time is outside the supported range.');
  const ms = Math.round(seconds * 1000);
  return `${Math.floor(ms / 3600000).toString().padStart(2, '0')}:${Math.floor(ms / 60000 % 60).toString().padStart(2, '0')}:${Math.floor(ms / 1000 % 60).toString().padStart(2, '0')}${separator}${(ms % 1000).toString().padStart(3, '0')}`;
}

export function parseSubtitles(input: string): { cues: CaptionCue[]; warnings: string[] } {
  if (typeof input !== 'string' || input.length > MAX_SUBTITLE_BYTES || utf8Bytes(input) > MAX_SUBTITLE_BYTES) throw new Error('Subtitle files must be smaller than 1 MB.');
  const blocks = input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim().split(/\n[ \t]*\n/);
  if (blocks.length > MAX_CAPTIONS * 4 + 10) throw new Error('This subtitle file contains too many blocks. Export a shorter subtitle file.');
  const cues: CaptionCue[] = [], warnings: string[] = [];
  for (const [index, block] of blocks.entries()) {
    if (/^(NOTE|STYLE|REGION)(?:\s|$)/.test(block)) continue;
    const lines = block.split('\n'), timing = lines.findIndex((line) => line.includes('-->'));
    if (timing < 0) {
      if (block.trim() && !/^WEBVTT(?:\s|$)/.test(block)) warnings.push(`Block ${index + 1}: no readable caption timing.`);
      continue;
    }
    try {
      const match = lines[timing].match(/^\s*(\S+)\s*-->\s*(\S+)(?:\s+.*)?$/);
      if (!match) throw new Error('invalid timestamp');
      const start = parseCaptionTime(match[1]), end = parseCaptionTime(match[2]);
      if (end - start < MIN_CLIP - 1e-8) throw new Error('end must be at least 0.1 seconds after start');
      cues.push({ start, end, text: cleanCaptionText(lines.slice(timing + 1).join('\n')) });
      if (cues.length > MAX_CAPTIONS) throw new Error(`Subtitle files can contain up to ${MAX_CAPTIONS} captions.`);
    } catch (error) {
      if (cues.length > MAX_CAPTIONS) throw error;
      warnings.push(`Block ${index + 1}: ${error instanceof Error ? error.message : 'invalid caption'}`);
    }
  }
  if (!cues.length) throw new Error('No readable SRT or WebVTT captions were found. Check the timestamps and text.');
  return { cues: cues.sort((a, b) => a.start - b.start || a.end - b.end), warnings };
}

function timelineEnd(project: Project): number {
  const end = totalDuration(project.main);
  if (!Number.isFinite(end) || end < MIN_CLIP) throw new Error('Add video or photos before adding captions.');
  return Math.min(MAX_CAPTION_TIME, end);
}

function validateCue(cue: CaptionCue, end: number): CaptionCue {
  if (!Number.isFinite(cue.start) || !Number.isFinite(cue.end) || cue.start < 0 || cue.end > end + 1e-8 || cue.end - cue.start < MIN_CLIP - 1e-8) throw new Error(`Caption timing must stay inside the video (0 – ${end.toFixed(2)}s), with a minimum duration of 0.1s.`);
  return { start: cue.start, end: Math.min(end, cue.end), text: plainCaptionText(cue.text) };
}

function assertNoCollisions(captions: CaptionCue[]) {
  const sorted = [...captions].sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i++) if (sorted[i].start < sorted[i - 1].end - 1e-7) throw new Error(`Captions overlap near ${captionTime(sorted[i].start)}. Adjust their timing before importing or saving.`);
}

function checkedStyle(style: Partial<CaptionStyle>): Partial<CaptionStyle> {
  const result: Partial<CaptionStyle> = {};
  if (style.font !== undefined) {
    if (!['sans', 'serif', 'mono', 'rounded', 'condensed'].includes(style.font)) throw new Error('Unknown caption font.');
    result.font = style.font;
  }
  if (style.color !== undefined) {
    if (!/^#[\da-f]{6}$/i.test(style.color)) throw new Error('Choose a valid caption color.');
    result.color = style.color;
  }
  for (const key of ['x', 'y', 'size', 'opacity', 'rotation'] as const) if (style[key] !== undefined) {
    const value = style[key]!;
    const min = key === 'rotation' ? -180 : key === 'size' ? .015 : 0;
    const max = key === 'rotation' ? 180 : key === 'size' ? .25 : 1;
    if (!Number.isFinite(value) || value < min || value > max) throw new Error(`Caption ${key} is outside the supported range.`);
    result[key] = value;
  }
  if (style.box !== undefined) result.box = !!style.box;
  for (const key of ['animIn', 'animOut'] as const) if (style[key] !== undefined) {
    if (!['none', 'fade', 'slide', 'pop'].includes(style[key]!)) throw new Error('Unknown caption animation.');
    result[key] = style[key];
  }
  return result;
}

export function addCaptions(project: Project, cues: CaptionCue[], options: { offset?: number; style?: Partial<CaptionStyle>; id?: () => string } = {}): { project: Project; added: number; clipped: number; skipped: number } {
  const end = timelineEnd(project), offset = options.offset ?? 0;
  if (!Number.isFinite(offset) || Math.abs(offset) > MAX_CAPTION_TIME || cues.length > MAX_CAPTIONS) throw new Error('The caption timing or count is outside the supported range.');
  const existing = projectCaptions(project), added: TextOverlay[] = [];
  const ids = new Set([...project.main, ...project.texts, ...project.audio].map((item) => item.id));
  const style = { ...CAPTION_STYLES[0].style, ...checkedStyle(options.style ?? {}) };
  let clipped = 0, skipped = 0;
  for (const cue of cues) {
    if (!Number.isFinite(cue.start) || !Number.isFinite(cue.end) || cue.start < 0 || cue.end - cue.start < MIN_CLIP - 1e-8 || cue.end > MAX_CAPTION_TIME) throw new Error('One caption has invalid timing. Nothing was imported.');
    const start = Math.max(0, cue.start + offset), stop = Math.min(end, cue.end + offset);
    if (stop - start < MIN_CLIP - 1e-8) { skipped++; continue; }
    if (start !== cue.start + offset || stop !== cue.end + offset) clipped++;
    const valid = validateCue({ start, end: stop, text: cue.text }, end);
    const id = (options.id ?? freshId)();
    if (!id || id.length > 128 || ids.has(id)) throw new Error('A caption identifier already exists. Nothing was imported.');
    ids.add(id);
    added.push({ ...style, ...valid, id, caption: true });
  }
  if (!added.length) throw new Error('All captions are outside your video. Change the import offset or extend the main track.');
  if (existing.length + added.length > MAX_CAPTIONS) throw new Error(`A project can contain up to ${MAX_CAPTIONS} captions. Nothing was imported.`);
  assertNoCollisions([...existing, ...added]);
  return { project: { ...project, texts: [...project.texts, ...added] }, added: added.length, clipped, skipped };
}

export function editCaption(project: Project, id: string, patch: Partial<CaptionCue>): Project {
  const original = project.texts.find((text) => text.id === id && isCaption(text));
  if (!original) throw new Error('This caption no longer exists.');
  const cue = validateCue({ ...original, ...patch }, timelineEnd(project));
  if (cue.start === original.start && cue.end === original.end && cue.text === original.text) return project;
  assertNoCollisions([...projectCaptions(project).filter((text) => text.id !== id), cue]);
  return { ...project, texts: project.texts.map((text) => text.id === id ? { ...text, ...cue } : text) };
}

/** Place a full-duration copy in the first free gap after this caption, without replacing another cue. */
export function duplicateCaption(project: Project, id: string, makeId = freshId): Project {
  const original = project.texts.find((text) => text.id === id && isCaption(text));
  if (!original) throw new Error('This caption no longer exists.');
  const end = timelineEnd(project), captions = projectCaptions(project);
  validateCue(original, end);
  assertNoCollisions(captions);
  const duration = original.end - original.start;
  let start = original.end;
  for (const caption of captions) {
    if (caption.end <= start + 1e-8) continue;
    if (caption.start >= start + duration - 1e-8) break;
    start = Math.max(start, caption.end);
  }
  if (start + duration > end + 1e-8) throw new Error('There is no room after this caption for a full copy. Move later captions or extend the video.');
  const result = addCaptions(project, [{ start, end: Math.min(end, start + duration), text: original.text }], { style: original, id: makeId });
  const copy = result.project.texts.at(-1)!;
  return { ...result.project, texts: [...project.texts, { ...original, ...copy }] };
}

export function shiftCaptions(project: Project, offset: number): Project {
  if (!Number.isFinite(offset) || Math.abs(offset) > MAX_CAPTION_TIME) throw new Error('Enter a valid timing offset in seconds.');
  if (offset === 0 || !project.texts.some(isCaption)) return project;
  const end = timelineEnd(project);
  const texts = project.texts.map((text) => isCaption(text) ? { ...text, ...validateCue({ ...text, start: text.start + offset, end: text.end + offset }, end) } : text);
  assertNoCollisions(texts.filter(isCaption));
  return { ...project, texts };
}

export function styleCaptions(project: Project, style: Partial<CaptionStyle>): Project {
  const patch = checkedStyle(style);
  if (!Object.keys(patch).length || !project.texts.some(isCaption)) return project;
  return { ...project, texts: project.texts.map((text) => isCaption(text) ? { ...text, ...patch } : text) };
}

function graphemes(text: string): string[] {
  if (typeof Intl !== 'undefined' && Intl.Segmenter) return [...new Intl.Segmenter('km', { granularity: 'grapheme' }).segment(text)].map((item) => item.segment);
  const result: string[] = [];
  for (const char of Array.from(text)) {
    const last = result.at(-1) ?? '';
    const flagPair = /^[\u{1f1e6}-\u{1f1ff}]$/u.test(char) && /^[\u{1f1e6}-\u{1f1ff}]$/u.test(last);
    if (result.length && (/\p{M}|\p{Emoji_Modifier}|\u200d/u.test(char) || /[\u17d2\u200d]$/.test(last) || flagPair)) result[result.length - 1] += char;
    else result.push(char);
  }
  return result;
}

/** Proportional timing keeps every segment inside the old caption and preserves all style properties. */
export function segmentCaption(project: Project, id: string, parts: string[], makeId = freshId): Project {
  const original = project.texts.find((text) => text.id === id && isCaption(text));
  if (!original) throw new Error('This caption no longer exists.');
  validateCue(original, timelineEnd(project));
  if (parts.length < 2 || parts.length > 20 || original.end - original.start < parts.length * MIN_CLIP) throw new Error('Use 2–20 segments, with at least 0.1 seconds for each.');
  if (projectCaptions(project).length + parts.length - 1 > MAX_CAPTIONS) throw new Error('Splitting would exceed the caption limit.');
  const cleaned = parts.map(plainCaptionText), weights = cleaned.map((text) => graphemes(text).length);
  const total = weights.reduce((a, b) => a + b, 0), spare = original.end - original.start - parts.length * MIN_CLIP;
  let at = original.start;
  const ids = new Set([...project.main, ...project.texts, ...project.audio].map((text) => text.id));
  const segments = cleaned.map((text, index): TextOverlay => {
    const next = index === cleaned.length - 1 ? original.end : at + MIN_CLIP + spare * weights[index] / total;
    const newId = index === 0 ? id : makeId();
    if (!newId || newId.length > 128 || (index > 0 && ids.has(newId))) throw new Error('A caption identifier already exists. Nothing was split.');
    ids.add(newId);
    const caption = { ...original, id: newId, text, start: at, end: next };
    at = next;
    return caption;
  });
  return { ...project, texts: project.texts.flatMap((text) => text.id === id ? segments : [text]) };
}

export function suggestCaptionSegments(text: string, maxLength = 42): string[] {
  const limit = Math.max(8, Math.min(200, Math.round(maxLength)));
  const result: string[] = [];
  for (const line of plainCaptionText(text).split('\n').filter((line) => line.trim())) {
    let remaining = graphemes(line.trim());
    while (remaining.length > limit) {
      const gap = remaining.slice(0, limit + 1).lastIndexOf(' ');
      const cut = gap >= limit / 2 ? gap : limit;
      result.push(remaining.slice(0, cut).join('').trim());
      remaining = remaining.slice(cut);
      while (remaining[0] === ' ') remaining.shift();
    }
    if (remaining.length) result.push(remaining.join(''));
  }
  return result;
}

export function exportSrt(project: Project): string {
  const end = timelineEnd(project), captions = projectCaptions(project);
  if (!captions.length) throw new Error('Add or import captions before exporting SRT.');
  captions.forEach((caption) => validateCue(caption, end));
  assertNoCollisions(captions);
  const output = captions.map((caption, index) => `${index + 1}\n${captionTime(caption.start, ',')} --> ${captionTime(caption.end, ',')}\n${caption.text.replace(/\r\n?/g, '\n').replace(/\n[ \t]*\n/g, '\n').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}`).join('\n\n') + '\n';
  if (utf8Bytes(output) > MAX_SUBTITLE_BYTES) throw new Error('These captions exceed the 1 MB SRT file limit. Export a shorter project or shorten the caption text.');
  return output;
}
