import { sampleWaveform, validateAnalysis, type AudioAnalysis } from './audio-analysis.ts';
import { audioEnd, clipStarts, fadeLengths, MIN_CLIP, totalDuration } from './timeline.ts';
import type { AudioClip, ID, Project } from './types.ts';

export const AUDIO_PRESETS = [
  { id: 'voice', name: 'Voice', description: 'Full volume · quick, gentle edges', volume: 1, fadeIn: .02, fadeOut: .08 },
  { id: 'music', name: 'Music bed', description: '35% volume · soft entrance and finish', volume: .35, fadeIn: .3, fadeOut: .8 },
  { id: 'ambient', name: 'Ambience', description: '18% volume · slow fades', volume: .18, fadeIn: 1, fadeOut: 1 },
  { id: 'accent', name: 'Sound effect', description: '80% volume · crisp edges', volume: .8, fadeIn: 0, fadeOut: .02 },
] as const;

export type AudioPresetId = typeof AUDIO_PRESETS[number]['id'];
export const MAX_AUDIO_REPEATS = 128;

function audioById(project: Project, id: ID): AudioClip {
  const audio = project.audio.find(clip => clip.id === id);
  if (!audio) throw new Error('Select an audio track first.');
  if (!Number.isFinite(audio.start) || !Number.isFinite(audio.in) || !Number.isFinite(audio.out) || audio.start < 0 || audio.in < 0 || audio.out <= audio.in) throw new Error('This audio track has an invalid trim.');
  const asset = project.assets[audio.assetId];
  if (!asset || asset.kind === 'image' || !Number.isFinite(asset.duration) || audio.out > asset.duration + 1e-6) throw new Error('This audio source is missing or its trim is outside the file.');
  return audio;
}

function replaceAudio(project: Project, clip: AudioClip): Project {
  const original = project.audio.find(audio => audio.id === clip.id);
  if (original && Object.keys(clip).every(key => clip[key as keyof AudioClip] === original[key as keyof AudioClip])) return project;
  return { ...project, audio: project.audio.map(audio => audio.id === clip.id ? clip : audio) };
}

export function extractableVideoClip(project: Project, id: ID) {
  const clip = project.main.find(item => item.id === id);
  if (!clip || project.assets[clip.assetId]?.kind !== 'video') throw new Error('Select a video clip with sound first.');
  if (clip.speed !== 1) throw new Error('Set this video to 1× speed before extracting sound. Audio tracks currently play at 1×.');
  if (!Number.isFinite(clip.in) || !Number.isFinite(clip.out) || clip.in < 0 || clip.out - clip.in < MIN_CLIP - 1e-8 || clip.out > project.assets[clip.assetId].duration + 1e-6) throw new Error('This video has an invalid trim.');
  return clip;
}

/** Extract only a readable, audible selected range; the source media stays unmodified. */
export function extractVideoAudio(project: Project, id: ID, makeId: () => ID, analysis: AudioAnalysis): Project {
  const clip = extractableVideoClip(project, id);
  const waveform = validateAnalysis(analysis);
  if ((sampleWaveform(waveform, clip.in, clip.out, 1)[0]?.peak ?? 0) <= .0001) throw new Error('This trimmed range is silent. There is no audio to extract.');
  return detachVideoAudio(project, id, makeId);
}

export function detachVideoAudio(project: Project, id: ID, makeId: () => ID, muteOriginal = true): Project {
  const clip = extractableVideoClip(project, id);
  const index = project.main.findIndex(item => item.id === id);
  const audioId = makeId();
  if (!audioId || [...project.main, ...project.texts, ...project.audio].some(item => item.id === audioId)) throw new Error('Could not create a unique audio track.');
  const audio: AudioClip = {
    id: audioId, assetId: clip.assetId, start: clipStarts(project.main)[index],
    in: clip.in, out: clip.out, volume: clip.volume,
    fadeIn: clip.fadeIn, fadeOut: clip.fadeOut,
  };
  return {
    ...project,
    main: muteOriginal ? project.main.map(item => item.id === id ? { ...item, volume: 0 } : item) : project.main,
    audio: [...project.audio, audio],
  };
}

export function setOriginalAudioMuted(project: Project, muted: boolean): Project {
  const volume = muted ? 0 : 1;
  const affected = (assetId: ID) => project.assets[assetId]?.kind === 'video';
  if (!project.main.some(clip => affected(clip.assetId) && clip.volume !== volume)) return project;
  return { ...project, main: project.main.map(clip => affected(clip.assetId) ? { ...clip, volume } : clip) };
}

export function applyAudioPreset(project: Project, id: ID, presetId: AudioPresetId): Project {
  const clip = audioById(project, id);
  const preset = AUDIO_PRESETS.find(item => item.id === presetId);
  if (!preset) throw new Error('Choose an audio preset.');
  const [fadeIn, fadeOut] = fadeLengths(clip.out - clip.in, preset.fadeIn, preset.fadeOut);
  return replaceAudio(project, { ...clip, volume: preset.volume, fadeIn, fadeOut });
}

export function setAudioFades(project: Project, id: ID, seconds: number): Project {
  const clip = audioById(project, id);
  if (!Number.isFinite(seconds) || seconds < 0) throw new Error('Use a fade length of zero or more seconds.');
  const [fadeIn, fadeOut] = fadeLengths(clip.out - clip.in, seconds, seconds);
  return replaceAudio(project, { ...clip, fadeIn, fadeOut });
}

