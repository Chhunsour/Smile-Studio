import { useCallback, useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { SLIDER_THUMB as THUMB, createSliderLifecycle, sliderCommitValue, sliderNormAt } from '@/core/slider';
import { type AppColors, useThemedStyles } from './theme';

/**
 * Horizontal slider driven on the UI thread. `toNorm`/`fromNorm` map the value to 0..1
 * (e.g. a log scale for speed) and must be stable, module-level worklets.
 */
export function Slider({
  value,
  toNorm,
  fromNorm,
  onChange,
  onCommit,
}: {
  value: number;
  toNorm: (v: number) => number;
  fromNorm: (n: number) => number;
  onChange?: (v: number) => void;
  onCommit: (v: number) => void;
}) {
  const styles = useThemedStyles(createStyles);
  const width = useSharedValue(0);
  const norm = useSharedValue(toNorm(value));
  const committedNorm = useSharedValue(toNorm(value));
  const dragging = useSharedValue(false);
  const lifecycle = useMemo(() => createSliderLifecycle(), []);

  useEffect(() => {
    lifecycle.activate();
    return lifecycle.deactivate;
  }, [lifecycle]);

  useEffect(() => {
    norm.set(toNorm(value));
    committedNorm.set(toNorm(value));
  }, [value, norm, committedNorm, toNorm]);

  const change = useCallback((next: number) => {
    lifecycle.run(onChange, next);
  }, [lifecycle, onChange]);
  const commit = useCallback((next: number) => {
    lifecycle.run(onCommit, next);
  }, [lifecycle, onCommit]);

  // Memoized so it isn't rebuilt mid-drag (that can drop the end event): pass stable callbacks.
  const gesture = useMemo(() => {
    const update = (x: number) => {
      'worklet';
      const next = sliderNormAt(x, width.value);
      if (next === null) return false;
      norm.set(next);
      const mapped = fromNorm(next);
      if (onChange && Number.isFinite(mapped)) scheduleOnRN(change, mapped);
      return true;
    };
    // One pan with minDistance 0 handles taps and drags; finalize fires on every release.
    return Gesture.Pan()
      .minDistance(0)
      .onStart((event) => dragging.set(update(event.x)))
      .onUpdate((event) => { if (dragging.value) update(event.x); })
      .onFinalize((_event, success) => {
        const next = sliderCommitValue(success && dragging.value, width.value, norm.value, fromNorm);
        dragging.set(false);
        if (next !== null) scheduleOnRN(commit, next);
        else norm.set(committedNorm.value);
      });
  }, [fromNorm, norm, committedNorm, width, dragging, change, commit, onChange]);

  const fill = useAnimatedStyle(() => ({ width: THUMB / 2 + norm.value * (width.value - THUMB) }));
  const thumb = useAnimatedStyle(() => ({ transform: [{ translateX: norm.value * (width.value - THUMB) }] }));

  return (
    <GestureDetector gesture={gesture}>
      <View style={styles.hit} onLayout={(e) => width.set(e.nativeEvent.layout.width)}>
        <View style={styles.track} />
        <Animated.View style={[styles.fill, fill]} />
        <Animated.View style={[styles.thumb, thumb]} />
      </View>
    </GestureDetector>
  );
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  hit: { height: 40, justifyContent: 'center' },
  track: { height: 4, borderRadius: 2, backgroundColor: colors.surface3, marginHorizontal: THUMB / 2 },
  fill: { position: 'absolute', left: 0, height: 4, borderRadius: 2, backgroundColor: colors.accent },
  thumb: {
    position: 'absolute',
    left: 0,
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
});
