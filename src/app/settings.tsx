import { StudioIcon as Ionicons } from '@/ui/StudioIcon';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { usePreferences, type AppPreferences, type AppearancePreference } from '@/state/preferences';
import { MotionPressable as Pressable } from '@/ui/MotionPressable';
import { ChoiceChips, NoticeCard, PageHeader, Screen, SectionTitle, SettingsGroup, SettingsRow } from '@/ui/Screen';
import { useAppTheme, useThemedStyles, type AppColors } from '@/ui/theme';

const APPEARANCES: { value: AppearancePreference; label: string; icon: 'sunny-outline' | 'moon-outline' | 'phone-portrait-outline' }[] = [
  { value: 'light', label: 'Light', icon: 'sunny-outline' },
  { value: 'dark', label: 'Dark', icon: 'moon-outline' },
  { value: 'system', label: 'System', icon: 'phone-portrait-outline' },
];

export default function Settings() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useAppTheme();
  const preferences = usePreferences(state => state.preferences);
  const ready = usePreferences(state => state.ready);
  const update = usePreferences(state => state.updatePreferences);
  const persistenceError = usePreferences(state => state.error);
  const [saving, setSaving] = useState(false);
  const save = async (patch: Partial<AppPreferences>) => {
    setSaving(true);
    try { await update(patch); } catch { /* The persistent error appears beside these controls. */ }
    finally { setSaving(false); }
  };
  const disabled = !ready || saving;
  return <Screen>
    <PageHeader title="Settings" subtitle="A workspace that feels like you." />
    <SectionTitle>Appearance</SectionTitle>
    <Text style={styles.description}>Set the mood for your next good idea.</Text>
    <View style={styles.appearances} accessibilityRole="radiogroup" accessibilityLabel="App appearance">
      {APPEARANCES.map(item => <Pressable key={item.value} disabled={disabled} onPress={() => void save({ appearance: item.value })} accessibilityRole="radio" accessibilityLabel={`${item.label} appearance`} accessibilityState={{ checked: preferences.appearance === item.value }} style={[styles.appearance, preferences.appearance === item.value && styles.appearanceSelected]}>
        <View style={[styles.preview, { backgroundColor: item.value === 'dark' ? '#25282B' : '#F1F0EB' }]} accessible={false}>
          {item.value === 'system' && <View style={styles.splitPreview} />}
          <View style={[styles.previewHeader, { backgroundColor: item.value === 'dark' ? '#44494E' : '#C9CCC1' }]} /><View style={styles.previewHero} /><View style={styles.previewRows}><View style={[styles.previewRow, { backgroundColor: item.value === 'dark' ? '#44494E' : '#DDE0D5' }]} /><View style={[styles.previewRow, { backgroundColor: item.value === 'dark' ? '#44494E' : '#DDE0D5', width: '65%' }]} /></View>
        </View>
        <View style={styles.appearanceLabel}><Ionicons name={item.icon} size={16} color={preferences.appearance === item.value ? colors.accentText : colors.textDim} /><Text style={[styles.choiceLabel, preferences.appearance === item.value && { color: colors.accentText }]}>{item.label}</Text></View>
        <View style={[styles.radio, preferences.appearance === item.value && styles.radioSelected]}>{preferences.appearance === item.value && <View style={styles.radioDot} />}</View>
      </Pressable>)}
    </View>
    <Text style={styles.helper}>{preferences.appearance === 'system' ? 'Follows your device’s light or dark appearance.' : `${preferences.appearance === 'light' ? 'Light' : 'Dark'} mode stays on until you change it.`}</Text>

    <SectionTitle>Start your way</SectionTitle>
    <View style={styles.controlCard}>
      <View style={styles.controlHeading}><View style={styles.controlIcon}><Ionicons name="crop-outline" size={20} color={colors.textDim} /></View><View style={styles.controlCopy}><Text style={styles.controlTitle}>Default canvas</Text><Text style={styles.helper}>For new projects. Existing drafts keep their size.</Text></View></View>
      <ChoiceChips label="Default canvas" options={[{ value: '9:16', label: '9:16' }, { value: '1:1', label: '1:1' }, { value: '16:9', label: '16:9' }, { value: '4:5', label: '4:5' }, { value: '3:4', label: '3:4' }, { value: 'original', label: 'Original' }]} selected={preferences.defaultAspect} onSelect={value => void save({ defaultAspect: value })} disabled={disabled} />
    </View>

    <SectionTitle>Export defaults</SectionTitle>
    <View style={styles.controlCard}>
      <View style={styles.controlHeading}><View style={styles.controlIcon}><Ionicons name="sparkles-outline" size={20} color={colors.textDim} /></View><View style={styles.controlCopy}><Text style={styles.controlTitle}>Resolution</Text><Text style={styles.helper}>A starting point for each export.</Text></View></View>
      <ChoiceChips label="Export resolution" options={[{ value: 720, label: '720p · Smaller' }, { value: 1080, label: '1080p · Full HD' }]} selected={preferences.exportResolution} onSelect={value => void save({ exportResolution: value })} disabled={disabled} />
      <View style={styles.divider} />
      <Text style={styles.controlTitle}>Frame rate</Text><Text style={[styles.helper, { marginBottom: 14 }]}>Choose the pace that suits your footage.</Text>
      <ChoiceChips label="Export frame rate" options={[{ value: 24, label: '24 fps' }, { value: 30, label: '30 fps' }, { value: 60, label: '60 fps' }]} selected={preferences.exportFps} onSelect={value => void save({ exportFps: value })} disabled={disabled} />
    </View>
    <Text style={styles.helper}>You can adjust resolution and frame rate before exporting.</Text>
    {persistenceError && <Text style={styles.error} accessibilityRole="alert">Settings could not be saved: {persistenceError}. Try your selection again.</Text>}

    <SectionTitle>Good to know</SectionTitle>
    <SettingsGroup>
      <SettingsRow title="Profile" subtitle="Your name, bio, and color" icon="person-outline" onPress={() => router.push('/edit-profile')} />
      <SettingsRow title="Help & about" subtitle="Editing tips and app information" icon="help-circle-outline" onPress={() => router.push('/help')} />
      <SettingsRow title="Storage & privacy" subtitle="Your work is saved on this device" icon="shield-checkmark-outline" onPress={() => router.push({ pathname: '/help', params: { topic: 'data' } })} last />
    </SettingsGroup>
    <NoticeCard title="Your settings, remembered" icon="checkmark-circle-outline">Appearance, profile, and editing preferences are saved locally and stay with you the next time you open Smile Studio.</NoticeCard>
  </Screen>;
}

