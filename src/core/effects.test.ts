/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyEffectPreset, DEFAULT_EFFECTS, EFFECT_CATEGORIES, EFFECT_PRESETS, EFFECTS, effectPixel, effectPrimitives, effectSeed, hasEffects, normalizeEffects, searchEffects } from './effects.ts';

test('legacy effects are empty, invalid settings normalize safely and each effect can be disabled independently', () => {
  assert.deepEqual(normalizeEffects(), DEFAULT_EFFECTS);
  assert.deepEqual(effectPrimitives(undefined, 1), []);
  assert.equal(hasEffects({ vignette: 0, grain: NaN }), false);
  assert.deepEqual(normalizeEffects({ grain: 5, vignette: -1, scanlines: Infinity, letterbox: .5 }), { ...DEFAULT_EFFECTS, grain: 1, letterbox: .5 });
  for (const effect of EFFECTS) assert.ok(effectPrimitives({ [effect.id]: .5 }, 1).length > 0, effect.id);
});

test('all effect coordinates/alphas stay finite, inside the canvas and stable across resolution and reload', () => {
  const settings = Object.fromEntries(EFFECTS.map(effect => [effect.id, 1]));
  for (const ratio of [9 / 16, 1, 16 / 9, 0, -1, NaN, Infinity]) {
    const primitives = effectPrimitives(settings, effectSeed('clip-a'), ratio);
    assert.ok(primitives.length < 300, 'the full library stays within a small native overlay budget');
    for (const p of primitives) {
      assert.ok(p.x >= 0 && p.y >= 0 && p.w > 0 && p.h > 0 && p.x + p.w <= 1 + 1e-9 && p.y + p.h <= 1 + 1e-9);
      assert.ok(p.a0 >= 0 && p.a0 <= 1 && p.a1 >= 0 && p.a1 <= 1);
    }
    assert.deepEqual(primitives, effectPrimitives(JSON.parse(JSON.stringify(settings)), effectSeed('clip-a'), ratio));
  }
  assert.notDeepEqual(effectPrimitives({ grain: 1 }, effectSeed('a')), effectPrimitives({ grain: 1 }, effectSeed('b')));
  const grain = effectPrimitives({ grain: 1 }, 1, 9 / 16)[0];
  assert.ok(Math.abs(grain.w * 1080 - grain.h * 1920) < 1e-9, 'grain remains square on portrait output');
});

test('legacy effect stacks keep their original primitive count, order and texture', () => {
  const settings = { vignette: .55, grain: .45, scanlines: .4, letterbox: .65, lightLeak: .5 };
  const legacy = effectPrimitives(settings, effectSeed('legacy-clip'), 9 / 16);
  assert.equal(legacy.length, 169);
  assert.equal(legacy[0].axis, 'x');
  assert.equal(legacy[4].axis, 'solid');
  assert.equal(legacy[100].h, .0025 * 9 / 16);
  assert.equal(legacy[164].color, '#FF9A3C');
  assert.deepEqual(legacy.slice(-2).map(primitive => primitive.color), ['#000000', '#000000']);
  assert.deepEqual(legacy, effectPrimitives({ ...DEFAULT_EFFECTS, ...settings }, effectSeed('legacy-clip'), 9 / 16));
});

test('new textures are stable when other texture effects are added and remain seed-specific', () => {
  for (const id of ['filmDust', 'scratches'] as const) {
    const standalone = effectPrimitives({ [id]: .6 }, effectSeed('same'));
    assert.deepEqual(standalone, effectPrimitives({ [id]: .6, grain: .4 }, effectSeed('same')).slice(96));
    assert.notDeepEqual(standalone, effectPrimitives({ [id]: .6 }, effectSeed('different')));
  }
  const scratches = effectPrimitives({ scratches: .6 }, effectSeed('same'));
  assert.deepEqual(scratches, effectPrimitives({ scratches: .6, filmDust: .4 }, effectSeed('same')).slice(24));
});

