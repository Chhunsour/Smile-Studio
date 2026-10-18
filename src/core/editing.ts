import type { AudioClip, VideoClip } from './types.ts';

/** Copy just the visual treatment. Framing, timing, and sound remain clip-specific. */
export function copyLook(clip: VideoClip): Pick<VideoClip, 'color' | 'effects'> {
  return { color: clip.color ? { ...clip.color } : undefined, effects: clip.effects ? { ...clip.effects } : undefined };
}

/** Repeats a trimmed source range, truncating the last copy at the movie end. */
export function loopAudio(clip: AudioClip, end: number, id: () => string, existing: AudioClip[] = []): AudioClip[] {
  const duration = clip.out - clip.in;
  if (!Number.isFinite(duration) || duration < .1 || !Number.isFinite(end)) return [];
  const repeats = Math.max(0, Math.ceil((end - clip.start) / duration) - 1);
  if (repeats > 64) throw new Error('Use a longer music section to loop this far. Up to 64 repeats can be added at once.');
  const result: AudioClip[] = [];
  for (let start = clip.start + duration; start < end - .099; start += duration) {
    const remaining = Math.min(duration, end - start);
    if (existing.some(a => a.assetId === clip.assetId && Math.abs(a.start-start) < .001 && Math.abs(a.in-clip.in) < .001 && Math.abs(a.out-(clip.in+remaining)) < .001)) continue;
    result.push({ ...clip, id: id(), start, out: clip.in + remaining,
      fadeIn: Math.min(clip.fadeIn ?? 0, remaining / 2), fadeOut: Math.min(clip.fadeOut ?? 0, remaining / 2) });
  }
  return result;
}

/** Stable, sorted bookmarks; millisecond precision and near-duplicate suppression. */
export function mergeMarkers(current: number[] | undefined, added: number[], end: number): number[] {
  const sorted = [...(current ?? []), ...added].filter(t => Number.isFinite(t) && t >= 0 && t <= end).map(t => Math.round(t * 1000) / 1000).sort((a,b) => a-b);
  const result: number[] = [];
  for (const time of sorted) if (!result.length || time - result[result.length - 1] >= .06) result.push(time);
  return result.slice(0, 512);
}
