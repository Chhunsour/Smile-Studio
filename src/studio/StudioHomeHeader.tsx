import { StudioIcon as Ionicons } from '@/ui/StudioIcon';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { EDIT_TEMPLATES } from '@/core/templates';
import type { AspectRatio } from '@/core/types';
import { usePreferences } from '@/state/preferences';
import { MotionPressable } from '@/ui/MotionPressable';
import { useAppTheme, useThemedStyles, type AppColors } from '@/ui/theme';
import { StylePreview } from './StylePreview';

export function StudioHomeHeader({ onStart, importing }: { onStart: (aspect?: AspectRatio, template?: string) => void; importing: boolean }) {
  const { colors, isDark } = useAppTheme();
  const s = useThemedStyles(makeStyles);
  const name = usePreferences(state => state.preferences.displayName);
  return <>
    <View style={s.welcome}>
      <Text style={s.eyebrow}>{name === 'Your studio' ? 'A SPACE FOR YOUR IDEAS' : `WELCOME BACK, ${name.toLocaleUpperCase()}`}</Text>
      <Text style={s.heading}>Make something{ '\n' }worth sharing.</Text>
      <Text style={s.intro}>A little footage. A story only you can tell.</Text>
    </View>
    <MotionPressable disabled={importing} onPress={() => onStart()} haptic="light" motionScale={.985} accessibilityLabel="New project. Import videos and photos" style={s.heroWrap}>
      <LinearGradient colors={isDark ? ['#EED195', '#F0CA71'] : ['#F8DFA5', '#F1CE7D']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.hero}>
        <View style={s.heroCopy}><View style={s.heroTag}><View style={s.dot} /><Text style={s.heroTagText}>LET’S CREATE</Text></View><Text style={s.heroTitle}>New project</Text><Text style={s.heroSub}>Bring your videos & photos.</Text><View style={s.heroAction}><View style={s.plus}><Ionicons name="add" color="#FAE3AE" size={24} /></View><Text style={s.heroActionText}>Start creating</Text><Ionicons name="arrow-forward" size={17} color="#3F3420" /></View></View>
        <View style={s.art} pointerEvents="none" accessible={false}><View style={s.backFrame} /><View style={s.frontFrame}><View style={s.artSun} /><View style={s.artHill} /><View style={s.artHill2} /><View style={s.play}><Ionicons name="play" size={18} color="#FFF8E4" /></View><View style={s.timeline}><View style={s.clip} /><View style={[s.clip, { flex: .5, opacity: .6 }]} /><View style={[s.clip, { opacity: .35 }]} /></View></View><View style={s.star}><Ionicons name="sparkles" color="#5D4F2D" size={25} /></View></View>
      </LinearGradient>
    </MotionPressable>
    <View style={s.formats}>{([{ aspect: '9:16', label: 'Reels', icon: 'phone-portrait-outline' }, { aspect: '1:1', label: 'Square', icon: 'square-outline' }, { aspect: '16:9', label: 'Wide', icon: 'tv-outline' }] as const).map(item => <MotionPressable key={item.aspect} style={s.format} onPress={() => onStart(item.aspect)} disabled={importing} accessibilityLabel={`New ${item.aspect} ${item.label} project`}><Ionicons name={item.icon} size={18} color={colors.accentText} /><Text style={s.formatText}>{item.label}</Text><Text style={s.ratio}>{item.aspect}</Text></MotionPressable>)}</View>
    <View style={s.sectionHeading}><View><Text style={s.sectionTitle}>Find your starting point</Text><Text style={s.sectionSub}>Styles to make your own</Text></View><View style={s.stylesCount}><Ionicons name="layers-outline" size={14} color={colors.textDim} /><Text style={s.count}>{EDIT_TEMPLATES.length}</Text></View></View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.shelf}>{EDIT_TEMPLATES.map(template => <StylePreview key={template.id} template={template} disabled={importing} onPress={() => onStart(template.aspect, template.id)} />)}</ScrollView>
    <MotionPressable onPress={() => router.push('/help')} style={s.tip} accessibilityLabel="Open editing guide"><View style={s.tipIcon}><Ionicons name="bulb-outline" size={22} color={colors.accentText} /></View><View style={s.tipCopy}><Text style={s.tipTitle}>Small clips. Big possibilities.</Text><Text style={s.tipSub}>Your first edit, from import to export.</Text></View><Ionicons name="arrow-forward" size={18} color={colors.textDim} /></MotionPressable>
  </>;
}

