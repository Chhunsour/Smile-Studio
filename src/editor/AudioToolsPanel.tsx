import { StudioIcon as Ionicons } from '@/ui/StudioIcon';
import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { AUDIO_PRESETS, applyAudioPreset, fitAudioToProject, focusVoice, normalizeAudioGain, repeatAudioToEnd, setAudioFades, setOriginalAudioMuted } from '@/core/audio-editing';
import type { Project } from '@/core/types';
import { useExtractAudio } from '@/editor/useExtractAudio';
import type { PlaybackEngine } from '@/playback/engine';
import { analyzeAsset } from '@/playback/waveforms';
import { useEditor } from '@/state/editor';
import { newId } from '@/storage/projects';
import { MotionPressable as Pressable } from '@/ui/MotionPressable';
import { font, radius, useAppTheme, useThemedStyles, type AppColors } from '@/ui/theme';

function AudioAction({ label, icon, onPress, primary = false, disabled = false }: {
  label: string;
  icon: ComponentProps<typeof Ionicons>['name'];
  onPress: () => void;
  primary?: boolean;
  disabled?: boolean;
}) {
  const { colors } = useAppTheme();
  const s = useThemedStyles(createStyles);
  return <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityState={{ disabled }} style={[s.action, primary && s.primary, disabled && s.disabled]}><Ionicons name={icon} size={21} color={primary ? colors.accentInk : colors.accentText}/><Text style={[s.actionText, primary && s.ink]}>{label}</Text></Pressable>;
}

