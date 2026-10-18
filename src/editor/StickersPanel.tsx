import { StudioIcon as Ionicons } from '@/ui/StudioIcon';
import { useState } from 'react';
import { FlatList, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';

import { MotionPressable as Pressable } from '@/ui/MotionPressable';
import { font, radius, useAppTheme, useThemedStyles, type AppColors } from '@/ui/theme';

const GROUPS = [
  { name: 'Favorites', keywords: 'favorite popular love smile happy', emojis: ['✨', '🔥', '💛', '😂', '😍', '🥳', '💯', '🙏', '👏', '🫶', '🎉', '⭐'] },
  { name: 'Reactions', keywords: 'face emotion laugh sad cry wow shocked', emojis: ['😀', '😎', '🤯', '😭', '🥹', '🤩', '🤔', '😴', '🤫', '😱', '🙃', '🤗', '👍', '👎', '👌', '✌️', '💪', '👀', '🫰', '🤝'] },
  { name: 'Cambodia', keywords: 'khmer cambodia flag lotus coconut mango temple travel', emojis: ['🇰🇭', '🪷', '🥥', '🥭', '🍜', '🛕', '🛺', '🌴', '🏝️', '🧋', '🌅', '🙏'] },
  { name: 'Hearts', keywords: 'heart love romantic valentine', emojis: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🤍', '🖤', '🩷', '💔', '💕', '💖', '💘', '💝', '💌', '💐'] },
  { name: 'Celebrate', keywords: 'party birthday celebration winner trophy firework', emojis: ['🎉', '🎊', '🎂', '🎈', '🎁', '🥂', '🏆', '🥇', '🎆', '🎇', '👑', '🪩'] },
  { name: 'Food', keywords: 'food drink coffee tea cake recipe cooking eating', emojis: ['🍕', '☕', '🍰', '🍔', '🍟', '🍩', '🍪', '🍓', '🍉', '🍒', '🥑', '🍣', '🍱', '🍳', '🍦', '🥐'] },
  { name: 'Travel', keywords: 'travel nature flower beach ocean sky animal', emojis: ['🌊', '🌈', '☀️', '🌙', '⚡', '🌸', '🌺', '🌻', '🦋', '🐶', '🐱', '🐣', '✈️', '🚀', '🏔️', '🌍', '📍', '🏖️'] },
  { name: 'Labels', keywords: 'arrow check label music video film camera sound speech idea', emojis: ['✅', '❌', '➡️', '⬅️', '⬇️', '⬆️', '💬', '💡', '🎬', '📷', '🎤', '🎧', '🎵', '🔔', '⏰', '📌', '🛒', '💰'] },
] as const;

export function StickersPanel({ onPick, onDone }: { onPick: (emoji: string) => void; onDone: () => void }) {
  const { colors, isDark } = useAppTheme();
  const styles = useThemedStyles(createStyles);
  const { height } = useWindowDimensions();
  const [category, setCategory] = useState('Favorites');
  const [query, setQuery] = useState('');
  const search = query.trim().toLowerCase();
  const groups = GROUPS.filter(group => search ? `${group.name} ${group.keywords} ${group.emojis.join(' ')}`.toLowerCase().includes(search) : group.name === category);
  const stickers = [...new Set(groups.flatMap(group => [...group.emojis]))];
  return <View style={[styles.panel, { height: Math.min(380, height * .45) }]}>
    <View style={styles.header}><View style={styles.titleRow}><Ionicons name="happy-outline" size={20} color={colors.accentText}/><Text style={styles.title}>Stickers</Text></View><Pressable onPress={onDone} style={styles.done} accessibilityRole="button" accessibilityLabel="Done browsing stickers"><Text style={styles.doneText}>Done</Text></Pressable></View>
    <View style={styles.search}><Ionicons name="search-outline" size={18} color={colors.textDim}/><TextInput keyboardAppearance={isDark ? 'dark' : 'light'} value={query} onChangeText={setQuery} placeholder="Search love, Khmer, food…" placeholderTextColor={colors.textDim} style={styles.input} accessibilityLabel="Search stickers" autoCorrect={false}/>{!!query && <Pressable onPress={() => setQuery('')} style={styles.clear} accessibilityRole="button" accessibilityLabel="Clear sticker search"><Ionicons name="close-circle" size={18} color={colors.textDim}/></Pressable>}</View>
    <View><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categories}>{GROUPS.map(group => <Pressable key={group.name} active={category === group.name && !search} accessibilityRole="button" accessibilityState={{ selected: category === group.name && !search }} onPress={() => { setCategory(group.name); setQuery(''); }} style={[styles.chip, category === group.name && !search && styles.chipOn]}><Text style={[styles.label, category === group.name && !search && styles.ink]}>{group.name}</Text></Pressable>)}</ScrollView></View>
    <FlatList data={stickers} numColumns={6} keyExtractor={emoji => emoji} keyboardShouldPersistTaps="handled" ListEmptyComponent={<Text style={styles.empty}>No stickers found. Try a category above.</Text>} renderItem={({ item }) => <Pressable onPress={() => onPick(item)} motionScale={0.88} accessibilityRole="button" accessibilityLabel={`Add ${item} sticker`} style={styles.sticker}><View style={styles.stickerTile}><Text style={styles.emoji}>{item}</Text></View></Pressable>}/>
  </View>;
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  panel: { paddingHorizontal: 16, paddingVertical: 10, gap: 8, backgroundColor: colors.surface }, header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, titleRow: { flexDirection: 'row', alignItems: 'center', gap: 9 }, title: { ...font.h2, color: colors.text },
  done: { minWidth: 60, minHeight: 44, paddingHorizontal: 12, justifyContent: 'center', alignItems: 'center', borderRadius: radius.md, backgroundColor: colors.accentSoft }, doneText: { ...font.small, fontWeight: '700', color: colors.accentText }, search: { flexDirection: 'row', alignItems: 'center', paddingLeft: 12, gap: 8, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md },
  clear: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }, input: { flex: 1, ...font.small, color: colors.text, minHeight: 44, paddingVertical: 10 }, categories: { gap: 7 }, chip: { paddingHorizontal: 12, minHeight: 44, justifyContent: 'center', backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md }, chipOn: { backgroundColor: colors.accentSoft, borderColor: '#766539' },
  label: { ...font.small, color: colors.text }, ink: { color: colors.accentText }, sticker: { width: '16.666%', minHeight: 56, alignItems: 'center', justifyContent: 'center' }, stickerTile: { width: 44, height: 44, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: 14, backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center' }, emoji: { fontSize: 28 },
  empty: { ...font.small, color: colors.textDim, textAlign: 'center', padding: 16 },
});
