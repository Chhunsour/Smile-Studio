import { StudioIcon as Ionicons } from '@/ui/StudioIcon';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { SOUNDS, filterSounds, type SoundId, type SoundKind } from '@/core/sounds';
import { totalDuration } from '@/core/timeline';
import type { PlaybackEngine } from '@/playback/engine';
import { useEditor } from '@/state/editor';
import { importAudio } from '@/storage/media';
import { soundFile } from '@/storage/sounds';
import { MotionPressable as Pressable } from '@/ui/MotionPressable';
import { font, radius, useAppTheme, useThemedStyles, type AppColors } from '@/ui/theme';

export function SoundLibraryPanel({ engine, onClose }: { engine: PlaybackEngine; onClose: () => void }) {
  const { colors, isDark } = useAppTheme();
  const s = useThemedStyles(createStyles);
  const { height } = useWindowDimensions();
  const [category, setCategory] = useState<SoundKind>('Music');
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('All');
  const [active, setActive] = useState<SoundId | null>(null);
  const [busy, setBusy] = useState<SoundId | null>(null);
  const player = useAudioPlayer(null);
  const status = useAudioPlayerStatus(player);
  const mounted = useRef(true);
  const previewRequest = useRef(0);
  const adding = useRef(false);
  const groups = ['All', ...new Set(SOUNDS.filter(sound => sound.kind === category).map(sound => sound.group))];
  const sounds = filterSounds(category, query, group);
  const pause = engine.pause;
  useEffect(() => { mounted.current = true; pause(); return () => { mounted.current = false; }; }, [pause]);
  const preview = async (id: SoundId) => {
    const request = ++previewRequest.current;
    engine.pause();
    if (id === active && status.playing) { player.pause(); return; }
    try {
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false });
      if (!mounted.current || previewRequest.current !== request) return;
      player.pause(); player.replace({ uri: soundFile(id).uri });
      // eslint-disable-next-line react-hooks/immutability
      player.volume = .65;
      player.play(); setActive(id);
    } catch (e) { if (!mounted.current || previewRequest.current !== request) return; Alert.alert('Could not preview sound', e instanceof Error ? e.message : String(e)); }
  };
  const add = async (id: SoundId) => {
    if (adding.current) return;
    adding.current = true;
    const projectId = useEditor.getState().project?.id;
    const requestedAt = engine.currentTime();
    ++previewRequest.current;
    player.pause(); engine.pause(); setBusy(id);
    try {
      const sound = SOUNDS.find(s => s.id === id)!;
      const asset = await importAudio(soundFile(id), sound.name);
      if (!mounted.current) return;
      const editor = useEditor.getState(), project = editor.project;
      if (!project || project.id !== projectId) return;
      const duration = totalDuration(project.main);
      if (duration < .1) throw new Error('Add a video or photo first.');
      const at = Math.min(Math.max(0, requestedAt), Math.max(0, duration - .1));
      const out = Math.min(asset.duration, duration - at);
      const clipId = `sound-${asset.id}`;
      editor.edit(p => ({ ...p, assets: { ...p.assets, [asset.id]: asset }, audio: [...p.audio, {
        id: clipId, assetId: asset.id, start: at, in: 0, out, volume: sound.kind === 'Music' ? .35 : .8,
        fadeIn: sound.kind === 'Music' ? Math.min(.15, out / 4) : 0,
        fadeOut: sound.kind === 'Music' ? Math.min(.4, out / 4) : 0,
      }] }));
      editor.select(clipId); onClose();
    } catch (e) { if (!mounted.current || useEditor.getState().project?.id !== projectId) return; Alert.alert('Could not add sound', e instanceof Error ? e.message : String(e)); }
    finally { adding.current = false; if (mounted.current) setBusy(null); }
  };
  return <View style={[s.panel, { maxHeight: Math.min(400, height * .45) }]}>
    <View style={s.heading}><View style={s.titleRow}><Ionicons name="musical-notes-outline" size={20} color={colors.accentText}/><Text style={s.title}>Sounds</Text><Text style={s.count}>{SOUNDS.length}</Text></View><Pressable onPress={onClose} style={s.done} accessibilityRole="button" accessibilityLabel="Done browsing sounds"><Text style={s.doneText}>Done</Text></Pressable></View>
    <ScrollView style={s.body} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
    <View style={s.tabs}>{(['Music', 'Effects'] as const).map(kind => <Pressable key={kind} active={category === kind} onPress={() => { ++previewRequest.current; player.pause(); setCategory(kind); setGroup('All'); }} accessibilityRole="tab" accessibilityState={{ selected: category === kind }} style={[s.chip, category === kind && s.selected]}><Ionicons name={kind === 'Music' ? 'musical-notes-outline' : 'pulse-outline'} size={18} color={category === kind ? colors.accentText : colors.textDim}/><Text style={[s.label, category === kind && s.accent]}>{kind === 'Music' ? 'Music beds' : 'Sound effects'}</Text></Pressable>)}</View>
    <View style={s.search}><Ionicons name="search-outline" size={18} color={colors.textDim}/><TextInput value={query} onChangeText={setQuery} placeholder="Search sounds or moods" placeholderTextColor={colors.textFaint} style={s.searchInput} accessibilityLabel="Search sounds" autoCorrect={false} returnKeyType="search" keyboardAppearance={isDark ? 'dark' : 'light'}/>{query ? <Pressable onPress={() => setQuery('')} style={s.clear} accessibilityRole="button" accessibilityLabel="Clear sound search"><Ionicons name="close-circle" size={18} color={colors.textDim}/></Pressable> : null}</View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.groups} keyboardShouldPersistTaps="handled">{groups.map(mood => <Pressable key={mood} active={group === mood} onPress={() => setGroup(mood)} accessibilityRole="button" accessibilityState={{ selected: group === mood }} style={[s.mood, group === mood && s.activeMood]}><Text style={[s.label, group === mood && s.accent]}>{mood}</Text></Pressable>)}</ScrollView>
    <View style={s.list}>
      {sounds.map(sound => <View style={[s.row, active === sound.id && status.playing && s.playingRow]} key={sound.id}>
        <Pressable active={active === sound.id && status.playing} onPress={() => preview(sound.id)} style={[s.play, active === sound.id && status.playing && s.playing]} accessibilityRole="button" accessibilityLabel={`${active === sound.id && status.playing ? 'Pause' : 'Preview'} ${sound.name}`}><Ionicons name={active === sound.id && status.playing ? 'pause' : 'play'} size={20} color={colors.accentText}/></Pressable>
        <View style={{ flex: 1 }}><Text style={s.name}>{sound.name}</Text><Text style={s.detail}>{sound.description} · {sound.duration}s</Text></View>
        <Pressable disabled={!!busy} onPress={() => add(sound.id)} style={[s.add, !!busy && s.disabled]} accessibilityRole="button" accessibilityState={{ disabled: !!busy }} accessibilityLabel={`Add ${sound.name}`}>{busy === sound.id ? <ActivityIndicator size="small" color={colors.accentInk}/> : <Ionicons name="add" size={22} color={colors.accentInk}/>}</Pressable>
      </View>)}
      {!sounds.length ? <Text style={s.empty}>No sounds match. Try another mood or search.</Text> : null}
    </View>
    <Text style={s.detail}>Original sounds, available offline. Add at the playhead, then trim or loop on the timeline.</Text>
    </ScrollView>
  </View>;
}
const createStyles = (colors: AppColors) => StyleSheet.create({
  panel: { paddingHorizontal: 16, paddingVertical: 10, gap: 10, backgroundColor: colors.surface }, heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  body: { flexShrink: 1 }, content: { gap: 10, paddingBottom: 4 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 9 }, title: { ...font.h2, color: colors.text }, done: { minWidth: 60, minHeight: 44, paddingHorizontal: 12, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.accentSoft, borderRadius: radius.md }, doneText: { ...font.small, fontWeight: '700', color: colors.accentText },
  count: { ...font.mono, color: colors.textDim, backgroundColor: colors.surface3, borderRadius: radius.sm, paddingHorizontal: 7, paddingVertical: 3 }, search: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingLeft: 12, minHeight: 44 },
  searchInput: { flex: 1, ...font.small, color: colors.text, paddingVertical: 12 }, clear: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  groups: { gap: 8 }, mood: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  activeMood: { borderColor: '#766539', backgroundColor: colors.accentSoft }, accent: { color: colors.accentText }, empty: { ...font.small, color: colors.textDim, paddingVertical: 20, textAlign: 'center' }, disabled: { opacity: .4 },
  tabs: { flexDirection: 'row', gap: 3, padding: 3, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md }, chip: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, minHeight: 44, paddingHorizontal: 10, backgroundColor: 'transparent', borderRadius: radius.sm },
  selected: { backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.borderStrong }, label: { ...font.small, color: colors.text }, ink: { color: colors.accentInk },
  list: { gap: 6 }, row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface2, borderRadius: radius.md },
  playingRow: { borderColor: '#766539' }, playing: { backgroundColor: colors.accentSoft, borderColor: '#766539' },
  play: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.borderStrong }, name: { ...font.body, color: colors.text, fontSize: 14 },
  detail: { ...font.small, color: colors.textDim, lineHeight: 17 }, add: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: colors.accent, justifyContent: 'center', alignItems: 'center' },
});
