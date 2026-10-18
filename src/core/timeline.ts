// Pure timeline math. No React / native imports so it can be tested with plain `node --test`.
import type { AspectRatio, AudioClip, Crop, ID, MediaAsset, Project, TextAnim, TextOverlay, VideoClip } from './types';

/** Shortest clip we allow after trim/split, in timeline seconds. */
export const MIN_CLIP = 0.1;

export const clipDuration = (c: VideoClip) => (c.out - c.in) / c.speed;

/** Timeline start time of every clip on the main track. */
export function clipStarts(main: VideoClip[]): number[] {
  const starts: number[] = [];
  let t = 0;
  for (const c of main) {
    starts.push(t);
    t += clipDuration(c);
  }
  return starts;
}

export const totalDuration = (main: VideoClip[]) => main.reduce((s, c) => s + clipDuration(c), 0);

export interface Located {
  index: number;
  clip: VideoClip;
  start: number;
  /** Source time inside the clip's asset. */
  source: number;
}

/** Which clip plays at timeline time `t` (clamped to the timeline). */
export function locate(main: VideoClip[], t: number): Located | null {
  if (!main.length) return null;
  let start = 0;
  for (let i = 0; i < main.length; i++) {
    const c = main[i];
    const d = clipDuration(c);
    if (t < start + d || i === main.length - 1) {
      const local = Math.min(Math.max(t - start, 0), d);
      return { index: i, clip: c, start, source: c.in + local * c.speed };
    }
    start += d;
  }
  return null;
}

/** Split the clip under `t` into two. Returns null when `t` is too close to a clip edge. */
export function splitAt(main: VideoClip[], t: number, newId: ID): VideoClip[] | null {
  const hit = locate(main, t);
  if (!hit) return null;
  const { clip, index, source } = hit;
  if ((source - clip.in) / clip.speed < MIN_CLIP || (clip.out - source) / clip.speed < MIN_CLIP) return null;
  // The fade in stays at the start of the left piece, the fade out at the end of the right one.
  const left: VideoClip = { ...clip, out: source, fadeOut: undefined };
  const right: VideoClip = { ...clip, id: newId, in: source, fadeIn: undefined };
  return [...main.slice(0, index), left, right, ...main.slice(index + 1)];
}

/** Move a clip's in or out point to `value` (source seconds), clamped to the asset and MIN_CLIP. */
export function trimClip(clip: VideoClip, edge: 'in' | 'out', value: number, assetDuration: number): VideoClip {
  const min = MIN_CLIP * clip.speed;
  if (edge === 'in') return { ...clip, in: Math.min(Math.max(value, 0), clip.out - min) };
  return { ...clip, out: Math.max(Math.min(value, assetDuration), clip.in + min) };
}

export function moveItem<T>(list: T[], from: number, to: number): T[] {
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(to, next.length)), 0, item);
  return next;
}

/** Snap `value` to the nearest target within `threshold`; returns the value unchanged otherwise. */
export function snap(value: number, targets: number[], threshold: number): number {
  let best = value;
  let bestDist = threshold;
  for (const t of targets) {
    const d = Math.abs(t - value);
    if (d <= bestDist) {
      best = t;
      bestDist = d;
    }
  }
  return best;
}

/** Canvas width / height for the project. */
export function canvasRatio(p: Pick<Project, 'aspect' | 'assets' | 'main'>): number {
  const ratios: Record<Exclude<AspectRatio, 'original'>, number> = {
    '9:16': 9 / 16,
    '16:9': 16 / 9,
    '1:1': 1,
    '4:5': 4 / 5,
    '3:4': 3 / 4,
  };
  if (p.aspect !== 'original') return ratios[p.aspect];
  const first = p.main[0] && p.assets[p.main[0].assetId];
  return first && first.width > 0 && first.height > 0 ? first.width / first.height : 9 / 16;
}

export const audioEnd = (a: AudioClip) => a.start + (a.out - a.in);

/** Greedy row assignment so overlapping overlays stack on separate timeline lanes. */
export function assignLanes(items: { id: ID; start: number; end: number }[]): {
  lanes: Record<ID, number>;
  count: number;
} {
  const lanes: Record<ID, number> = {};
  const laneEnds: number[] = [];
  for (const it of [...items].sort((a, b) => a.start - b.start)) {
    let lane = laneEnds.findIndex((end) => end <= it.start + 1e-6);
    if (lane < 0) lane = laneEnds.push(0) - 1;
    laneEnds[lane] = it.end;
    lanes[it.id] = lane;
  }
  return { lanes, count: laneEnds.length };
}

/** Move a text overlay's start or end edge to timeline time `t`. */
export function trimText(o: TextOverlay, edge: 'start' | 'end', t: number): TextOverlay {
  if (edge === 'start') return { ...o, start: Math.min(Math.max(t, 0), o.end - MIN_CLIP) };
  return { ...o, end: Math.max(t, o.start + MIN_CLIP) };
}

