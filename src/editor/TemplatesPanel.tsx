import { StudioIcon as Ionicons } from '@/ui/StudioIcon';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';

import { applyEditTemplate, EDIT_TEMPLATES } from '@/core/templates';
import type { PlaybackEngine } from '@/playback/engine';
import { useEditor } from '@/state/editor';
import { newId } from '@/storage/projects';
import { MotionPressable as Pressable } from '@/ui/MotionPressable';
import { font, radius, useAppTheme, useThemedStyles, type AppColors } from '@/ui/theme';

export function TemplatesPanel({ engine, onClose }: { engine: PlaybackEngine; onClose: () => void }) {
  const { colors, isDark } = useAppTheme();
  const styles = useThemedStyles(createStyles);
  const { height } = useWindowDimensions();
  const [selected, setSelected] = useState(EDIT_TEMPLATES[0]);
  const [title, setTitle] = useState(selected.title);
  const [status, setStatus] = useState('');
  const apply = () => {
    engine.pause();
    try {
      useEditor.getState().edit(project => applyEditTemplate(project, selected.id, title, newId));
      engine.time.set(0); engine.seek(0);
      setStatus('Template applied. Tap a title or clip to customize it. Undo restores your previous edit.');
    } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
  };
  return <View style={[styles.panel, { maxHeight: Math.min(390, height * .46) }]}>
    <View style={styles.heading}><View style={styles.titleRow}><Ionicons name="albums-outline" size={20} color={colors.accentText}/><Text style={styles.title}>Templates</Text></View><Pressable onPress={onClose} style={styles.done} accessibilityRole="button" accessibilityLabel="Done browsing templates"><Text style={styles.doneText}>Done</Text></Pressable></View>
    <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ gap: 8 }} keyboardShouldPersistTaps="handled">
    <Text style={styles.hint}>One tap styles your footage, canvas and cuts.</Text>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.templates}>
      {EDIT_TEMPLATES.map(template => <Pressable key={template.id} active={selected.id === template.id} onPress={() => { setSelected(template); setTitle(template.title); setStatus(''); }} accessibilityRole="button" accessibilityState={{ selected: template.id === selected.id }} accessibilityLabel={`${template.name}, ${template.aspect}`} style={[styles.card, selected.id === template.id && styles.cardSelected]}>
        <View style={[styles.art, { borderTopColor: template.accent }]}><View style={styles.artIcon}><Ionicons name={template.id === 'cinema' ? 'film-outline' : template.id === 'travel' ? 'airplane-outline' : template.id === 'food' ? 'restaurant-outline' : 'sparkles-outline'} size={27} color={template.accent}/></View><Text style={styles.ratio}>{template.aspect}</Text></View>
        <View style={styles.labelRow}><Text style={styles.label}>{template.name}</Text>{selected.id === template.id ? <Ionicons name="checkmark" size={16} color={colors.accentText}/> : null}</View>
      </Pressable>)}
    </ScrollView>
    <Text style={styles.hint}>{selected.description}</Text>
    <TextInput keyboardAppearance={isDark ? 'dark' : 'light'} value={title} onChangeText={setTitle} maxLength={300} placeholder="Opening title (optional)" placeholderTextColor={colors.textFaint} accessibilityLabel="Template opening title" style={styles.input} selectionColor={colors.accent}/>
    <View style={styles.heading}><Text style={[styles.hint, { flex: 1 }]}>Changes clip looks, canvas and the template title. Your other text and audio stay.</Text><Pressable onPress={apply} style={styles.apply} accessibilityRole="button"><Text style={styles.applyText}>Apply template</Text></Pressable></View>
    {!!status && <Text accessibilityLiveRegion="polite" style={styles.hint}>{status}</Text>}
    </ScrollView>
  </View>;
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  panel: { paddingHorizontal: 16, paddingVertical: 10, gap: 8, backgroundColor: colors.surface }, heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 9 }, title: { ...font.h2, color: colors.text }, done: { minWidth: 60, minHeight: 44, paddingHorizontal: 12, justifyContent: 'center', alignItems: 'center', borderRadius: radius.md, backgroundColor: colors.accentSoft }, doneText: { ...font.small, fontWeight: '700', color: colors.accentText },
  hint: { ...font.small, color: colors.textDim, lineHeight: 17 }, templates: { gap: 10, paddingVertical: 4 },
  card: { width: 126, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.borderStrong, overflow: 'hidden', backgroundColor: colors.surface2 },
  cardSelected: { borderColor: colors.selection, backgroundColor: colors.accentSoft },
  art: { height: 76, padding: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.surfaceRaised, borderTopWidth: 3 },
  artIcon: { width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderStrong }, ratio: { ...font.mono, fontSize: 10, color: colors.textDim },
  labelRow: { paddingHorizontal: 10, paddingVertical: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 4 }, label: { ...font.small, color: colors.text }, input: { ...font.body, color: colors.text, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, minHeight: 44, padding: 12, borderRadius: radius.md },
  apply: { backgroundColor: colors.accent, padding: 12, minHeight: 44, justifyContent: 'center', borderRadius: radius.md }, applyText: { ...font.small, fontWeight: '700', color: colors.accentInk },
});
