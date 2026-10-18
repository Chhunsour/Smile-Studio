import { useCallback, useEffect } from 'react';
import { ActivityIndicator, Alert, BackHandler, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import type { MediaAsset } from '@/core/types';
import { importVideos, pickMedia } from '@/storage/media';
import { beginMediaImport, finishMediaImport, protectMediaPaths, useMediaImport } from '@/state/import';
import { useMotionPreferences } from './motion';
import { font, radius, type AppColors, useThemedStyles, useAppTheme } from './theme';

/** Pick media under one app-wide lock, including the native picker and the caller's commit. */
export function useImport() {
  const importing = useMediaImport((state) => state.busy);
  const run = useCallback(async (): Promise<MediaAsset[]> => {
    if (!beginMediaImport()) return [];
    try {
      let picked;
      try {
        picked = await pickMedia();
      } catch (e) {
        Alert.alert('Could not open your library', e instanceof Error ? e.message : String(e));
        return [];
      }
      if (!picked.length) return [];
      useMediaImport.setState({ progress: { done: 0, total: picked.length } });
      const { assets, errors } = await importVideos(picked, (done, total) => {
        useMediaImport.setState({ progress: { done, total } });
      });
      protectMediaPaths(assets.flatMap((asset) => asset.poster ? [asset.path, asset.poster] : [asset.path]));
      if (errors.length) {
        Alert.alert(
          errors.length === picked.length ? 'Import failed' : 'Some files were skipped',
          [...new Set(errors)].join('\n'),
        );
      }
      return assets;
    } finally {
      finishMediaImport();
    }
  }, []);

  // RootLayout renders the single overlay above every route and the tab bar.
  return { run, overlay: null, importing };
}

/** An in-screen overlay avoids native Modal dismissal races when a new editor route opens. */
export function ImportOverlay() {
  const busy = useMediaImport((state) => state.busy);
  const progress = useMediaImport((state) => state.progress);
  const { colors } = useAppTheme();
  const styles = useThemedStyles(createStyles);
  const reducedMotion = useMotionPreferences();

  useEffect(() => {
    if (!busy) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => subscription.remove();
  }, [busy]);

  if (!busy) return null;

  const label = progress ? 'Importing media' : 'Opening your library';
  const detail = progress ? `${Math.min(progress.done + 1, progress.total)} of ${progress.total}` : 'Choose videos or photos to continue';
  return (
    <Animated.View
      entering={reducedMotion ? undefined : FadeIn.duration(150)}
      exiting={reducedMotion ? undefined : FadeOut.duration(150)}
      style={styles.backdrop}
      pointerEvents="auto"
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderTerminationRequest={() => false}
      accessibilityViewIsModal
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`${label}. ${detail}`}
      accessibilityLiveRegion="polite"
      accessibilityValue={progress ? { min: 0, max: progress.total, now: progress.done } : undefined}>
      <View style={styles.card}>
        <ActivityIndicator color={colors.accentText} size="large" />
        <Text style={styles.title}>{label}</Text>
        <Text style={styles.sub}>{detail}</Text>
      </View>
    </Animated.View>
  );
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFill,
    zIndex: 100,
    backgroundColor: colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    backgroundColor: colors.surface2,
    borderRadius: radius.lg,
    paddingVertical: 28,
    paddingHorizontal: 40,
    alignItems: 'center',
    gap: 10,
  },
  title: { ...font.h2, color: colors.text, marginTop: 6 },
  sub: { ...font.small, color: colors.textDim },
});