/** Move an audio clip's left edge (also shifts the source in-point) or right edge to timeline time `t`. */
export function trimAudio(a: AudioClip, edge: 'start' | 'end', t: number, assetDuration: number): AudioClip {
  if (edge === 'start') {
    const d = Math.min(Math.max(t - a.start, -a.in, -a.start), a.out - MIN_CLIP - a.in);
    return { ...a, start: a.start + d, in: a.in + d };
  }
  return { ...a, out: Math.min(Math.max(a.in + (t - a.start), a.in + MIN_CLIP), assetDuration) };
}

/** Split a text at timeline time `t`; null when `t` is too close to an edge. Animations stay at the outer ends. */
export function splitText(o: TextOverlay, t: number, newId: ID): [TextOverlay, TextOverlay] | null {
  if (t - o.start < MIN_CLIP || o.end - t < MIN_CLIP) return null;
  return [
    { ...o, end: t, animOut: undefined },
    { ...o, id: newId, start: t, animIn: undefined },
  ];
}

/** Split an audio clip at timeline time `t`; null when `t` is too close to an edge. Fades stay at the outer ends. */
export function splitAudio(a: AudioClip, t: number, newId: ID): [AudioClip, AudioClip] | null {
  const local = t - a.start;
  if (local < MIN_CLIP || a.out - a.in - local < MIN_CLIP) return null;
  return [
    { ...a, out: a.in + local, fadeOut: undefined },
    { ...a, id: newId, start: t, in: a.in + local, fadeIn: undefined },
  ];
}

// --- Fades and text animation --------------------------------------------------------------------
// Worklets: the preview evaluates these on the UI thread every frame. The exporters get the same curves as
// keyframes (fadeEnvelope) or re-implement textAnimAt line for line (SmileExporter.swift / .kt).

/** Fade lengths scaled down together so they never overlap inside an item of `duration`. */
export function fadeLengths(duration: number, fadeIn = 0, fadeOut = 0): [number, number] {
  'worklet';
  const sum = fadeIn + fadeOut;
  const k = sum > duration && sum > 0 ? Math.max(0, duration) / sum : 1;
  return [fadeIn * k, fadeOut * k];
}

/** 0..1 gain `local` seconds into an item of `duration` with linear fades at both ends. */
export function fadeGain(local: number, duration: number, fadeIn = 0, fadeOut = 0): number {
  'worklet';
  const [fi, fo] = fadeLengths(duration, fadeIn, fadeOut);
  let g = 1;
  if (fi > 0) g = Math.min(g, local / fi);
  if (fo > 0) g = Math.min(g, (duration - local) / fo);
  return Math.min(1, Math.max(0, g));
}

/** The same fades as piecewise-linear `[time, gain, time, gain, ...]` keyframes (timeline seconds); [] = always 1. */
export function fadeEnvelope(start: number, duration: number, fadeIn = 0, fadeOut = 0): number[] {
  const [fi, fo] = fadeLengths(duration, fadeIn, fadeOut);
  if (!fi && !fo) return [];
  const end = start + duration;
  return [start, fi ? 0 : 1, start + fi, 1, end - fo, 1, end, fo ? 0 : 1];
}

/** Length of a text's in / out animation. */
export const textAnimDuration = (o: Pick<TextOverlay, 'start' | 'end'>) => {
  'worklet';
  return Math.min(0.5, Math.max(0, o.end - o.start) / 2);
};

/** Vertical travel of the slide animation, as a fraction of the canvas height. */
export const SLIDE_DISTANCE = 0.06;

export interface AnimState {
  /** Opacity multiplier, 0..1. */
  alpha: number;
  scale: number;
  /** Vertical offset, fraction of the canvas height (y down). */
  dy: number;
}

