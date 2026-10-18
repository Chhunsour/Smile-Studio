/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyMatrix, colorMatrix, DEFAULT_COLOR, FILTERS, then } from './color.ts';

const close = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]) < 1e-6);

test('default settings are a no-op', () => {
  assert.equal(colorMatrix(DEFAULT_COLOR), null);
  assert.equal(colorMatrix(undefined), null);
  assert.equal(colorMatrix({ ...DEFAULT_COLOR, filter: 'mono', intensity: 0 }), null);
});

test('mono removes chroma but keeps luma', () => {
  const m = colorMatrix({ ...DEFAULT_COLOR, filter: 'mono' })!;
  const [r, g, b] = applyMatrix(m, [1, 0, 0]);
  assert.ok(close([r, g], [g, b]));
  assert.ok(Math.abs(r - 0.2126) < 1e-6);
});

test('brightness and contrast move values the expected way', () => {
  const bright = applyMatrix(colorMatrix({ ...DEFAULT_COLOR, brightness: 1 })!, [0.5, 0.5, 0.5]);
  assert.ok(close(bright, [0.75, 0.75, 0.75]));
  const flat = applyMatrix(colorMatrix({ ...DEFAULT_COLOR, contrast: -1 })!, [1, 1, 1]);
  assert.ok(flat[0] < 1 && flat[0] > 0.5);
});

test('then applies the first matrix first', () => {
  // prettier-ignore
  const add = [1,0,0,0,0.1, 0,1,0,0,0, 0,0,1,0,0, 0,0,0,1,0];
  // prettier-ignore
  const dbl = [2,0,0,0,0, 0,1,0,0,0, 0,0,1,0,0, 0,0,0,1,0];
  assert.ok(Math.abs(applyMatrix(then(add, dbl), [0.2, 0, 0])[0] - 0.6) < 1e-9);
  assert.ok(Math.abs(applyMatrix(then(dbl, add), [0.2, 0, 0])[0] - 0.5) < 1e-9);
});

test('all looks retain alpha and intensity zero restores the original', () => {
  assert.equal(new Set(FILTERS.map(f => f.id)).size, 20);
  for (const filter of FILTERS) {
    assert.equal(colorMatrix({ ...DEFAULT_COLOR, filter: filter.id, intensity: 0 }), null);
    assert.equal(filter.matrix.length, 20);
    assert.ok(filter.matrix.every(Number.isFinite));
    assert.deepEqual(filter.matrix.slice(15), [0, 0, 0, 1, 0]);
  }
});
