import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, Text, View } from 'react-native';

import type { EditTemplate } from '@/core/templates';
import { MotionPressable } from '@/ui/MotionPressable';
import { useAppTheme, useThemedStyles, type AppColors } from '@/ui/theme';

const art: Record<string, { colors: [string, string]; title: string; ink: string }> = {
  daily: { colors: ['#D8E6C8', '#A9C7A4'], title: 'little\nmoments.', ink: '#293D2D' },
  cinema: { colors: ['#385763', '#142E38'], title: 'AFTER\nTHE RAIN', ink: '#EBF0DF' },
  travel: { colors: ['#F4D2A7', '#D99165'], title: 'somewhere\nnew', ink: '#663A25' },
  food: { colors: ['#E5E8B4', '#B9C783'], title: 'made\nwith love', ink: '#394728' },
  retro: { colors: ['#D9C1A2', '#9C7F65'], title: 'THE\nGOOD DAYS', ink: '#3D3025' },
  product: { colors: ['#F8DC8D', '#DDB961'], title: 'meet your\nfavorite.', ink: '#403720' },
  night: { colors: ['#4C3B55', '#252330'], title: 'after\nhours', ink: '#F1C6DC' },
  khmer: { colors: ['#F2D397', '#C6A068'], title: 'អនុស្សាវរីយ៍\nល្អៗ', ink: '#57432D' },
};

/** Small, local title compositions preview a style without pretending to show the user's footage. */
export function StylePreview({ template, onPress, disabled }: { template: EditTemplate; onPress: () => void; disabled?: boolean }) {
  const { colors } = useAppTheme();
  const s = useThemedStyles(makeStyles);
  const preview = art[template.id] ?? art.daily;
  return <MotionPressable onPress={onPress} disabled={disabled} style={s.card} accessibilityLabel={`Start ${template.name}. ${template.description}`}>
    <LinearGradient colors={preview.colors} style={s.art}>
      <View style={[s.orbit, { borderColor: preview.ink }]} />
      <View style={[s.disc, { backgroundColor: preview.ink }]} />
      <View style={s.topLine}><Text style={[s.previewLabel, { color: preview.ink }]}>SMILE / {template.aspect}</Text><View style={[s.miniDot, { backgroundColor: preview.ink }]} /></View>
      <Text style={[s.artTitle, { color: preview.ink }, template.id === 'cinema' && s.cinema, template.id === 'khmer' && s.khmer]}>{preview.title}</Text>
      <View style={[s.baseline, { backgroundColor: preview.ink }]} />
      <Text style={[s.editable, { color: preview.ink }]}>YOUR STORY, YOUR WAY</Text>
    </LinearGradient>
    <View style={s.caption}><Text style={s.name}>{template.name}</Text><Text style={[s.plus, { color: colors.accentText }]}>↗</Text></View>
  </MotionPressable>;
}

const makeStyles = (c: AppColors) => StyleSheet.create({
  card: { width: 152, borderRadius: 19, overflow: 'hidden', backgroundColor: c.surface },
  art: { height: 164, padding: 13, overflow: 'hidden', justifyContent: 'space-between' },
  topLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  previewLabel: { fontSize: 9, fontWeight: '700', letterSpacing: 1 },
  miniDot: { width: 5, height: 5, borderRadius: 3 },
  artTitle: { fontSize: 26, lineHeight: 27, fontWeight: '700', letterSpacing: -1, marginTop: 22 },
  cinema: { fontSize: 22, lineHeight: 25, letterSpacing: 1.3, fontWeight: '500' },
  khmer: { fontSize: 19, lineHeight: 30, letterSpacing: 0 },
  orbit: { width: 175, height: 175, borderRadius: 90, borderWidth: 1, opacity: .13, position: 'absolute', top: -70, right: -75 },
  disc: { width: 100, height: 100, borderRadius: 50, opacity: .08, position: 'absolute', bottom: 12, right: -45 },
  baseline: { height: 1, opacity: .24, marginTop: 10 },
  editable: { fontSize: 7, fontWeight: '600', letterSpacing: 1.3 },
  caption: { paddingHorizontal: 12, minHeight: 47, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 4 },
  name: { fontSize: 13, fontWeight: '600', color: c.text, flexShrink: 1 },
  plus: { fontSize: 20 },
});