/** Progress `p` (0 = hidden, 1 = settled) of one animation phase; `dir` is +1 for in, -1 for out. */
function animPhase(kind: TextAnim | undefined, p: number, dir: number, s: AnimState) {
  'worklet';
  if (!kind || kind === 'none' || p >= 1) return;
  const q = Math.max(0, p);
  const k = 1 - (1 - q) * (1 - q) * (1 - q); // ease-out cubic
  s.alpha *= k;
  if (kind === 'slide') s.dy += dir * (1 - k) * SLIDE_DISTANCE;
  if (kind === 'slideDown') s.dy -= dir * (1 - k) * SLIDE_DISTANCE;
  if (kind === 'pop') {
    // ease-out back: overshoots to ~1.1 before settling.
    const b = 1 + 2.70158 * (q - 1) * (q - 1) * (q - 1) + 1.70158 * (q - 1) * (q - 1);
    s.scale *= 0.4 + 0.6 * b;
  }
  if (kind === 'bounce') {
    let progress = q;
    let bounce: number;
    if (progress < 1 / 2.75) {
      bounce = 7.5625 * progress * progress;
    } else if (progress < 2 / 2.75) {
      progress -= 1.5 / 2.75;
      bounce = 7.5625 * progress * progress + 0.75;
    } else if (progress < 2.5 / 2.75) {
      progress -= 2.25 / 2.75;
      bounce = 7.5625 * progress * progress + 0.9375;
    } else {
      progress -= 2.625 / 2.75;
      bounce = 7.5625 * progress * progress + 0.984375;
    }
    s.scale *= 0.55 + 0.45 * bounce;
    s.dy += dir * (1 - bounce) * 0.045;
  }
  if (kind === 'zoomIn') s.scale *= 0.6 + 0.4 * k;
  if (kind === 'zoomOut') s.scale *= 1.5 - 0.5 * k;
  if (kind === 'rise') {
    s.dy += dir * (1 - q) * 0.1;
    s.scale *= 0.94 + 0.06 * k;
  }
  if (kind === 'pulse') s.scale *= 1 + 0.18 * (1 - q) * Math.sin(q * Math.PI * 3);
}

/** How a text looks at timeline time `t`: slides in from below and out upwards, pops with a small overshoot. */
export function textAnimAt(o: Pick<TextOverlay, 'start' | 'end' | 'animIn' | 'animOut'>, t: number): AnimState {
  'worklet';
  const s: AnimState = { alpha: 1, scale: 1, dy: 0 };
  const d = textAnimDuration(o);
  if (d <= 0) return s;
  animPhase(o.animIn, (t - o.start) / d, 1, s);
  animPhase(o.animOut, (o.end - t) / d, -1, s);
  return s;
}

// --- Photos, Ken Burns, crossfades ----------------------------------------------------------------

/** Default length of a photo clip, seconds. */
export const PHOTO_DURATION = 3;
/** Trim limit of a photo clip (stored as the image asset's `duration`). */
export const PHOTO_MAX = 600;

/** A main-track clip showing all of `asset` (photos: PHOTO_DURATION). */
export function newClip(asset: MediaAsset, id: ID): VideoClip {
  return {
    id,
    assetId: asset.id,
    in: 0,
    out: asset.kind === 'image' ? PHOTO_DURATION : asset.duration,
    speed: 1,
    volume: 1,
  };
}

/** Extra zoom a Ken Burns clip reaches at its end. */
export const KEN_BURNS_ZOOM = 0.15;

/** Scale factor of a Ken Burns clip `local` seconds into it (linear zoom in). */
export function kenBurnsScale(local: number, duration: number): number {
  'worklet';
  return 1 + KEN_BURNS_ZOOM * Math.min(1, Math.max(0, duration > 0 ? local / duration : 0));
}

/**
 * Crossfade length into clip `i`, centered on its cut and clamped so each half fits inside both clips. Timing
 * doesn't change: across the window the incoming clip's first frame fades in over the outgoing clip, then the
 * outgoing clip's last frame fades out over the incoming one (frozen frames, as no footage exists past the trims).
 */
export function transitionLength(main: VideoClip[], i: number): number {
  if (i <= 0 || i >= main.length) return 0;
  return Math.max(0, Math.min(main[i].transition ?? 0, clipDuration(main[i - 1]), clipDuration(main[i])));
}

/** Weight (0..1) of the incoming clip at timeline time `t` for a crossfade of length `d` at `cut`; null = outside. */
export function crossfadeWeight(t: number, cut: number, d: number): number | null {
  'worklet';
  if (d <= 0 || t < cut - d / 2 || t > cut + d / 2) return null;
  return (t - (cut - d / 2)) / d;
}

/** Size of a clip's (cropped) frame fitted inside a W x H canvas, before the user's transform. */
export function fitFrame(
  asset: { width: number; height: number },
  crop: Crop | undefined,
  W: number,
  H: number,
): { w: number; h: number } {
  const sw = Math.max(1, asset.width) * (crop?.w ?? 1);
  const sh = Math.max(1, asset.height) * (crop?.h ?? 1);
  const k = Math.min(W / sw, H / sh);
  return { w: sw * k, h: sh * k };
}

/** The largest centered crop of `ratio` (width / height) inside a frame of the given size. */
export function centeredCrop(width: number, height: number, ratio: number): Crop {
  const aspect = width / height;
  if (aspect > ratio) {
    const w = ratio / aspect;
    return { x: (1 - w) / 2, y: 0, w, h: 1 };
  }
  const h = aspect / ratio;
  return { x: 0, y: (1 - h) / 2, w: 1, h };
}

export function formatTime(seconds: number, withFraction = false): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const base = `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return withFraction ? `${base}.${Math.floor((s % 1) * 10)}` : base;
}
