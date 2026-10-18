import { StudioIcon as Ionicons, type StudioIconName } from '@/ui/StudioIcon';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { AvatarTone } from '@/state/preferences';
import { MotionPressable as Pressable } from '@/ui/MotionPressable';
import { useAppTheme, useThemedStyles, type AppColors } from '@/ui/theme';

type IconName = StudioIconName;

/** Shared page spacing keeps the studio's quieter account screens consistent. */
export function Screen({ children, scroll = true, tab = false, style }: { children: ReactNode; scroll?: boolean; tab?: boolean; style?: StyleProp<ViewStyle> }) {
  const styles = useThemedStyles(makeStyles);
  return <SafeAreaView style={styles.screen} edges={tab ? ['top'] : ['top', 'bottom']}>
    {scroll ? <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={[styles.content, style]}>{children}</ScrollView> : <View style={[styles.content, { flex: 1 }, style]}>{children}</View>}
  </SafeAreaView>;
}

export function PageHeader({ title, subtitle, back = true, action }: { title: string; subtitle?: string; back?: boolean; action?: ReactNode }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useAppTheme();
  return <View style={styles.header}>
    {back && <Pressable style={styles.headerButton} accessibilityLabel="Go back" onPress={() => router.canGoBack() ? router.back() : router.replace('/')}><Ionicons name="arrow-back" size={22} color={colors.text} /></Pressable>}
    <View style={styles.headerCopy}><Text style={styles.title} accessibilityRole="header">{title}</Text>{subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}</View>
    {action}
  </View>;
}

export function SectionTitle({ children, note }: { children: ReactNode; note?: string }) {
  const styles = useThemedStyles(makeStyles);
  return <View style={styles.sectionHeading}><Text style={styles.sectionTitle} accessibilityRole="header">{children}</Text>{note && <Text style={styles.sectionNote}>{note}</Text>}</View>;
}

export function SettingsGroup({ children }: { children: ReactNode }) {
  const styles = useThemedStyles(makeStyles);
  return <View style={styles.group}>{children}</View>;
}

export function SettingsRow({ title, subtitle, icon, value, onPress, last = false }: { title: string; subtitle?: string; icon: IconName; value?: string; onPress: () => void; last?: boolean }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useAppTheme();
  return <Pressable onPress={onPress} motionScale={0.99} style={[styles.row, !last && styles.rowBorder]} accessibilityLabel={[title, value, subtitle].filter(Boolean).join('. ')}>
    <View style={styles.rowIcon}><Ionicons name={icon} size={20} color={colors.textDim} /></View>
    <View style={styles.rowCopy}><Text style={styles.rowTitle}>{title}</Text>{subtitle && <Text style={styles.rowSubtitle}>{subtitle}</Text>}</View>
    {value && <Text numberOfLines={1} style={styles.rowValue}>{value}</Text>}
    <Ionicons name="chevron-forward" size={17} color={colors.textFaint} />
  </Pressable>;
}

export function ChoiceChips<T extends string | number>({ label, options, selected, onSelect, disabled }: { label: string; options: readonly { value: T; label: string }[]; selected: T; onSelect: (value: T) => void; disabled?: boolean }) {
  const styles = useThemedStyles(makeStyles);
  return <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel={label}>{options.map(option => <Pressable key={option.value} onPress={() => onSelect(option.value)} disabled={disabled} accessibilityRole="radio" accessibilityState={{ checked: selected === option.value }} accessibilityLabel={`${label}: ${option.label}`} style={[styles.chip, selected === option.value && styles.selectedChip]}><Text style={[styles.chipLabel, selected === option.value && styles.selectedChipLabel]}>{option.label}</Text></Pressable>)}</View>;
}

export function NoticeCard({ title, children, icon = 'information-circle-outline' }: { title: string; children: ReactNode; icon?: IconName }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useAppTheme();
  return <View style={styles.notice}><Ionicons name={icon} size={21} color={colors.accentText} /><View style={styles.rowCopy}><Text style={styles.noticeTitle}>{title}</Text><Text style={styles.noticeText}>{children}</Text></View></View>;
}

export const AVATAR_TONES: { value: AvatarTone; label: string; color: string }[] = [
  { value: 'sunshine', label: 'Sunshine', color: '#F2CE78' },
  { value: 'sage', label: 'Sage', color: '#C1D7B7' },
  { value: 'lavender', label: 'Lavender', color: '#D7CCEB' },
  { value: 'peach', label: 'Peach', color: '#F2C4AC' },
];

export function StudioAvatar({ name, tone, size = 72 }: { name: string; tone: AvatarTone; size?: number }) {
  const initials = name.trim().split(/\s+/u).slice(0, 2).map(part => [...part][0] ?? '').join('').toLocaleUpperCase();
  return <View accessibilityLabel={`${name} avatar`} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: AVATAR_TONES.find(item => item.value === tone)?.color ?? AVATAR_TONES[0].color, justifyContent: 'center', alignItems: 'center' }}><Text style={{ fontSize: size * 0.32, fontWeight: '800', color: '#34392C', letterSpacing: -0.8 }}>{initials || 'S'}</Text></View>;
}

const makeStyles = (colors: AppColors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { width: '100%', maxWidth: 720, alignSelf: 'center', paddingHorizontal: 22, paddingBottom: 32 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 18, marginBottom: 14 },
  headerCopy: { flex: 1 },
  headerButton: { width: 44, height: 44, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 28, fontWeight: '800', letterSpacing: -0.9, color: colors.text },
  subtitle: { fontSize: 13, lineHeight: 20, marginTop: 3, color: colors.textDim },
  sectionHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 28, marginBottom: 12, gap: 10 },
  sectionTitle: { fontSize: 17, fontWeight: '700', letterSpacing: -0.3, color: colors.text },
  sectionNote: { fontSize: 12, color: colors.textDim },
  group: { borderRadius: 22, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, paddingHorizontal: 16 },
  row: { minHeight: 72, flexDirection: 'row', gap: 12, alignItems: 'center', paddingVertical: 14 },
  rowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  rowIcon: { width: 36, height: 36, backgroundColor: colors.surface2, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  rowCopy: { flex: 1 },
  rowTitle: { fontSize: 15, lineHeight: 21, fontWeight: '600', color: colors.text },
  rowSubtitle: { fontSize: 12, lineHeight: 18, color: colors.textDim, marginTop: 2 },
  rowValue: { maxWidth: '29%', fontSize: 12, color: colors.textDim },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: 44, minWidth: 58, paddingHorizontal: 16, paddingVertical: 11, borderRadius: 13, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  selectedChip: { borderColor: colors.accentText, backgroundColor: colors.accentSoft },
  chipLabel: { fontSize: 13, fontWeight: '600', color: colors.textDim },
  selectedChipLabel: { color: colors.accentText },
  notice: { flexDirection: 'row', gap: 12, padding: 18, borderRadius: 20, backgroundColor: colors.accentSoft, marginTop: 22 },
  noticeTitle: { fontSize: 14, lineHeight: 20, color: colors.text, fontWeight: '700' },
  noticeText: { fontSize: 12, lineHeight: 19, color: colors.textDim, marginTop: 4 },
});
