/** Actual decoded amplitude, never a decorative or generated waveform. Times are source seconds. */
export interface AudioAnalysis {
  duration: number;
  rms: number[];
  peaks: number[];
  onsets: number[];
  sampleRate: number;
  channels: number;
}

export const MAX_ANALYSIS_SECONDS = 1800;
// At least .18 seconds separate candidates, so the full 30-minute source fits without discarding later trims.
export const MAX_ONSETS = 10_000;
const amplitude = (n: number) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));

/** Energy-rise candidates, not a claimed tempo grid. Silence and steady tones create no repeated beats. */
export function detectOnsets(energy: readonly number[], interval: number): number[] {
  if (!Number.isFinite(interval) || interval <= 0 || !energy.length) return [];
  const flux = energy.map((n, i) => Math.max(0, amplitude(n) - (i ? amplitude(energy[i - 1]) : 0)));
  const radius = Math.max(1, Math.round(.16 / interval));
  const picked: { time: number; strength: number }[] = [];
  for (let i = 0; i < flux.length; i++) {
    if (flux[i] < .018 || flux[i] < (flux[i - 1] ?? 0) || flux[i] < (flux[i + 1] ?? 0)) continue;
    let sum = 0, count = 0;
    for (let j = Math.max(0, i - radius); j <= Math.min(flux.length - 1, i + radius); j++) {
      if (j !== i) { sum += flux[j]; count++; }
    }
    if (flux[i] < Math.max(.018, count ? sum / count * 2.2 : .018)) continue;
    const candidate = { time: i * interval, strength: flux[i] };
    const last = picked.at(-1);
    if (last && candidate.time - last.time < .18) {
      if (candidate.strength > last.strength) picked[picked.length - 1] = candidate;
    } else picked.push(candidate);
  }
  return picked.slice(0, MAX_ONSETS).map(p => p.time);
}

/** Streaming-native equivalent for tests and small PCM fixtures; averages channel energy, not channel polarity. */
export function analyzeSamples(samples: ArrayLike<number>, sampleRate: number, channels = 1, bins = 1024): AudioAnalysis {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0 || !Number.isInteger(channels) || channels < 1) throw new Error('Invalid PCM format.');
  const frames = Math.floor(samples.length / channels);
  const duration = frames / sampleRate;
  if (!frames || duration > MAX_ANALYSIS_SECONDS) throw new Error('Audio analysis supports non-empty files up to 30 minutes.');
  const count = Math.max(1, Math.min(2048, Math.round(bins), frames));
  const sums = new Array<number>(count).fill(0), peaks = new Array<number>(count).fill(0), counts = new Array<number>(count).fill(0);
  const windowFrames = Math.max(1, Math.round(sampleRate * .02));
  const energy = new Array<number>(Math.ceil(frames / windowFrames)).fill(0);
  const energyCounts = new Array<number>(energy.length).fill(0);
  for (let frame = 0; frame < frames; frame++) {
    const bin = Math.min(count - 1, Math.floor(frame / frames * count));
    const window = Math.floor(frame / windowFrames);
    for (let channel = 0; channel < channels; channel++) {
      const sample = amplitude(Math.abs(samples[frame * channels + channel]));
      sums[bin] += sample * sample; counts[bin]++; peaks[bin] = Math.max(peaks[bin], sample);
      energy[window] += sample * sample; energyCounts[window]++;
    }
  }
  return { duration, rms: sums.map((sum, i) => Math.sqrt(sum / Math.max(1, counts[i]))), peaks, onsets: detectOnsets(energy.map((sum, i) => Math.sqrt(sum / Math.max(1, energyCounts[i]))), windowFrames / sampleRate), sampleRate, channels };
}

/** Samples only the visible source range. Fractional bins are weighted, preserving RMS when zooming. */
export function sampleWaveform(analysis: AudioAnalysis, sourceIn: number, sourceOut: number, columns: number): { rms: number; peak: number }[] {
  const count = Math.max(0, Math.min(512, Math.ceil(columns)));
  if (!count || !analysis.peaks.length || analysis.duration <= 0 || sourceOut <= sourceIn) return [];
  const interval = analysis.duration / analysis.peaks.length;
  return Array.from({ length: count }, (_, col) => {
    const from = sourceIn + (sourceOut - sourceIn) * col / count;
    const to = sourceIn + (sourceOut - sourceIn) * (col + 1) / count;
    let sum = 0, weight = 0, peak = 0;
    const first = Math.max(0, Math.floor(from / interval));
    const last = Math.min(analysis.peaks.length - 1, Math.ceil(to / interval) - 1);
    for (let i = first; i <= last; i++) {
      const overlap = Math.max(0, Math.min(to, (i + 1) * interval) - Math.max(from, i * interval));
      sum += amplitude(analysis.rms[i]) ** 2 * overlap; weight += overlap;
      if (overlap) peak = Math.max(peak, amplitude(analysis.peaks[i]));
    }
    return { rms: weight ? Math.sqrt(sum / weight) : 0, peak };
  });
}

/** Rebase source candidates to this clip, respecting trim and playback speed. */
export function onsetsForClip(analysis: AudioAnalysis, clip: { in: number; out: number; start: number; speed?: number }, maxTime = Infinity): number[] {
  const speed = Number.isFinite(clip.speed) && (clip.speed ?? 0) > 0 ? clip.speed! : 1;
  return analysis.onsets.filter(t => t >= clip.in && t < clip.out).map(t => clip.start + (t - clip.in) / speed).filter(t => t >= 0 && t <= maxTime);
}

export function validateAnalysis(value: AudioAnalysis): AudioAnalysis {
  if (!value || !Number.isFinite(value.duration) || value.duration <= 0 || value.duration > MAX_ANALYSIS_SECONDS + .1 || !Array.isArray(value.peaks) || !Array.isArray(value.rms) || !value.peaks.length || value.peaks.length > 2048 || value.rms.length !== value.peaks.length) throw new Error('This file did not return a readable audio waveform.');
  return { duration: value.duration, rms: value.rms.map(amplitude), peaks: value.peaks.map(amplitude), onsets: [...new Set((Array.isArray(value.onsets) ? value.onsets : []).filter(t => Number.isFinite(t) && t >= 0 && t < value.duration))].sort((a, b) => a - b).slice(0, MAX_ONSETS), sampleRate: value.sampleRate, channels: value.channels };
}
