import { useEffect, type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { font, radius, type AppColors, useThemedStyles, useAppTheme } from './theme';
import { MotionPressable } from './MotionPressable';
import { StudioIcon } from './StudioIcon';
import { useMotionPreferences } from './motion';
import { useKeyboardSpace } from './useKeyboardSpace';

/** Bottom sheet modal. Tapping the backdrop closes it. */
export function Sheet({
  visible,
  onClose,
  onDismiss,
  title,
  children,
  keyboardAware = false,
}: {
  visible: boolean;
  onClose: () => void;
  onDismiss?: () => void;
  title?: string;
  children: ReactNode;
  keyboardAware?: boolean;
}) {
  const { colors } = useAppTheme();
  const styles = useThemedStyles(createStyles);
  const insets = useSafeAreaInsets();
  const reducedMotion = useMotionPreferences();
  const keyboardSpace = useKeyboardSpace(visible && keyboardAware);
  // A plain animated transform, not a Reanimated `entering` animation: inside a Modal on iOS the latter
  // left the sheet's touch area behind, so taps on its buttons fell through to the backdrop.
  const offset = useSharedValue(600);
  useEffect(() => {
    offset.set(visible ? reducedMotion ? 0 : withSpring(0, { damping: 25, stiffness: 270, overshootClamping: true }) : 600);
  }, [visible, offset, reducedMotion]);
  const slide = useAnimatedStyle(() => ({ transform: [{ translateY: offset.value }] }));
  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} onDismiss={onDismiss} statusBarTranslucent>
      <Animated.View entering={FadeIn.duration(reducedMotion ? 0 : 150)} style={StyleSheet.absoluteFill}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" accessibilityRole="button" />
      </Animated.View>
      <Animated.View accessibilityViewIsModal style={[styles.sheet, { bottom: keyboardSpace, paddingBottom: (keyboardSpace ? 0 : insets.bottom) + 12 }, slide]}>
        <View style={styles.grabber} />
        {title ? (
          <View style={styles.heading}><Text accessibilityRole="header" style={styles.title} numberOfLines={1}>
            {title}
          </Text><MotionPressable onPress={onClose} accessibilityLabel={`Close ${title}`} style={styles.close}><StudioIcon name="close" size={18} color={colors.textDim}/></MotionPressable></View>
        ) : null}
        {children}
      </Animated.View>
    </Modal>
  );
}

export function SheetButton({
  label,
  onPress,
  destructive,
  icon,
}: {
  label: string;
  onPress: () => void;
  destructive?: boolean;
  icon?: ReactNode;
}) {
  const { colors } = useAppTheme();
  const styles = useThemedStyles(createStyles);
  return (
    <MotionPressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.button, pressed && { backgroundColor: colors.surface3 }]}>
      {icon}
      <Text style={[styles.buttonText, destructive && { color: colors.danger }]}>{label}</Text>
    </MotionPressable>
  );
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surface2,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: 12,
    paddingTop: 8,
    borderTopWidth: 1,
    borderColor: colors.borderStrong,
  },
  grabber: {
    alignSelf: 'center',
    width: 30,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.borderStrong,
    marginBottom: 2,
  },
  heading: { flexDirection: 'row', alignItems: 'center', paddingLeft: 6, marginBottom: 10 },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, backgroundColor: colors.surfaceRaised },
  title: { ...font.h2, fontSize: 21, letterSpacing: -.6, color: colors.text, flex: 1 },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 12,
    paddingVertical: 15,
    borderRadius: radius.md,
  },
  buttonText: { ...font.body, color: colors.text, fontSize: 16 },
});
