// Color pipeline shared by native preview and export.
// Everything reduces to one 4x5 color matrix so both platforms apply identical math.

export type FilterId = 'none' | 'vivid' | 'warm' | 'cool' | 'mono' | 'noir' | 'fade' | 'sepia'
  | 'amber' | 'blush' | 'cinema' | 'forest' | 'ocean' | 'dream' | 'retro' | 'matte'
  | 'clean' | 'sunset' | 'ice' | 'ink';

export interface ColorSettings {
  filter: FilterId;
  /** 0..1, how strongly the filter applies. */
  intensity: number;
  /** -1..1 each, 0 = unchanged. */
  brightness: number;
  contrast: number;
  saturation: number;
  warmth: number;
}

export const DEFAULT_COLOR: ColorSettings = {
  filter: 'none',
  intensity: 1,
  brightness: 0,
  contrast: 0,
  saturation: 0,
  warmth: 0,
};

/**
 * Row-major 4x5 matrix: R' = m0*R + m1*G + m2*B + m3*A + m4 (likewise for G, B, A). Values are 0..1 color.
 */
export type ColorMatrix = number[];

// prettier-ignore
const IDENTITY: ColorMatrix = [
  1, 0, 0, 0, 0,
  0, 1, 0, 0, 0,
  0, 0, 1, 0, 0,
  0, 0, 0, 1, 0,
];

// Rec. 709 luma weights.
const LR = 0.2126;
const LG = 0.7152;
const LB = 0.0722;

function saturation(s: number): ColorMatrix {
  const r = (1 - s) * LR;
  const g = (1 - s) * LG;
  const b = (1 - s) * LB;
  // prettier-ignore
  return [
    r + s, g, b, 0, 0,
    r, g + s, b, 0, 0,
    r, g, b + s, 0, 0,
    0, 0, 0, 1, 0,
  ];
}

/** Scale around mid-grey. */
function contrast(k: number): ColorMatrix {
  const o = 0.5 * (1 - k);
  // prettier-ignore
  return [
    k, 0, 0, 0, o,
    0, k, 0, 0, o,
    0, 0, k, 0, o,
    0, 0, 0, 1, 0,
  ];
}

function brightness(offset: number): ColorMatrix {
  // prettier-ignore
  return [
    1, 0, 0, 0, offset,
    0, 1, 0, 0, offset,
    0, 0, 1, 0, offset,
    0, 0, 0, 1, 0,
  ];
}

/** Positive = warmer (more red, less blue). */
function warmth(w: number): ColorMatrix {
  // prettier-ignore
  return [
    1 + 0.15 * w, 0, 0, 0, 0,
    0, 1 + 0.02 * w, 0, 0, 0,
    0, 0, 1 - 0.15 * w, 0, 0,
    0, 0, 0, 1, 0,
  ];
}

// prettier-ignore
const SEPIA: ColorMatrix = [
  0.393, 0.769, 0.189, 0, 0,
  0.349, 0.686, 0.168, 0, 0,
  0.272, 0.534, 0.131, 0, 0,
  0, 0, 0, 1, 0,
];

/** `then(a, b)` = apply `a` first, then `b`. */
export function then(a: ColorMatrix, b: ColorMatrix): ColorMatrix {
  const out = new Array<number>(20);
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 5; col++) {
      let v = col === 4 ? b[row * 5 + 4] : 0;
      for (let k = 0; k < 4; k++) v += b[row * 5 + k] * a[k * 5 + col];
      out[row * 5 + col] = v;
    }
  }
  return out;
}

const chain = (...ms: ColorMatrix[]) => ms.reduce(then, IDENTITY);
const mix = (m: ColorMatrix, t: number) => m.map((v, i) => IDENTITY[i] + (v - IDENTITY[i]) * t);
/** Small channel offsets create distinct looks while retaining neutral alpha. */
const tint = (r: number, g: number, b: number): ColorMatrix => [
  1, 0, 0, 0, r, 0, 1, 0, 0, g, 0, 0, 1, 0, b, 0, 0, 0, 1, 0,
];

