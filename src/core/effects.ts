/** Optional settings keep schema-2 projects backwards compatible. Intensities are always 0..1. */
export interface ClipEffects {
  vignette?: number;
  grain?: number;
  scanlines?: number;
  letterbox?: number;
  lightLeak?: number;
  bloom?: number;
  goldenHour?: number;
  coolGlow?: number;
  dreamy?: number;
  neonFrame?: number;
  filmDust?: number;
  scratches?: number;
  retroFade?: number;
  frost?: number;
  spotlight?: number;
}

export type EffectId = keyof ClipEffects;
export const EFFECT_CATEGORIES = ['All', 'Cinema', 'Light', 'Texture', 'Color', 'Creative'] as const;
export type EffectCategory = typeof EFFECT_CATEGORIES[number];
export interface EffectDefinition {
  id: EffectId;
  name: string;
  description: string;
  defaultIntensity: number;
  category: Exclude<EffectCategory, 'All'>;
  tint: string;
  tags: readonly string[];
}
export const EFFECTS: readonly EffectDefinition[] = [
  { id: 'vignette', name: 'Vignette', description: 'Soft, darker edges around the scene.', defaultIntensity: .55, category: 'Cinema', tint: '#A9A0F4', tags: ['dark', 'focus'] },
  { id: 'grain', name: 'Film grain', description: 'A fine, consistent film texture.', defaultIntensity: .45, category: 'Texture', tint: '#D6C8A7', tags: ['retro', 'noise', 'analog'] },
  { id: 'scanlines', name: 'Scanlines', description: 'Horizontal lines for a retro screen look.', defaultIntensity: .4, category: 'Texture', tint: '#92D4BE', tags: ['vhs', 'tv', 'retro'] },
  { id: 'letterbox', name: 'Cinema bars', description: 'Adjust the height of black cinema bars.', defaultIntensity: .65, category: 'Cinema', tint: '#B5B8CF', tags: ['film', 'movie', 'wide'] },
  { id: 'lightLeak', name: 'Light leak', description: 'Warm orange and rose light along the edges.', defaultIntensity: .5, category: 'Light', tint: '#FF9A69', tags: ['sun', 'film', 'warm'] },
  { id: 'bloom', name: 'Soft glow', description: 'A gentle white glow that softens the edges.', defaultIntensity: .45, category: 'Light', tint: '#F4E9C7', tags: ['haze', 'bright', 'portrait'] },
  { id: 'goldenHour', name: 'Golden hour', description: 'Sunset amber light with a warm, golden wash.', defaultIntensity: .5, category: 'Light', tint: '#FFD16B', tags: ['sun', 'warm', 'summer'] },
  { id: 'coolGlow', name: 'Blue hour', description: 'Cool blue and violet light along the edges.', defaultIntensity: .5, category: 'Light', tint: '#93ADFF', tags: ['night', 'cool', 'blue'] },
  { id: 'dreamy', name: 'Dreamy', description: 'A soft rose-to-lavender wash across the scene.', defaultIntensity: .45, category: 'Color', tint: '#EDAAE4', tags: ['pastel', 'pink', 'romantic'] },
  { id: 'neonFrame', name: 'Neon frame', description: 'A bright cyan and pink border around the canvas.', defaultIntensity: .6, category: 'Creative', tint: '#69E5F5', tags: ['party', 'neon', 'border'] },
  { id: 'filmDust', name: 'Film dust', description: 'Small, scattered flecks for a vintage film texture.', defaultIntensity: .45, category: 'Texture', tint: '#E7D8B9', tags: ['retro', 'vintage', 'analog'] },
  { id: 'scratches', name: 'Film scratches', description: 'Fine vertical scratches, like an old film print.', defaultIntensity: .4, category: 'Texture', tint: '#CFC4B3', tags: ['retro', 'vintage', 'analog'] },
  { id: 'retroFade', name: 'Retro fade', description: 'A muted cream wash with faded, warm edges.', defaultIntensity: .5, category: 'Color', tint: '#DDBA83', tags: ['vintage', 'warm', 'matte'] },
  { id: 'frost', name: 'Frost', description: 'Pale, icy blue edges with a cool color wash.', defaultIntensity: .5, category: 'Color', tint: '#B8E7F4', tags: ['winter', 'cool', 'ice'] },
  { id: 'spotlight', name: 'Spotlight', description: 'Deeper, wider shadows that draw focus to the center.', defaultIntensity: .5, category: 'Cinema', tint: '#C2ADD7', tags: ['dark', 'focus', 'drama'] },
];

