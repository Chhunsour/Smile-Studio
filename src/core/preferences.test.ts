import assert from 'node:assert/strict';
import { test } from 'node:test';

import { decodePreferences, DEFAULT_PREFERENCES, encodePreferences, sanitizePreferences } from './preferences.ts';

test('preferences round-trip every supported editor and appearance choice', () => {
  for (const appearance of ['system', 'light', 'dark'] as const) {
    for (const defaultAspect of ['original', '9:16', '16:9', '1:1', '4:5', '3:4'] as const) {
      for (const exportFps of [24, 30, 60] as const) {
        const preferences = { ...DEFAULT_PREFERENCES, appearance, defaultAspect, exportFps, exportResolution: 720 as const, avatarTone: 'sage' as const, displayName: 'ស្នាមញញឹម', bio: 'A small film every day.' };
        assert.deepEqual(decodePreferences(encodePreferences(preferences)), preferences);
      }
    }
  }
});

test('unsafe export values and unknown appearance data recover to valid defaults', () => {
  assert.deepEqual(sanitizePreferences({ appearance: 'neon', exportFps: 120, exportResolution: 2160, defaultAspect: 'potato', avatarTone: 'red', displayName: '   ', bio: 999 }), DEFAULT_PREFERENCES);
  assert.deepEqual(sanitizePreferences(null), DEFAULT_PREFERENCES);
  assert.deepEqual(sanitizePreferences([]), DEFAULT_PREFERENCES);
});

test('profile input trims whitespace and bounds persisted fields', () => {
  const preferences = sanitizePreferences({ displayName: '  ' + 'A'.repeat(80) + ' ', bio: ' ' + 'B'.repeat(200) + ' ' });
  assert.equal(preferences.displayName, 'A'.repeat(40));
  assert.equal(preferences.bio, 'B'.repeat(160));
});

test('malformed, unsupported and missing settings envelopes are reported instead of silently accepted', () => {
  for (const json of ['{', 'null', '[]', '{}', '{"schema":2,"preferences":{}}', '{"schema":1,"preferences":null}', '{"schema":1,"preferences":[]}']) {
    assert.throws(() => decodePreferences(json));
  }
  assert.deepEqual(decodePreferences('{"schema":1,"preferences":{}}'), DEFAULT_PREFERENCES);
});
