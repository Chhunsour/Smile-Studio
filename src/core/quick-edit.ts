import { clipDuration, MIN_CLIP, totalDuration } from './timeline.ts';
import type { Project, VideoClip } from './types.ts';

export function trimAtPlayhead(project: Project, selectedId: string, time: number, edge: 'before' | 'after'): Project {
  if (!Number.isFinite(time)) throw new Error('Move the playhead inside the selected clip.');
  let start = 0;
  const main = project.main.map((clip) => {
    const duration = clipDuration(clip), local = time - start;
    start += duration;
    if (clip.id !== selectedId) return clip;
    if (local < MIN_CLIP || duration - local < MIN_CLIP) throw new Error('Keep at least 0.1 seconds on each side of the playhead.');
    return edge === 'before'
      ? { ...clip, in: clip.in + local * clip.speed, fadeIn: undefined, transition: undefined }
      : { ...clip, out: clip.in + local * clip.speed, fadeOut: undefined };
  });
  return main.some((clip, index) => clip !== project.main[index]) ? { ...project, main } : project;
}

export function splitAtMarkers(project: Project, id: () => string): { project: Project; added: number } {
  const end = totalDuration(project.main);
  const markers = [...new Set(project.markers ?? [])].filter(time => Number.isFinite(time) && time > 0 && time < end).sort((left, right) => left - right);
  const main: VideoClip[] = [];
  let start = 0, added = 0;
  for (const clip of project.main) {
    const duration = clipDuration(clip);
    let part = clip;
    for (const marker of markers) {
      const source = clip.in + (marker - start) * clip.speed;
      if (marker <= start || marker >= start + duration || (source - part.in) / clip.speed < MIN_CLIP - 1e-9 || (clip.out - source) / clip.speed < MIN_CLIP - 1e-9) continue;
      if (added >= 128) throw new Error('Split up to 128 markers at once. Remove some markers and try again.');
      main.push({ ...part, out: source, fadeOut: undefined });
      part = { ...part, id: id(), in: source, fadeIn: undefined, transition: undefined };
      added += 1;
    }
    main.push(part);
    start += duration;
  }
  return { project: added ? { ...project, main } : project, added };
}

export function applyTransitionPreset(project: Project, selectedId: string, duration: number | 'dip'): Project {
  const index = project.main.findIndex(clip => clip.id === selectedId);
  if (index <= 0) return project;
  if (duration !== 'dip' && (!Number.isFinite(duration) || duration < 0 || duration > 2)) throw new Error('Choose a transition between zero and two seconds.');
  const wasDip = !project.main[index].transition && project.main[index].fadeIn === .3 && project.main[index - 1].fadeOut === .3;
  return {
    ...project,
    main: project.main.map((clip, position) => {
      if (position === index) return { ...clip, transition: duration === 'dip' ? undefined : duration || undefined, fadeIn: duration === 'dip' ? .3 : undefined };
      if (position === index - 1 && (duration === 'dip' || wasDip)) return { ...clip, fadeOut: duration === 'dip' ? .3 : undefined };
      return clip;
    }),
  };
}