export function fitAudioToProject(project: Project, id: ID): Project {
  const clip = audioById(project, id);
  const remaining = totalDuration(project.main) - clip.start;
  if (remaining <= 0) throw new Error('Move this audio inside the video timeline first.');
  if (audioEnd(clip) <= totalDuration(project.main)) return project;
  const out = clip.in + remaining;
  const [fadeIn, fadeOut] = fadeLengths(remaining, clip.fadeIn, clip.fadeOut);
  return replaceAudio(project, { ...clip, out, fadeIn, fadeOut });
}

export function repeatAudioToEnd(project: Project, id: ID, makeId: () => ID): Project {
  const clip = audioById(project, id);
  const end = totalDuration(project.main);
  const duration = clip.out - clip.in;
  if (end <= clip.start) throw new Error('Move this audio inside the video timeline first.');
  const count = Math.max(1, Math.ceil((end - clip.start - 1e-8) / duration));
  if (count > MAX_AUDIO_REPEATS) throw new Error(`Choose a longer audio segment. Repeat supports up to ${MAX_AUDIO_REPEATS} pieces.`);
  const used = new Set([...project.main, ...project.audio, ...project.texts].map(item => item.id));
  const existing = new Map<number, AudioClip>();
  const repeatedIds = new Set<ID>();
  let lastExistingIndex = 0;
  for (const audio of project.audio) {
    if (audio.id === id || audio.assetId !== clip.assetId || Math.abs(audio.in - clip.in) >= 1e-6 || audio.out > clip.out + 1e-6) continue;
    const index = Math.round((audio.start - clip.start) / duration);
    if (index < 1 || Math.abs(audio.start - (clip.start + index * duration)) >= 1e-6) continue;
    if (!existing.has(index)) existing.set(index, audio);
    repeatedIds.add(audio.id);
    lastExistingIndex = Math.max(lastExistingIndex, index);
  }
  const closingFadeOut = existing.get(lastExistingIndex)?.fadeOut ?? clip.fadeOut;
  const copies: AudioClip[] = [];
  for (let index = 0; index < count; index++) {
    const start = clip.start + index * duration;
    const length = Math.min(duration, end - start);
    if (!index) {
      const first = count === 1 ? fitAudioToProject(project, id).audio.find(audio => audio.id === id)! : clip.fadeOut === 0 ? clip : { ...clip, fadeOut: 0 };
      copies.push(first);
      continue;
    }
    const matched = existing.get(index);
    if (matched) {
      const out = index === count - 1 || (index === lastExistingIndex && matched.out < clip.out - 1e-6) ? matched.in + length : matched.out;
      copies.push(Math.abs(out - matched.out) < 1e-8 ? matched : { ...matched, out });
      continue;
    }
    const nextId = makeId();
    if (!nextId || used.has(nextId)) throw new Error('Could not create unique repeated tracks.');
    used.add(nextId);
    const [fadeIn, fadeOut] = fadeLengths(length, 0, index === count - 1 ? closingFadeOut : 0);
    copies.push({ ...clip, id: nextId, start, out: clip.in + length, fadeIn, fadeOut });
  }
  const replacements = new Map(copies.map(audio => [audio.id, audio]));
  const added = copies.filter(audio => !project.audio.some(previous => previous.id === audio.id));
  const audio = project.audio.flatMap(previous => previous.id === id ? [copies[0], ...added] : repeatedIds.has(previous.id) ? replacements.has(previous.id) ? [replacements.get(previous.id)!] : [] : [previous]);
  if (audio.length === project.audio.length && audio.every((item, index) => item === project.audio[index])) return project;
  return { ...project, audio };
}

export function focusVoice(project: Project, id: ID): Project {
  const voice = audioById(project, id);
  const starts = clipStarts(project.main);
  const overlaps = (start: number, end: number) => start < audioEnd(voice) && end > voice.start;
  let changed = false;
  const quiet = (volume: number) => {
    const next = Math.min(volume, .2);
    changed ||= next !== volume;
    return next;
  };
  const main = project.main.map((clip, index) => overlaps(starts[index], starts[index] + (clip.out - clip.in) / clip.speed) && project.assets[clip.assetId]?.kind === 'video' ? { ...clip, volume: quiet(clip.volume) } : clip);
  const audio = project.audio.map(clip => clip.id !== id && overlaps(clip.start, audioEnd(clip)) ? { ...clip, volume: quiet(clip.volume) } : clip);
  return changed ? { ...project, main, audio } : project;
}

export function normalizeAudioGain(project: Project, id: ID, analysis: AudioAnalysis, target = .85): Project {
  const clip = project.audio.find(audio => audio.id === id) ?? project.main.find(video => video.id === id);
  if (!clip) throw new Error('Select a video or audio track first.');
  if (!Number.isFinite(target) || target <= 0 || target > 1 || !Number.isFinite(analysis.duration) || analysis.duration <= 0 || !analysis.peaks.length) throw new Error('A readable audio waveform is needed to set the level.');
  const interval = analysis.duration / analysis.peaks.length;
  const first = Math.max(0, Math.floor(clip.in / interval));
  const last = Math.min(analysis.peaks.length, Math.ceil(clip.out / interval));
  let peak = 0;
  for (let index = first; index < last; index++) {
    const value = analysis.peaks[index];
    if (Number.isFinite(value)) peak = Math.max(peak, Math.min(1, Math.max(0, value)));
  }
  if (peak < .0001) throw new Error('This trimmed range is silent. There is no audio level to adjust.');
  const volume = Math.min(1, target / peak);
  if (Math.abs(clip.volume - volume) < 1e-8) return project;
  return project.audio.some(audio => audio.id === id)
    ? replaceAudio(project, { ...clip, volume } as AudioClip)
    : { ...project, main: project.main.map(video => video.id === id ? { ...video, volume } : video) };
}
