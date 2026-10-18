import { useEffect, useState } from 'react';
import {
  BackHandler,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { font, radius, type AppColors, useThemedStyles, useAppTheme } from './theme';
import { MotionPressable as Pressable } from './MotionPressable';
import { useMotionPreferences } from './motion';

/**
 * Cross-platform text prompt (Alert.prompt is iOS-only). Rendered as an in-screen overlay rather than a
 * Modal, because iOS won't present a Modal while another one (e.g. an action sheet) is still dismissing.
 * Render it last in the screen root.
 */
export function PromptDialog({
  visible,
  ...props
}: {
  visible: boolean;
  title: string;
  initialValue: string;
  confirmLabel?: string;
  onCancel: () => void;
  onConfirm: (value: string) => void;
}) {
  return visible ? <Prompt {...props} /> : null;
}

function Prompt({
  title,
  initialValue,
  confirmLabel = 'Save',
  onCancel,
  onConfirm,
}: {
  title: string;
  initialValue: string;
  confirmLabel?: string;
  onCancel: () => void;
  onConfirm: (value: string) => void;
}) {
  const { colors, isDark } = useAppTheme();
  const styles = useThemedStyles(createStyles);
  const [value, setValue] = useState(initialValue);
  const reducedMotion = useMotionPreferences();
  const trimmed = value.trim();

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onCancel();
      return true;
    });
    return () => sub.remove();
  }, [onCancel]);

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.root}>
      <Animated.View entering={FadeIn.duration(reducedMotion ? 0 : 120)} exiting={FadeOut.duration(reducedMotion ? 0 : 120)} style={StyleSheet.absoluteFill}>
        <Pressable style={styles.backdrop} onPress={onCancel} motionScale={1} haptic="none" accessibilityLabel="Dismiss prompt" />
      </Animated.View>
      <Animated.View entering={FadeIn.duration(reducedMotion ? 0 : 150)} style={styles.card}>
        <Text style={styles.title}>{title}</Text>
        <TextInput
          value={value}
          onChangeText={setValue}
          autoFocus
          selectTextOnFocus
          clearButtonMode="always"
          maxLength={60}
          returnKeyType="done"
          onSubmitEditing={() => trimmed && onConfirm(trimmed)}
          style={styles.input}
          placeholderTextColor={colors.textFaint}
          selectionColor={colors.accent}
          keyboardAppearance={isDark ? 'dark' : 'light'}
        />
        <View style={styles.row}>
          <Pressable style={styles.btn} onPress={onCancel}>
            <Text style={styles.cancel}>Cancel</Text>
          </Pressable>
          <Pressable
            style={[styles.btn, styles.primary, !trimmed && { opacity: 0.4 }]}
            disabled={!trimmed}
            onPress={() => onConfirm(trimmed)}>
            <Text style={styles.primaryText}>{confirmLabel}</Text>
          </Pressable>
        </View>
      </Animated.View>
    </KeyboardAvoidingView>
  );
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  root: { ...StyleSheet.absoluteFill, zIndex: 100, alignItems: 'center', justifyContent: 'center', padding: 24 },
  backdrop: { flex: 1, backgroundColor: colors.overlay },
  card: { width: '100%', maxWidth: 380, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.xl, padding: 22 },
  title: { ...font.h2, color: colors.text, marginBottom: 14 },
  input: {
    ...font.body,
    color: colors.text,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  row: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 18 },
  btn: { paddingHorizontal: 18, paddingVertical: 11, minHeight: 44, justifyContent: 'center', borderRadius: radius.md },
  cancel: { ...font.body, color: colors.textDim },
  primary: { backgroundColor: colors.accent },
  primaryText: { ...font.body, color: colors.accentInk, fontWeight: '700' },
});
