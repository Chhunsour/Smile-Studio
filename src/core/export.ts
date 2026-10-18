// Turns a project into a flat, fully resolved render description for the native exporters
// (modules/smile-engine: AVFoundation on iOS, Media3 Transformer on Android). All geometry is in output pixels
// and all times in timeline seconds, so the native side only draws what it is told.

import { colorMatrix, type ColorMatrix } from './color.ts';
import { effectPrimitives, effectSeed, type EffectPrimitive } from './effects.ts';
import {
  canvasRatio,
  clipStarts,
  fadeEnvelope,
  fitFrame,
  KEN_BURNS_ZOOM,
  textAnimDuration,
  totalDuration,
  transitionLength,
} from './timeline.ts';
import type { Crop, FontId, MediaAsset, Project, TextAnim, Transform } from './types';

export type Resolution = 720 | 1080;
export type FrameRate = 24 | 30 | 60;

export const RESOLUTIONS: Resolution[] = [720, 1080];
export const FRAME_RATES: FrameRate[] = [24, 30, 60];

export interface ExportClip {
  uri: string;
  /** A photo (JPEG) instead of a video: no audio, any source time shows the image. */
  still: boolean;
  /** Timeline start and length (after speed). */
  start: number;
  duration: number;
  /** Source range, seconds. */
  sourceIn: number;
  sourceOut: number;
  speed: number;
  volume: number;
  /** Size of the cropped frame fitted in the canvas, before the user transform (output pixels). */
  frameWidth: number;
  frameHeight: number;
  crop: Crop;
  transform: Transform;
  /** 4x5 row-major color matrix on 0..1 sRGB values, or null for none. */
  matrix: ColorMatrix | null;
  /**
   * Fades: piecewise-linear `[time, gain, ...]` keyframes in timeline seconds, [] = constant 1. Scales the picture
   * (fade to black) and the clip sound.
   */
  envelope: number[];
  /**
   * Crossfade from the previous clip, seconds, centered on this clip's start (0 = cut). Before the cut this clip's
   * first frame fades in over the previous clip; after it the previous clip's last frame fades out over this one.
   */
  transition: number;
  /** Ken Burns: the transform's scale grows linearly by this much over the clip (0 = off). */
  kenBurns: number;
  /** Normalized, resolution-independent scene overlay primitives, before fade/crossfade and below titles. */
  effects: EffectPrimitive[];
}

export interface ExportText {
  text: string;
  font: FontId;
  color: string;
  opacity: number;
  box: boolean;
  /** Center in output pixels. */
  x: number;
  y: number;
  /** Font size in output pixels. */
  fontSize: number;
  rotation: number;
  start: number;
  /** Not clipped to the video's end, so the out animation is timed exactly like in the preview. */
  end: number;
  /** See textAnimAt in timeline.ts, which the exporters mirror. */
  animIn: TextAnim;
  animOut: TextAnim;
  animDuration: number;
  caption?: boolean;
}

export interface ExportAudio {
  uri: string;
  start: number;
  sourceIn: number;
  sourceOut: number;
  volume: number;
  /** Like ExportClip.envelope. */
  envelope: number[];
}

export interface ExportSpec {
  output: string;
  width: number;
  height: number;
  fps: FrameRate;
  bitrate: number;
  /** Fill around clips: 'blur' or a '#RRGGBB' color (see Project.background). */
  background: string;
  duration: number;
  clips: ExportClip[];
  texts: ExportText[];
  audio: ExportAudio[];
}

const IDENTITY: Transform = { x: 0, y: 0, scale: 1, rotation: 0, flip: false };
const FULL: Crop = { x: 0, y: 0, w: 1, h: 1 };

/** Output size: the short side is `res`, both sides even (required by H.264 encoders). */
export function exportSize(ratio: number, res: Resolution): { width: number; height: number } {
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  return ratio >= 1 ? { width: even(res * ratio), height: res } : { width: res, height: even(res / ratio) };
}

/** Target H.264 bitrate: ~0.15 bits per pixel per frame (≈9 Mbps at 1080p30). */
export const exportBitrate = (width: number, height: number, fps: number) => Math.round(width * height * fps * 0.15);

