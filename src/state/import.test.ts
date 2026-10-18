/// <reference types="node" />
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import { protectMediaPaths, releaseMediaPaths, releaseSavedMediaPaths, useMediaImport } from './import.ts';

beforeEach(() => {
  useMediaImport.setState({ busy: false, progress: null, protectedPaths: new Set<string>() });
});

test('pending audio paths are protected without acquiring the media-picker lock', () => {
  const before = useMediaImport.getState().protectedPaths;
  protectMediaPaths(['media/audio.m4a']);
  const state = useMediaImport.getState();
  assert.equal(state.busy, false);
  assert.equal(state.progress, null);
  assert.equal(state.protectedPaths.has('media/audio.m4a'), true);
  assert.equal(before.size, 0);
});

test('a failed audio import releases only its own path while overlapping takes stay protected', () => {
  protectMediaPaths(['media/take-one.m4a']);
  protectMediaPaths(['media/take-two.m4a', 'media/music.wav']);
  const beforeFailure = useMediaImport.getState().protectedPaths;
  releaseMediaPaths(['media/take-one.m4a']);
  assert.deepEqual([...useMediaImport.getState().protectedPaths], ['media/take-two.m4a', 'media/music.wav']);
  assert.equal(beforeFailure.has('media/take-one.m4a'), true);
  assert.equal(useMediaImport.getState().busy, false);
});

test('successful project saves release referenced audio while leaving unsaved media protected', () => {
  protectMediaPaths(['media/audio.m4a', 'media/video.mp4', 'media/video.jpg', 'media/unfinished.m4a']);
  releaseSavedMediaPaths(['media/audio.m4a', 'media/video.mp4', 'media/video.jpg']);
  assert.deepEqual([...useMediaImport.getState().protectedPaths], ['media/unfinished.m4a']);
  releaseSavedMediaPaths(['media/unfinished.m4a']);
  assert.equal(useMediaImport.getState().protectedPaths.size, 0);
});

test('GC can observe new audio protection after awaiting an older project scan', async () => {
  let completeScan!: () => void;
  const scan = new Promise<void>(resolve => { completeScan = resolve; });
  const protectedAfterScan = (async () => {
    await scan;
    return new Set(useMediaImport.getState().protectedPaths);
  })();
  protectMediaPaths(['media/new-audio.wav']);
  completeScan();
  assert.equal((await protectedAfterScan).has('media/new-audio.wav'), true);
  assert.equal(useMediaImport.getState().protectedPaths.has('media/new-audio.wav'), true);
});

test('path release accepts iterables and preserves unrelated protection', () => {
  protectMediaPaths(new Set(['media/one.wav', 'media/two.wav']));
  releaseMediaPaths(new Set(['media/one.wav', 'media/missing.wav']));
  assert.deepEqual([...useMediaImport.getState().protectedPaths], ['media/two.wav']);
});
