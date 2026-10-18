import type { AspectRatio } from './types.ts';

export type AppearancePreference = 'system' | 'light' | 'dark';
export type AvatarTone = 'sunshine' | 'sage' | 'lavender' | 'peach';

export type AppPreferences = {
  appearance: AppearancePreference;
  displayName: string;
  bio: string;
  avatarTone: AvatarTone;
  defaultAspect: AspectRatio;
  exportResolution: 720 | 1080;
  exportFps: 24 | 30 | 60;
};

export const DEFAULT_PREFERENCES: AppPreferences = {
  appearance: 'system',
  displayName: 'Your studio',
  bio: '',
  avatarTone: 'sunshine',
  defaultAspect: '9:16',
  exportResolution: 1080,
  exportFps: 30,
};

const APPEARANCES: readonly AppearancePreference[] = ['system', 'light', 'dark'];
const AVATAR_TONES: readonly AvatarTone[] = ['sunshine', 'sage', 'lavender', 'peach'];
const ASPECTS: readonly AspectRatio[] = ['original', '9:16', '16:9', '1:1', '4:5', '3:4'];

/** Validate persisted and updated values; never let a damaged preference reach the editor/exporter. */
export function sanitizePreferences(value: unknown): AppPreferences {
  const raw = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
  return {
    appearance: APPEARANCES.includes(raw.appearance as AppearancePreference)
      ? raw.appearance as AppearancePreference : DEFAULT_PREFERENCES.appearance,
    displayName: typeof raw.displayName === 'string'
      ? raw.displayName.trim().slice(0, 40) || DEFAULT_PREFERENCES.displayName : DEFAULT_PREFERENCES.displayName,
    bio: typeof raw.bio === 'string' ? raw.bio.trim().slice(0, 160) : DEFAULT_PREFERENCES.bio,
    avatarTone: AVATAR_TONES.includes(raw.avatarTone as AvatarTone)
      ? raw.avatarTone as AvatarTone : DEFAULT_PREFERENCES.avatarTone,
    defaultAspect: ASPECTS.includes(raw.defaultAspect as AspectRatio)
      ? raw.defaultAspect as AspectRatio : DEFAULT_PREFERENCES.defaultAspect,
    exportResolution: raw.exportResolution === 720 || raw.exportResolution === 1080
      ? raw.exportResolution : DEFAULT_PREFERENCES.exportResolution,
    exportFps: raw.exportFps === 24 || raw.exportFps === 30 || raw.exportFps === 60
      ? raw.exportFps : DEFAULT_PREFERENCES.exportFps,
  };
}

export function decodePreferences(json: string): AppPreferences {
  const value: unknown = JSON.parse(json);
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !('schema' in value) || value.schema !== 1 || !('preferences' in value)
    || !value.preferences || typeof value.preferences !== 'object' || Array.isArray(value.preferences)) {
    throw new Error('This settings file cannot be read. Your projects are safe; save a setting to start a new settings file.');
  }
  return sanitizePreferences(value.preferences);
}

export function encodePreferences(preferences: AppPreferences): string {
  return JSON.stringify({ schema: 1, preferences: sanitizePreferences(preferences) });
}
