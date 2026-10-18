import { useMemo } from 'react';
import { useColorScheme } from 'react-native';

import { usePreferences } from '@/state/preferences';

export type AppColors = {
  bg: string;
  surface: string;
  surface2: string;
  surface3: string;
  surfaceRaised: string;
  border: string;
  borderStrong: string;
  text: string;
  textDim: string;
  textFaint: string;
  accent: string;
  accentText: string;
  accentSoft: string;
  accentInk: string;
  danger: string;
  success: string;
  selection: string;
  overlay: string;
};

export const darkColors: AppColors = {
  bg: '#101113',
  surface: '#191B1E',
  surface2: '#202327',
  surface3: '#2A2E33',
  surfaceRaised: '#25292E',
  border: '#32373D',
  borderStrong: '#4A515A',
  text: '#F4F3EF',
  textDim: '#B1B7BD',
  textFaint: '#929AA4',
  accent: '#F4CF75',
  accentText: '#F4CF75',
  accentSoft: '#383123',
  accentInk: '#292010',
  danger: '#FF8C8D',
  success: '#A9D6B9',
  selection: '#F4CF75',
  overlay: 'rgba(6,8,10,0.68)',
};

export const lightColors: AppColors = {
  bg: '#F7F6F2',
  surface: '#FFFFFF',
  surface2: '#F0EFEA',
  surface3: '#E5E5DF',
  surfaceRaised: '#FFFFFF',
  border: '#DEDFD7',
  borderStrong: '#C7CBC1',
  text: '#242924',
  textDim: '#60695F',
  textFaint: '#737C72',
  accent: '#F0CA71',
  accentText: '#80601C',
  accentSoft: '#FBF0D4',
  accentInk: '#30240E',
  danger: '#BC4247',
  success: '#39714C',
  selection: '#B48628',
  overlay: 'rgba(25,32,25,0.40)',
};

/** Fixed dark palette for artwork/constants; rendered UI should use useAppTheme. */
export const colors = darkColors;

export function useAppTheme(): { colors: AppColors; isDark: boolean } {
  const appearance = usePreferences((state) => state.preferences.appearance);
  const system = useColorScheme();
  const isDark = appearance === 'dark' || (appearance === 'system' && system === 'dark');
  return { colors: isDark ? darkColors : lightColors, isDark };
}

/** One cached StyleSheet per palette and component module, including the timeline's many cells. */
const styleCache = new WeakMap<object, WeakMap<AppColors, unknown>>();
export function useThemedStyles<T>(factory: (palette: AppColors) => T): T {
  const { colors: palette } = useAppTheme();
  return useMemo(() => {
    let palettes = styleCache.get(factory);
    if (!palettes) { palettes = new WeakMap(); styleCache.set(factory, palettes); }
    if (!palettes.has(palette)) palettes.set(palette, factory(palette));
    return palettes.get(palette) as T;
  }, [factory, palette]);
}

export const radius = { sm: 7, md: 12, lg: 18, xl: 26 } as const;
export const font = {
  title: { fontSize: 28, fontWeight: '800' as const, letterSpacing: -0.6 },
  h2: { fontSize: 17, fontWeight: '700' as const, letterSpacing: -0.2 },
  body: { fontSize: 15, fontWeight: '500' as const },
  small: { fontSize: 12, fontWeight: '500' as const },
  mono: { fontSize: 12, fontWeight: '600' as const, fontVariant: ['tabular-nums' as const] },
};