test('light, color and frame overlays visibly affect their intended regions', () => {
  const base: [number, number, number] = [.4, .4, .4];
  const sample = (id: keyof typeof DEFAULT_EFFECTS, x = .02, y = .5) => effectPixel(effectPrimitives({ [id]: 1 }, 1), x, y, base);
  const golden = sample('goldenHour');
  assert.ok(golden[0] > golden[1] && golden[1] > golden[2]);
  const blue = sample('coolGlow');
  assert.ok(blue[2] > blue[0]);
  assert.ok(sample('bloom')[0] > base[0]);
  assert.ok(sample('frost')[2] > sample('frost')[0]);
  assert.ok(sample('spotlight')[0] < base[0]);
  assert.deepEqual(sample('spotlight', .5), base);
  assert.notDeepEqual(sample('dreamy', .5, .1), sample('dreamy', .5, .9));
  assert.notDeepEqual(sample('retroFade', .5), base);
  const frame = sample('neonFrame', .001);
  assert.ok(frame[1] > frame[0] && frame[2] > frame[0]);
  assert.deepEqual(sample('neonFrame', .5), base);
  const all = effectPrimitives(Object.fromEntries(EFFECTS.map(effect => [effect.id, 1])), 7);
  assert.deepEqual(effectPixel(all, .5, .01, base), [0, 0, 0], 'cinema bars remain the final overlay');
});

test('search finds categories and related terms without ignoring the selected category', () => {
  assert.equal(searchEffects('  ').length, EFFECTS.length);
  assert.deepEqual(searchEffects('VHS').map(effect => effect.id), ['scanlines']);
  assert.ok(searchEffects('film', 'Texture').every(effect => effect.category === 'Texture'));
  assert.equal(searchEffects('film', 'Light').length, 1);
  assert.ok(searchEffects('warm sun').some(effect => effect.id === 'goldenHour'));
  assert.deepEqual(searchEffects('not an effect'), []);
  assert.equal(new Set(EFFECTS.map(effect => effect.id)).size, EFFECTS.length);
  for (const category of EFFECT_CATEGORIES.filter(category => category !== 'All')) assert.ok(searchEffects('', category).length > 0);
});

test('curated presets replace or merge one stack without mutating the source settings', () => {
  const original = { frost: .8, grain: .9 };
  const preset = EFFECT_PRESETS.find(item => item.id === 'cinematic')!;
  const replaced = applyEffectPreset(preset, original);
  const stacked = applyEffectPreset(preset, original, true);
  assert.equal(replaced.frost, 0);
  assert.equal(stacked.frost, .8);
  assert.equal(replaced.grain, preset.effects.grain);
  assert.equal(stacked.grain, preset.effects.grain);
  assert.deepEqual(original, { frost: .8, grain: .9 });
  assert.deepEqual(preset.effects, { letterbox: .55, vignette: .35, grain: .25 });
  for (const item of EFFECT_PRESETS) {
    const settings = applyEffectPreset(item);
    assert.ok(hasEffects(settings));
    assert.ok(Object.values(settings).every(value => value >= 0 && value <= 1));
    assert.deepEqual(effectPrimitives(settings, 8), effectPrimitives(JSON.parse(JSON.stringify(settings)), 8));
  }
});

test('reference pixels verify real vignette/light-leak/bars and effect stacking order', () => {
  const base: [number, number, number] = [.5, .5, .5];
  const vignette = effectPrimitives({ vignette: 1 }, 1);
  assert.deepEqual(effectPixel(vignette, .5, .5, base), base);
  assert.ok(effectPixel(vignette, .01, .5, base)[0] < .2);
  const warm = effectPixel(effectPrimitives({ lightLeak: 1 }, 1), .01, .6, base);
  assert.ok(warm[0] > warm[1] && warm[1] > warm[2]);
  const stacked = effectPrimitives({ letterbox: 1, lightLeak: 1, grain: 1 }, 2);
  assert.deepEqual(effectPixel(stacked, .5, .05, base), [0, 0, 0], 'cinema bars stay black over other effects');
  assert.deepEqual(effectPixel(stacked, .5, .5, base), base);
});
