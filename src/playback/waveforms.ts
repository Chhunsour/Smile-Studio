import { useEffect } from 'react';
import { create } from 'zustand';

import { analyzeAudio } from '../../modules/smile-engine';
import { MAX_ANALYSIS_SECONDS, validateAnalysis, type AudioAnalysis } from '@/core/audio-analysis';
import type { MediaAsset } from '@/core/types';
import { fileUri } from '@/storage/projects';

export type WaveformState = { status: 'idle' | 'loading' | 'ready' | 'unavailable'; analysis?: AudioAnalysis; error?: string };
const IDLE: WaveformState = { status: 'idle' };
const cache = create<{ entries: Map<string, WaveformState> }>(() => ({ entries: new Map() }));
type Job = { asset: MediaAsset; promise: Promise<AudioAnalysis>; resolve: (a: AudioAnalysis) => void; reject: (e: Error) => void };
const jobs = new Map<string, Job>();
const queue: Job[] = [];
let active: AbortController | null = null;
let running = false;

function put(path: string, state: WaveformState) {
  cache.setState(({ entries }) => {
    const next = new Map(entries); next.delete(path); next.set(path, state);
    // Session cache is bounded; eviction merely regenerates a waveform if that asset is shown again.
    for (const [key, value] of next) {
      if (next.size <= 64) break;
      if (value.status !== 'loading') next.delete(key);
    }
    return { entries: next };
  });
}

function enqueue(asset: MediaAsset, priority: boolean): Promise<AudioAnalysis> {
  if (asset.kind === 'image') return Promise.reject(new Error('Still images have no audio to analyze.'));
  const known = cache.getState().entries.get(asset.path);
  if (known?.analysis) return Promise.resolve(known.analysis);
  if (known?.status === 'unavailable') return Promise.reject(new Error(known.error || 'This file has no readable audio.'));
  const pending = jobs.get(asset.path);
  if (pending) {
    const index = queue.indexOf(pending);
    if (priority && index > 0) { queue.splice(index, 1); queue.unshift(pending); }
    return pending.promise;
  }
  if (!Number.isFinite(asset.duration) || asset.duration <= 0 || asset.duration > MAX_ANALYSIS_SECONDS) {
    const error = 'Audio analysis supports files up to 30 minutes. Use a shorter source file.';
    put(asset.path, { status: 'unavailable', error });
    return Promise.reject(new Error(error));
  }
  let resolve!: Job['resolve'], reject!: Job['reject'];
  const promise = new Promise<AudioAnalysis>((yes, no) => { resolve = yes; reject = no; });
  const job = { asset, promise, resolve, reject };
  jobs.set(asset.path, job);
  if (priority) queue.unshift(job);
  else queue.push(job);
  put(asset.path, { status: 'loading' });
  setTimeout(() => { void pump(); }, 0);
  return promise;
}

async function pump() {
  if (running) return;
  running = true;
  try {
    while (queue.length) {
      const job = queue.shift()!;
      const controller = new AbortController(); active = controller;
      try {
        const analysis = validateAnalysis(await analyzeAudio(fileUri(job.asset.path), controller.signal));
        put(job.asset.path, { status: 'ready', analysis }); job.resolve(analysis);
      } catch (cause) {
        const error = cause instanceof Error ? cause : new Error('This file has no readable audio waveform.');
        put(job.asset.path, { status: 'unavailable', error: error.message }); job.reject(error);
      } finally { jobs.delete(job.asset.path); active = null; }
    }
  } finally { running = false; }
}

/** Lazy background request. Automatic failures never interrupt editing or show an alert. */
export function requestWaveform(asset: MediaAsset) {
  if (asset.kind !== 'image') void enqueue(asset, false).catch(() => {});
}

/** One immutable asset path shares decoded amplitudes across duplicates and trimmed clips. */
export function useWaveform(asset: MediaAsset | undefined): WaveformState {
  const value = cache(s => asset ? s.entries.get(asset.path) ?? IDLE : IDLE);
  useEffect(() => { if (asset && asset.kind !== 'image') requestWaveform(asset); }, [asset]);
  return value;
}

/** Explicit Beats action gets a descriptive error and priority over queued thumbnail waveforms. */
export function analyzeAsset(asset: MediaAsset): Promise<AudioAnalysis> { return enqueue(asset, true); }

/** Stop pending analysis on app teardown without ever touching playback or export decoders. */
export function cancelWaveformAnalysis() {
  active?.abort();
  const pending = queue.splice(0);
  for (const job of pending) {
    const error = new Error('Audio analysis cancelled.');
    jobs.delete(job.asset.path); put(job.asset.path, { status: 'unavailable', error: error.message }); job.reject(error);
  }
}
