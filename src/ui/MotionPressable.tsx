import * as Haptics from 'expo-haptics';
import { forwardRef, useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, type PressableProps, type View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';

import { useMotionPreferences } from './motion';
import { useAppTheme } from './theme';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const RELEASE = { damping: 18, stiffness: 390, mass: 0.55 };

export type MotionPressableProps = PressableProps & {
  haptic?: 'selection' | 'light' | 'none';
  active?: boolean;
  motionScale?: number;
};

/**
 * A direct Pressable replacement: no extra layout or responder wrapper. Callbacks, long presses,
 * hit slop and render props retain native Pressable behavior. Only transform and opacity animate.
 */
export const MotionPressable = forwardRef<View, MotionPressableProps>(function MotionPressable({
  style, children, disabled, onPressIn, onPressOut, onPress, onHoverIn, onHoverOut, onFocus, onBlur,
  accessibilityState, haptic = 'selection', active, motionScale = 0.96, ...props
}, ref) {
  const reducedMotion = useMotionPreferences();
  const { colors } = useAppTheme();
  const [pressed, setPressed] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);
  const resolvedStyle = typeof style === 'function' ? style({ pressed: pressed && !disabled, hovered: hovered && !disabled }) : style;
  const flatStyle = StyleSheet.flatten(resolvedStyle);
  const baseOpacity = typeof flatStyle?.opacity === 'number' ? flatStyle.opacity : 1;
  const baseTransform = Array.isArray(flatStyle?.transform) ? flatStyle.transform : [];

  useEffect(() => {
    const target = disabled || reducedMotion ? 1 : pressed ? motionScale : hovered ? 1.015 : 1;
    scale.set(reducedMotion ? 1 : pressed ? withTiming(target, { duration: 90 }) : withSpring(target, RELEASE));
    opacity.set(withTiming(disabled ? 1 : pressed ? 0.78 : 1, { duration: reducedMotion ? 0 : 110 }));
  }, [disabled, hovered, motionScale, opacity, pressed, reducedMotion, scale]);

  const feedback = useAnimatedStyle(() => ({
    opacity: baseOpacity * opacity.value,
    transform: [...baseTransform, { scale: scale.value }],
  }));

  return <AnimatedPressable
    {...props}
    ref={ref}
    disabled={disabled}
    accessibilityRole={props.accessibilityRole ?? 'button'}
    accessibilityState={{ ...accessibilityState, ...(active === undefined ? {} : { selected: active }), disabled: !!disabled }}
    style={[resolvedStyle, feedback, focused && { outlineColor: colors.accentText, outlineWidth: 2, outlineStyle: 'solid', outlineOffset: 3 }]}
    onPressIn={event => { setPressed(true); onPressIn?.(event); }}
    onPressOut={event => { setPressed(false); onPressOut?.(event); }}
    onHoverIn={event => { setHovered(true); onHoverIn?.(event); }}
    onHoverOut={event => { setHovered(false); onHoverOut?.(event); }}
    onFocus={event => { setFocused(true); onFocus?.(event); }}
    onBlur={event => { setFocused(false); setPressed(false); onBlur?.(event); }}
    onPress={event => {
      // Emit feedback only for a completed activation, never a cancelled scroll or disabled control.
      if (disabled) return;
      if (Platform.OS !== 'web' && haptic !== 'none') {
        const feedback = haptic === 'light'
          ? Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
          : Haptics.selectionAsync();
        void feedback.catch(() => {});
      }
      onPress?.(event);
    }}>
    {typeof children === 'function' ? children({ pressed: pressed && !disabled, hovered: hovered && !disabled }) : children}
  </AnimatedPressable>;
});

