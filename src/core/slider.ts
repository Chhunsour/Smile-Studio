export const SLIDER_THUMB = 22;

export function createSliderLifecycle() {
  let active = false;
  return {
    activate: () => { active = true; },
    deactivate: () => { active = false; },
    run: (callback: ((value: number) => void) | undefined, value: number) => {
      if (active) callback?.(value);
    },
  };
}

export function sliderNormAt(position: number, width: number): number | null {
  'worklet';
  if (!Number.isFinite(position) || !Number.isFinite(width) || width <= SLIDER_THUMB) return null;
  return Math.min(1, Math.max(0, (position - SLIDER_THUMB / 2) / (width - SLIDER_THUMB)));
}

export function sliderCommitValue(success: boolean, width: number, norm: number, fromNorm: (norm: number) => number): number | null {
  'worklet';
  if (!success || !Number.isFinite(width) || width <= SLIDER_THUMB || !Number.isFinite(norm) || norm < 0 || norm > 1) return null;
  const value = fromNorm(norm);
  return Number.isFinite(value) ? value : null;
}

export function isSpeedCommitCurrent(current: {
  project: { id: string; main: readonly { id: string; speed: number }[] } | null;
  selectedId: string | null;
  panel: string | null;
}, expected: { projectId: string; clipId: string; speed: number }): boolean {
  return current.project?.id === expected.projectId && current.selectedId === expected.clipId && current.panel === 'speed'
    && current.project.main.find(clip => clip.id === expected.clipId)?.speed === expected.speed;
}
