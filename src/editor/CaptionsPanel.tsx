import { StudioIcon as Ionicons } from '@/ui/StudioIcon';
import { useState } from 'react';
import { ActivityIndicator, FlatList, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';

import { addCaptions, CAPTION_STYLES, captionTime, editCaption, isCaption, parseCaptionTime, parseSubtitles, projectCaptions, segmentCaption, shiftCaptions, styleCaptions, suggestCaptionSegments, type CaptionCue } from '@/core/captions';
import { createFieldDraft, reconcileFieldDraft } from '@/core/drafts';
import { totalDuration } from '@/core/timeline';
import type { Project, TextOverlay } from '@/core/types';
import type { PlaybackEngine } from '@/playback/engine';
import { useEditor } from '@/state/editor';
import { pickSubtitleFile, shareCaptionFile } from '@/storage/captions';
import { MotionPressable as Pressable } from '@/ui/MotionPressable';
import { font, radius, useAppTheme, useThemedStyles, type AppColors } from '@/ui/theme';

export function CaptionsPanel({ engine, onClose }: { engine: PlaybackEngine; onClose: () => void }) {
  const { colors, isDark } = useAppTheme();
  const styles = useThemedStyles(createStyles);
  const { height } = useWindowDimensions();
  const project = useEditor((state) => state.project);
  const selectedId = useEditor((state) => state.selectedId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [relative, setRelative] = useState(false);
  const [offset, setOffset] = useState('0.5');
  const captions = project ? projectCaptions(project) : [];

  const edit = (operation: (project: Project) => Project, message = '', coalesce?: string) => {
    engine.pause();
    try {
      useEditor.getState().edit(operation, coalesce);
      setError(''); setStatus(message);
    } catch (cause) { setStatus(''); setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const seek = (caption: TextOverlay) => {
    engine.pause(); engine.time.set(caption.start); engine.seek(caption.start);
    // select() closes the current tool panel when switching selection; keep this editing list open.
    useEditor.setState({ selectedId: caption.id, lastEdit: null });
  };
  const importFile = async () => {
    const currentId = useEditor.getState().project?.id;
    const start = relative ? engine.currentTime() : 0;
    engine.pause(); setBusy(true); setError('');
    try {
      const file = await pickSubtitleFile();
      if (!file) return;
      const parsed = parseSubtitles(file.text);
      const current = useEditor.getState().project;
      if (!current || current.id !== currentId) throw new Error('The project changed while the file picker was open. Import the file again.');
      const result = addCaptions(current, parsed.cues, { offset: start });
      useEditor.getState().edit((latest) => {
        if (latest !== current) throw new Error('The project changed during import. Import the file again.');
        return result.project;
      });
      setStatus(`Added ${result.added} captions from ${file.name}.${result.clipped ? ` ${result.clipped} clipped to the video.` : ''}${result.skipped ? ` ${result.skipped} outside the video were skipped.` : ''}${parsed.warnings.length ? ` ${parsed.warnings.length} unreadable blocks were skipped.` : ''}`);
      if (parsed.warnings.length) setError(parsed.warnings.slice(0, 3).join('\n'));
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const add = () => {
    const current = useEditor.getState().project;
    if (!current) return;
    const end = totalDuration(current.main), start = Math.min(engine.currentTime(), Math.max(0, end - .1));
    const existing = projectCaptions(current);
    const hit = existing.find((caption) => start >= caption.start && start < caption.end);
    if (hit) { seek(hit); setError('A caption is already at the playhead. Edit its text below, or move the playhead to a gap.'); return; }
    const next = existing.find((caption) => caption.start > start)?.start ?? end;
    let id: string | undefined;
    edit((p) => {
      const result = addCaptions(p, [{ start, end: Math.min(start + 2, next, end), text: 'Your caption' }]);
      id = result.project.texts.at(-1)?.id;
      return result.project;
    }, 'Caption added at the playhead.');
    if (id) useEditor.setState({ selectedId: id, lastEdit: null });
  };
  const shift = (value: number) => edit((p) => shiftCaptions(p, value), `Shifted captions ${value >= 0 ? '+' : ''}${value}s.`);
  const share = async () => {
    const current = useEditor.getState().project;
    if (!current) return;
    engine.pause(); setBusy(true); setError('');
    try { await shareCaptionFile(current); setStatus('SRT file ready to share.'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };

  if (!project) return null;
  return (
    <View style={[styles.panel, { maxHeight: Math.min(360, height * .4) }]}>
      <View style={styles.header}>
        <View style={styles.titleRow}><Ionicons name="chatbox-ellipses-outline" size={20} color={colors.accentText}/><View><Text style={styles.title}>Captions</Text><Text style={styles.hint}>{captions.length} captions · SRT / WebVTT</Text></View></View>
        <Pressable accessibilityLabel="Done editing captions" onPress={onClose} disabled={busy} style={styles.done}><Ionicons name="checkmark" size={22} color={colors.accentInk} /></Pressable>
      </View>
      <FlatList data={captions} keyExtractor={(item) => item.id} style={styles.list} keyboardShouldPersistTaps="handled" initialNumToRender={4} maxToRenderPerBatch={6} windowSize={5} ListHeaderComponent={<View style={styles.controls}>
      <View style={styles.actions}>
        <Pressable style={styles.primary} disabled={busy} onPress={() => void importFile()} accessibilityLabel="Import SRT or WebVTT captions"><Ionicons name="document-text-outline" size={17} color={colors.accentInk} /><Text style={styles.primaryText}>Import</Text></Pressable>
        <Pressable style={styles.button} disabled={busy || !project.main.length} onPress={add}><Ionicons name="add" size={17} color={colors.text} /><Text style={styles.buttonText}>At playhead</Text></Pressable>
        <Pressable style={[styles.button, !captions.length && styles.disabled]} disabled={busy || !captions.length} onPress={() => void share()} accessibilityLabel="Share captions as an SRT file"><Ionicons name="share-outline" size={17} color={colors.text} /><Text style={styles.buttonText}>SRT</Text></Pressable>
        {busy && <ActivityIndicator color={colors.accentText} />}
      </View>
      <Pressable active={relative} accessibilityRole="checkbox" accessibilityState={{ checked: relative }} disabled={busy} onPress={() => setRelative((value) => !value)} style={styles.relative}><Ionicons name={relative ? 'checkbox' : 'square-outline'} size={20} color={relative ? colors.accentText : colors.textDim} /><Text style={[styles.hint, { flex: 1 }]}>Import timestamps relative to the playhead</Text></Pressable>
      {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      {!!status && <Text accessibilityLiveRegion="polite" style={styles.status}>{status}</Text>}
      {captions.length > 0 && <>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.styleRow}>
          <Text style={styles.hint}>Style all</Text>{CAPTION_STYLES.map((preset) => <Pressable key={preset.id} disabled={busy} onPress={() => edit((p) => styleCaptions(p, preset.style), `Applied ${preset.name.toLowerCase()} style to all captions.`)} style={styles.styleButton}><Text style={[styles.buttonText, { color: preset.style.color }]}>{preset.name}</Text></Pressable>)}
        </ScrollView>
        <View style={styles.shiftRow}>
          <Text style={styles.hint}>Shift all</Text><Pressable disabled={busy} style={styles.smallButton} onPress={() => shift(-.5)} accessibilityLabel="Shift all captions half a second earlier"><Text style={styles.buttonText}>−0.5s</Text></Pressable><Pressable disabled={busy} style={styles.smallButton} onPress={() => shift(.5)} accessibilityLabel="Shift all captions half a second later"><Text style={styles.buttonText}>+0.5s</Text></Pressable>
          <TextInput keyboardAppearance={isDark ? 'dark' : 'light'} accessibilityLabel="Caption timing offset in seconds" value={offset} onChangeText={setOffset} keyboardType="numbers-and-punctuation" style={styles.offset} editable={!busy} maxLength={12} />
          <Pressable disabled={busy} style={styles.smallButton} onPress={() => { if (!offset.trim() || !Number.isFinite(Number(offset))) setError('Enter a timing offset in seconds, such as 0.5 or -0.5.'); else shift(Number(offset)); }}><Text style={styles.accent}>Apply</Text></Pressable>
        </View>
      </>}
      </View>} ListEmptyComponent={<Text style={styles.empty}>Import a subtitle file or add a caption at the playhead. Captions stay editable and appear in the exported video.</Text>} renderItem={({ item, index }) => <CaptionRow caption={item} index={index} active={selectedId === item.id} disabled={busy} onSeek={() => seek(item)} onSave={(patch) => edit((p) => editCaption(p, item.id, patch), '', `caption:${item.id}`)} onDelete={() => { edit((p) => ({ ...p, texts: p.texts.filter((text) => text.id !== item.id || !isCaption(text)) }), 'Caption removed. Undo restores it.'); if (selectedId === item.id) useEditor.setState({ selectedId: null, lastEdit: null }); }} onSegment={() => {
        const parts = suggestCaptionSegments(item.text, 42);
        if (parts.length < 2) { setError('This caption is already short. Add a line break to choose where it should split.'); return; }
        edit((p) => segmentCaption(p, item.id, parts), `Split into ${parts.length} captions with proportional timing.`);
      }} />}/>
    </View>
  );
}

function CaptionRow({ caption, index, active, disabled, onSeek, onSave, onDelete, onSegment }: { caption: TextOverlay; index: number; active: boolean; disabled: boolean; onSeek: () => void; onSave: (patch: Partial<CaptionCue>) => void; onDelete: () => void; onSegment: () => void }) {
  const { colors, isDark } = useAppTheme();
  const styles = useThemedStyles(createStyles);
  const source = { text: caption.text, start: captionTime(caption.start), end: captionTime(caption.end) };
  const [draft, setDraft] = useState(() => createFieldDraft(source));
  const current = reconcileFieldDraft(draft, source);
  // Guarded adjustment tracks every external change, including A → B → Undo A, without losing focus.
  if (current !== draft) setDraft(current);
  const { text, start, end } = current.values;
  const [error, setError] = useState('');
  const apply = () => {
    try { const patch = { text, start: parseCaptionTime(start), end: parseCaptionTime(end) }; setError(''); onSave(patch); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  return <View style={[styles.card, active && styles.activeCard]}>
    <View style={styles.rowHeader}><Pressable disabled={disabled} style={styles.seek} onPress={onSeek} accessibilityLabel={`Go to caption ${index + 1}`}><Ionicons name="play-circle-outline" size={18} color={colors.accentText} /><Text style={styles.hint}>Caption {index + 1}</Text></Pressable><View style={styles.actions}><Pressable disabled={disabled} onPress={onSegment} style={styles.smallButton}><Text style={styles.hint}>Split lines</Text></Pressable><Pressable disabled={disabled} onPress={onDelete} accessibilityLabel={`Delete caption ${index + 1}`} style={styles.smallButton}><Ionicons name="trash-outline" size={17} color={colors.textDim} /></Pressable></View></View>
    <TextInput keyboardAppearance={isDark ? 'dark' : 'light'} value={text} onChangeText={(value) => { setDraft({ ...current, values: { ...current.values, text: value } }); if (value.trim()) onSave({ text: value }); }} onEndEditing={(event) => { if (event.nativeEvent.text !== caption.text) onSave({ text: event.nativeEvent.text }); }} multiline maxLength={2000} editable={!disabled} accessibilityLabel={`Text for caption ${index + 1}`} style={styles.textInput} textAlignVertical="top" />
    <View style={styles.timing}><View style={styles.timeField}><Text style={styles.label}>Start</Text><TextInput keyboardAppearance={isDark ? 'dark' : 'light'} value={start} onChangeText={(value) => setDraft({ ...current, values: { ...current.values, start: value } })} editable={!disabled} keyboardType="numbers-and-punctuation" accessibilityLabel={`Start time for caption ${index + 1}`} maxLength={16} style={styles.timeInput} /></View><View style={styles.timeField}><Text style={styles.label}>End</Text><TextInput keyboardAppearance={isDark ? 'dark' : 'light'} value={end} onChangeText={(value) => setDraft({ ...current, values: { ...current.values, end: value } })} editable={!disabled} keyboardType="numbers-and-punctuation" accessibilityLabel={`End time for caption ${index + 1}`} maxLength={16} style={styles.timeInput} /></View><Pressable disabled={disabled} onPress={apply} style={styles.smallButton}><Text style={styles.accent}>Save</Text></Pressable></View>
    {!!error && <Text style={styles.error}>{error}</Text>}
  </View>;
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  panel: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8, gap: 9, flexShrink: 1, backgroundColor: colors.surface },
  controls: { gap: 9, paddingBottom: 10 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 9 }, title: { ...font.h2, color: colors.text }, hint: { ...font.small, color: colors.textDim },
  done: { backgroundColor: colors.accent, borderRadius: 14, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  primary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 12, minHeight: 44, borderRadius: radius.md, backgroundColor: colors.accent }, primaryText: { ...font.small, color: colors.accentInk, fontWeight: '700' },
  button: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, minHeight: 44, borderRadius: radius.md, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.borderStrong }, buttonText: { ...font.small, color: colors.text },
  disabled: { opacity: .4 }, relative: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 },
  error: { ...font.small, color: colors.danger, lineHeight: 17 }, status: { ...font.small, color: colors.accentText, lineHeight: 17 },
  styleRow: { alignItems: 'center', gap: 8 }, styleButton: { minHeight: 44, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.borderStrong },
  shiftRow: { flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap' }, smallButton: { minHeight: 44, minWidth: 44, paddingHorizontal: 7, justifyContent: 'center', alignItems: 'center', borderRadius: radius.sm }, accent: { ...font.small, color: colors.accentText, fontWeight: '700' },
  offset: { ...font.mono, color: colors.text, paddingHorizontal: 7, minHeight: 44, width: 52, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.sm, backgroundColor: colors.bg },
  list: { flexShrink: 1 }, empty: { ...font.small, color: colors.textDim, lineHeight: 19, paddingVertical: 10 },
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: 10, marginBottom: 8, gap: 7, backgroundColor: colors.surface2 }, activeCard: { borderColor: colors.selection, backgroundColor: colors.accentSoft },
  rowHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, seek: { flexDirection: 'row', gap: 5, alignItems: 'center', minHeight: 44 },
  textInput: { ...font.body, color: colors.text, minHeight: 54, maxHeight: 100, padding: 9, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  timing: { flexDirection: 'row', alignItems: 'flex-end', gap: 7 }, timeField: { flex: 1, gap: 3 }, label: { ...font.small, fontSize: 10, color: colors.textDim }, timeInput: { ...font.mono, color: colors.text, fontSize: 11, paddingVertical: 8, paddingHorizontal: 5, minHeight: 44, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.sm, backgroundColor: colors.bg },
});
