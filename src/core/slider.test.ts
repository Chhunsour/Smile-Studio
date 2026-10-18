/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createSliderLifecycle, isSpeedCommitCurrent, sliderCommitValue, sliderNormAt } from './slider.ts';

test('slider lifecycle ignores queued callbacks after unmount and supports StrictMode reactivation', () => {
  const lifecycle = createSliderLifecycle();
  const values: number[] = [];
  const callback = (value: number) => values.push(value);
  const queuedCommit = () => lifecycle.run(callback, 2);
  lifecycle.run(callback, 0);
  assert.deepEqual(values, []);
  lifecycle.activate();
  lifecycle.run(callback, 1);
  lifecycle.deactivate();
  queuedCommit();
  assert.deepEqual(values, [1]);
  lifecycle.activate();
  queuedCommit();
  assert.deepEqual(values, [1, 2]);
  lifecycle.deactivate();
  lifecycle.run(callback, 3);
  lifecycle.run(undefined, 4);
  assert.deepEqual(values, [1, 2]);
});

test('slider positions map the thumb center and clamp touches at either edge', () => {
  assert.equal(sliderNormAt(11, 122), 0);
  assert.equal(sliderNormAt(61, 122), .5);
  assert.equal(sliderNormAt(111, 122), 1);
  assert.equal(sliderNormAt(-100, 122), 0);
  assert.equal(sliderNormAt(1000, 122), 1);
  for (const width of [0, 21, 22, Number.NaN, Infinity]) assert.equal(sliderNormAt(50, width), null);
  assert.equal(sliderNormAt(Number.NaN, 122), null);
});

test('failed or cancelled sliders discard their draft without evaluating the value mapper', () => {
  let mapped = 0;
  const fromNorm = (norm: number) => { mapped++; return norm * 4; };
  assert.equal(sliderCommitValue(false, 122, .9, fromNorm), null);
  assert.equal(mapped, 0);
  assert.equal(sliderCommitValue(true, 122, .5, fromNorm), 2);
  assert.equal(mapped, 1);
});

test('slider commits require a measured width and a finite mapped value', () => {
  for (const width of [0, 22, Number.NaN, Infinity]) assert.equal(sliderCommitValue(true, width, .5, norm => norm), null);
  for (const norm of [Number.NaN, Infinity, -.01, 1.01]) assert.equal(sliderCommitValue(true, 122, norm, value => value), null);
  assert.equal(sliderCommitValue(true, 122, .5, () => Number.NaN), null);
  assert.equal(sliderCommitValue(true, 122, .5, () => Infinity), null);
  assert.equal(sliderCommitValue(true, 122, 0, norm => norm), 0);
});

test('queued speed edits only target the original project, selection, panel and base speed', () => {
  const expected = { projectId: 'original', clipId: 'clip', speed: 1 };
  const current = { project: { id: 'original', main: [{ id: 'clip', speed: 1 }] }, selectedId: 'clip', panel: 'speed' };
  assert.equal(isSpeedCommitCurrent(current, expected), true);
  assert.equal(isSpeedCommitCurrent({ ...current, project: { ...current.project, id: 'new-project' } }, expected), false);
  assert.equal(isSpeedCommitCurrent({ ...current, selectedId: 'another-clip' }, expected), false);
  assert.equal(isSpeedCommitCurrent({ ...current, panel: null }, expected), false);
  assert.equal(isSpeedCommitCurrent({ ...current, panel: 'volume' }, expected), false);
  assert.equal(isSpeedCommitCurrent({ ...current, project: null }, expected), false);
  assert.equal(isSpeedCommitCurrent({ ...current, project: { ...current.project, main: [] } }, expected), false);
  assert.equal(isSpeedCommitCurrent({ ...current, project: { ...current.project, main: [{ id: 'clip', speed: 2 }] } }, expected), false);
});