export const FILTERS: { id: FilterId; label: string; swatch: string; matrix: ColorMatrix }[] = [
  { id: 'none', label: 'None', swatch: '#3A3A42', matrix: IDENTITY },
  { id: 'vivid', label: 'Vivid', swatch: '#FF4F7B', matrix: chain(saturation(1.4), contrast(1.1)) },
  { id: 'warm', label: 'Warm', swatch: '#FFA94D', matrix: chain(warmth(0.45), saturation(1.08)) },
  { id: 'cool', label: 'Cool', swatch: '#4DA3FF', matrix: chain(warmth(-0.45), saturation(0.95)) },
  { id: 'mono', label: 'Mono', swatch: '#B8B8B8', matrix: saturation(0) },
  { id: 'noir', label: 'Noir', swatch: '#4A4A4A', matrix: chain(saturation(0), contrast(1.35)) },
  { id: 'fade', label: 'Fade', swatch: '#C9B8A6', matrix: chain(contrast(0.78), brightness(0.06), saturation(0.85)) },
  { id: 'sepia', label: 'Sepia', swatch: '#A67C52', matrix: SEPIA },
  { id: 'amber', label: 'Amber', swatch: '#D79B45', matrix: chain(warmth(.65), contrast(1.05), tint(.02, .01, -.025)) },
  { id: 'blush', label: 'Blush', swatch: '#E5A4B7', matrix: chain(saturation(.9), contrast(.92), tint(.055, -.015, .025)) },
  { id: 'cinema', label: 'Cinema', swatch: '#417D81', matrix: chain(saturation(.8), contrast(1.2), tint(-.025, .025, .045)) },
  { id: 'forest', label: 'Forest', swatch: '#72985C', matrix: chain(saturation(1.15), contrast(1.06), tint(-.025, .045, -.025)) },
  { id: 'ocean', label: 'Ocean', swatch: '#398DB3', matrix: chain(warmth(-.35), saturation(1.2), tint(-.025, .025, .025)) },
  { id: 'dream', label: 'Dream', swatch: '#C2AFDF', matrix: chain(contrast(.8), brightness(.07), saturation(.75), tint(.02, -.01, .035)) },
  { id: 'retro', label: 'Retro', swatch: '#BA9C6C', matrix: chain(mix(SEPIA, .28), saturation(.8), contrast(.95), tint(.03, .015, -.025)) },
  { id: 'matte', label: 'Matte', swatch: '#9A9690', matrix: chain(contrast(.72), saturation(.7), brightness(.015)) },
  { id: 'clean', label: 'Clean', swatch: '#DBECE4', matrix: chain(contrast(1.06), brightness(.025), saturation(1.05)) },
  { id: 'sunset', label: 'Sunset', swatch: '#ED916A', matrix: chain(warmth(.7), saturation(1.15), tint(.04, -.02, .01)) },
  { id: 'ice', label: 'Ice', swatch: '#ADD5E9', matrix: chain(warmth(-.65), contrast(.94), brightness(.035), saturation(.8)) },
  { id: 'ink', label: 'Ink', swatch: '#49515C', matrix: chain(saturation(0), contrast(1.6), brightness(-.025)) },
];

/** The matrix for a clip's color settings, or null when it would change nothing. */
export function colorMatrix(c: ColorSettings | undefined): ColorMatrix | null {
  if (!c) return null;
  const preset = FILTERS.find((f) => f.id === c.filter)?.matrix ?? IDENTITY;
  const m = chain(
    mix(preset, c.intensity),
    brightness(c.brightness * 0.25),
    contrast(1 + c.contrast * 0.6),
    saturation(1 + c.saturation),
    warmth(c.warmth),
  );
  return m.every((v, i) => Math.abs(v - IDENTITY[i]) < 1e-6) ? null : m;
}

/** Apply a matrix to one RGB color (0..1). Used by tests and for UI swatches. */
export function applyMatrix(m: ColorMatrix, [r, g, b]: [number, number, number]): [number, number, number] {
  const row = (i: number) => m[i * 5] * r + m[i * 5 + 1] * g + m[i * 5 + 2] * b + m[i * 5 + 3] + m[i * 5 + 4];
  return [row(0), row(1), row(2)];
}