const makeStyles = (c: AppColors) => StyleSheet.create({
  welcome: { paddingTop: 15, paddingBottom: 25 }, eyebrow: { color: c.textDim, fontSize: 10, fontWeight: '700', letterSpacing: 1.8, marginBottom: 12 },
  heading: { fontSize: 33, lineHeight: 37, letterSpacing: -1.3, fontWeight: '700', color: c.text }, intro: { color: c.textDim, fontSize: 13, lineHeight: 21, marginTop: 10 },
  heroWrap: { borderRadius: 25, overflow: 'hidden' }, hero: { padding: 22, minHeight: 199, flexDirection: 'row', alignItems: 'center' }, heroCopy: { flex: 1, zIndex: 1 },
  heroTag: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 }, dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#5D4A21' }, heroTagText: { fontSize: 9, letterSpacing: 1.5, fontWeight: '700', color: '#66532B' },
  heroTitle: { fontSize: 27, fontWeight: '700', letterSpacing: -.9, color: '#302A1C' }, heroSub: { fontSize: 12, color: '#655335', marginTop: 6, lineHeight: 18 }, heroAction: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 23 }, heroActionText: { fontSize: 13, fontWeight: '700', color: '#3F3420' }, plus: { width: 32, height: 32, borderRadius: 11, backgroundColor: '#3F3420', alignItems: 'center', justifyContent: 'center' },
  art: { width: 91, height: 133, marginLeft: 3 }, backFrame: { width: 78, height: 113, borderRadius: 14, backgroundColor: '#C5AF7C', position: 'absolute', top: 6, right: 10, transform: [{ rotate: '-12deg' }], borderWidth: 3, borderColor: '#F8E7BD' },
  frontFrame: { width: 82, height: 120, borderRadius: 14, overflow: 'hidden', backgroundColor: '#69857B', transform: [{ rotate: '9deg' }], position: 'absolute', right: -3, top: 12, borderWidth: 4, borderColor: '#FFF3D4' }, artSun: { position: 'absolute', top: 16, right: 13, width: 21, height: 21, borderRadius: 12, backgroundColor: '#F5D99D' }, artHill: { width: 110, height: 90, borderRadius: 70, transform: [{ rotate: '-20deg' }], backgroundColor: '#385D55', position: 'absolute', top: 57, left: -35 }, artHill2: { width: 110, height: 90, borderRadius: 60, backgroundColor: '#2B4740', position: 'absolute', top: 75, right: -55 }, play: { position: 'absolute', top: 39, left: 22, width: 31, height: 31, borderRadius: 16, backgroundColor: '#FFFFFF30', alignItems: 'center', justifyContent: 'center', paddingLeft: 2 }, timeline: { position: 'absolute', bottom: 8, left: 6, right: 6, height: 7, flexDirection: 'row', gap: 2 }, clip: { flex: 1, backgroundColor: '#F5D99D', borderRadius: 2 }, star: { position: 'absolute', top: -7, left: -6 },
  formats: { flexDirection: 'row', gap: 8, marginTop: 11, marginBottom: 29 }, format: { flex: 1, minHeight: 49, borderRadius: 14, backgroundColor: c.surface, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, flexWrap: 'wrap', padding: 8 }, formatText: { fontSize: 12, fontWeight: '600', color: c.text }, ratio: { fontSize: 10, color: c.textDim },
  sectionHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 }, sectionTitle: { fontSize: 18, fontWeight: '700', letterSpacing: -.4, color: c.text }, sectionSub: { fontSize: 12, color: c.textDim, marginTop: 5 }, stylesCount: { flexDirection: 'row', gap: 5, alignItems: 'center' }, count: { fontSize: 12, color: c.textDim }, shelf: { gap: 11, paddingBottom: 3 },
  tip: { flexDirection: 'row', alignItems: 'center', gap: 11, marginTop: 23, padding: 15, borderRadius: 18, backgroundColor: c.accentSoft, marginBottom: 27 }, tipIcon: { width: 35, alignItems: 'center' }, tipCopy: { flex: 1, gap: 5 }, tipTitle: { color: c.text, fontSize: 13, fontWeight: '600' }, tipSub: { color: c.textDim, fontSize: 11, lineHeight: 16 },
});
