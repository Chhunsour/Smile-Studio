import { File, Paths } from 'expo-file-system';
import { create } from 'zustand';

import { decodePreferences, DEFAULT_PREFERENCES, encodePreferences, sanitizePreferences, type AppPreferences } from '@/core/preferences';

export type { AppPreferences, AppearancePreference, AvatarTone } from '@/core/preferences';

export type PreferencesState = {
  preferences: AppPreferences;
  ready: boolean;
  error: string | null;
  hydrate: () => Promise<void>;
  updatePreferences: (patch: Partial<AppPreferences>) => Promise<void>;
};

let hydration: Promise<void> | null = null;
let updates: Promise<void> = Promise.resolve();

const preferencesFile = () => new File(Paths.document, 'preferences.json');

function persist(preferences: AppPreferences) {
  const temporary = new File(Paths.document, 'preferences.json.tmp');
  if (temporary.exists) temporary.delete();
  temporary.create();
  temporary.write(encodePreferences(preferences));
  temporary.moveSync(preferencesFile(), { overwrite: true });
}

export const usePreferences = create<PreferencesState>((set, get) => ({
  preferences: { ...DEFAULT_PREFERENCES },
  ready: false,
  error: null,
  hydrate: () => {
    if (get().ready) return Promise.resolve();
    if (hydration) return hydration;
    hydration = (async () => {
      try {
        const file = preferencesFile();
        const preferences = file.exists ? decodePreferences(await file.text()) : { ...DEFAULT_PREFERENCES };
        set({ preferences, ready: true, error: null });
      } catch (error) {
        set({ ready: true, error: error instanceof Error ? error.message : 'Could not load your settings.' });
      }
    })();
    return hydration;
  },
  updatePreferences: (patch) => {
    // Queue writes and hydrate first so quick changes cannot overwrite each other or saved preferences.
    const update = updates.then(async () => {
      await get().hydrate();
      const previous = get().preferences;
      const preferences = sanitizePreferences({ ...previous, ...patch });
      try {
        persist(preferences);
        set({ preferences, error: null });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Could not save your settings.';
        set({ error: message });
        throw new Error(message);
      }
    });
    updates = update.catch(() => {});
    return update;
  },
}));
