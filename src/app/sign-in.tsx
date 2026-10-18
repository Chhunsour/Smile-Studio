import { StudioIcon as Ionicons } from '@/ui/StudioIcon';
import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { Logo } from '@/ui/Logo';
import { MotionPressable as Pressable } from '@/ui/MotionPressable';
import { NoticeCard, PageHeader, Screen } from '@/ui/Screen';
import { useAppTheme, useThemedStyles, type AppColors } from '@/ui/theme';

export default function SignInPreview() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useAppTheme();
  return <Screen>
    <PageHeader title="Smile account" />
    <View style={styles.art} accessible={false}>
      <View style={styles.orbit} /><View style={styles.orbitInner} /><View style={styles.artDot} /><View style={styles.artDotSmall} />
      <View style={styles.miniFilm}><Ionicons name="play" size={21} color={colors.accentText} /><View style={styles.miniLine} /><View style={[styles.miniLine, { width: 21, opacity: 0.5 }]} /></View>
      <View style={styles.logoFrame}><Logo size={83} /></View>
      <View style={styles.spark}><Ionicons name="sparkles" size={25} color={colors.accentText} /></View>
    </View>
    <View style={styles.intro}><View style={styles.previewBadge}><View style={styles.previewDot} /><Text style={styles.previewLabel}>DESIGN PREVIEW</Text></View><Text style={styles.headline}>Every story starts{ '\n' }with you.</Text><Text style={styles.description}>A little glimpse of your future Smile account.{ '\n' }For now, your creative space is right here.</Text></View>
    <View style={styles.providers}>
      {[{ icon: 'logo-apple', text: 'Continue with Apple' }, { icon: 'logo-google', text: 'Continue with Google' }, { icon: 'mail-outline', text: 'Continue with email' }].map(item => <Pressable key={item.text} disabled haptic="none" style={styles.provider} accessibilityLabel={`${item.text}. Design preview only. Sign-in is not available.`} accessibilityHint="Accounts will be available after the service is connected."><Ionicons name={item.icon as 'logo-apple' | 'logo-google' | 'mail-outline'} size={21} color={colors.textDim} /><Text style={styles.providerLabel}>{item.text}</Text><Ionicons name="lock-closed-outline" size={13} color={colors.textFaint} /></Pressable>)}
    </View>
    <NoticeCard title="Accounts aren’t connected yet" icon="information-circle-outline">These options show the planned design. No sign-in is available, and no email, password, or account information is requested.</NoticeCard>
    <Pressable onPress={() => router.canGoBack() ? router.back() : router.replace('/')} style={styles.continue} haptic="light"><Text style={styles.continueLabel}>Continue creating</Text><Ionicons name="arrow-forward" size={19} color={colors.accentInk} /></Pressable>
    <Text style={styles.guestText}>All current editing features work without an account.</Text>
  </Screen>;
}

const makeStyles = (colors: AppColors) => StyleSheet.create({
  art: { height: 210, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  orbit: { position: 'absolute', width: 204, height: 204, borderRadius: 102, borderColor: colors.border, borderWidth: 1 },
  orbitInner: { position: 'absolute', width: 151, height: 151, borderRadius: 76, backgroundColor: colors.accentSoft },
  logoFrame: { borderRadius: 31, backgroundColor: colors.surface, padding: 9, transform: [{ rotate: '-8deg' }], borderWidth: 1, borderColor: colors.border },
  artDot: { position: 'absolute', right: '24%', top: 14, width: 14, height: 14, borderRadius: 7, backgroundColor: '#C1D7B7' },
  artDotSmall: { position: 'absolute', left: '27%', bottom: 23, width: 9, height: 9, borderRadius: 5, backgroundColor: '#D7CCEB' },
  miniFilm: { position: 'absolute', left: '17%', top: 25, width: 62, height: 82, padding: 11, gap: 6, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 13, transform: [{ rotate: '-13deg' }], alignItems: 'center' },
  miniLine: { height: 4, width: 33, borderRadius: 2, backgroundColor: colors.borderStrong },
  spark: { position: 'absolute', right: '16%', bottom: 33, width: 54, height: 54, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, transform: [{ rotate: '12deg' }] },
  intro: { alignItems: 'center' },
  previewBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 20, paddingVertical: 7, paddingHorizontal: 12, backgroundColor: colors.surface2, marginTop: 12 },
  previewDot: { backgroundColor: colors.accentText, width: 5, height: 5, borderRadius: 3 },
  previewLabel: { fontSize: 9, letterSpacing: 1.4, color: colors.textDim, fontWeight: '700' },
  headline: { fontSize: 33, lineHeight: 39, fontWeight: '800', letterSpacing: -1.1, color: colors.text, textAlign: 'center', marginTop: 19 },
  description: { fontSize: 13, lineHeight: 21, color: colors.textDim, textAlign: 'center', marginTop: 12 },
  providers: { marginTop: 29, gap: 11 },
  provider: { minHeight: 54, paddingHorizontal: 18, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, flexDirection: 'row', gap: 13, alignItems: 'center' },
  providerLabel: { flex: 1, color: colors.textDim, fontSize: 14, fontWeight: '600' },
  continue: { marginTop: 22, minHeight: 55, gap: 10, borderRadius: 17, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', flexDirection: 'row' },
  continueLabel: { fontSize: 15, fontWeight: '700', color: colors.accentInk },
  guestText: { color: colors.textFaint, fontSize: 11, lineHeight: 18, textAlign: 'center', marginTop: 15 },
});
