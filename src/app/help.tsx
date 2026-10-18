import { StudioIcon as Ionicons } from '@/ui/StudioIcon';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import appConfig from '../../app.json';
import { Logo } from '@/ui/Logo';
import { MotionPressable as Pressable } from '@/ui/MotionPressable';
import { NoticeCard, PageHeader, Screen, SectionTitle } from '@/ui/Screen';
import { useAppTheme, useThemedStyles, type AppColors } from '@/ui/theme';

const GUIDE = [
  { id: 'start', icon: 'film-outline', title: 'Start a new story', text: 'Tap New project and choose videos or photos from your library. Your draft saves automatically as you edit. Choose Reel (9:16), Square (1:1), or Video (16:9) to start with a specific canvas.' },
  { id: 'edit', icon: 'cut-outline', title: 'Find your rhythm', text: 'Tap a clip on the timeline to reveal its tools. Trim the edges, split at the playhead, change speed, or add a filter. Undo lets you step back while you’re editing.' },
  { id: 'captions', icon: 'chatbox-ellipses-outline', title: 'Add your voice and words', text: 'Use Text for titles and stickers. Captions can be added at the playhead or imported from an SRT or WebVTT file, then edited and styled. Sounds adds music and effects; Voiceover records your own audio with microphone permission.' },
  { id: 'export', icon: 'share-outline', title: 'Share the finished feeling', text: 'Tap Export in the editor, choose your resolution and frame rate, then keep Smile Studio open until it finishes. Save the video to your photo library or use Share to send a copy to another app.' },
] as const;

export default function Help() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useAppTheme();
  const { topic } = useLocalSearchParams<{ topic?: string }>();
  const [open, setOpen] = useState<string | null>(topic === 'data' ? null : 'start');
  return <Screen>
    <PageHeader title={topic === 'data' ? 'Your data' : 'A little guidance'} subtitle={topic === 'data' ? 'Your studio, saved on this device.' : 'More creating. Less figuring things out.'} />
    {topic === 'data' && <LocalData />}
    <View style={styles.hero}><View style={styles.heroIcon}><Ionicons name="bulb-outline" size={26} color={colors.accentText} /></View><View style={styles.heroCopy}><Text style={styles.heroTitle}>Small steps. Good stories.</Text><Text style={styles.heroText}>A quick guide to feeling at home in your editor.</Text></View></View>
    <SectionTitle>From idea to final cut</SectionTitle>
    <View style={styles.guide}>
      {GUIDE.map((item, index) => <View key={item.id} style={index !== GUIDE.length - 1 && styles.guideBorder}><Pressable onPress={() => setOpen(open === item.id ? null : item.id)} style={styles.question} accessibilityState={{ expanded: open === item.id }} accessibilityLabel={item.title}><View style={styles.step}><Ionicons name={item.icon} size={19} color={colors.textDim} /></View><Text style={styles.questionTitle}>{item.title}</Text><Ionicons name={open === item.id ? 'remove' : 'add'} size={20} color={colors.textDim} /></Pressable>{open === item.id && <Text style={styles.answer}>{item.text}</Text>}</View>)}
    </View>
    {topic !== 'data' && <LocalData />}
    <SectionTitle>About Smile Studio</SectionTitle>
    <View style={styles.about}><Logo size={48} /><View style={styles.aboutCopy}><Text style={styles.aboutTitle}>A little studio. Endless ideas.</Text><Text style={styles.aboutText}>A video editor for short stories, everyday moments, and your next Reel.</Text><Text style={styles.version}>Smile Studio · Version {appConfig.expo.version}</Text></View></View>
    <Text style={styles.footer}>Take your time. Make something that feels like you.</Text>
  </Screen>;
}

function LocalData() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useAppTheme();
  return <>
    <SectionTitle>Local by design</SectionTitle>
    <View style={styles.dataCard}>
      {[{ icon: 'phone-portrait-outline', title: 'Drafts live here', text: 'Projects, imported media copies, your local profile, and preferences are stored in this app on this device.' }, { icon: 'cloud-offline-outline', title: 'No cloud account yet', text: 'There is no account service or cloud sync connected. The sign-in screen is a design preview and does not collect credentials.' }, { icon: 'images-outline', title: 'You choose access', text: 'Photo access is used to import media or save exports. Microphone access is requested when you record a voiceover. You can change permissions in your device settings.' }].map((item, index) => <View key={item.title} style={[styles.dataRow, index !== 2 && styles.guideBorder]}><Ionicons name={item.icon as 'phone-portrait-outline' | 'cloud-offline-outline' | 'images-outline'} size={20} color={colors.textDim} /><View style={styles.dataCopy}><Text style={styles.dataTitle}>{item.title}</Text><Text style={styles.dataText}>{item.text}</Text></View></View>)}
    </View>
    <NoticeCard title="Keep a copy of the moments you love" icon="folder-open-outline">Removing the app can remove its local drafts. Save or share finished videos outside the app to keep a separate copy. Deleting a draft does not delete a video you’ve already saved to your photo library.</NoticeCard>
  </>;
}

const makeStyles = (colors: AppColors) => StyleSheet.create({
  hero: { borderRadius: 23, backgroundColor: colors.accentSoft, padding: 21, flexDirection: 'row', gap: 15, alignItems: 'center', marginTop: 4 },
  heroIcon: { width: 49, height: 58, borderRadius: 17, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '-7deg' }] },
  heroCopy: { flex: 1 },
  heroTitle: { fontSize: 18, fontWeight: '800', letterSpacing: -0.4, color: colors.text },
  heroText: { fontSize: 12, lineHeight: 19, color: colors.textDim, marginTop: 7 },
  guide: { paddingHorizontal: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 22 },
  guideBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  question: { minHeight: 76, flexDirection: 'row', gap: 12, alignItems: 'center', paddingVertical: 15 },
  step: { width: 36, height: 36, borderRadius: 12, backgroundColor: colors.surface2, justifyContent: 'center', alignItems: 'center' },
  questionTitle: { fontSize: 14, fontWeight: '600', color: colors.text, flex: 1 },
  answer: { fontSize: 13, lineHeight: 22, color: colors.textDim, paddingLeft: 48, paddingBottom: 21, paddingRight: 7 },
  dataCard: { borderWidth: 1, borderColor: colors.border, borderRadius: 22, backgroundColor: colors.surface, paddingHorizontal: 18 },
  dataRow: { flexDirection: 'row', gap: 13, paddingVertical: 20 },
  dataCopy: { flex: 1 },
  dataTitle: { fontSize: 14, lineHeight: 20, color: colors.text, fontWeight: '700' },
  dataText: { fontSize: 12, lineHeight: 20, color: colors.textDim, marginTop: 5 },
  about: { flexDirection: 'row', gap: 15, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: 22, padding: 20 },
  aboutCopy: { flex: 1 },
  aboutTitle: { fontSize: 15, color: colors.text, fontWeight: '700' },
  aboutText: { fontSize: 12, lineHeight: 19, color: colors.textDim, marginTop: 6 },
  version: { fontSize: 11, lineHeight: 18, color: colors.textFaint, marginTop: 13 },
  footer: { fontSize: 11, color: colors.textFaint, textAlign: 'center', lineHeight: 18, marginTop: 28 },
});