export interface EffectPreset {
  id: string;
  name: string;
  description: string;
  effects: ClipEffects;
  tint: string;
}

export const EFFECT_PRESETS: readonly EffectPreset[] = [
  { id: 'cinematic', name: 'Cinematic', description: 'Cinema bars, a gentle vignette and film grain.', effects: { letterbox: .55, vignette: .35, grain: .25 }, tint: '#B5B8CF' },
  { id: 'sunset', name: 'Sunset story', description: 'Golden light, warm leaks and softly faded color.', effects: { goldenHour: .45, lightLeak: .35, retroFade: .2 }, tint: '#FFD16B' },
  { id: 'portrait', name: 'Soft portrait', description: 'Gentle white glow and a subtle pastel wash.', effects: { bloom: .3, dreamy: .2, vignette: .15 }, tint: '#EDAAE4' },
  { id: 'vhs', name: 'Retro tape', description: 'Scanlines, film texture and faded color.', effects: { scanlines: .4, grain: .25, retroFade: .3 }, tint: '#92D4BE' },
  { id: 'archive', name: 'Old film', description: 'Dust, fine scratches and a warm vintage finish.', effects: { filmDust: .4, scratches: .35, grain: .2, retroFade: .3, vignette: .3 }, tint: '#DDBA83' },
  { id: 'neon', name: 'Neon night', description: 'Cyan and pink borders with cool evening light.', effects: { neonFrame: .65, coolGlow: .45, spotlight: .15 }, tint: '#69E5F5' },
];

export const DEFAULT_EFFECTS: Required<ClipEffects> = {
  vignette: 0, grain: 0, scanlines: 0, letterbox: 0, lightLeak: 0, bloom: 0, goldenHour: 0,
  coolGlow: 0, dreamy: 0, neonFrame: 0, filmDust: 0, scratches: 0, retroFade: 0, frost: 0, spotlight: 0,
};

export function normalizeEffects(input?: ClipEffects | null): Required<ClipEffects> {
  const result = { ...DEFAULT_EFFECTS };
  for (const { id } of EFFECTS) {
    const value = input?.[id];
    result[id] = typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
  }
  return result;
}

export function hasEffects(input?: ClipEffects | null): boolean { return Object.values(normalizeEffects(input)).some(value => value > 0); }

export function searchEffects(query: string, category: EffectCategory = 'All'): readonly EffectDefinition[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return EFFECTS.filter(effect => (category === 'All' || effect.category === category)
    && terms.every(term => `${effect.name} ${effect.description} ${effect.category} ${effect.tags.join(' ')}`.toLowerCase().includes(term)));
}

export function applyEffectPreset(preset: EffectPreset, input?: ClipEffects, stack = false): Required<ClipEffects> {
  return normalizeEffects({ ...(stack ? normalizeEffects(input) : DEFAULT_EFFECTS), ...preset.effects });
}

/** FNV-1a, using fixed integer math so the same clip keeps its texture after save/reload and frame slicing. */
export function effectSeed(id: string): number {
  let seed = 2166136261;
  for (let index = 0; index < id.length; index++) seed = Math.imul(seed ^ id.charCodeAt(index), 16777619) >>> 0;
  return seed;
}

/**
 * Normalized canvas coordinates, y down. Solids use a0=a1; gradients run from a0 to a1 along x or y.
 * RN, Core Graphics and Android Canvas draw this exact list, rather than reimplementing effects separately.
 * Effects belong to one scene, before its fade/crossfade and below titles; they cover its canvas/background.
 */
