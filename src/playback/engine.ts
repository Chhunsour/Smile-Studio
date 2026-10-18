import { createVideoPlayer, type VideoPlayer } from 'expo-video';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSharedValue, type SharedValue } from 'react-native-reanimated';

import { clipDuration, clipStarts, fadeGain, locate, totalDuration, transitionLength } from '@/core/timeline';
import { planAudioPlayers } from '@/core/audio-pool';
import type { AudioClip, ID, MediaAsset, VideoClip } from '@/core/types';
import { fileUri } from '@/storage/projects';
import { createStillPlayer, waitReady } from './player-utils';

/**
 * Preview playback for the magnetic main track, built on expo-video.
 *
 * One player per source asset (small LRU pool). The next clip's player is preloaded and parked on
 * its in-point, so cuts between different files are a view swap rather than a load. Contiguous
 * pieces of the same file (e.g. after a split) keep playing without any seek.
 *
 * Photos get a clock-only stand-in player (createStillPlayer), so they cut and preload like videos.
 *
 * Crossfades: the next clip's player is already parked on its in-point, and when a clip starts with a crossfade the
 * previous clip's player is parked on its last frame; Preview fades between the two views.
 *
 * Audio clips (music, voiceover) each get their own player, slaved to the video clock: started/stopped as the
 * playhead crosses them and re-seeked if they drift more than AUDIO_DRIFT.
 *
 * ponytail: two non-contiguous clips from the *same* file share a player, so that cut costs one
 * seek (~1 frame hitch). Key the pool by asset+instance if that ever matters.
 */
const POOL_SIZE = 3;
/** Switch to the next clip this close (seconds) to the out-point; the frame loop runs at ~60 Hz. */
const END_EPSILON = 0.02;
/** Re-seek audio only past this drift; a seek itself takes ~0.2s to land, so smaller corrections oscillate. */
const AUDIO_DRIFT = 0.2;
const AUDIO_CHECK_MS = 1000;

interface PoolEntry {
  assetId: ID;
  player: VideoPlayer;
  ready: Promise<void>;
  /** The clip this player is currently set up for (its transform/color apply to the view). */
  clipId: ID | null;
  /** Last volume we set, so fades only touch the player when the value changes. */
  volume: number;
}

interface AudioEntry {
  clip: AudioClip;
  player: VideoPlayer;
  ready: boolean;
  on: boolean;
  lastCheck: number;
  volume: number;
}

export interface PlaybackEngine {
  /** Playhead in timeline seconds. Written by the engine while playing, by the timeline while scrubbing. */
  time: SharedValue<number>;
  duration: number;
  playing: boolean;
  /** Number of overlapping audible layers beyond the eight-player preview limit. */
  audioOverflow: number;
  /** Players to render, the clip each one shows, and which one is visible. */
  views: { assetId: ID; player: VideoPlayer; clipId: ID | null }[];
  activeAssetId: ID | null;
  play(): void;
  pause(): void;
  toggle(): void;
  /** Show the frame at timeline time `t` (does not write `time`). */
  seek(t: number): void;
  /** Show an arbitrary source frame, e.g. while dragging a trim handle. */
  peek(assetId: ID, sourceTime: number): void;
  setScrubbing(on: boolean): void;
  /** Silence every player (clip sound and music), e.g. while recording a voiceover. */
  setMuted(on: boolean): void;
  /** Re-draw the paused frame (Android's TextureView goes blank after a resize until the player seeks). */
  redraw(): void;
  currentTime(): number;
  isPlaying(): boolean;
}

/** Releasing must never take the editor down with it (worst case the player is collected later). */
function release(p: VideoPlayer) {
  try {
    p.release();
  } catch (e) {
    console.warn('Could not release player', e);
  }
}

function configure(p: VideoPlayer) {
  p.timeUpdateEventInterval = 0;
  p.preservesPitch = true;
  p.keepScreenOnWhilePlaying = true;
}

