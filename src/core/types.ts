import type { ColorSettings } from './color';
import type { ClipEffects } from './effects';

export type ID = string;

/** Canvas aspect ratio. `original` follows the first clip on the main track. */
export type AspectRatio = 'original' | '9:16' | '16:9' | '1:1' | '4:5' | '3:4';

export interface MediaAsset {
  id: ID;
  /** Images are still photos: their clips can be any length (`duration` is only the trim limit). */
  kind: 'video' | 'audio' | 'image';
  /**
   * Path relative to the app's document directory (e.g. `media/abc.mov`).
   * Never store absolute paths: the iOS container path changes between app updates.
   */
  path: string;
  /** Poster frame (videos only), also relative to the document directory. */
  poster?: string;
  name: string;
  /** Seconds. */
  duration: number;
  /** Display size (rotation already applied). 0 for audio. Images are stored upright as JPEG. */
  width: number;
  height: number;
}

/**
 * Where a clip sits on the canvas. With the identity transform the (cropped) frame is fitted inside the canvas.
 * `x`/`y` are offsets of the center as fractions of the canvas size, `rotation` is in degrees (clockwise).
 */
export interface Transform {
  x: number;
  y: number;
  scale: number;
  rotation: number;
  flip: boolean;
}

/** Crop rectangle in the source frame, normalized 0..1 (display orientation). */
export interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A segment of a source asset placed on the main (magnetic) track. */
export interface VideoClip {
  id: ID;
  assetId: ID;
  /** Source in/out points, seconds. */
  in: number;
  out: number;
  /** Playback rate multiplier. */
  speed: number;
  /** 0..1, 0 = muted. */
  volume: number;
  /** Optional so older documents stay valid; missing means identity / no crop / no color change / no fade. */
  transform?: Transform;
  crop?: Crop;
  color?: ColorSettings;
  /** Seconds (timeline time) of fade from / to black at the clip's start and end; the clip sound fades too. */
  fadeIn?: number;
  fadeOut?: number;
  /** Seconds of crossfade from the previous clip, centered on the cut (see transitionLength in timeline.ts). */
  transition?: number;
  /** Slow zoom in over the clip (see kenBurnsScale). */
  kenBurns?: boolean;
  /** Stackable scene effects. Missing / all-zero means no effects. */
  effects?: ClipEffects;
}

export type FontId = 'sans' | 'serif' | 'mono' | 'rounded' | 'condensed';

/** How a text appears (in) or disappears (out). See `textAnimAt` in timeline.ts. */
export type TextAnim = 'none' | 'fade' | 'slide' | 'pop' | 'slideDown' | 'bounce' | 'zoomIn' | 'zoomOut' | 'rise' | 'pulse';

/**
 * A text layer shown between `start` and `end` (timeline seconds). Position is the center as a fraction of the
 * canvas; `size` is the font size as a fraction of the canvas width so it renders identically at any resolution.
 * AI subtitles / translations will be generated text overlays (they can add a `source` field when they land).
 */
export interface TextOverlay {
  id: ID;
  start: number;
  end: number;
  text: string;
  font: FontId;
  color: string;
  /** 0..1 */
  opacity: number;
  /** Draw a dark box behind the text (caption style). */
  box: boolean;
  x: number;
  y: number;
  size: number;
  rotation: number;
  /** Missing means 'none'. */
  animIn?: TextAnim;
  animOut?: TextAnim;
  /** Caption workflow membership; legacy titles remain regular text overlays. */
  caption?: boolean;
  templateTitle?: boolean;
}

/** A piece of an audio file (music, voiceover, later AI dubbing) placed freely on the timeline. */
export interface AudioClip {
  id: ID;
  assetId: ID;
  /** Timeline start, seconds. */
  start: number;
  /** Source in/out points, seconds. */
  in: number;
  out: number;
  /** 0..1 */
  volume: number;
  /** Seconds of fade from / to silence at the start and end. */
  fadeIn?: number;
  fadeOut?: number;
}

/**
 * Non-destructive project document. Media files are referenced, never modified.
 * Bump `schema` and migrate in `storage/projects.ts` when the shape changes.
 */
export interface Project {
  schema: 2;
  id: ID;
  name: string;
  createdAt: number;
  updatedAt: number;
  aspect: AspectRatio;
  /**
   * What fills the canvas around a clip that doesn't cover it: 'blur' (a blurred, zoomed copy of the clip) or a
   * '#RRGGBB' color. Missing means black.
   */
  background?: string;
  assets: Record<ID, MediaAsset>;
  /** Main video track. Clips play back-to-back with no gaps. */
  main: VideoClip[];
  texts: TextOverlay[];
  audio: AudioClip[];
  /** User placed timeline bookmarks in seconds. */
  markers?: number[];
}