export interface EffectPrimitive {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  a0: number;
  a1: number;
  axis: 'solid' | 'x' | 'y';
}

export function effectPrimitives(input: ClipEffects | undefined, seed: number, ratio = 1): EffectPrimitive[] {
  const settings = normalizeEffects(input);
  const output: EffectPrimitive[] = [];
  const draw = (x: number, y: number, w: number, h: number, color: string, a0: number, a1 = a0, axis: EffectPrimitive['axis'] = 'solid') => output.push({ x, y, w, h, color, a0, a1, axis });
  const aspect = Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
  const unitX = 1 / Math.max(1, aspect), unitY = Math.min(1, aspect);
  if (settings.retroFade) {
    draw(0, 0, 1, 1, '#D9C6A2', settings.retroFade * .22);
    draw(0, 0, 1, .65, '#A98152', settings.retroFade * .13, 0, 'y');
  }
  if (settings.goldenHour) {
    draw(0, 0, 1, 1, '#FFC05C', settings.goldenHour * .12);
    draw(0, 0, .65, 1, '#FFAD42', settings.goldenHour * .28, 0, 'x');
  }
  if (settings.dreamy) {
    draw(0, 0, 1, .7, '#FFB8D5', settings.dreamy * .24, 0, 'y');
    draw(0, .3, 1, .7, '#B7A3F0', 0, settings.dreamy * .24, 'y');
  }
  if (settings.frost) {
    draw(0, 0, 1, 1, '#A7D8ED', settings.frost * .09);
    draw(0, 0, .22, 1, '#DCF6FF', settings.frost * .42, 0, 'x');
    draw(.78, 0, .22, 1, '#DCF6FF', 0, settings.frost * .42, 'x');
    draw(0, 0, 1, .22, '#DCF6FF', settings.frost * .42, 0, 'y');
    draw(0, .78, 1, .22, '#DCF6FF', 0, settings.frost * .42, 'y');
  }
  if (settings.bloom) {
    draw(0, 0, .45, 1, '#FFF9EA', settings.bloom * .28, 0, 'x');
    draw(.55, 0, .45, 1, '#FFF9EA', 0, settings.bloom * .28, 'x');
    draw(0, 0, 1, .4, '#FFFFFF', settings.bloom * .2, 0, 'y');
    draw(0, .6, 1, .4, '#FFFFFF', 0, settings.bloom * .2, 'y');
  }
  if (settings.coolGlow) {
    draw(0, 0, .38, 1, '#678EFF', settings.coolGlow * .3, 0, 'x');
    draw(.62, 0, .38, 1, '#AE79FF', 0, settings.coolGlow * .25, 'x');
    draw(0, .6, 1, .4, '#5FB9F4', 0, settings.coolGlow * .18, 'y');
  }
  if (settings.vignette) {
    const alpha = settings.vignette * .72;
    draw(0, 0, .3, 1, '#000000', alpha, 0, 'x');
    draw(.7, 0, .3, 1, '#000000', 0, alpha, 'x');
    draw(0, 0, 1, .27, '#000000', alpha, 0, 'y');
    draw(0, .73, 1, .27, '#000000', 0, alpha, 'y');
  }
  if (settings.spotlight) {
    const alpha = settings.spotlight * .85;
    draw(0, 0, .42, 1, '#090713', alpha, 0, 'x');
    draw(.58, 0, .42, 1, '#090713', 0, alpha, 'x');
    draw(0, 0, 1, .4, '#090713', alpha, 0, 'y');
    draw(0, .6, 1, .4, '#090713', 0, alpha, 'y');
  }
  if (settings.grain) {
    let state = seed >>> 0;
    const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
    for (let index = 0; index < 96; index++) {
      const size = .003 + random() * .005;
      const w = size * unitX, h = size * unitY;
      draw(random() * (1 - w), random() * (1 - h), w, h, index % 2 ? '#FFFFFF' : '#000000', settings.grain * (.15 + random() * .3));
    }
  }
  if (settings.filmDust || settings.scratches) {
    let state = (seed ^ 0xA5F1523D) >>> 0;
    const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
    if (settings.filmDust) for (let index = 0; index < 24; index++) {
      const size = .003 + random() * .009;
      const width = size * unitX, height = size * (.4 + random() * .6) * unitY;
      draw(random() * (1 - width), random() * (1 - height), width, height, index % 3 ? '#E9DFCA' : '#221D19', settings.filmDust * (.2 + random() * .35));
    }
    if (settings.scratches) {
      let scratchState = (seed ^ 0x7B4169A3) >>> 0;
      const scratchRandom = () => { scratchState = (Math.imul(scratchState, 1664525) + 1013904223) >>> 0; return scratchState / 4294967296; };
      for (let index = 0; index < 7; index++) {
        const width = (.0006 + scratchRandom() * .0012) * unitX;
        const height = .2 + scratchRandom() * .5;
        draw(scratchRandom() * (1 - width), scratchRandom() * (1 - height), width, height, index % 2 ? '#E9DFCA' : '#211D1B', settings.scratches * (.14 + scratchRandom() * .22));
      }
    }
  }
  if (settings.scanlines) for (let index = 0; index < 64; index++) draw(0, index / 64, 1, .0025 * unitY, '#000000', settings.scanlines * .4);
  if (settings.neonFrame) {
    const width = .012 * unitX, height = .012 * unitY;
    const glowWidth = .065 * unitX, glowHeight = .065 * unitY;
    draw(0, 0, glowWidth, 1, '#36E7FF', settings.neonFrame * .4, 0, 'x');
    draw(1 - glowWidth, 0, glowWidth, 1, '#FF56C6', 0, settings.neonFrame * .4, 'x');
    draw(0, 0, 1, glowHeight, '#36E7FF', settings.neonFrame * .4, 0, 'y');
    draw(0, 1 - glowHeight, 1, glowHeight, '#FF56C6', 0, settings.neonFrame * .4, 'y');
    draw(0, 0, width, 1, '#57ECFF', settings.neonFrame * .85);
    draw(1 - width, 0, width, 1, '#FF73D3', settings.neonFrame * .85);
    draw(0, 0, 1, height, '#57ECFF', settings.neonFrame * .85);
    draw(0, 1 - height, 1, height, '#FF73D3', settings.neonFrame * .85);
  }
  if (settings.lightLeak) {
    draw(0, 0, .42, 1, '#FF9A3C', settings.lightLeak * .42, 0, 'x');
    draw(0, 0, .58, .48, '#FF507C', settings.lightLeak * .22, 0, 'y');
    draw(.83, .35, .17, .65, '#FFC466', 0, settings.lightLeak * .24, 'x');
  }
  if (settings.letterbox) {
    const height = settings.letterbox * .12;
    draw(0, 0, 1, height, '#000000', 1);
    draw(0, 1 - height, 1, height, '#000000', 1);
  }
  return output;
}

/** Reference pixel compositor for parity tests / exported-frame checks. RGB channels are 0..1. */
export function effectPixel(primitives: EffectPrimitive[], x: number, y: number, background: [number, number, number]): [number, number, number] {
  const color: [number, number, number] = [...background];
  for (const primitive of primitives) {
    if (x < primitive.x || y < primitive.y || x >= primitive.x + primitive.w || y >= primitive.y + primitive.h) continue;
    const progress = primitive.axis === 'x' ? (x - primitive.x) / primitive.w : primitive.axis === 'y' ? (y - primitive.y) / primitive.h : 0;
    const alpha = primitive.a0 + (primitive.a1 - primitive.a0) * progress;
    for (let channel = 0; channel < 3; channel++) {
      const value = parseInt(primitive.color.slice(1 + channel * 2, 3 + channel * 2), 16) / 255;
      color[channel] = value * alpha + color[channel] * (1 - alpha);
    }
  }
  return color;
}