export function buildExportSpec(
  p: Project,
  opts: { resolution: Resolution; fps: FrameRate; output: string },
  uriOf: (a: MediaAsset) => string,
): ExportSpec {
  const { width: W, height: H } = exportSize(canvasRatio(p), opts.resolution);
  const total = totalDuration(p.main);
  const starts = clipStarts(p.main);
  return {
    output: opts.output,
    width: W,
    height: H,
    fps: opts.fps,
    bitrate: exportBitrate(W, H, opts.fps),
    background: p.background ?? '#000000',
    duration: total,
    clips: p.main.map((c, i) => {
      const asset = p.assets[c.assetId];
      const frame = fitFrame(asset, c.crop, W, H);
      return {
        uri: uriOf(asset),
        still: asset.kind === 'image',
        start: starts[i],
        duration: (c.out - c.in) / c.speed,
        sourceIn: c.in,
        sourceOut: c.out,
        speed: c.speed,
        volume: c.volume,
        frameWidth: frame.w,
        frameHeight: frame.h,
        crop: c.crop ?? FULL,
        transform: c.transform ?? IDENTITY,
        matrix: colorMatrix(c.color),
        envelope: fadeEnvelope(starts[i], (c.out - c.in) / c.speed, c.fadeIn, c.fadeOut),
        transition: transitionLength(p.main, i),
        kenBurns: c.kenBurns ? KEN_BURNS_ZOOM : 0,
        // Source identity stays stable when the user splits/duplicates a clip, avoiding a grain jump at the cut.
        effects: effectPrimitives(c.effects, effectSeed(c.assetId), W / H),
      };
    }),
    // Same placement as the preview: center at (x, y) of the canvas, font size a fraction of its width.
    texts: p.texts
      .filter((o) => o.start < total && o.text.trim() !== '')
      .map((o) => ({
        text: o.text,
        font: o.font,
        color: o.color,
        opacity: o.opacity,
        box: o.box,
        x: o.x * W,
        y: o.y * H,
        fontSize: o.size * W,
        rotation: o.rotation,
        start: o.start,
        end: o.end,
        animIn: o.animIn ?? 'none',
        animOut: o.animOut ?? 'none',
        animDuration: textAnimDuration(o),
        ...(o.caption ? { caption: true } : {}),
      })),
    // Audio past the end of the video is cut, like in the preview.
    audio: p.audio
      .filter((a) => a.start < total && p.assets[a.assetId])
      .map((a) => ({
        uri: uriOf(p.assets[a.assetId]),
        start: a.start,
        sourceIn: a.in,
        sourceOut: Math.min(a.out, a.in + (total - a.start)),
        volume: a.volume,
        // Fades belong to the whole clip, so one that runs past the end of the video is cut like in the preview.
        envelope: fadeEnvelope(a.start, a.out - a.in, a.fadeIn, a.fadeOut),
      })),
  };
}

/**
 * The part of `spec` from `from` to `from + len` (timeline seconds), as a spec of its own starting at 0, without
 * music. Used to render single frames (save frame, freeze frame) through the same exporters as full videos.
 *
 * ponytail: crossfades are dropped (their neighbour clip may be outside the slice), so a frame taken in the middle
 * of a crossfade shows the clip under the playhead only. Keep the neighbour clip with a negative start if that matters.
 */
export function sliceSpec(spec: ExportSpec, from: number, len: number): ExportSpec {
  const to = Math.min(from + len, spec.duration);
  const shift = (e: number[]) => e.map((v, i) => (i % 2 ? v : v - from));
  return {
    ...spec,
    duration: to - from,
    audio: [],
    clips: spec.clips
      .filter((c) => c.start < to && c.start + c.duration > from)
      .map((c) => {
        const cut = Math.max(0, from - c.start);
        const start = c.start + cut - from;
        const duration = Math.min(c.start + c.duration, to) - from - start;
        const sourceIn = c.sourceIn + cut * c.speed;
        // A Ken Burns zoom is relative to the whole clip, so pre-apply the part that is already done.
        const done = c.kenBurns * (c.duration > 0 ? cut / c.duration : 0);
        return {
          ...c,
          start,
          duration,
          sourceIn,
          sourceOut: sourceIn + duration * c.speed,
          envelope: shift(c.envelope),
          transition: 0,
          transform: { ...c.transform, scale: c.transform.scale * (1 + done) },
          // Same zoom per second as the full clip, relative to the new base scale.
          kenBurns: (c.kenBurns * duration) / Math.max(1e-9, c.duration) / (1 + done),
        };
      }),
    texts: spec.texts
      .filter((t) => t.start < to && t.end > from)
      .map((t) => ({ ...t, start: t.start - from, end: t.end - from })),
  };
}
