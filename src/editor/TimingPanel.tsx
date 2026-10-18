import { useState } from 'react';
import { StudioIcon as Ionicons } from '@/ui/StudioIcon';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { editCaption } from '@/core/captions';
import { createFieldDraft, reconcileFieldDraft } from '@/core/drafts';
import { MIN_CLIP, PHOTO_MAX, totalDuration } from '@/core/timeline';
import { useEditor } from '@/state/editor';
import { MotionPressable as Pressable } from '@/ui/MotionPressable';
import { font, radius, useAppTheme, useThemedStyles, type AppColors } from '@/ui/theme';

/** Exact source trim for media, exact timeline timing for text; commits both fields atomically. */
export function TimingPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const { colors, isDark } = useAppTheme();
  const s = useThemedStyles(createStyles);
  const project = useEditor(s => s.project)!;
  const clip = project.main.find(c => c.id === id), audio = project.audio.find(a => a.id === id), text = project.texts.find(t => t.id === id);
  const source = clip ?? audio;
  const initial = { start: String(source?.in ?? text?.start ?? 0), end: String(source?.out ?? text?.end ?? 0), at: String(audio?.start ?? 0) };
  const [draft, setDraft] = useState(() => createFieldDraft(initial));
  const [error, setError] = useState('');
  const current = reconcileFieldDraft(draft, initial);
  if (current !== draft) setDraft(current);
  const { start, end, at } = current.values;
  const setStart = (value: string) => setDraft({ ...current, values: { ...current.values, start: value } });
  const setEnd = (value: string) => setDraft({ ...current, values: { ...current.values, end: value } });
  const setAt = (value: string) => setDraft({ ...current, values: { ...current.values, at: value } });
  const apply = () => {
    const begin = Number(start), finish = Number(end), position = Number(at);
    const asset = source ? project.assets[source.assetId] : undefined;
    const max = source ? asset?.kind === 'image' ? PHOTO_MAX : asset?.duration ?? 0 : totalDuration(project.main);
    const min = MIN_CLIP * (clip?.speed ?? 1);
    if (!start.trim() || !end.trim() || !Number.isFinite(begin) || !Number.isFinite(finish) || begin < 0 || finish > max + .001 || finish - begin < min - .0001) {
      setError(`Use 0–${max.toFixed(2)}s, with at least ${(min / (clip?.speed ?? 1)).toFixed(1)}s of playback.`); return;
    }
    if (audio && (!at.trim() || !Number.isFinite(position) || position < 0 || position > totalDuration(project.main) - MIN_CLIP)) {
      setError('Place the audio within the video timeline.'); return;
    }
    const store = useEditor.getState();
    if (clip) store.updateClip(id, { in: begin, out: finish });
    if (audio) store.updateAudio(id, { in: begin, out: finish, start: position });
    if (text) {
      try {
        if (text.caption) store.edit(p => editCaption(p, id, { start: begin, end: finish }));
        else store.updateText(id, { start: begin, end: finish });
      } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); return; }
    }
    onClose();
  };
  const field = (label: string, value: string, change: (value: string) => void) => <View style={s.field}><Text style={s.label}>{label}</Text><TextInput value={value} onChangeText={change} style={s.input} keyboardType="decimal-pad" keyboardAppearance={isDark ? 'dark' : 'light'} accessibilityLabel={label} selectTextOnFocus/></View>;
  return <View style={s.panel}>
    <View style={s.heading}><View style={s.titleRow}><Ionicons name="time-outline" size={20} color={colors.accentText}/><Text style={s.title}>Timing</Text></View><Pressable onPress={onClose} style={s.button} accessibilityRole="button" accessibilityLabel="Cancel timing changes"><Text style={s.label}>Cancel</Text></Pressable></View>
    <Text style={s.detail}>{source ? 'Trim the original media in seconds.' : 'Set when this text appears and disappears.'}</Text>
    <View style={s.row}>{field(source ? 'Source in' : 'Start', start, setStart)}{field(source ? 'Source out' : 'End', end, setEnd)}{audio ? field('Timeline start', at, setAt) : null}</View>
    {error ? <Text style={s.error}>{error}</Text> : null}
    <Pressable style={[s.button, s.apply]} onPress={apply} accessibilityRole="button"><Ionicons name="checkmark" size={18} color={colors.accentInk}/><Text style={s.ink}>Apply timing</Text></Pressable>
  </View>;
}
const createStyles = (colors: AppColors) => StyleSheet.create({
  panel: { paddingHorizontal: 16, paddingVertical: 10, gap: 10, backgroundColor: colors.surface }, heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 9 }, title: { ...font.h2, color: colors.text }, label: { ...font.small, color: colors.text }, detail: { ...font.small, color: colors.textDim },
  row: { flexDirection: 'row', gap: 8 }, field: { flex: 1, gap: 6 }, input: { ...font.mono, color: colors.text, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.md, minHeight: 48, padding: 12 },
  button: { minHeight: 44, paddingHorizontal: 12, paddingVertical: 10, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' }, apply: { flexDirection: 'row', gap: 8, backgroundColor: colors.accent }, ink: { ...font.body, color: colors.accentInk }, error: { ...font.small, color: colors.danger },
});
