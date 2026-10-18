import { StudioIcon as Ionicons } from '@/ui/StudioIcon';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { totalDuration } from '@/core/timeline';
import { usePreferences } from '@/state/preferences';
import { listProjects } from '@/storage/projects';
import { MotionPressable as Pressable } from '@/ui/MotionPressable';
import { NoticeCard, PageHeader, Screen, SectionTitle, SettingsGroup, SettingsRow, StudioAvatar } from '@/ui/Screen';
import { useAppTheme, useThemedStyles, type AppColors } from '@/ui/theme';

export default function Profile() {
  const { colors } = useAppTheme();
  const styles = useThemedStyles(makeStyles);
  const preferences = usePreferences(state => state.preferences);
  const [stats, setStats] = useState<{ projects: number; clips: number; duration: number } | null>(null);
  const [loadError, setLoadError] = useState(false);
  useFocusEffect(useCallback(() => {
    let active = true;
    listProjects().then(projects => {
      if (active) { setStats({ projects: projects.length, clips: projects.reduce((sum, project) => sum + project.main.length, 0), duration: projects.reduce((sum, project) => sum + totalDuration(project.main), 0) }); setLoadError(false); }
    }).catch(() => { if (active) setLoadError(true); });
    return () => { active = false; };
  }, []));
  const minutes = stats ? stats.duration < 60 ? `${Math.round(stats.duration)}s` : `${Math.floor(stats.duration / 60)}m` : '—';
  return <Screen tab>
    <PageHeader title="Your space" subtitle="A little more you." back={false} action={<Pressable onPress={() => router.push('/settings')} style={styles.settingsButton} accessibilityLabel="Open settings"><Ionicons name="settings-outline" size={22} color={colors.text} /></Pressable>} />

    <View style={styles.profileCard}>
      <View style={styles.identity}><StudioAvatar name={preferences.displayName} tone={preferences.avatarTone} size={76} /><View style={styles.identityCopy}><View style={styles.guestBadge}><View style={styles.guestDot} /><Text style={styles.guestLabel}>LOCAL CREATOR</Text></View><Text style={styles.name}>{preferences.displayName}</Text><Text style={styles.bio}>{preferences.bio || 'Good stories start with a little imagination.'}</Text></View></View>
      <Pressable onPress={() => router.push('/edit-profile')} style={styles.editButton}><Ionicons name="pencil-outline" size={16} color={colors.text} /><Text style={styles.editLabel}>Edit profile</Text></Pressable>
    </View>

    <View style={styles.stats}>
      {[{ value: stats?.projects.toString() ?? '—', label: 'Projects' }, { value: stats?.clips.toString() ?? '—', label: 'Clips' }, { value: minutes, label: 'Timeline' }].map((item, index) => <View key={item.label} style={[styles.stat, index !== 2 && styles.statBorder]}><Text style={styles.statValue}>{loadError ? '—' : item.value}</Text><Text style={styles.statLabel}>{item.label}</Text></View>)}
    </View>
    {loadError && <Text accessibilityRole="alert" style={styles.loadError}>Project totals are unavailable. Reopen this tab to try again.</Text>}

    <SectionTitle>Your studio</SectionTitle>
    <SettingsGroup>
      <SettingsRow title="Appearance & preferences" subtitle="Make your workspace feel right" icon="options-outline" onPress={() => router.push('/settings')} />
      <SettingsRow title="Editing guide" subtitle="From your first clip to the final cut" icon="book-outline" onPress={() => router.push('/help')} />
      <SettingsRow title="Your data & privacy" subtitle="Understand what stays on this device" icon="shield-checkmark-outline" onPress={() => router.push({ pathname: '/help', params: { topic: 'data' } })} last />
    </SettingsGroup>

    <Pressable onPress={() => router.push('/sign-in')} style={styles.accountCard} accessibilityLabel="Explore the sign-in design preview. Accounts are not connected yet.">
      <View style={styles.accountIcon}><Ionicons name="person-add-outline" size={22} color={colors.accentText} /></View><View style={styles.accountCopy}><View style={styles.accountHeading}><Text style={styles.accountTitle}>Make yourself at home</Text><Text style={styles.previewBadge}>PREVIEW</Text></View><Text style={styles.accountText}>A peek at your future Smile account.</Text></View><Ionicons name="arrow-forward" size={19} color={colors.textDim} />
    </Pressable>
    <NoticeCard title="Create freely. Stay local." icon="phone-portrait-outline">Your profile and drafts are saved on this device. You can edit and export without an account.</NoticeCard>
    <Text style={styles.footer}>Made for the stories only you can tell.</Text>
  </Screen>;
}

const makeStyles = (colors: AppColors) => StyleSheet.create({
  settingsButton: { width: 46, height: 46, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  profileCard: { backgroundColor: colors.surface, padding: 22, borderWidth: 1, borderColor: colors.border, borderRadius: 26 },
  identity: { flexDirection: 'row', gap: 17, alignItems: 'center' },
  identityCopy: { flex: 1 },
  guestBadge: { flexDirection: 'row', gap: 5, alignItems: 'center', marginBottom: 7 },
  guestDot: { width: 5, height: 5, backgroundColor: colors.success, borderRadius: 3 },
  guestLabel: { fontSize: 9, letterSpacing: 1.4, color: colors.textDim, fontWeight: '700' },
  name: { fontSize: 23, fontWeight: '800', letterSpacing: -0.7, color: colors.text },
  bio: { fontSize: 12, lineHeight: 19, color: colors.textDim, marginTop: 6 },
  editButton: { marginTop: 22, borderWidth: 1, borderColor: colors.border, borderRadius: 13, minHeight: 44, gap: 7, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  editLabel: { fontSize: 13, fontWeight: '600', color: colors.text },
  stats: { flexDirection: 'row', marginTop: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, paddingVertical: 19, borderRadius: 21 },
  stat: { flex: 1, gap: 4, alignItems: 'center', paddingHorizontal: 7 },
  statBorder: { borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: colors.border },
  statValue: { fontSize: 24, fontWeight: '800', letterSpacing: -0.5, color: colors.text },
  statLabel: { fontSize: 11, color: colors.textDim },
  loadError: { color: colors.danger, fontSize: 12, lineHeight: 18, marginTop: 10 },
  accountCard: { flexDirection: 'row', gap: 12, alignItems: 'center', marginTop: 20, borderRadius: 21, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, padding: 17 },
  accountIcon: { width: 43, height: 43, backgroundColor: colors.accentSoft, borderRadius: 15, justifyContent: 'center', alignItems: 'center' },
  accountCopy: { flex: 1 },
  accountHeading: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 7 },
  accountTitle: { fontSize: 14, fontWeight: '700', color: colors.text },
  accountText: { fontSize: 12, lineHeight: 18, color: colors.textDim, marginTop: 4 },
  previewBadge: { fontSize: 8, letterSpacing: 0.8, fontWeight: '800', backgroundColor: colors.surface2, borderRadius: 5, overflow: 'hidden', color: colors.textDim, paddingHorizontal: 5, paddingVertical: 3 },
  footer: { textAlign: 'center', color: colors.textFaint, fontSize: 11, marginTop: 28, marginBottom: 5 },
});
