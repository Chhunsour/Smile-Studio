import type { AudioClip } from './types.ts';

export const MAX_AUDIO_PLAYERS = 8;
const PRELOAD_AHEAD = 2;
const END_EPSILON = .02;

/** A bounded decoder plan. Loud foreground clips win over quiet music when more than eight overlap. */
export function planAudioPlayers(clips: readonly AudioClip[], time: number): {
  clips: AudioClip[];
  overflow: number;
  nextChange: number;
} {
  const t = Number.isFinite(time) ? Math.max(0, time) : 0;
  const eligible = clips.filter(c => c.volume > 0 && Number.isFinite(c.start + c.out - c.in) && c.out > c.in);
  const end = (c: AudioClip) => c.start + c.out - c.in - END_EPSILON;
  const priority = (a: AudioClip, b: AudioClip) => b.volume - a.volume || b.start - a.start || a.id.localeCompare(b.id);
  const active = eligible.filter(c => c.start <= t && t < end(c)).sort(priority);
  const future = eligible.filter(c => c.start > t).sort((a, b) => a.start - b.start || priority(a, b));
  const selected = active.slice(0, MAX_AUDIO_PLAYERS);
  // Normally two upcoming clips suffice. Prepare a simultaneous group together when slots are available.
  const near = future.filter(c => c.start <= t + PRELOAD_AHEAD);
  const group = near.filter(c => c.start === near[0]?.start).length;
  const count = Math.min(MAX_AUDIO_PLAYERS - selected.length, Math.max(2, group));
  selected.push(...near.slice(0, count));
  let nextChange = Infinity;
  for (const clip of eligible) {
    for (const boundary of [clip.start - PRELOAD_AHEAD, clip.start, end(clip)]) {
      if (boundary > t + .000001) nextChange = Math.min(nextChange, boundary);
    }
  }
  return { clips: selected, overflow: Math.max(0, active.length - MAX_AUDIO_PLAYERS), nextChange };
}
