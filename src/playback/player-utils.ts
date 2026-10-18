import type { VideoPlayer } from 'expo-video';

/** Resolves once the player's current source can be played (or rejects on error / timeout). */
export function waitReady(player: VideoPlayer, timeoutMs = 10000): Promise<void> {
  if (player.status === 'readyToPlay') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const done = (err?: Error) => {
      clearTimeout(timer);
      sub.remove();
      if (err) reject(err);
      else resolve();
    };
    const timer = setTimeout(() => done(new Error('Timed out loading video')), timeoutMs);
    const sub = player.addListener('statusChange', ({ status, error }) => {
      if (status === 'readyToPlay') done();
      else if (status === 'error') done(new Error(error?.message ?? 'Video failed to load'));
    });
    if (player.status === 'error') done(new Error('Video failed to load'));
  });
}

/**
 * Stands in for an expo-video player on photo clips so the engine runs them like any other clip: a wall clock that
 * advances while "playing". The preview draws the image itself (see ClipLayer).
 *
 * ponytail: implements only what engine.ts touches; a cast, not a full VideoPlayer.
 */
export function createStillPlayer(): VideoPlayer {
  let base = 0;
  let since = 0;
  let playing = false;
  const now = () => performance.now() / 1000;
  const still = {
    status: 'readyToPlay',
    playbackRate: 1,
    volume: 1,
    muted: false,
    timeUpdateEventInterval: 0,
    preservesPitch: true,
    keepScreenOnWhilePlaying: true,
    scrubbingModeOptions: {},
    get currentTime() {
      return playing ? base + (now() - since) * still.playbackRate : base;
    },
    set currentTime(t: number) {
      base = t;
      since = now();
    },
    get playing() {
      return playing;
    },
    play() {
      if (playing) return;
      since = now();
      playing = true;
    },
    pause() {
      base = still.currentTime;
      playing = false;
    },
    addListener: () => ({ remove() {} }),
    release() {},
  };
  return still as unknown as VideoPlayer;
}
