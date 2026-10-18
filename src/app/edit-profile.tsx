import { StudioIcon as Ionicons } from '@/ui/StudioIcon';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from 'react-native';

import { usePreferences, type AvatarTone } from '@/state/preferences';
import { MotionPressable as Pressable } from '@/ui/MotionPressable';
import { AVATAR_TONES, NoticeCard, PageHeader, Screen, SectionTitle, StudioAvatar } from '@/ui/Screen';
import { useAppTheme, useThemedStyles, type AppColors } from '@/ui/theme';

export default function EditProfile() {
  const ready = usePreferences(state => state.ready);
  const { colors } = useAppTheme();
  if (!ready) return <Screen><PageHeader title="Edit profile" /><ActivityIndicator accessibilityLabel="Loading your profile" color={colors.accentText} /></Screen>;
  return <ProfileEditor />;
}

function ProfileEditor() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useAppTheme();
  const preferences = usePreferences(state => state.preferences);
  const update = usePreferences(state => state.updatePreferences);
  const [name, setName] = useState(preferences.displayName);
  const [bio, setBio] = useState(preferences.bio);
  const [tone, setTone] = useState<AvatarTone>(preferences.avatarTone);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    if (!name.trim()) { setError('Give your studio a name before saving.'); return; }
    setSaving(true); setError('');
    try { await update({ displayName: name.trim(), bio: bio.trim(), avatarTone: tone }); if (router.canGoBack()) router.back(); else router.replace('/profile'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Your profile could not be saved. Try again.'); }
    finally { setSaving(false); }
  };
  const cancel = () => {
    if (name !== preferences.displayName || bio !== preferences.bio || tone !== preferences.avatarTone) Alert.alert('Discard profile changes?', 'Your saved profile will stay as it was.', [{ text: 'Keep editing', style: 'cancel' }, { text: 'Discard', style: 'destructive', onPress: () => router.canGoBack() ? router.back() : router.replace('/profile') }]);
    else if (router.canGoBack()) router.back(); else router.replace('/profile');
  };
  return <KeyboardAvoidingView style={styles.keyboard} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <Screen>
      <PageHeader title="Edit profile" subtitle="Add a personal touch to your studio." back={false} action={<Pressable onPress={cancel} disabled={saving} accessibilityLabel="Cancel editing profile" style={styles.close}><Ionicons name="close" size={22} color={colors.text} /></Pressable>} />
      <View style={styles.avatarWrap}><StudioAvatar name={name} tone={tone} size={104} /><Text style={styles.avatarNote}>A color for your creative side</Text></View>
      <View style={styles.tones} accessibilityRole="radiogroup" accessibilityLabel="Avatar color">{AVATAR_TONES.map(item => <Pressable key={item.value} onPress={() => setTone(item.value)} disabled={saving} accessibilityRole="radio" accessibilityLabel={item.label} accessibilityState={{ checked: tone === item.value }} style={[styles.tone, tone === item.value && styles.toneSelected]}><View style={[styles.swatch, { backgroundColor: item.color }]}>{tone === item.value && <Ionicons name="checkmark" size={19} color="#34392C" />}</View><Text style={styles.toneLabel}>{item.label}</Text></Pressable>)}</View>
      <SectionTitle>Your details</SectionTitle>
      <View style={styles.fields}>
        <Text style={styles.label}>Studio name</Text>
        <TextInput accessibilityLabel="Studio name" value={name} onChangeText={value => { setName(value); setError(''); }} maxLength={40} placeholder="Your studio" placeholderTextColor={colors.textFaint} selectionColor={colors.selection} style={styles.input} editable={!saving} autoCapitalize="words" autoComplete="off" textContentType="none" returnKeyType="done" />
        <Text style={styles.counter}>{name.length}/40</Text>
        <Text style={styles.label}>A little about you <Text style={styles.optional}>· optional</Text></Text>
        <TextInput accessibilityLabel="Profile bio, optional" value={bio} onChangeText={setBio} maxLength={160} placeholder="What do you love to create?" placeholderTextColor={colors.textFaint} selectionColor={colors.selection} style={[styles.input, styles.bioInput]} multiline textAlignVertical="top" editable={!saving} autoComplete="off" textContentType="none" />
        <Text style={styles.counter}>{bio.length}/160</Text>
      </View>
      {error && <Text style={styles.error} accessibilityRole="alert">{error}</Text>}
      <Pressable onPress={() => void save()} disabled={saving || !name.trim()} style={[styles.saveButton, (!name.trim() || saving) && styles.disabled]} haptic="light" accessibilityLabel="Save profile">
        {saving ? <ActivityIndicator color={colors.accentInk} /> : <Ionicons name="checkmark" size={20} color={colors.accentInk} />}<Text style={styles.saveLabel}>{saving ? 'Saving…' : 'Save changes'}</Text>
      </Pressable>
      <NoticeCard title="Just for this device" icon="lock-closed-outline">This is a local profile, so it doesn’t create an account or upload your details.</NoticeCard>
    </Screen>
  </KeyboardAvoidingView>;
}

const makeStyles = (colors: AppColors) => StyleSheet.create({
  keyboard: { flex: 1, backgroundColor: colors.bg },
  close: { width: 44, height: 44, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  avatarWrap: { alignItems: 'center', gap: 15, paddingTop: 8, paddingBottom: 18 },
  avatarNote: { color: colors.textDim, fontSize: 12 },
  tones: { flexDirection: 'row', gap: 10, justifyContent: 'center' },
  tone: { flex: 1, maxWidth: 100, alignItems: 'center', paddingVertical: 10, borderRadius: 15, borderWidth: 1, borderColor: 'transparent', gap: 8 },
  toneSelected: { borderColor: colors.borderStrong, backgroundColor: colors.surface },
  swatch: { width: 35, height: 35, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  toneLabel: { color: colors.textDim, fontSize: 11 },
  fields: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, padding: 18, borderRadius: 23 },
  label: { fontSize: 13, color: colors.text, fontWeight: '700', marginBottom: 10 },
  optional: { fontSize: 12, color: colors.textDim, fontWeight: '400' },
  input: { backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border, borderRadius: 13, minHeight: 50, paddingHorizontal: 14, paddingVertical: 13, color: colors.text, fontSize: 15 },
  bioInput: { minHeight: 113, lineHeight: 22 },
  counter: { fontSize: 10, color: colors.textFaint, textAlign: 'right', marginTop: 7, marginBottom: 18 },
  error: { color: colors.danger, fontSize: 12, lineHeight: 19, marginTop: 16 },
  saveButton: { marginTop: 22, backgroundColor: colors.accent, minHeight: 54, borderRadius: 17, gap: 8, alignItems: 'center', justifyContent: 'center', flexDirection: 'row' },
  disabled: { opacity: 0.45 },
  saveLabel: { fontSize: 15, fontWeight: '700', color: colors.accentInk },
});