export function AudioToolsPanel({ engine, onClose }: { engine: PlaybackEngine; onClose: () => void }) {
  const { colors } = useAppTheme();
  const s = useThemedStyles(createStyles);
  const { height } = useWindowDimensions();
  const project = useEditor(state => state.project);
  const selectedId = useEditor(state => state.selectedId);
  const canUndo = useEditor(state => state.past.length > 0);
  const [analyzing, setAnalyzing] = useState(false);
  const { extract, extracting } = useExtractAudio(engine);
  const busy = analyzing || extracting;
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const mounted = useRef(true);
  const pending = useRef(false);
  const pause = engine.pause;
  useEffect(() => { mounted.current = true; pause(); return () => { mounted.current = false; }; }, [pause]);
  const video = project?.main.find(clip => clip.id === selectedId);
  const audio = project?.audio.find(clip => clip.id === selectedId);
  const selected = audio ?? video;
  const asset = selected && project?.assets[selected.assetId];

  const apply = (operation: (current: Project) => Project, feedback: string) => {
    engine.pause(); setError(''); setMessage('');
    try {
      const editor = useEditor.getState();
      if (editor.project?.id !== project?.id || editor.selectedId !== selectedId) throw new Error('Your selection changed. Select the track again.');
      editor.edit(operation);
      setMessage(feedback);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };

  const extractAudio = async () => {
    if (!video || busy) return;
    setError(''); setMessage('');
    try {
      if (await extract(video.id)) setMessage('Audio extracted. The original clip is muted. Undo restores it.');
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const analyze = async () => {
    if (!asset || !selectedId || pending.current) return;
    const projectId = project?.id;
    const selection = selectedId;
    pending.current = true;
    engine.pause(); setAnalyzing(true); setError(''); setMessage('');
    try {
      const analysis = await analyzeAsset(asset);
      if (!mounted.current) return;
      const editor = useEditor.getState();
      const current = editor.project;
      if (!current || current.id !== projectId || editor.selectedId !== selection) return;
      const currentClip = current.audio.find(clip => clip.id === selection) ?? current.main.find(clip => clip.id === selection);
      if (currentClip?.assetId !== asset.id || current.assets[asset.id]?.path !== asset.path) throw new Error('This audio source changed. Try again with the current track.');
      editor.edit(current => normalizeAudioGain(current, selection, analysis));
      setMessage('Peak level balanced. Volume stays at or below 100%.');
    } catch (cause) {
      if (mounted.current && useEditor.getState().project?.id === projectId) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      pending.current = false;
      if (mounted.current) setAnalyzing(false);
    }
  };

  return <View style={[s.panel, { maxHeight: Math.min(400, height * .45) }]}>
    <View style={s.heading}><View style={s.titleRow}><Ionicons name="headset-outline" size={20} color={colors.accentText}/><Text style={s.title}>Audio tools</Text></View><Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Done editing audio" style={s.done}><Text style={s.doneText}>Done</Text></Pressable></View>
    <ScrollView style={s.scroll} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <Text style={s.detail} numberOfLines={1}>{asset?.name ?? 'Select a video or audio track'}{selected ? ` · ${Math.round(selected.volume * 100)}% volume` : ''}</Text>
      {video && asset?.kind === 'video' ? <>
        <Text style={s.section}>Original sound</Text>
        <Text style={s.detail}>Extract this clip’s audio into a separate track. The original is muted to keep the sound from doubling.{video.speed !== 1 ? ' Set the video to 1× speed first.' : ''}</Text>
        <View style={s.actions}>
          <AudioAction label={extracting ? 'Extracting…' : 'Extract audio'} icon="git-branch-outline" onPress={() => { void extractAudio(); }} primary disabled={busy || video.speed !== 1}/>
          <AudioAction label={video.volume ? 'Mute this clip' : 'Restore to 100%'} icon={video.volume ? 'volume-mute-outline' : 'volume-high-outline'} onPress={() => apply(current => ({ ...current, main: current.main.map(clip => clip.id === video.id ? { ...clip, volume: clip.volume ? 0 : 1 } : clip) }), video.volume ? 'Original sound muted.' : 'Original sound restored to 100%.')} disabled={busy}/>
        </View>
      </> : null}
      {audio ? <>
        <Text style={s.section}>Quick mix</Text>
        <View style={s.presets}>{AUDIO_PRESETS.map(preset => <Pressable key={preset.id} onPress={() => apply(current => applyAudioPreset(current, audio.id, preset.id), `${preset.name} mix applied.`)} disabled={busy} accessibilityRole="button" accessibilityLabel={`${preset.name}: ${preset.description}`} style={[s.preset, busy && s.disabled]}><View style={s.presetHeading}><Ionicons name={preset.id === 'voice' ? 'mic-outline' : preset.id === 'music' ? 'musical-notes-outline' : preset.id === 'ambient' ? 'leaf-outline' : 'pulse-outline'} size={20} color={colors.accentText}/><Text style={s.actionText}>{preset.name}</Text></View><Text style={s.detail}>{Math.round(preset.volume * 100)}% · fades</Text></Pressable>)}</View>
        <View style={s.heading}><Text style={s.section}>Fade both ends</Text><Text style={s.detail}>{(audio.fadeIn ?? 0).toFixed(2)}s in · {(audio.fadeOut ?? 0).toFixed(2)}s out</Text></View>
        <View style={s.actions}>{[0, .15, .5, 1].map(seconds => <Pressable key={seconds} onPress={() => apply(current => setAudioFades(current, audio.id, seconds), seconds ? 'Fades added to both ends.' : 'Audio fades removed.')} disabled={busy} accessibilityRole="button" style={[s.fade, busy && s.disabled]}><Text style={s.actionText}>{seconds ? `${seconds}s` : 'None'}</Text></Pressable>)}</View>
        <Text style={s.section}>Arrange soundtrack</Text>
        <View style={s.actions}>
          <AudioAction label="Repeat to end" icon="repeat-outline" onPress={() => apply(current => repeatAudioToEnd(current, audio.id, newId), 'Repeated the trimmed audio through the end of the project.')} disabled={busy}/>
          <AudioAction label="Trim excess" icon="cut-outline" onPress={() => apply(current => fitAudioToProject(current, audio.id), 'Audio ends within the project.')} disabled={busy}/>
        </View>
        <Text style={s.section}>Make room for this voice</Text>
        <Text style={s.detail}>Lower the full length of other tracks that overlap this audio to at most 20%. Undo restores the mix.</Text>
        <AudioAction label="Lower other tracks" icon="mic-outline" onPress={() => apply(current => focusVoice(current, audio.id), 'Overlapping tracks lowered to at most 20%.')} disabled={busy}/>
      </> : null}
      {selected && asset?.kind !== 'image' ? <>
        <Text style={s.section}>Balance loud peaks</Text>
        <Text style={s.detail}>Set the level from the actual audio waveform. Quiet sources stay within 100% volume.</Text>
        <AudioAction label="Balance peak level" icon="pulse-outline" onPress={() => { void analyze(); }} disabled={busy}/>
      </> : null}
      <Text style={s.section}>All original clips</Text>
      <View style={s.actions}>
        <AudioAction label="Mute originals" icon="volume-mute-outline" onPress={() => apply(current => setOriginalAudioMuted(current, true), 'All original video sound muted.')} disabled={busy}/>
        <AudioAction label="Restore to 100%" icon="volume-high-outline" onPress={() => apply(current => setOriginalAudioMuted(current, false), 'All original video sound restored to 100%.')} disabled={busy}/>
      </View>
      {busy ? <View style={s.status}><ActivityIndicator size="small" color={colors.accentText}/><Text style={s.detail}>Reading audio…</Text></View> : null}
      {error ? <Text style={s.error} accessibilityRole="alert">{error}</Text> : message ? <Text style={s.feedback} accessibilityLiveRegion="polite">{message}</Text> : null}
      <Pressable onPress={() => { engine.pause(); useEditor.getState().undo(); setError(''); setMessage('Last edit undone.'); }} disabled={!canUndo || busy} accessibilityRole="button" style={[s.undo, (!canUndo || busy) && s.disabled]}><Ionicons name="arrow-undo-outline" size={16} color={colors.textDim}/><Text style={s.detail}>Undo last edit</Text></Pressable>
    </ScrollView>
  </View>;
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  panel: { paddingHorizontal: 16, paddingVertical: 10, gap: 9, backgroundColor: colors.surface }, heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 9 }, title: { ...font.h2, color: colors.text }, done: { minWidth: 60, minHeight: 44, paddingHorizontal: 12, justifyContent: 'center', alignItems: 'center', borderRadius: radius.md, backgroundColor: colors.accentSoft }, doneText: { ...font.small, fontWeight: '700', color: colors.accentText },
  detail: { ...font.small, color: colors.textDim, lineHeight: 17 }, scroll: { flexShrink: 1 }, content: { gap: 10, paddingBottom: 4 },
  section: { ...font.small, color: colors.text, fontWeight: '700', marginTop: 3 }, actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  action: { flexDirection: 'row', gap: 8, alignItems: 'center', backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.md, minHeight: 44, paddingHorizontal: 12, paddingVertical: 10 },
  primary: { backgroundColor: colors.accent, borderColor: colors.selection }, actionText: { ...font.small, color: colors.text }, ink: { color: colors.accentInk },
  presets: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, preset: { width: '47%', gap: 6, padding: 12, borderRadius: radius.md, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.borderStrong },
  presetHeading: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  fade: { flex: 1, alignItems: 'center', padding: 12, minHeight: 44, borderRadius: radius.md, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.borderStrong },
  disabled: { opacity: .4 }, status: { flexDirection: 'row', alignItems: 'center', gap: 8 }, error: { ...font.small, color: colors.danger, lineHeight: 17 },
  feedback: { ...font.small, color: colors.accentText, lineHeight: 17 }, undo: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 10, minHeight: 44 },
});
