import { useEffect, useMemo, useState } from 'react';
import { FlatList, Keyboard, Platform, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { createToolHandoff } from '@/core/tool-handoff';
import { MotionPressable as Pressable } from '@/ui/MotionPressable';
import { Sheet } from '@/ui/Sheet';
import { StudioIcon, type StudioIconName } from '@/ui/StudioIcon';
import { font, radius, useAppTheme, useThemedStyles, type AppColors } from '@/ui/theme';
import { useKeyboardSpace } from '@/ui/useKeyboardSpace';

export interface EditorTool {
  id: string;
  name: string;
  description: string;
  category: 'Edit' | 'Looks' | 'Text' | 'Audio' | 'Project';
  icon: StudioIconName;
  disabled?: boolean;
  run: () => void;
}

const CATEGORIES = ['All', 'Edit', 'Looks', 'Text', 'Audio', 'Project'];

export function ToolLibrary({ visible, tools, onClose }: { visible: boolean; tools: EditorTool[]; onClose: () => void }) {
  const { height, width, fontScale } = useWindowDimensions();
  const { colors, isDark } = useAppTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const keyboardSpace = useKeyboardSpace(visible);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');
  const handoff = useMemo(() => createToolHandoff(), []);
  useEffect(() => {
    if (visible) { handoff.cancel(); return; }
    if (Platform.OS === 'ios') return;
    const frame = requestAnimationFrame(() => handoff.flush());
    return () => cancelAnimationFrame(frame);
  }, [handoff, visible]);
  useEffect(() => () => handoff.cancel(), [handoff]);
  const search = query.trim().toLowerCase();
  const results = tools.filter(tool => (category === 'All' || tool.category === category) && `${tool.name} ${tool.description}`.toLowerCase().includes(search));
  const columns = width < 350 || fontScale > 1.3 ? 1 : 2;
  const availableHeight = Math.max(0, height - keyboardSpace - insets.top - (keyboardSpace ? 0 : insets.bottom) - 84);
  const compact = keyboardSpace > 0 || availableHeight < 330;
  const close = () => { Keyboard.dismiss(); onClose(); };
  return <Sheet visible={visible} onClose={close} onDismiss={() => { if (!visible) handoff.flush(); }} title="All tools" keyboardAware>
    <View style={{ height: Math.min(560, height * .65, availableHeight), gap: compact ? 8 : 12 }}>
      <View style={styles.search}>
        <StudioIcon name="search-outline" size={20} color={colors.textDim} />
        <TextInput value={query} onChangeText={setQuery} placeholder="Find your next tool" placeholderTextColor={colors.textDim} accessibilityLabel="Search editing tools" style={styles.input} autoCorrect={false} returnKeyType="search" selectionColor={colors.accent} keyboardAppearance={isDark ? 'dark' : 'light'} />
        {!!query && <Pressable accessibilityLabel="Clear tool search" onPress={() => setQuery('')} style={styles.clear}><StudioIcon name="close-circle" size={19} color={colors.textDim} /></Pressable>}
      </View>
      {availableHeight >= 240 && <View><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categories} keyboardShouldPersistTaps="handled">
        {CATEGORIES.map(item => <Pressable key={item} active={category === item} onPress={() => setCategory(item)} style={[styles.chip, category === item && styles.chipOn]}><Text style={[styles.label, category === item && styles.ink]}>{item}</Text>{category === item && <View style={styles.chipDot} />}</Pressable>)}
      </ScrollView></View>}
      {!compact && <View style={styles.results}><Text style={styles.resultTitle}>{category === 'All' ? 'The studio toolkit' : `${category} tools`}</Text><Text style={styles.count}>{results.length} tools</Text></View>}
      <FlatList key={columns} numColumns={columns} data={results} keyExtractor={item => item.id} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={styles.list} columnWrapperStyle={columns > 1 ? styles.columns : undefined}
        ListEmptyComponent={<View style={styles.empty}><StudioIcon name="search-outline" size={32} color={colors.textDim} /><Text style={styles.emptyTitle}>No matching tools</Text><Text style={styles.emptyCopy}>Try “text”, “music” or “color”.</Text><Pressable style={styles.reset} onPress={() => { setQuery(''); setCategory('All'); }}><Text style={styles.resetLabel}>Show all tools</Text></Pressable></View>}
        renderItem={({ item }) => <Pressable disabled={item.disabled} onPress={() => { handoff.queue(item.run); close(); }} accessibilityLabel={`${item.name}. ${item.description}${item.disabled ? '. Currently unavailable.' : ''}`} style={[styles.tool, columns > 1 && styles.half, item.disabled && styles.disabled]}>
          <View style={styles.toolHeading}><View style={styles.icon}><StudioIcon name={item.icon} size={27} color={item.disabled ? colors.textDim : colors.text} /></View><StudioIcon name="chevron-forward" size={14} color={colors.textFaint} /></View>
          <Text style={styles.name}>{item.name}</Text><Text style={styles.description} numberOfLines={2}>{item.description}</Text>
        </Pressable>}
      />
      {!compact && <Text style={styles.footer}>Clip tools use your selection or the clip at the playhead.</Text>}
    </View>
  </Sheet>;
}

const makeStyles = (colors: AppColors) => StyleSheet.create({
  search: { paddingLeft: 14, minHeight: 48, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface, flexDirection: 'row', gap: 10, alignItems: 'center' },
  input: { flex: 1, ...font.body, color: colors.text, paddingVertical: 13 }, clear: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }, categories: { gap: 6 },
  chip: { minHeight: 44, paddingHorizontal: 15, flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: radius.md, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: 'transparent' },
  chipOn: { backgroundColor: colors.accentSoft, borderColor: colors.accentText }, chipDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: colors.accentText },
  label: { ...font.small, fontSize: 13, fontWeight: '600', color: colors.textDim }, ink: { color: colors.accentText },
  results: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 2 }, resultTitle: { ...font.small, color: colors.textDim, fontWeight: '600' }, count: { ...font.mono, fontSize: 11, color: colors.textFaint },
  list: { paddingBottom: 8, gap: 10 }, columns: { gap: 10 },
  tool: { flex: 1, gap: 6, padding: 13, minHeight: 144, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border }, half: { maxWidth: '50%' },
  toolHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }, icon: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 14, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surfaceRaised },
  name: { ...font.body, fontSize: 14, fontWeight: '600', color: colors.text }, description: { ...font.small, fontSize: 11, color: colors.textDim, lineHeight: 16 }, disabled: { opacity: .46 },
  empty: { alignItems: 'center', gap: 10, padding: 24 }, emptyTitle: { ...font.h2, color: colors.text }, emptyCopy: { ...font.body, color: colors.textDim, textAlign: 'center' }, reset: { paddingHorizontal: 18, minHeight: 44, justifyContent: 'center', borderRadius: radius.md, backgroundColor: colors.accentSoft, marginTop: 4 }, resetLabel: { ...font.small, color: colors.accentText },
  footer: { ...font.small, fontSize: 11, color: colors.textDim, paddingHorizontal: 2, paddingBottom: 4 },
});