const makeStyles = (colors: AppColors) => StyleSheet.create({
  description: { color: colors.textDim, fontSize: 13, lineHeight: 20, marginTop: -4, marginBottom: 16 },
  appearances: { flexDirection: 'row', gap: 10 },
  appearance: { flex: 1, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, padding: 10, alignItems: 'center' },
  appearanceSelected: { borderColor: colors.accentText, backgroundColor: colors.accentSoft },
  preview: { width: '100%', height: 96, borderRadius: 10, padding: 10, overflow: 'hidden' },
  splitPreview: { position: 'absolute', right: 0, top: 0, bottom: 0, width: '50%', backgroundColor: '#25282B' },
  previewHeader: { width: '40%', height: 4, borderRadius: 2, marginBottom: 11 },
  previewHero: { height: 30, borderRadius: 6, backgroundColor: '#F0CA71', opacity: 0.9 },
  previewRows: { gap: 5, marginTop: 10 },
  previewRow: { height: 4, width: '85%', borderRadius: 2 },
  appearanceLabel: { flexDirection: 'row', gap: 5, marginTop: 12, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' },
  choiceLabel: { fontSize: 12, fontWeight: '600', color: colors.textDim },
  radio: { borderWidth: 1.5, borderColor: colors.borderStrong, width: 17, height: 17, borderRadius: 9, marginTop: 11, alignItems: 'center', justifyContent: 'center' },
  radioSelected: { borderColor: colors.accentText },
  radioDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.accentText },
  helper: { color: colors.textDim, fontSize: 12, lineHeight: 19, marginTop: 9 },
  controlCard: { padding: 18, borderRadius: 22, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  controlHeading: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 18 },
  controlIcon: { width: 40, height: 40, borderRadius: 13, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
  controlCopy: { flex: 1 },
  controlTitle: { fontSize: 14, fontWeight: '700', color: colors.text },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: 20 },
  error: { color: colors.danger, fontSize: 12, lineHeight: 19, marginTop: 15 },
});
