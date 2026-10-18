import { createVideoPlayer, type VideoThumbnail } from 'expo-video';
import { create } from 'zustand';

import type { ID, MediaAsset } from '@/core/types';
import { fileUri } from '@/storage/projects';
import { waitReady } from './player-utils';

/** One frame per second, capped so long videos don't eat memory. Frames are ~180px native images. */
const FRAME_STEP = 1;
const MAX_FRAMES = 120;
const BATCH = 12;

export interface FilmStrip {
  interval: number;
  frames: (VideoThumbnail | undefined)[];
}

/** In-memory filmstrips for the timeline, keyed by asset id. Regenerated per app session. */
export const useFilmStrips = create<Record<ID, FilmStrip>>(() => ({}));

const queue: MediaAsset[] = [];
let running = false;

export function requestFilmStrip(asset: MediaAsset) {
  if (useFilmStrips.getState()[asset.id] || queue.some((a) => a.id === asset.id)) return;
  queue.push(asset);
  void pump();
}

async function pump() {
  if (running) return;
  running = true;
  while (queue.length) {
    const asset = queue.shift()!;
    try {
      await generate(asset);
    } catch (e) {
      console.warn('Filmstrip generation failed', asset.name, e);
    }
  }
  running = false;
}

async function generate(asset: MediaAsset) {
  const count = Math.max(1, Math.min(MAX_FRAMES, Math.ceil(asset.duration / FRAME_STEP)));
  const interval = asset.duration / count;
  useFilmStrips.setState({ [asset.id]: { interval, frames: new Array(count).fill(undefined) } });

  const player = createVideoPlayer({ uri: fileUri(asset.path) });
  try {
    await waitReady(player);
    for (let i = 0; i < count; i += BATCH) {
      const times: number[] = [];
      for (let k = i; k < Math.min(i + BATCH, count); k++) times.push((k + 0.5) * interval);
      const thumbs = await player.generateThumbnailsAsync(times, { maxWidth: 180, maxHeight: 180 });
      useFilmStrips.setState((s) => {
        const frames = s[asset.id].frames.slice();
        thumbs.forEach((t, j) => (frames[i + j] = t));
        return { [asset.id]: { interval, frames } };
      });
    }
  } finally {
    player.release();
  }
}

/** Nearest generated frame for a source time. */
export function frameAt(strip: FilmStrip | undefined, sourceTime: number): VideoThumbnail | undefined {
  if (!strip) return undefined;
  const n = strip.frames.length;
  const idx = Math.min(n - 1, Math.max(0, Math.floor(sourceTime / strip.interval)));
  for (let d = 0; d < n; d++) {
    const f = strip.frames[idx - d] ?? strip.frames[idx + d];
    if (f) return f;
  }
  return undefined;
}
