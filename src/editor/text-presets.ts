import type { TextAnim, TextOverlay } from '../core/types';

export type TextStyle = Partial<Omit<TextOverlay, 'id' | 'start' | 'end'>>;

const animations = [
  { id: 'none', label: 'None', icon: 'ban-outline' },
  { id: 'fade', label: 'Fade', icon: 'invert-mode-outline' },
  { id: 'slide', label: 'Slide up', icon: 'arrow-up-outline' },
  { id: 'slideDown', label: 'Slide down', icon: 'arrow-down-outline' },
  { id: 'pop', label: 'Pop', icon: 'expand-outline' },
  { id: 'bounce', label: 'Bounce', icon: 'basketball-outline' },
  { id: 'zoomIn', label: 'Zoom in', icon: 'add-circle-outline' },
  { id: 'zoomOut', label: 'Zoom out', icon: 'remove-circle-outline' },
  { id: 'rise', label: 'Rise', icon: 'trending-up-outline' },
  { id: 'pulse', label: 'Pulse', icon: 'pulse-outline' },
] as const satisfies readonly { id: TextAnim; label: string; icon: string }[];

export const ANIMATION_PRESETS = Object.freeze(animations.map((preset) => Object.freeze(preset)));

const styles = [
  { label: 'Subtitle', style: { font: 'sans', color: '#FFFFFF', box: true, size: 0.05, x: 0.5, y: 0.85, rotation: 0, animIn: 'fade', animOut: 'fade' } },
  { label: 'Title', style: { font: 'condensed', color: '#FFFFFF', box: false, size: 0.13, x: 0.5, y: 0.42, rotation: 0, animIn: 'pop', animOut: 'fade' } },
  { label: 'Highlight', style: { font: 'rounded', color: '#FFD23F', box: false, size: 0.09, x: 0.5, y: 0.5, rotation: -4, animIn: 'slide', animOut: 'fade' } },
  { label: 'Quote', style: { font: 'serif', color: '#FFFFFF', box: false, size: 0.07, x: 0.5, y: 0.5, rotation: 0, animIn: 'fade', animOut: 'fade' } },
  { label: 'Tag', style: { font: 'mono', color: '#4ADE80', box: true, size: 0.045, x: 0.5, y: 0.12, rotation: 0, animIn: 'slide', animOut: 'none' } },
  { label: 'Reel hook', style: { font: 'condensed', color: '#FFD23F', box: true, size: 0.1, x: 0.5, y: 0.25, rotation: 0, animIn: 'pop', animOut: 'fade' } },
  { label: 'Minimal', style: { font: 'sans', color: '#FFFFFF', box: false, size: 0.045, x: 0.5, y: 0.78, rotation: 0, animIn: 'fade', animOut: 'fade' } },
  { label: 'Neon', style: { font: 'mono', color: '#4ADE80', box: true, size: 0.065, x: 0.5, y: 0.5, rotation: 0, animIn: 'slide', animOut: 'fade' } },
  { label: 'Chapter', style: { font: 'serif', color: '#FFE4BD', box: false, size: 0.09, x: 0.5, y: 0.35, rotation: 0, animIn: 'fade', animOut: 'fade' } },
  { label: 'Pop', style: { font: 'rounded', color: '#FF4F7B', box: false, size: 0.1, x: 0.5, y: 0.5, rotation: 6, animIn: 'pop', animOut: 'pop' } },
  { label: 'Lower third', style: { font: 'sans', color: '#FFFFFF', box: true, size: 0.055, x: 0.5, y: 0.76, rotation: 0, animIn: 'slide', animOut: 'slide' } },
  { label: 'Cinema', style: { font: 'serif', color: '#FFE4BD', box: false, size: 0.085, x: 0.5, y: 0.5, rotation: 0, animIn: 'zoomOut', animOut: 'fade' } },
  { label: 'Headline', style: { font: 'condensed', color: '#FFFFFF', box: true, size: 0.105, x: 0.5, y: 0.2, rotation: 0, animIn: 'slideDown', animOut: 'fade' } },
  { label: 'Travel', style: { font: 'serif', color: '#FFD23F', box: false, size: 0.09, x: 0.5, y: 0.4, rotation: 0, animIn: 'rise', animOut: 'fade' } },
  { label: 'Bubble', style: { font: 'rounded', color: '#FFFFFF', box: true, size: 0.08, x: 0.5, y: 0.5, rotation: 0, animIn: 'bounce', animOut: 'pop' } },
  { label: 'Tech', style: { font: 'mono', color: '#60A5FA', box: true, size: 0.055, x: 0.5, y: 0.2, rotation: 0, animIn: 'zoomIn', animOut: 'fade' } },
  { label: 'Soft pink', style: { font: 'rounded', color: '#F9A8D4', box: false, size: 0.075, x: 0.5, y: 0.5, rotation: 0, animIn: 'rise', animOut: 'fade' } },
  { label: 'Focus', style: { font: 'condensed', color: '#FFD23F', box: false, size: 0.12, x: 0.5, y: 0.5, rotation: 0, animIn: 'zoomIn', animOut: 'zoomOut' } },
  { label: 'Energy', style: { font: 'rounded', color: '#FF4F7B', box: true, size: 0.095, x: 0.5, y: 0.32, rotation: -3, animIn: 'pulse', animOut: 'pop' } },
  { label: 'Closing', style: { font: 'sans', color: '#FFFFFF', box: false, size: 0.075, x: 0.5, y: 0.5, rotation: 0, animIn: 'zoomOut', animOut: 'slide' } },
] satisfies { label: string; style: TextStyle }[];

export const TEXT_STYLE_PRESETS = Object.freeze(styles.map((preset) => Object.freeze({
  ...preset,
  style: Object.freeze(preset.style),
})));
