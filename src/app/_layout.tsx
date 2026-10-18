import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import * as SystemUI from 'expo-system-ui';
import { useEffect } from 'react';
import { Appearance } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { usePreferences } from '@/state/preferences';
import { useAppTheme } from '@/ui/theme';
import { MotionProvider } from '@/ui/motion';
import { ImportOverlay } from '@/ui/useImport';

// Keep the native splash until saved appearance is known to avoid flashing the wrong theme.
void SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const { colors, isDark } = useAppTheme();
  const hydrate = usePreferences((state) => state.hydrate);
  const appearance = usePreferences((state) => state.preferences.appearance);
  const ready = usePreferences((state) => state.ready);

  useEffect(() => { void hydrate(); }, [hydrate]);
  useEffect(() => {
    Appearance.setColorScheme(appearance === 'system' ? 'unspecified' : appearance);
  }, [appearance]);
  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(colors.bg).catch(() => {});
  }, [colors.bg]);

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  const base = isDark ? DarkTheme : DefaultTheme;
  const theme = {
    ...base,
    colors: { ...base.colors, background: colors.bg, card: colors.surface, primary: colors.accentText, text: colors.text, border: colors.border },
  };

  if (!ready) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
      <MotionProvider>
        <ThemeProvider value={theme}>
          <StatusBar style={isDark ? 'light' : 'dark'} animated />
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="settings" />
            <Stack.Screen name="edit-profile" />
            <Stack.Screen name="sign-in" />
            <Stack.Screen name="help" />
            <Stack.Screen name="editor/[id]" options={{ gestureEnabled: false, animation: 'fade_from_bottom' }} />
          </Stack>
          <ImportOverlay />
        </ThemeProvider>
      </MotionProvider>
    </GestureHandlerRootView>
  );
}