export function usePlaybackEngine(
  main: VideoClip[],
  assets: Record<ID, MediaAsset>,
  audio: AudioClip[],
): PlaybackEngine {
  const time = useSharedValue(0);
  const [playing, setPlaying] = useState(false);
  const [views, setViews] = useState<PoolEntry[]>([]);
  const [activeAssetId, setActiveAssetId] = useState<ID | null>(null);
  const [audioOverflow, setAudioOverflow] = useState(0);

  // Mutable engine state lives in a ref: it changes every frame and must not trigger renders.
  const s = useRef({
    main: [] as VideoClip[],
    starts: [] as number[],
    total: 0,
    assets: {} as Record<ID, MediaAsset>,
    pool: [] as PoolEntry[],
    released: [] as VideoPlayer[],
    audio: new Map<ID, AudioEntry>(),
    audioClips: [] as AudioClip[],
    audioPlanTime: -Infinity,
    nextAudioPlanAt: -Infinity,
    audioRetryAt: Infinity,
    audioFailedUntil: new Map<ID, number>(),
    audioOverflow: 0,
    active: null as PoolEntry | null,
    index: 0,
    t: 0,
    playing: false,
    switching: false,
    raf: 0,
    token: 0,
    scrubbing: false,
    muted: false,
    disposed: false,
  }).current;

  const engine = useMemo<
    Omit<PlaybackEngine, 'time' | 'duration' | 'playing' | 'views' | 'activeAssetId' | 'audioOverflow'> & {
      setAudio(clips: AudioClip[]): void;
    }
  >(() => {
    function publishPool() {
      setViews(s.pool.slice());
    }

    function ensurePlayer(assetId: ID): PoolEntry {
      let entry = s.pool.find((e) => e.assetId === assetId);
      if (!entry) {
        const asset = s.assets[assetId];
        const player = asset.kind === 'image' ? createStillPlayer() : createVideoPlayer({ uri: fileUri(asset.path) });
        configure(player);
        if (s.scrubbing) player.scrubbingModeOptions = { scrubbingModeEnabled: true };
        const created: PoolEntry = { assetId, player, ready: waitReady(player), clipId: null, volume: -1 };
        // A file can end a little before its probed duration (e.g. audio and video tracks of different lengths),
        // so a clip whose out-point is the end of the file would never reach `out - END_EPSILON` in tick().
        player.addListener('playToEnd', () => {
          if (s.playing && !s.switching && s.active === created) advance();
        });
        // A player that never becomes ready (e.g. no free decoder on a busy device) is dropped so the
        // next request builds a fresh one instead of reusing the dead entry.
        created.ready.catch((e) => {
          if (s.disposed || !s.pool.includes(created)) return; // released on purpose while loading
          console.warn('Preview failed to load', asset.name, e);
          s.pool = s.pool.filter((x) => x !== created);
          s.released.push(player);
          publishPool();
        });
        entry = created;
      }
      // Most recently used first; evict from the tail, never the active player.
      s.pool = [entry, ...s.pool.filter((e) => e !== entry)];
      while (s.pool.length > POOL_SIZE) {
        const victimIdx = s.pool.findLastIndex((e) => e !== s.active && e !== entry);
        if (victimIdx < 0) break;
        const [victim] = s.pool.splice(victimIdx, 1);
        victim.player.pause();
        s.released.push(victim.player);
      }
      publishPool();
      return entry;
    }

    /** Clip volume with its fades, `local` timeline seconds into the clip. */
    function setClipVolume(entry: PoolEntry, clip: VideoClip, local: number) {
      const v = clip.volume * fadeGain(local, clipDuration(clip), clip.fadeIn, clip.fadeOut);
      if (Math.abs(v - entry.volume) < 0.005) return;
      entry.volume = v;
      entry.player.volume = v;
    }

    function applyClip(entry: PoolEntry, clip: VideoClip, keepPlaying: boolean, local = 0) {
      const { player } = entry;
      if (player.playbackRate !== clip.speed) {
        player.playbackRate = clip.speed;
        // On iOS expo-video applies the rate via AVPlayer.rate, which also *starts* playback.
        if (!keepPlaying) player.pause();
      }
      setClipVolume(entry, clip, local);
      player.muted = s.muted || clip.volume === 0;
      if (entry.clipId !== clip.id) {
        entry.clipId = clip.id;
        publishPool();
      }
    }

    function activate(entry: PoolEntry) {
      if (s.active === entry) return;
      s.active?.player.pause();
      s.active = entry;
      setActiveAssetId(entry.assetId);
    }

    /** Make clip `index` the active one at `source`; optionally start playing. */
    async function showClip(index: number, source: number, autoplay: boolean, retry = true) {
      const token = ++s.token;
      const clip = s.main[index];
      if (!clip) return;
      const entry = ensurePlayer(clip.assetId);
      s.index = index;
      try {
        await entry.ready;
      } catch {
        // One retry with a fresh player (the failed one was evicted above).
        if (retry && token === s.token && !s.disposed) await showClip(index, source, autoplay, false);
        return;
      }
      if (token !== s.token || s.disposed) return;
      applyClip(entry, clip, autoplay, (source - clip.in) / clip.speed);
      // While playing, a preloaded player is already parked on the in-point and re-seeking would cost a hitch
      // at the cut. While paused, always seek: on Android it's what makes a newly attached view draw a frame.
      if (!autoplay || Math.abs(entry.player.currentTime - source) > 0.03) entry.player.currentTime = source;
      activate(entry);
      if (autoplay) entry.player.play();
      preloadAfter(index);
      parkBefore(index);
    }

    /** For a crossfade into clip `index`: show the previous clip's last frame in its own view. */
    function parkBefore(index: number) {
      const prev = s.main[index - 1];
      const cur = s.main[index];
      if (!prev || prev.assetId === cur.assetId || transitionLength(s.main, index) <= 0) return;
      const entry = ensurePlayer(prev.assetId);
      entry.ready.then(
        () => {
          if (s.active === entry) return;
          entry.player.pause();
          entry.player.currentTime = Math.max(prev.in, prev.out - END_EPSILON * 1.5);
          if (entry.clipId !== prev.id) {
            entry.clipId = prev.id;
            publishPool();
          }
        },
        () => {},
      );
    }

    function preloadAfter(index: number) {
      const cur = s.main[index];
      const next = s.main[index + 1];
      if (!cur || !next || next.assetId === cur.assetId) return;
      const entry = ensurePlayer(next.assetId);
      entry.ready.then(
        () => {
          if (s.active === entry) return;
          entry.player.currentTime = next.in;
          // So the preview shows this clip's look (crop, color) at the cut. Not speed: on iOS that starts playback.
          if (entry.clipId !== next.id) {
            entry.clipId = next.id;
            publishPool();
          }
        },
        () => {},
      );
    }

    function advance() {
      const cur = s.main[s.index];
      const nextIndex = s.index + 1;
      const next = s.main[nextIndex];
      if (!next) {
        pause();
        s.t = s.total;
        time.value = s.total;
        return;
      }
      if (next.assetId === cur.assetId && Math.abs(next.in - cur.out) < 0.05 && s.active) {
        // Contiguous piece of the same file: keep the decoder running.
        s.index = nextIndex;
        applyClip(s.active, next, true);
        preloadAfter(nextIndex);
        return;
      }
      s.switching = true;
      showClip(nextIndex, next.in, true).finally(() => (s.switching = false));
    }

    function tick() {
      if (!s.playing) return;
      const clip = s.main[s.index];
      const player = s.active?.player;
      if (clip && player && !s.switching && s.active?.assetId === clip.assetId) {
        const src = player.currentTime;
        if (src >= clip.out - END_EPSILON) {
          advance();
        } else {
          const local = Math.max(0, src - clip.in) / clip.speed;
          const t = s.starts[s.index] + local;
          s.t = t;
          time.value = t;
          if (clip.fadeIn || clip.fadeOut) setClipVolume(s.active!, clip, local);
          syncAudio(t);
        }
      }
      s.raf = requestAnimationFrame(tick);
    }

    function play() {
      if (s.playing || !s.main.length) return;
      if (s.t >= s.total - END_EPSILON) s.t = 0;
      const hit = locate(s.main, s.t)!;
      setAudio(s.audioClips); // recreates any audio player that failed to load
      s.playing = true;
      setPlaying(true);
      s.switching = true;
      showClip(hit.index, hit.source, true).finally(() => (s.switching = false));
      s.raf = requestAnimationFrame(tick);
    }

    function pause() {
      if (!s.playing) return;
      s.playing = false;
      setPlaying(false);
      cancelAnimationFrame(s.raf);
      s.active?.player.pause();
      syncAudio(s.t);
    }

    /** Start, stop and drift-correct audio clips against timeline time `t`. */
    function syncAudio(t: number) {
      const now = Date.now();
      prepareAudio(t, false, now);
      for (const e of s.audio.values()) {
        if (!e.ready) continue;
        const a = e.clip;
        const expected = a.in + (t - a.start);
        const audible = s.playing && t >= a.start && expected < a.out - END_EPSILON;
        const volume = a.volume * fadeGain(t - a.start, a.out - a.in, a.fadeIn, a.fadeOut);
        if (audible && Math.abs(volume - e.volume) >= 0.005) {
          e.volume = volume;
          e.player.volume = volume;
        }
        if (audible && !e.on) {
          e.player.muted = s.muted;
          e.player.currentTime = expected;
          e.player.play();
          e.on = true;
          e.lastCheck = now;
        } else if (audible && now - e.lastCheck > AUDIO_CHECK_MS) {
          e.lastCheck = now;
          if (Math.abs(e.player.currentTime - expected) > AUDIO_DRIFT) {
            e.player.currentTime = expected;
            e.lastCheck = now + AUDIO_CHECK_MS; // let the seek land before judging drift again
          }
        } else if (!audible && e.on) {
          e.player.pause();
          e.on = false;
        }
      }
    }

    /** Re-plan only at source boundaries, seeks or edits. Never allocate a decoder per future loop segment. */
    function prepareAudio(t: number, force = false, now = Date.now()) {
      if (s.disposed) return;
      if (!force && t >= s.audioPlanTime && t < s.nextAudioPlanAt && now < s.audioRetryAt) return;
      const plan = planAudioPlayers(s.audioClips.filter(c => !!s.assets[c.assetId]), t);
      s.audioPlanTime = t;
      s.nextAudioPlanAt = plan.nextChange;
      s.audioRetryAt = Infinity;
      const overflow = s.muted ? 0 : plan.overflow;
      if (s.audioOverflow !== overflow) { s.audioOverflow = overflow; setAudioOverflow(overflow); }
      const ids = new Set(plan.clips.map(a => a.id));
      for (const [id, e] of s.audio) {
        if (ids.has(id)) continue;
        // Remove before release: an asynchronous failure from a retired player must not schedule a retry.
        s.audio.delete(id);
        release(e.player);
      }
      for (const clip of plan.clips) {
        const existing = s.audio.get(clip.id);
        if (existing && existing.clip.assetId === clip.assetId) {
          existing.clip = clip;
          continue;
        }
        if (existing) { s.audio.delete(clip.id); release(existing.player); }
        const failedUntil = s.audioFailedUntil.get(clip.id) ?? 0;
        if (failedUntil > now) { s.audioRetryAt = Math.min(s.audioRetryAt, failedUntil); continue; }
        const asset = s.assets[clip.assetId];
        if (!asset) continue;
        let player: VideoPlayer;
        try { player = createVideoPlayer({ uri: fileUri(asset.path) }); }
        catch (error) {
          console.warn('Audio player could not be created', asset.name, error);
          s.audioFailedUntil.set(clip.id, now + 2000); s.audioRetryAt = Math.min(s.audioRetryAt, now + 2000);
          continue;
        }
        player.timeUpdateEventInterval = 0;
        player.muted = s.muted;
        const entry: AudioEntry = { clip, player, ready: false, on: false, lastCheck: 0, volume: -1 };
        s.audio.set(clip.id, entry);
        waitReady(player).then(
          () => {
            if (s.disposed || s.audio.get(clip.id) !== entry) return;
            entry.ready = true;
            s.audioFailedUntil.delete(clip.id);
            if (s.playing) syncAudio(s.t);
          },
          (e) => {
            if (s.audio.get(clip.id) !== entry) return; // released on purpose while loading
            console.warn('Audio failed to load', asset.name, e);
            // Forget it so the next play or edit creates a fresh player instead of keeping a dead one.
            s.audio.delete(clip.id);
            release(player);
            const retry = Date.now() + 2000;
            s.audioFailedUntil.set(clip.id, retry);
            s.audioRetryAt = Math.min(s.audioRetryAt, retry);
          },
        );
      }
    }

    function setAudio(clips: AudioClip[]) {
      s.audioClips = clips;
      const ids = new Set(clips.map(c => c.id));
      for (const id of s.audioFailedUntil.keys()) if (!ids.has(id)) s.audioFailedUntil.delete(id);
      prepareAudio(s.t, true);
    }

    function seek(t: number) {
      s.t = Math.min(Math.max(t, 0), s.total);
      // A scrub to another part of the movie primes its audio without starting it or changing audio focus.
      prepareAudio(s.t, true);
      const hit = locate(s.main, s.t);
      if (!hit) return;
      const entry = s.active;
      if (entry && entry.assetId === hit.clip.assetId && entry.player.status === 'readyToPlay') {
        // Fast path for scrubbing within the current file: no promise hop.
        s.token++;
        s.index = hit.index;
        applyClip(entry, hit.clip, false);
        entry.player.currentTime = hit.source;
        return;
      }
      void showClip(hit.index, hit.source, false);
    }

    function peek(assetId: ID, sourceTime: number) {
      if (s.playing) pause();
      const token = ++s.token;
      const entry = ensurePlayer(assetId);
      entry.ready.then(
        () => {
          if (token !== s.token) return;
          entry.player.currentTime = sourceTime;
          activate(entry);
        },
        () => {},
      );
    }

    function setScrubbing(on: boolean) {
      s.scrubbing = on;
      if (on) pause();
      for (const e of s.pool) e.player.scrubbingModeOptions = { scrubbingModeEnabled: on };
    }

    function setMuted(on: boolean) {
      s.muted = on;
      for (const e of s.pool) {
        const clip = e.clipId ? s.main.find((c) => c.id === e.clipId) : undefined;
        e.player.muted = on || clip?.volume === 0;
      }
      for (const e of s.audio.values()) e.player.muted = on;
      prepareAudio(s.t, true);
    }

    return {
      play,
      pause,
      setMuted,
      toggle: () => (s.playing ? pause() : play()),
      seek,
      peek,
      setScrubbing,
      setAudio,
      redraw: () => {
        const e = s.active;
        // A seek to the current position is a no-op on Android, so nudge by 1ms (same frame).
        if (e && !s.playing && !s.disposed && e.player.status === 'readyToPlay')
          e.player.currentTime = e.player.currentTime + 0.001;
      },
      currentTime: () => s.t,
      isPlaying: () => s.playing,
    };
    // `s` and `time` are stable refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Declared first so it runs before the sync effect below; also survives Fast Refresh effect re-runs.
  useEffect(() => {
    s.disposed = false;
    return () => {
      s.disposed = true;
      s.playing = false;
      cancelAnimationFrame(s.raf);
      for (const e of s.pool) release(e.player);
      for (const p of s.released) release(p);
      for (const e of s.audio.values()) release(e.player);
      s.audio.clear();
      s.audioFailedUntil.clear();
      s.nextAudioPlanAt = -Infinity;
      s.audioPlanTime = -Infinity;
      s.audioRetryAt = Infinity;
      s.audioOverflow = 0;
      setAudioOverflow(0);
      s.pool = [];
      s.released = [];
      s.active = null;
      setViews([]);
      setActiveAssetId(null);
      setPlaying(false);
    };
  }, [s]);

  // Re-sync whenever the edit changes: editing pauses playback and re-shows the frame under the playhead.
  useEffect(() => {
    s.main = main;
    s.assets = assets;
    s.starts = clipStarts(main);
    s.total = totalDuration(main);
    engine.pause();
    engine.setAudio(audio);
    const t = Math.min(s.t, s.total);
    time.value = t;
    engine.seek(t);
  }, [main, assets, audio, engine, s, time]);

  // Release evicted players once their views are unmounted.
  useEffect(() => {
    const doomed = s.released.splice(0);
    for (const p of doomed) release(p);
  }, [views, s]);

  return useMemo(
    () => ({
      ...engine,
      time,
      duration: totalDuration(main),
      playing,
      audioOverflow,
      views: views.map((e) => ({ assetId: e.assetId, player: e.player, clipId: e.clipId })),
      activeAssetId,
    }),
    [engine, time, main, playing, views, activeAssetId, audioOverflow],
  );
}
