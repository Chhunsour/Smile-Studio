import { StudioIcon as Ionicons } from '@/ui/StudioIcon';
import { AudioModule, RecordingPresets, setAudioModeAsync, type AudioRecorder } from 'expo-audio';
import { File } from 'expo-file-system';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { Alert, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeOut } from 'react-native-reanimated';

import { onsetsForClip } from '@/core/audio-analysis';
import { repeatAudioToEnd } from '@/core/audio-editing';
import { copyLook, mergeMarkers } from '@/core/editing';
import { applyTransitionPreset, splitAtMarkers, trimAtPlayhead } from '@/core/quick-edit';
import { isSpeedCommitCurrent } from '@/core/slider';
import { DEFAULT_COLOR, FILTERS, type ColorSettings } from '@/core/color';
import { centeredCrop, clipStarts, locate, textAnimDuration, totalDuration } from '@/core/timeline';
import type { AspectRatio, AudioClip, TextAnim, TextOverlay, VideoClip } from '@/core/types';
import { CaptionsPanel } from '@/editor/CaptionsPanel';
import { AudioToolsPanel } from '@/editor/AudioToolsPanel';
import { EffectsPanel } from '@/editor/EffectsPanel';
import { SoundLibraryPanel } from '@/editor/SoundLibraryPanel';
import { StickersPanel } from '@/editor/StickersPanel';
import { TimingPanel } from '@/editor/TimingPanel';
import { TemplatesPanel } from '@/editor/TemplatesPanel';
import { ToolLibrary, type EditorTool } from '@/editor/ToolLibrary';
import { useExtractAudio } from '@/editor/useExtractAudio';
import { ANIMATION_PRESETS, TEXT_STYLE_PRESETS, type TextStyle } from '@/editor/text-presets';
import { registerVoiceoverSession } from '@/playback/voiceover-session';
import { analyzeAsset } from '@/playback/waveforms';
import { newId } from '@/storage/projects';
import { saveToPhotos } from '@/editor/ExportFlow';
import { IDENTITY_TRANSFORM } from '@/editor/Preview';
import { renderStill } from '@/editor/still';
import type { PlaybackEngine } from '@/playback/engine';
import { DEFAULT_TEXT, selectionKind, useEditor, type Panel } from '@/state/editor';
import { importAudio, importPhoto } from '@/storage/media';
import { FONTS, fontStyle, TEXT_COLORS } from '@/ui/fonts';
import { Slider } from '@/ui/Slider';
import { MotionPressable as Pressable } from '@/ui/MotionPressable';
import { useMotionPreferences } from '@/ui/motion';
import { colors as fixedColors, font, radius, useAppTheme, useThemedStyles, type AppColors } from '@/ui/theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

const RATIOS: { value: AspectRatio; label: string }[] = [
  { value: 'original', label: 'Original' },
  { value: '9:16', label: '9:16' },
  { value: '16:9', label: '16:9' },
  { value: '1:1', label: '1:1' },
  { value: '4:5', label: '4:5' },
  { value: '3:4', label: '3:4' },
];

/** Fill around clips that don't cover the canvas (Project.background). */
const BACKGROUNDS: { value: string; label: string }[] = [
  { value: '#000000', label: 'Black' },
  { value: 'blur', label: 'Blur' },
  { value: '#FFFFFF', label: 'White' },
  { value: fixedColors.accent, label: 'Sunny' },
  { value: '#F472B6', label: 'Pink' },
  { value: '#60A5FA', label: 'Blue' },
];

const CROPS: { label: string; ratio: number | null }[] = [
  { label: 'Full', ratio: null },
  { label: '1:1', ratio: 1 },
  { label: '4:5', ratio: 4 / 5 },
  { label: '9:16', ratio: 9 / 16 },
  { label: '16:9', ratio: 16 / 9 },
  { label: '3:4', ratio: 3 / 4 },
];

const ADJUSTMENTS: { key: keyof Omit<ColorSettings, 'filter' | 'intensity'>; label: string; icon: IconName }[] = [
  { key: 'brightness', label: 'Brightness', icon: 'sunny-outline' },
  { key: 'contrast', label: 'Contrast', icon: 'contrast-outline' },
  { key: 'saturation', label: 'Saturation', icon: 'color-palette-outline' },
  { key: 'warmth', label: 'Warmth', icon: 'thermometer-outline' },
];

// Slider mappings (worklets: they run on the UI thread inside the slider).
const speedToNorm = (v: number) => {
  'worklet';
  return (Math.log2(v) + 2) / 4;
};
const normToSpeed = (n: number) => {
  'worklet';
  const v = Math.pow(2, n * 4 - 2);
  return Math.abs(v - 1) < 0.06 ? 1 : Math.round(v * 20) / 20;
};
const unitToNorm = (v: number) => {
  'worklet';
  return v;
};
const normToUnit = (n: number) => {
  'worklet';
  return Math.round(n * 100) / 100;
};
const signedToNorm = (v: number) => {
  'worklet';
  return (v + 1) / 2;
};
const normToSigned = (n: number) => {
  'worklet';
  const v = Math.round((n * 2 - 1) * 100) / 100;
  return Math.abs(v) < 0.04 ? 0 : v;
};
const pct = (v: number) => `${Math.round(v * 100)}`;
const sizeToNorm = (value: number) => { 'worklet'; return (value - .025) / .175; };
const normToSize = (value: number) => { 'worklet'; return Math.round((.025 + value * .175) * 1000) / 1000; };
/** Fade lengths: 0..3 s in 0.1 s steps. */
const MAX_FADE = 3;
const fadeToNorm = (v: number) => {
  'worklet';
  return v / 3;
};
const normToFade = (n: number) => {
  'worklet';
  return Math.round(n * 30) / 10;
};
const seconds = (v: number) => (v === 0 ? 'Off' : `${v.toFixed(1)}s`);

const SPEED_PRESETS = [0.25, 0.5, 1, 1.5, 2, 3, 4];

/** Crossfade lengths: 0..2 s in 0.1 s steps. */
const xfadeToNorm = (v: number) => {
  'worklet';
  return v / 2;
};
const normToXfade = (n: number) => {
  'worklet';
  return Math.round(n * 20) / 10;
};

export type { TextStyle } from '@/editor/text-presets';

/** One-tap text looks: plain patches of the text's own fields, so export draws them with no extra work. */
const TEXT_STYLES = TEXT_STYLE_PRESETS;

/** Stickers are big emoji text layers: they move, scale, animate and export like any text. */
const STICKER_STYLE: TextStyle = { size: 0.2, box: false, animIn: 'pop', animOut: 'fade' };

const ANIMS = ANIMATION_PRESETS;

export function Toolbar({
  engine,
  onAdd,
  onAddText,
  onAddAudio,
}: {
  engine: PlaybackEngine;
  onAdd: () => void;
  onAddText: (style?: TextStyle) => void;
  onAddAudio: () => void;
}) {
  const { colors } = useAppTheme();
  const styles = useThemedStyles(createStyles);
  const reducedMotion = useMotionPreferences();
  const project = useEditor((s) => s.project);
  const selectedId = useEditor((s) => s.selectedId);
  const panel = useEditor((s) => s.panel);
  const { select, split, duplicate, remove, setAspect, setPanel } = useEditor.getState();
  const [hint, setHint] = useState<string | null>(null);
  const [savedLook, setSavedLook] = useState<ReturnType<typeof copyLook> | null>(null);
  const [findingBeats, setFindingBeats] = useState(false);
  const [toolsVisible, setToolsVisible] = useState(false);
  const { extract, extracting } = useExtractAudio(engine);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  useEffect(() => {
    if (!hint) return;
    const t = setTimeout(() => setHint(null), 1800);
    return () => clearTimeout(t);
  }, [hint]);

  if (!project) return null;
  const kind = selectionKind(project, selectedId);
  const clip = kind === 'clip' ? project.main.find((c) => c.id === selectedId) : undefined;
  const text = kind === 'text' ? project.texts.find((t) => t.id === selectedId) : undefined;
  const audioClip = kind === 'audio' ? project.audio.find((a) => a.id === selectedId) : undefined;
  const photo = !!clip && project.assets[clip.assetId]?.kind === 'image';
  const extractTarget = clip ?? locate(project.main, engine.currentTime())?.clip;
  const canExtract = !!extractTarget && project.assets[extractTarget.assetId]?.kind === 'video';
  const done = () => setPanel(null);

  const extractAudio = async () => {
    const target = clip ?? locate(project.main, engine.currentTime())?.clip;
    if (!target || extracting) return;
    try {
      if (await extract(target.id)) setHint('Audio extracted · edit it separately below');
    } catch (error) {
      Alert.alert('Could not extract audio', error instanceof Error ? error.message : String(error));
    }
  };

  const doSplit = () => {
    const t = engine.currentTime();
    const hit = locate(project.main, t);
    const ok = clip
      ? hit?.clip.id === clip.id && split(t)
      : !!selectedId && useEditor.getState().splitOverlay(selectedId, t);
    if (!ok) {
      setHint(`Move the playhead inside the selected ${clip ? 'clip' : 'item'} to split it`);
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  /** Renders the frame under the playhead; null (after telling the user) when that isn't possible. */
  const still = async (withText: boolean) => {
    engine.pause();
    if (!project.main.length) return null;
    try {
      return await renderStill(project, engine.currentTime(), withText);
    } catch (e) {
      Alert.alert('Could not render the frame', e instanceof Error ? e.message : String(e));
      return null;
    }
  };

  const saveFrame = async () => {
    setHint('Saving frame…');
    const frame = await still(true);
    if (!frame) return setHint(null);
    const saved = await saveToPhotos(frame.uri);
    setHint(saved === 'yes' ? 'Frame saved to Photos' : saved === 'denied' ? 'Allow Photos access to save frames' : 'Could not save the frame');
    if (saved === 'yes') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const freeze = async () => {
    setHint('Freezing frame…');
    const t = engine.currentTime();
    // Texts stay live layers on top, so they aren't baked into the still.
    const frame = await still(false);
    if (!frame) return setHint(null);
    try {
      const asset = await importPhoto({ ...frame, fileName: 'Freeze frame' });
      useEditor.getState().insertStill(t, asset);
      setHint(null);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch (e) {
      setHint(null);
      Alert.alert('Could not freeze the frame', e instanceof Error ? e.message : String(e));
    }
  };

  const selectUnderPlayhead = () => {
    const hit = locate(project.main, engine.currentTime());
    if (hit) select(hit.clip.id);
  };

  const mark = () => {
    const at = engine.currentTime();
    useEditor.getState().edit(p => { const markers = mergeMarkers(p.markers, [at], totalDuration(p.main)); return JSON.stringify(markers) === JSON.stringify(p.markers ?? []) ? p : { ...p, markers }; });
    setHint('Marker added · tap to seek, hold to remove');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };
  const findBeats = async () => {
    const item = audioClip ?? clip;
    if (!item || findingBeats) return;
    const asset = project.assets[item.assetId];
    if (!asset || asset.kind === 'image') return;
    engine.pause(); setFindingBeats(true); setHint('Finding beats…');
    try {
      const analysis = await analyzeAsset(asset);
      const current = useEditor.getState().project;
      if (!mounted.current || !current || current.id !== project.id) return;
      // Re-read trim and placement after analysis; edits or deletion may have occurred meanwhile.
      const audio = current.audio.find(a => a.id === item.id);
      const index = current.main.findIndex(c => c.id === item.id);
      const video = current.main[index];
      const range = audio ?? (video ? { ...video, start: clipStarts(current.main)[index] } : undefined);
      if (!range) return;
      const beats = onsetsForClip(analysis, range, totalDuration(current.main));
      if (!beats.length) { setHint('No clear beats in this section'); return; }
      useEditor.getState().edit(p => { const markers = mergeMarkers(p.markers, beats, totalDuration(p.main)); return JSON.stringify(markers) === JSON.stringify(p.markers ?? []) ? p : { ...p, markers }; });
      setHint(`Found ${beats.length} beats · clips snap to markers`);
    } catch (e) { if (mounted.current && useEditor.getState().project?.id === project.id) { Alert.alert('Could not find beats', e instanceof Error ? e.message : String(e)); setHint(null); } }
    finally { if (mounted.current) setFindingBeats(false); }
  };
  const loop = () => {
    if (!audioClip) return;
    engine.pause();
    try {
      const result = repeatAudioToEnd(project, audioClip.id, newId);
      if (result === project) { setHint('This audio already reaches the end'); return; }
      useEditor.getState().edit(() => result);
      setHint('Audio repeated to the end');
    } catch (error) { Alert.alert('Could not repeat audio', error instanceof Error ? error.message : String(error)); }
  };

  const openClipPanel = (next: Panel) => {
    engine.pause();
    const target = clip ?? locate(project.main, engine.currentTime())?.clip;
    if (!target) return;
    select(target.id);
    setPanel(next);
  };
  const quickTrim = (edge: 'before' | 'after') => {
    const target = clip ?? locate(project.main, engine.currentTime())?.clip;
    if (!target) return;
    engine.pause();
    try {
      const time = engine.currentTime();
      const start = clipStarts(project.main)[project.main.findIndex(item => item.id === target.id)];
      useEditor.getState().edit(current => trimAtPlayhead(current, target.id, time, edge));
      const seek = edge === 'before' ? start : Math.max(start, time - .01);
      engine.time.set(seek); engine.seek(seek);
      setHint('Clip trimmed. Text and audio keep their timeline positions.');
    } catch (error) { setHint(error instanceof Error ? error.message : String(error)); }
  };
  const cutMarkers = () => {
    engine.pause();
    try {
      const result = splitAtMarkers(project, newId);
      useEditor.getState().edit(() => result.project);
      setHint(result.added ? `Split at ${result.added} markers` : 'Add markers inside clips first');
    } catch (error) { setHint(error instanceof Error ? error.message : String(error)); }
  };
  const hasClips = project.main.length > 0;
  const tools: EditorTool[] = [
    { id: 'undo', name: 'Undo', description: 'Restore the edit before your last change.', category: 'Project', icon: 'arrow-undo-outline', disabled: !useEditor.getState().past.length, run: () => { engine.pause(); useEditor.getState().undo(); } },
    { id: 'redo', name: 'Redo', description: 'Reapply the last edit you undid.', category: 'Project', icon: 'arrow-redo-outline', disabled: !useEditor.getState().future.length, run: () => { engine.pause(); useEditor.getState().redo(); } },
    { id: 'split', name: 'Split', description: 'Cut the selected clip, text or audio at the playhead.', category: 'Edit', icon: 'cut-outline', disabled: !hasClips, run: () => { engine.pause(); if (selectedId) doSplit(); else { selectUnderPlayhead(); if (!useEditor.getState().split(engine.currentTime())) setHint('Move the playhead inside a clip to split it'); } } },
    { id: 'duplicate', name: 'Duplicate', description: 'Add a copy after the selected clip, text or audio.', category: 'Edit', icon: 'copy-outline', disabled: !selectedId, run: () => { engine.pause(); if (selectedId) duplicate(selectedId); } },
    { id: 'delete', name: 'Delete selection', description: 'Remove the selected item. Undo restores it.', category: 'Edit', icon: 'trash-outline', disabled: !selectedId, run: () => { engine.pause(); if (selectedId) remove(selectedId); } },
    { id: 'timing', name: 'Exact timing', description: 'Set source trim or text and audio start/end times.', category: 'Edit', icon: 'time-outline', disabled: !selectedId, run: () => { engine.pause(); setPanel('timing'); } },
    { id: 'templates', name: 'Templates', description: 'Eight editable styles for your footage and opening title.', category: 'Project', icon: 'albums-outline', disabled: !hasClips, run: () => { engine.pause(); setPanel('templates'); } },
    { id: 'effects', name: 'Video effects', description: 'Stack textures, light leaks, frames and cinema looks.', category: 'Looks', icon: 'sparkles-outline', disabled: !hasClips, run: () => openClipPanel('effects') },
    { id: 'filters', name: 'Filters', description: 'Color looks with adjustable intensity.', category: 'Looks', icon: 'color-filter-outline', disabled: !hasClips, run: () => openClipPanel('filters') },
    { id: 'adjust', name: 'Adjust color', description: 'Brightness, contrast, saturation and warmth.', category: 'Looks', icon: 'options-outline', disabled: !hasClips, run: () => openClipPanel('adjust') },
    { id: 'crop', name: 'Crop', description: 'Reframe a clip for square, vertical or widescreen video.', category: 'Edit', icon: 'crop-outline', disabled: !hasClips, run: () => openClipPanel('crop') },
    { id: 'transform', name: 'Rotate, flip & zoom', description: 'Rotate footage, fill the canvas or add a slow zoom.', category: 'Edit', icon: 'sync-outline', disabled: !hasClips, run: () => openClipPanel('rotate') },
    { id: 'speed', name: 'Speed', description: 'Slow motion or fast motion from 0.25× to 4×.', category: 'Edit', icon: 'speedometer-outline', disabled: !hasClips, run: () => openClipPanel('speed') },
    { id: 'transition', name: 'Crossfade', description: 'Blend two clips smoothly at the cut.', category: 'Edit', icon: 'git-compare-outline', disabled: !hasClips, run: () => openClipPanel('transition') },
    { id: 'fade', name: 'Fade video', description: 'Fade a scene and its sound in or out.', category: 'Looks', icon: 'invert-mode-outline', disabled: !hasClips, run: () => openClipPanel('fade') },
    { id: 'copy-look', name: 'Copy look', description: 'Copy color settings and the effect stack from a clip.', category: 'Looks', icon: 'eyedrop-outline', disabled: !hasClips, run: () => { const target = clip ?? locate(project.main, engine.currentTime())?.clip; if (target) { setSavedLook(copyLook(target)); setHint('Look copied. Select another clip to paste.'); } } },
    { id: 'paste-look', name: 'Paste look', description: 'Apply your copied colors and effects to another clip.', category: 'Looks', icon: 'color-palette-outline', disabled: !hasClips || !savedLook, run: () => { const target = clip ?? locate(project.main, engine.currentTime())?.clip; if (target && savedLook) useEditor.getState().updateClip(target.id, copyLook({ ...target, ...savedLook })); } },
    { id: 'freeze', name: 'Freeze frame', description: 'Insert the current picture as an editable photo clip.', category: 'Edit', icon: 'snow-outline', disabled: !hasClips, run: freeze },
    { id: 'trim-before', name: 'Trim before playhead', description: 'Remove the beginning of the selected clip.', category: 'Edit', icon: 'play-skip-back-outline', disabled: !hasClips, run: () => quickTrim('before') },
    { id: 'trim-after', name: 'Trim after playhead', description: 'Remove the end of the selected clip.', category: 'Edit', icon: 'play-skip-forward-outline', disabled: !hasClips, run: () => quickTrim('after') },
    { id: 'marker-cuts', name: 'Split at markers', description: 'Turn your beat markers into cuts in one step.', category: 'Edit', icon: 'cut-outline', disabled: !project.markers?.length, run: cutMarkers },
    { id: 'text', name: 'Add text', description: 'Add an editable title at the playhead.', category: 'Text', icon: 'text-outline', disabled: !hasClips, run: () => onAddText() },
    { id: 'text-styles', name: 'Text styles', description: 'Twenty title, subtitle and headline presets.', category: 'Text', icon: 'color-wand-outline', disabled: !hasClips, run: () => { if (!text) onAddText(TEXT_STYLE_PRESETS[0].style); setPanel('style'); } },
    { id: 'animation', name: 'Text animation', description: 'Fade, bounce, pulse, slide and zoom your titles.', category: 'Text', icon: 'expand-outline', disabled: !hasClips, run: () => { if (!text) onAddText(TEXT_STYLE_PRESETS[1].style); setPanel('animate'); } },
    { id: 'captions', name: 'Captions', description: 'Import SRT / WebVTT, edit timing and share subtitles.', category: 'Text', icon: 'chatbox-ellipses-outline', disabled: !hasClips, run: () => { engine.pause(); setPanel('captions'); } },
    { id: 'stickers', name: 'Stickers', description: 'Emoji, celebrations, food and Cambodian favorites.', category: 'Text', icon: 'happy-outline', disabled: !hasClips, run: () => setPanel('stickers') },
    { id: 'sounds', name: 'Sound library', description: 'Original music and sound effects available offline.', category: 'Audio', icon: 'musical-notes-outline', disabled: !hasClips, run: () => setPanel('sounds') },
    { id: 'extract-audio', name: 'Extract audio', description: 'Separate video sound into an editable audio track. Mutes the original.', category: 'Audio', icon: 'git-branch-outline', disabled: extracting || !canExtract, run: () => { void extractAudio(); } },
    { id: 'audio-tools', name: 'Audio tools', description: 'Extract sound, level volume and shape your soundtrack.', category: 'Audio', icon: 'headset-outline', disabled: !hasClips, run: () => { engine.pause(); setPanel('audioTools'); } },
    { id: 'volume', name: 'Volume & mute', description: 'Adjust the sound of the selected video or audio.', category: 'Audio', icon: 'volume-high-outline', disabled: !clip && !audioClip, run: () => { engine.pause(); setPanel('volume'); } },
    { id: 'audio-fade', name: 'Fade audio', description: 'Fade the beginning and end of the selected audio.', category: 'Audio', icon: 'invert-mode-outline', disabled: !audioClip, run: () => { engine.pause(); setPanel('fade'); } },
    { id: 'beats', name: 'Find beats', description: 'Analyze selected video or audio for beat markers.', category: 'Audio', icon: 'pulse-outline', disabled: findingBeats || !clip && !audioClip, run: findBeats },
    { id: 'repeat-audio', name: 'Repeat audio to end', description: 'Loop the selected soundtrack through the project.', category: 'Audio', icon: 'repeat-outline', disabled: !audioClip, run: loop },
    { id: 'import-audio', name: 'Import audio', description: 'Add music or a voice recording from Files.', category: 'Audio', icon: 'folder-open-outline', disabled: !hasClips, run: onAddAudio },
    { id: 'voiceover', name: 'Record voiceover', description: 'Record your voice while watching the edit.', category: 'Audio', icon: 'mic-outline', disabled: !hasClips, run: () => { engine.pause(); setPanel('voiceover'); } },
    { id: 'canvas', name: 'Canvas & background', description: 'Choose an aspect ratio, solid color or blurred background.', category: 'Project', icon: 'scan-outline', run: () => setPanel('ratio') },
    { id: 'marker', name: 'Add marker', description: 'Bookmark the playhead for a later cut.', category: 'Edit', icon: 'flag-outline', disabled: !hasClips, run: mark },
    { id: 'save-frame', name: 'Save frame', description: 'Save the current frame with your effects and titles.', category: 'Project', icon: 'download-outline', disabled: !hasClips, run: saveFrame },
    { id: 'media', name: 'Add media', description: 'Import more photos or videos into this edit.', category: 'Project', icon: 'add-circle-outline', run: onAdd },
  ];

  let body: ReactNode;
  if (panel === 'captions') {
    body = <CaptionsPanel engine={engine} onClose={done} />;
  } else if (panel === 'templates') {
    body = <TemplatesPanel engine={engine} onClose={done} />;
  } else if (panel === 'audioTools') {
    body = <AudioToolsPanel engine={engine} onClose={done} />;
  } else if (panel === 'effects' && clip) {
    body = <EffectsPanel clip={clip} onClose={done} />;
  } else if (panel === 'sounds') {
    body = <SoundLibraryPanel engine={engine} onClose={done} />;
  } else if (panel === 'timing' && selectedId) {
    body = <TimingPanel key={selectedId} id={selectedId} onClose={done} />;
  } else if (panel === 'voiceover') {
    body = <VoiceoverPanel engine={engine} onDone={done} />;
  } else if (panel === 'ratio') {
    body = (
      <PanelShell title="Canvas" onDone={done}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {RATIOS.map((r) => (
            <Chip key={r.value} on={project.aspect === r.value} onPress={() => setAspect(r.value)} label={r.label}>
              <RatioGlyph ratio={r.value} on={project.aspect === r.value} />
            </Chip>
          ))}
        </ScrollView>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {BACKGROUNDS.map((b) => {
            const on = (project.background ?? '#000000') === b.value;
            return (
              <Chip
                key={b.value}
                on={on}
                onPress={() => useEditor.getState().setBackground(b.value)}
                label={b.label}>
                {b.value === 'blur' ? (
                  <Ionicons name="water-outline" size={16} color={on ? colors.accentInk : colors.textDim} />
                ) : (
                  <View style={[styles.dot, { backgroundColor: b.value }]} />
                )}
              </Chip>
            );
          })}
        </ScrollView>
      </PanelShell>
    );
  } else if (panel === 'speed' && clip) {
    body = (
      <ValuePanel
        title="Speed"
        value={clip.speed}
        format={(v) => `${v.toFixed(2)}x`}
        toNorm={speedToNorm}
        fromNorm={normToSpeed}
        marks={['0.25x', '1x', '4x']}
        onCommit={(speed) => {
          const editor = useEditor.getState();
          if (isSpeedCommitCurrent(editor, { projectId: project.id, clipId: clip.id, speed: clip.speed })) editor.updateClip(clip.id, { speed });
        }}
        onDone={done}
        below={
          <View style={styles.presetRow}>
            {SPEED_PRESETS.map((v) => (
              <Chip
                key={v}
                label={`${v}x`}
                on={clip.speed === v}
                onPress={() => useEditor.getState().updateClip(clip.id, { speed: v })}
              />
            ))}
          </View>
        }
      />
    );
  } else if (panel === 'volume' && (clip || audioClip)) {
    const item = (clip ?? audioClip)!;
    const setVolume = (volume: number) =>
      clip
        ? useEditor.getState().updateClip(clip.id, { volume })
        : useEditor.getState().updateAudio(item.id, { volume });
    body = (
      <ValuePanel
        title="Volume"
        value={item.volume}
        format={(v) => (v === 0 ? 'Muted' : `${Math.round(v * 100)}%`)}
        toNorm={unitToNorm}
        fromNorm={normToUnit}
        marks={['0', '50', '100']}
        onCommit={setVolume}
        onDone={done}
        extra={
          <Pressable
            style={styles.squareBtn}
            onPress={() => setVolume(item.volume === 0 ? 1 : 0)}
            accessibilityLabel={item.volume === 0 ? 'Unmute' : 'Mute'}>
            <Ionicons name={item.volume === 0 ? 'volume-mute' : 'volume-high'} size={20} color={colors.text} />
          </Pressable>
        }
      />
    );
  } else if (panel === 'crop' && clip) {
    body = <CropPanel clip={clip} asset={project.assets[clip.assetId]} onDone={done} />;
  } else if (panel === 'rotate' && clip) {
    body = <RotatePanel clip={clip} onDone={done} />;
  } else if (panel === 'filters' && clip) {
    body = <FiltersPanel clip={clip} onDone={done} />;
  } else if (panel === 'adjust' && clip) {
    body = <AdjustPanel clip={clip} onDone={done} />;
  } else if (panel === 'text' && text) {
    body = <TextPanel text={text} onDone={done} />;
  } else if (panel === 'fade' && (clip || audioClip)) {
    body = <FadePanel item={(clip ?? audioClip)!} isClip={!!clip} onDone={done} />;
  } else if (panel === 'animate' && text) {
    body = <AnimatePanel text={text} engine={engine} onDone={done} />;
  } else if (panel === 'style' && text) {
    body = <StylePanel text={text} onDone={done} />;
  } else if (panel === 'stickers') {
    body = (
      <StickersPanel
        onPick={(emoji) => {
          onAddText({ ...STICKER_STYLE, text: emoji });
        }}
        onDone={done}
      />
    );
  } else if (panel === 'transition' && clip) {
    body = <TransitionPanel clip={clip} isFirst={project.main[0]?.id === clip.id} onDone={done} />;
  } else if (kind) {
    body = (
      <Animated.View key={kind} entering={reducedMotion ? undefined : FadeInDown.duration(180)} style={styles.toolsRow}>
        <Pressable onPress={() => select(null)} style={styles.back} accessibilityLabel="Done editing">
          <Ionicons name="chevron-down" size={22} color={colors.text} />
        </Pressable>
        <Tool icon="grid-outline" label="All tools" featured onPress={() => { engine.pause(); setToolsVisible(true); }} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tools}>
          {clip ? (
            <>
              <Tool icon="cut-outline" label="Split" haptic="none" onPress={doSplit} />
              {photo ? null : <Tool icon="git-branch-outline" label={extracting ? 'Extracting…' : 'Extract audio'} disabled={extracting} onPress={() => { void extractAudio(); }} />}
              <Tool icon="sparkles-outline" label="Effects" onPress={() => setPanel('effects')} />
              {photo ? null : (
                <>
                  <Tool icon="speedometer-outline" label="Speed" onPress={() => setPanel('speed')} />
                  <Tool icon="volume-high-outline" label="Volume" onPress={() => setPanel('volume')} />
                  <Tool icon="headset-outline" label="Audio tools" onPress={() => setPanel('audioTools')} />
                </>
              )}
              <Tool icon="git-compare-outline" label="Transition" onPress={() => setPanel('transition')} />
              <Tool icon="crop-outline" label="Crop" onPress={() => setPanel('crop')} />
              <Tool icon="sync-outline" label="Rotate" onPress={() => setPanel('rotate')} />
              <Tool icon="color-filter-outline" label="Filters" onPress={() => setPanel('filters')} />
              <Tool icon="options-outline" label="Adjust" onPress={() => setPanel('adjust')} />
              <Tool icon="invert-mode-outline" label="Fade" onPress={() => setPanel('fade')} />
              <Tool icon="play-skip-back-outline" label="Trim before" onPress={() => quickTrim('before')} />
              <Tool icon="play-skip-forward-outline" label="Trim after" onPress={() => quickTrim('after')} />
              <Tool icon="eyedrop-outline" label="Copy look" onPress={() => { setSavedLook(copyLook(clip)); setHint('Look copied · select another clip to paste'); }} />
              <Tool icon="color-palette-outline" label="Paste look" disabled={!savedLook} onPress={() => savedLook && useEditor.getState().updateClip(clip.id, { ...savedLook, color: savedLook.color && { ...savedLook.color }, effects: savedLook.effects && { ...savedLook.effects } })} />
              {photo ? null : <Tool icon="pulse-outline" label={findingBeats ? 'Finding…' : 'Beats'} disabled={findingBeats} onPress={findBeats} />}
              {photo ? null : <Tool icon="snow-outline" label="Freeze" haptic="none" onPress={freeze} />}
            </>
          ) : null}
          {text ? (
            <>
              <Tool icon="create-outline" label="Edit" onPress={() => setPanel('text')} />
              <Tool icon="color-wand-outline" label="Style" onPress={() => setPanel('style')} />
              <Tool icon="sparkles-outline" label="Animate" onPress={() => setPanel('animate')} />
              <Tool icon="cut-outline" label="Split" haptic="none" onPress={doSplit} />
            </>
          ) : null}
          {audioClip ? (
            <>
              <Tool icon="pulse-outline" label={findingBeats ? 'Finding…' : 'Beats'} disabled={findingBeats} onPress={findBeats} />
              <Tool icon="repeat-outline" label="Loop to end" onPress={loop} />
              <Tool icon="volume-high-outline" label="Volume" onPress={() => setPanel('volume')} />
              <Tool icon="headset-outline" label="Audio tools" onPress={() => setPanel('audioTools')} />
              <Tool icon="invert-mode-outline" label="Fade" onPress={() => setPanel('fade')} />
              <Tool icon="cut-outline" label="Split" haptic="none" onPress={doSplit} />
            </>
          ) : null}
          <Tool icon="time-outline" label="Timing" onPress={() => { engine.pause(); setPanel('timing'); }} />
          <Tool icon="flag-outline" label="Mark" haptic="none" onPress={mark} />
          <Tool icon="copy-outline" label="Duplicate" onPress={() => selectedId && duplicate(selectedId)} />
          <Tool icon="trash-outline" label="Delete" onPress={() => selectedId && remove(selectedId)} />
        </ScrollView>
      </Animated.View>
    );
  } else {
    body = (
      <Animated.View key="main" entering={reducedMotion ? undefined : FadeInDown.duration(180)} style={styles.toolsRow}>
        <Tool icon="grid-outline" label="All tools" featured onPress={() => { engine.pause(); setToolsVisible(true); }} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tools}>
          <Tool icon="cut-outline" label="Edit" onPress={selectUnderPlayhead} disabled={!project.main.length} />
          <Tool icon="albums-outline" label="Templates" onPress={() => { engine.pause(); setPanel('templates'); }} disabled={!project.main.length} />
          <Tool icon="sparkles-outline" label="Effects" onPress={() => openClipPanel('effects')} disabled={!project.main.length} />
          <Tool icon="chatbox-ellipses-outline" label="Captions" onPress={() => { engine.pause(); setPanel('captions'); }} disabled={!project.main.length} />
          <Tool icon="musical-notes-outline" label="Sounds" onPress={() => setPanel('sounds')} disabled={!project.main.length} />
          <Tool icon="git-branch-outline" label={extracting ? 'Extracting…' : 'Extract audio'} disabled={extracting || !canExtract} onPress={() => { void extractAudio(); }} />
          <Tool icon="folder-open-outline" label="Import audio" onPress={onAddAudio} />
          <Tool
            icon="mic-outline"
            label="Voiceover"
            onPress={() => setPanel('voiceover')}
            disabled={!project.main.length}
          />
          <Tool icon="text-outline" label="Text" onPress={() => onAddText()} />
          <Tool icon="happy-outline" label="Stickers" onPress={() => setPanel('stickers')} />
          <Tool icon="flag-outline" label="Mark" haptic="none" onPress={mark} disabled={!project.main.length} />
          <Tool icon="crop-outline" label="Canvas" onPress={() => setPanel('ratio')} />
          <Tool icon="download-outline" label="Save frame" haptic="none" onPress={saveFrame} disabled={!project.main.length} />
          <Tool icon="add-circle-outline" label="Add media" onPress={onAdd} />
        </ScrollView>
      </Animated.View>
    );
  }

  return (
    <View style={styles.root}>
      {hint ? (
        <Animated.View entering={reducedMotion ? undefined : FadeIn} exiting={reducedMotion ? undefined : FadeOut} style={styles.hint} pointerEvents="none">
          <Text style={styles.hintText}>{hint}</Text>
        </Animated.View>
      ) : null}
      {engine.audioOverflow > 0 ? <Text style={styles.panelHint}>Preview limit: 8 overlapping audio layers. Mute unused layers to hear this section.</Text> : null}
      {body}
      <ToolLibrary visible={toolsVisible} tools={tools} onClose={() => setToolsVisible(false)} />
    </View>
  );
}

// --- Panels ---------------------------------------------------------------------------------------

function CropPanel({
  clip,
  asset,
  onDone,
}: {
  clip: VideoClip;
  asset: { width: number; height: number } | undefined;
  onDone: () => void;
}) {
  const styles = useThemedStyles(createStyles);
  const current = clip.crop ? (clip.crop.w / clip.crop.h) * ((asset?.width ?? 1) / (asset?.height ?? 1)) : null;
  const apply = (ratio: number | null) =>
    useEditor.getState().updateClip(clip.id, {
      crop: ratio && asset ? centeredCrop(asset.width, asset.height, ratio) : undefined,
    });
  return (
    <PanelShell title="Crop" onDone={onDone}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {CROPS.map((c) => {
          const on = c.ratio === null ? current === null : current !== null && Math.abs(current - c.ratio) < 0.01;
          return <Chip key={c.label} label={c.label} on={on} onPress={() => apply(c.ratio)} />;
        })}
      </ScrollView>
      <Text style={styles.panelHint}>Pinch and drag the video in the preview to frame it.</Text>
    </PanelShell>
  );
}

function RotatePanel({ clip, onDone }: { clip: VideoClip; onDone: () => void }) {
  const styles = useThemedStyles(createStyles);
  const t = clip.transform ?? IDENTITY_TRANSFORM;
  const set = (patch: Partial<typeof t>) => useEditor.getState().updateClip(clip.id, { transform: { ...t, ...patch } });
  return (
    <PanelShell title="Rotate & position" onDone={onDone}>
      <View style={styles.btnRow}>
        <Tool
          compact
          icon="refresh-outline"
          label="Rotate 90°"
          onPress={() => set({ rotation: (Math.round(t.rotation / 90) * 90 + 90) % 360 })}
        />
        <Tool compact icon="swap-horizontal-outline" label="Flip" on={t.flip} onPress={() => set({ flip: !t.flip })} />
        <Tool compact icon="scan-outline" label="Fill" onPress={() => set({ scale: fillScale(clip), x: 0, y: 0 })} />
        <Tool
          compact
          icon="contract-outline"
          label="Reset"
          onPress={() => useEditor.getState().updateClip(clip.id, { transform: undefined })}
        />
        <Tool
          compact
          icon="expand-outline"
          label="Slow zoom"
          on={!!clip.kenBurns}
          onPress={() => useEditor.getState().updateClip(clip.id, { kenBurns: !clip.kenBurns || undefined })}
        />
      </View>
    </PanelShell>
  );
}

/** Scale that makes the (fitted) frame cover the canvas instead of fitting inside it. */
function fillScale(clip: VideoClip) {
  const p = useEditor.getState().project;
  const a = p?.assets[clip.assetId];
  if (!p || !a) return 1;
  const ratio =
    p.aspect === 'original'
      ? a.width / a.height
      : (() => {
          const [w, h] = p.aspect.split(':').map(Number);
          return w / h;
        })();
  const frame = (a.width * (clip.crop?.w ?? 1)) / (a.height * (clip.crop?.h ?? 1));
  return Math.max(frame / ratio, ratio / frame);
}

function FiltersPanel({ clip, onDone }: { clip: VideoClip; onDone: () => void }) {
  const { colors } = useAppTheme();
  const styles = useThemedStyles(createStyles);
  const c = clip.color ?? DEFAULT_COLOR;
  const set = (patch: Partial<ColorSettings>, coalesce?: string) =>
    useEditor.getState().updateClip(clip.id, { color: { ...c, ...patch } }, coalesce);
  return (
    <PanelShell title="Filters" onDone={onDone}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
        {FILTERS.map((f) => (
          <Pressable
            key={f.id}
            active={c.filter === f.id}
            accessibilityRole="button"
            accessibilityLabel={`${f.label} filter`}
            accessibilityState={{ selected: c.filter === f.id }}
            onPress={() => set({ filter: f.id, intensity: c.intensity || 1 })}
            style={styles.filter}>
            <View style={[styles.swatch, { backgroundColor: f.swatch }, c.filter === f.id && styles.swatchOn]}>
              {f.id === 'none' ? <Ionicons name="ban-outline" size={18} color={colors.textDim} /> : null}
            </View>
            <Text style={[styles.filterLabel, c.filter === f.id && { color: colors.accentText }]}>{f.label}</Text>
          </Pressable>
        ))}
      </ScrollView>
      {c.filter !== 'none' ? (
        <InlineSlider
          label="Intensity"
          value={c.intensity}
          format={pct}
          toNorm={unitToNorm}
          fromNorm={normToUnit}
          onCommit={(intensity) => set({ intensity }, 'intensity')}
        />
      ) : null}
      <ApplyToAll label="Apply look to all clips" patch={{ color: clip.color }} />
    </PanelShell>
  );
}

function AdjustPanel({ clip, onDone }: { clip: VideoClip; onDone: () => void }) {
  const { colors } = useAppTheme();
  const styles = useThemedStyles(createStyles);
  const c = clip.color ?? DEFAULT_COLOR;
  const [param, setParam] = useState<(typeof ADJUSTMENTS)[number]['key']>('brightness');
  const set = (patch: Partial<ColorSettings>) =>
    useEditor.getState().updateClip(clip.id, { color: { ...c, ...patch } }, `adjust-${param}`);
  return (
    <PanelShell title="Adjust" onDone={onDone}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {ADJUSTMENTS.map((a) => (
          <Chip key={a.key} label={a.label} on={param === a.key} onPress={() => setParam(a.key)}>
            <Ionicons name={a.icon} size={15} color={param === a.key ? colors.accentInk : colors.textDim} />
          </Chip>
        ))}
      </ScrollView>
      <InlineSlider
        key={param}
        label={ADJUSTMENTS.find((a) => a.key === param)!.label}
        value={c[param]}
        format={(v) => (v > 0 ? `+${pct(v)}` : pct(v))}
        toNorm={signedToNorm}
        fromNorm={normToSigned}
        onCommit={(v) => set({ [param]: v })}
      />
      <ApplyToAll label="Apply look to all clips" patch={{ color: clip.color }} />
    </PanelShell>
  );
}

function TextPanel({ text, onDone }: { text: TextOverlay; onDone: () => void }) {
  const { colors, isDark } = useAppTheme();
  const styles = useThemedStyles(createStyles);
  const update = (patch: Partial<TextOverlay>, coalesce?: string) =>
    useEditor.getState().updateText(text.id, patch, coalesce);
  return (
    <PanelShell title="Text" onDone={onDone}>
      <TextInput
        // Controlled by the project itself so undo/redo shows up here too.
        value={text.text === DEFAULT_TEXT ? '' : text.text}
        onChangeText={(v) => update({ text: v || DEFAULT_TEXT }, 'typing')}
        autoFocus={text.text === DEFAULT_TEXT}
        selectTextOnFocus
        placeholder="Enter text"
        placeholderTextColor={colors.textFaint}
        style={styles.input}
        selectionColor={colors.accent}
        keyboardAppearance={isDark ? 'dark' : 'light'}
        multiline
        maxLength={300}
      />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {FONTS.map((f) => (
          <Pressable
            key={f.id}
            active={text.font === f.id}
            accessibilityRole="button"
            accessibilityLabel={`${f.label} font`}
            accessibilityState={{ selected: text.font === f.id }}
            onPress={() => update({ font: f.id })}
            style={[styles.chip, text.font === f.id && styles.chipOn]}>
            <Text style={[styles.chipText, fontStyle(f.id), text.font === f.id && { color: colors.accentInk }]}>
              {f.label}
            </Text>
          </Pressable>
        ))}
        <Pressable active={text.box} accessibilityRole="switch" accessibilityLabel="Text background box" accessibilityState={{ checked: text.box }} onPress={() => update({ box: !text.box })} style={[styles.chip, text.box && styles.chipOn]}>
          <Ionicons name="square" size={14} color={text.box ? colors.accentInk : colors.textDim} />
          <Text style={[styles.chipText, text.box && { color: colors.accentInk }]}>Box</Text>
        </Pressable>
      </ScrollView>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.colorRow}>
        {TEXT_COLORS.map((c) => (
          <Pressable
            key={c}
            active={text.color === c}
            hitSlop={4}
            onPress={() => update({ color: c })}
            accessibilityRole="button"
            accessibilityState={{ selected: text.color === c }}
            accessibilityLabel={`Color ${c}`}
            style={[styles.color, { backgroundColor: c }, text.color === c && styles.colorOn]}
          />
        ))}
      </ScrollView>
      <View style={styles.presetRow}>
        {([{ label: 'Top', y: .18 }, { label: 'Center', y: .5 }, { label: 'Bottom', y: .82 }] as const).map(position => <Chip key={position.label} label={position.label} on={Math.abs(text.y - position.y) < .001 && Math.abs(text.x - .5) < .001} onPress={() => update({ x: .5, y: position.y, rotation: 0 })} />)}
      </View>
      <InlineSlider label="Size" value={text.size} format={value => `${Math.round(value * 100)}%`} toNorm={sizeToNorm} fromNorm={normToSize} onCommit={size => update({ size }, 'text-size')}/>
      <InlineSlider
        label="Opacity"
        value={text.opacity}
        format={pct}
        toNorm={unitToNorm}
        fromNorm={normToUnit}
        onCommit={(opacity) => update({ opacity: Math.max(0.05, opacity) }, 'opacity')}
      />
    </PanelShell>
  );
}

function FadePanel({ item, isClip, onDone }: { item: VideoClip | AudioClip; isClip: boolean; onDone: () => void }) {
  const styles = useThemedStyles(createStyles);
  const set = (patch: { fadeIn?: number; fadeOut?: number }, key: string) =>
    isClip
      ? useEditor.getState().updateClip(item.id, patch, key)
      : useEditor.getState().updateAudio(item.id, patch, key);
  return (
    <PanelShell title="Fade" onDone={onDone}>
      <InlineSlider
        label="Fade in"
        value={Math.min(item.fadeIn ?? 0, MAX_FADE)}
        format={seconds}
        toNorm={fadeToNorm}
        fromNorm={normToFade}
        onCommit={(fadeIn) => set({ fadeIn }, 'fade-in')}
      />
      <InlineSlider
        label="Fade out"
        value={Math.min(item.fadeOut ?? 0, MAX_FADE)}
        format={seconds}
        toNorm={fadeToNorm}
        fromNorm={normToFade}
        onCommit={(fadeOut) => set({ fadeOut }, 'fade-out')}
      />
      {isClip ? (
        <ApplyToAll
          label="Fade every cut"
          patch={{ fadeIn: item.fadeIn, fadeOut: item.fadeOut }}
          disabled={!item.fadeIn && !item.fadeOut}
        />
      ) : null}
      <Text style={styles.panelHint}>
        {isClip ? 'The picture fades from / to black and the clip sound fades with it.' : 'Fades the sound in / out.'}
      </Text>
    </PanelShell>
  );
}

function AnimatePanel({ text, engine, onDone }: { text: TextOverlay; engine: PlaybackEngine; onDone: () => void }) {
  const { colors } = useAppTheme();
  const styles = useThemedStyles(createStyles);
  const stopTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(stopTimer.current), []);
  const pick = (phase: 'animIn' | 'animOut', kind: TextAnim) => {
    useEditor.getState().updateText(text.id, { [phase]: kind });
    if (kind === 'none') return;
    // Play just the animated part once so the choice is visible right away.
    const total = totalDuration(useEditor.getState().project?.main ?? []);
    const span = textAnimDuration(text) + 0.6;
    const from = phase === 'animIn' ? text.start : Math.max(text.start, text.end - span);
    const to = Math.min(phase === 'animIn' ? Math.min(text.end, text.start + span) : text.end, total);
    if (to - from < 0.05) return;
    clearTimeout(stopTimer.current);
    engine.pause();
    engine.time.set(from);
    engine.seek(from);
    engine.play();
    stopTimer.current = setTimeout(engine.pause, (to - from) * 1000);
  };
  const row = (phase: 'animIn' | 'animOut', label: string) => (
    <View style={styles.animRow}>
      <Text style={styles.inlineLabel}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {ANIMS.map((a) => {
          const on = (text[phase] ?? 'none') === a.id;
          return (
            <Chip key={a.id} label={a.label} on={on} onPress={() => pick(phase, a.id)}>
              <Ionicons name={a.icon} size={15} color={on ? colors.accentInk : colors.textDim} />
            </Chip>
          );
        })}
      </ScrollView>
    </View>
  );
  return (
    <PanelShell title="Animate" onDone={onDone}>
      {row('animIn', 'In')}
      {row('animOut', 'Out')}
    </PanelShell>
  );
}

/**
 * Records the microphone while the video plays (muted) from the playhead; the take lands on the audio lane where
 * recording started. Stops when the video ends, on pause, or with the button.
 */
let voiceoverLease = 0;
function VoiceoverPanel({ engine, onDone }: { engine: PlaybackEngine; onDone: () => void }) {
  const styles = useThemedStyles(createStyles);
  // Retain this native recorder until its asynchronous save finishes, even if the panel unmounts.
  const recorderRef = useRef<AudioRecorder | null>(null);
  const starting = useRef<Promise<void> | null>(null);
  const lease = useRef(0);
  const [state, setState] = useState<'idle' | 'starting' | 'recording' | 'saving' | 'unsaved'>('idle');
  const startAt = useRef(0);
  const [elapsed, setElapsed] = useState(0);

  const mounted = useRef(true);
  const session = useRef(0);
  const phase = useRef<'idle' | 'starting' | 'recording' | 'saving' | 'unsaved'>('idle');
  const projectId = useRef<string | undefined>(undefined);
  const stopping = useRef<Promise<void> | null>(null);
  const takeUri = useRef<string | null>(null);
  const stop = useCallback((): Promise<void> => {
    if (stopping.current) return stopping.current;
    if (phase.current !== 'recording' && phase.current !== 'unsaved') return Promise.resolve();
    const recorder = recorderRef.current;
    if (!recorder) return Promise.resolve();
    phase.current = 'saving';
    if (mounted.current) setState('saving');
    const destination = projectId.current, at = startAt.current;
    engine.pause(); engine.setMuted(false);
    const operation = (async () => {
      let saved = false;
      try {
        if (!takeUri.current) { await recorder.stop(); takeUri.current = recorder.uri; }
        if (lease.current === voiceoverLease) await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
        if (!takeUri.current) throw new Error('Nothing was recorded.');
        const p = useEditor.getState().project;
        if (!p || p.id !== destination) throw new Error('Reopen the recording project to finish saving this take.');
        const n = p.audio.filter(a => p.assets[a.assetId]?.name.startsWith('Voiceover')).length + 1;
        const take = new File(takeUri.current);
        const asset = await importAudio(take, `Voiceover ${n}.m4a`);
        if (useEditor.getState().project?.id !== destination) throw new Error('The project changed before the take was saved.');
        useEditor.getState().addAudio(asset, at);
        saved = true; takeUri.current = null;
        try { take.delete(); } catch { /* The imported media is durable; an old cache file can expire normally. */ }
        if (mounted.current) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } finally {
        if (lease.current === voiceoverLease) void setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
        phase.current = saved ? 'idle' : 'unsaved'; stopping.current = null;
        if (mounted.current) setState(saved ? 'idle' : 'unsaved');
      }
    })();
    stopping.current = operation;
    return operation;
  }, [engine]);
  const stopRef = useRef(stop);
  useEffect(() => { stopRef.current = stop; }, [stop]);
  useEffect(() => {
    mounted.current = true;
    const finish = async () => {
      if (phase.current === 'starting') session.current += 1;
      await starting.current;
      await stopRef.current();
      if (phase.current === 'starting') { phase.current = 'idle'; if (mounted.current) setState('idle'); }
    };
    const unregister = registerVoiceoverSession({ pending: () => phase.current !== 'idle', finish: async () => {
      await finish();
      if (!mounted.current) { recorderRef.current?.release(); recorderRef.current = null; unregister(); }
    } });
    return () => {
      mounted.current = false;
      void (async () => {
        await finish();
        recorderRef.current?.release();
        recorderRef.current = null;
        unregister();
      })().catch((error) => { Alert.alert('Voiceover still needs saving', error instanceof Error ? error.message : String(error)); });
    };
  }, []);

  const startRecording = async () => {
    if (phase.current !== 'idle') return;
    phase.current = 'starting'; setState('starting');
    const request = ++session.current;
    const currentLease = ++voiceoverLease;
    lease.current = currentLease;
    const destination = useEditor.getState().project?.id;
    projectId.current = destination;
    const valid = () => mounted.current && session.current === request && useEditor.getState().project?.id === destination;
    try {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!valid()) return;
      if (!perm.granted) {
        phase.current = 'idle'; setState('idle');
        Alert.alert('Microphone access needed', 'Allow microphone access in Settings to record a voiceover.'); return;
      }
      engine.pause();
      let at = engine.currentTime();
      if (at >= engine.duration - 0.2) at = 0;
      startAt.current = at;
      engine.time.set(at); engine.seek(at);
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      if (!valid()) { if (currentLease === voiceoverLease) await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }); return; }
      takeUri.current = null;
      const options = { ...RecordingPresets.HIGH_QUALITY, directory: 'document' as const };
      // SDK57 exposes this writable native SharedObject constructor; retain it through asynchronous save.
      // eslint-disable-next-line import/namespace
      const recorder = recorderRef.current ?? new AudioModule.AudioRecorder({ ...options, isMeteringEnabled: false, ...(Platform.OS === 'ios' ? options.ios : Platform.OS === 'android' ? options.android : options.web) });
      recorderRef.current = recorder;
      await recorder.prepareToRecordAsync(options);
      if (!valid()) { await recorder.stop().catch(() => {}); if (currentLease === voiceoverLease) await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }); return; }
      engine.setMuted(true); recorder.record(); engine.play();
      phase.current = 'recording'; setElapsed(0); setState('recording');
    } catch (e) {
      phase.current = 'idle';
      if (currentLease === voiceoverLease) { engine.setMuted(false); void setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {}); }
      if (valid()) { setState('idle'); Alert.alert('Could not start recording', e instanceof Error ? e.message : String(e)); }
    }
  };

  const start = () => {
    if (phase.current !== 'idle') return;
    const operation = startRecording();
    starting.current = operation;
    void operation.finally(() => { if (starting.current === operation) starting.current = null; });
  };

  const reportSaveError = (error: unknown) => Alert.alert('Voiceover still needs saving', `${error instanceof Error ? error.message : String(error)} Your take is kept; tap the record button to retry saving.`);

  // Stop with the video: when it reaches the end or the user pauses it.
  const recording = state === 'recording';
  useEffect(() => {
    if (recording && !engine.playing) queueMicrotask(() => void stop().catch((error) => Alert.alert('Voiceover still needs saving', error instanceof Error ? error.message : String(error))));
  }, [recording, engine.playing, stop]);
  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setElapsed(engine.currentTime() - startAt.current), 200);
    return () => clearInterval(t);
  }, [recording, engine]);
  const busy = state === 'starting' || state === 'saving';
  return (
    <PanelShell title="Voiceover" onDone={() => { void stop().then(onDone).catch(reportSaveError); }}>
      <View style={styles.recordRow}>
        <Pressable
          onPress={recording || state === 'unsaved' ? () => { void stop().catch(reportSaveError); } : start}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={recording ? 'Stop recording' : state === 'unsaved' ? 'Retry saving voiceover' : 'Start recording'}
          style={({ pressed }) => [styles.recordBtn, (pressed || busy) && { opacity: 0.6 }]}>
          <View style={recording ? styles.recordStop : styles.recordDot} />
        </Pressable>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.recordTitle}>
            {recording ? `Recording  ${elapsed.toFixed(1)}s` : state === 'saving' ? 'Saving…' : state === 'unsaved' ? 'Tap to retry saving' : 'Tap to record'}
          </Text>
          <Text style={styles.panelHint}>
            {recording
              ? 'The video plays muted. Tap stop or pause when you are done.'
              : 'Records from the playhead while the video plays. Headphones keep the room quiet.'}
          </Text>
        </View>
      </View>
    </PanelShell>
  );
}

function StylePanel({ text, onDone }: { text: TextOverlay; onDone: () => void }) {
  const styles = useThemedStyles(createStyles);
  return (
    <PanelShell title="Text style" onDone={onDone}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
        {TEXT_STYLES.map(({ label, style }) => (
          <Pressable
            key={label}
            onPress={() => useEditor.getState().updateText(text.id, style)}
            accessibilityRole="button"
            accessibilityLabel={`${label} style`}
            style={styles.filter}>
            <View style={styles.styleCard}>
              <Text
                style={[
                  fontStyle(style.font ?? 'sans'),
                  { color: style.color, fontSize: 18, transform: [{ rotate: `${style.rotation ?? 0}deg` }] },
                  style.box ? styles.styleBox : styles.styleShadow,
                ]}>
                Aa
              </Text>
            </View>
            <Text style={styles.filterLabel}>{label}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <Text style={styles.panelHint}>Sets font, color, size, position and animation in one tap. Undo restores the old look.</Text>
    </PanelShell>
  );
}

function TransitionPanel({ clip, isFirst, onDone }: { clip: VideoClip; isFirst: boolean; onDone: () => void }) {
  const styles = useThemedStyles(createStyles);
  const preset = (duration: number | 'dip') => useEditor.getState().edit(project => applyTransitionPreset(project, clip.id, duration));
  return (
    <PanelShell title="Transition" onDone={onDone}>
      {isFirst ? (
        <Text style={styles.panelHint}>The first clip has nothing to fade from. Select a later clip.</Text>
      ) : (
        <>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {([{ label: 'Cut', duration: 0 }, { label: 'Quick dissolve', duration: .2 }, { label: 'Soft dissolve', duration: .5 }, { label: 'Slow dissolve', duration: 1.2 }] as const).map(item => <Chip key={item.label} label={item.label} on={Math.abs((clip.transition ?? 0) - item.duration) < .001 && !clip.fadeIn} onPress={() => preset(item.duration)}/>)}
          <Chip label="Dip to black" on={!clip.transition && clip.fadeIn === .3} onPress={() => preset('dip')}/>
        </ScrollView>
        <InlineSlider
          label="Crossfade"
          value={Math.min(clip.transition ?? 0, 2)}
          format={seconds}
          toNorm={xfadeToNorm}
          fromNorm={normToXfade}
          onCommit={(v) => useEditor.getState().updateClip(clip.id, { transition: v || undefined }, 'transition')}
        />
        </>
      )}
      <ApplyToAll label="Crossfade every cut" patch={{ transition: clip.transition }} disabled={!clip.transition} />
      <Text style={styles.panelHint}>Dissolves from the previous clip into this one, centered on the cut.</Text>
    </PanelShell>
  );
}

/** Copies `patch` onto every clip (one undo step) and confirms with a haptic. */
function ApplyToAll({ label, patch, disabled }: { label: string; patch: Partial<VideoClip>; disabled?: boolean }) {
  const { colors } = useAppTheme();
  const styles = useThemedStyles(createStyles);
  const count = useEditor((s) => s.project?.main.length ?? 0);
  if (count < 2) return null;
  return (
    <Pressable
      haptic="none"
      onPress={() => {
        useEditor.getState().updateAllClips(patch);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => [styles.applyAll, (pressed || disabled) && { opacity: disabled ? 0.35 : 0.6 }]}>
      <Ionicons name="layers-outline" size={16} color={colors.text} />
      <Text style={styles.applyAllText}>{label}</Text>
    </Pressable>
  );
}

// --- Building blocks ------------------------------------------------------------------------------

function Tool({
  icon,
  label,
  onPress,
  disabled,
  on,
  featured = false,
  compact = false,
  haptic = 'selection',
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  /** Toggle state, for tools that switch something on and off. */
  on?: boolean;
  featured?: boolean;
  compact?: boolean;
  haptic?: 'selection' | 'light' | 'none';
}) {
  const { colors } = useAppTheme();
  const styles = useThemedStyles(createStyles);
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      active={on}
      motionScale={0.94}
      haptic={haptic}
      accessibilityRole={on === undefined ? 'button' : 'switch'}
      accessibilityState={{ disabled: !!disabled, ...(on === undefined ? {} : { checked: on }) }}
      accessibilityLabel={label}
      style={[styles.tool, compact && styles.toolCompact, disabled && { opacity: 0.35 }]}>
      <View style={[styles.toolTile, featured && styles.toolTileFeatured, on && styles.toolTileOn]}>
        <Ionicons name={icon} size={24} color={on || featured ? colors.accentText : label === 'Delete' ? colors.danger : colors.text} />
        {on ? <View style={styles.toolIndicator} /> : null}
      </View>
      <Text numberOfLines={1} style={[styles.toolLabel, (on || featured) && styles.toolLabelOn]}>{label}</Text>
    </Pressable>
  );
}

function Chip({
  label,
  on,
  onPress,
  children,
}: {
  label: string;
  on: boolean;
  onPress: () => void;
  children?: ReactNode;
}) {
  const { colors } = useAppTheme();
  const styles = useThemedStyles(createStyles);
  return (
    <Pressable
      onPress={onPress}
      active={on}
      style={[styles.chip, on && styles.chipOn]}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      accessibilityLabel={label}>
      {children}
      <Text style={[styles.chipText, on && { color: colors.accentInk }]}>{label}</Text>
    </Pressable>
  );
}

function PanelShell({ title, onDone, children }: { title: string; onDone: () => void; children: ReactNode }) {
  const reducedMotion = useMotionPreferences();
  const { colors } = useAppTheme();
  const styles = useThemedStyles(createStyles);
  return (
    <Animated.View entering={reducedMotion ? undefined : FadeInDown.duration(180)} style={styles.panel}>
      <View style={styles.panelHeader}>
        <Text style={styles.panelTitle}>{title}</Text>
        <Pressable onPress={onDone} accessibilityLabel={`Done editing ${title.toLowerCase()}`} accessibilityRole="button" style={styles.done}>
          <Ionicons name="checkmark" size={22} color={colors.accentInk} />
        </Pressable>
      </View>
      {children}
    </Animated.View>
  );
}

/** A labelled slider that shows its live value while dragging and commits on release. */
function InlineSlider({
  label,
  value,
  format,
  toNorm,
  fromNorm,
  onCommit,
}: {
  label: string;
  value: number;
  format: (v: number) => string;
  toNorm: (v: number) => number;
  fromNorm: (n: number) => number;
  onCommit: (v: number) => void;
}) {
  const styles = useThemedStyles(createStyles);
  const [live, setLive] = useState<number | null>(null);
  const commit = useCallback(
    (v: number) => {
      setLive(null);
      if (v !== value) onCommit(v);
    },
    [value, onCommit],
  );
  return (
    <View style={styles.inlineSlider}>
      <Text style={styles.inlineLabel}>{label}</Text>
      <View style={{ flex: 1 }}>
        <Slider value={value} toNorm={toNorm} fromNorm={fromNorm} onChange={setLive} onCommit={commit} />
      </View>
      <Text style={styles.inlineValue}>{format(live ?? value)}</Text>
    </View>
  );
}

function ValuePanel({
  title,
  value,
  format,
  toNorm,
  fromNorm,
  marks,
  onCommit,
  onDone,
  extra,
  below,
}: {
  title: string;
  value: number;
  format: (v: number) => string;
  toNorm: (v: number) => number;
  fromNorm: (n: number) => number;
  marks: string[];
  onCommit: (v: number) => void;
  onDone: () => void;
  extra?: ReactNode;
  below?: ReactNode;
}) {
  const styles = useThemedStyles(createStyles);
  // Value while dragging; null = show the committed value.
  const [live, setLive] = useState<number | null>(null);
  const commit = useCallback(
    (v: number) => {
      setLive(null);
      if (v !== value) onCommit(v);
    },
    [value, onCommit],
  );
  return (
    <PanelShell title={`${title}  ·  ${format(live ?? value)}`} onDone={onDone}>
      <View style={styles.sliderRow}>
        {extra}
        <View style={{ flex: 1 }}>
          <Slider value={value} toNorm={toNorm} fromNorm={fromNorm} onChange={setLive} onCommit={commit} />
          <View style={styles.marks}>
            {marks.map((m) => (
              <Text key={m} style={styles.mark}>
                {m}
              </Text>
            ))}
          </View>
        </View>
      </View>
      {below}
    </PanelShell>
  );
}

function RatioGlyph({ ratio, on }: { ratio: AspectRatio; on: boolean }) {
  const { colors } = useAppTheme();
  const [w, h] = ratio === 'original' ? [14, 14] : ratio.split(':').map(Number);
  const scale = 16 / Math.max(w, h);
  return (
    <View
      style={{
        width: w * scale,
        height: h * scale,
        borderWidth: 1.5,
        borderRadius: 2,
        borderStyle: ratio === 'original' ? 'dashed' : 'solid',
        borderColor: on ? colors.accentInk : colors.textDim,
      }}
    />
  );
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  root: {
    flexShrink: 1,
    minHeight: 88,
    justifyContent: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  toolsRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4 },
  tools: { paddingHorizontal: 4, gap: 1 },
  tool: { width: 76, minHeight: 84, alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 8 },
  toolCompact: { width: 64 },
  toolTile: { width: 43, height: 43, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.borderStrong, borderTopColor: colors.borderStrong },
  toolTileFeatured: { backgroundColor: colors.accentSoft, borderColor: '#766539', borderTopColor: '#AF9750' },
  toolTileOn: { backgroundColor: colors.accentSoft, borderColor: colors.selection },
  toolIndicator: { position: 'absolute', bottom: 3, width: 12, height: 2, borderRadius: 1, backgroundColor: colors.accent },
  toolLabel: { ...font.small, color: colors.textDim, fontSize: 11, letterSpacing: .1 },
  toolLabelOn: { color: colors.accentText },
  btnRow: { flexDirection: 'row', justifyContent: 'space-around' },
  back: {
    width: 44,
    height: 44,
    marginLeft: 8,
    borderRadius: radius.md,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  panel: { paddingHorizontal: 16, paddingVertical: 10, gap: 4, backgroundColor: colors.surface },
  panelHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  panelTitle: { ...font.h2, color: colors.text, fontSize: 15 },
  panelHint: { ...font.small, color: colors.textFaint, marginTop: 4 },
  done: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sliderRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  marks: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 2 },
  mark: { ...font.small, fontSize: 10, color: colors.textFaint },
  squareBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chips: { gap: 8, paddingVertical: 6 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minHeight: 44,
    borderRadius: radius.md,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.selection },
  dot: { width: 16, height: 16, borderRadius: 8, borderWidth: 1, borderColor: colors.border },
  chipText: { ...font.body, color: colors.text, fontSize: 14 },
  filterRow: { gap: 14, paddingVertical: 6 },
  filter: { alignItems: 'center', gap: 6, minWidth: 52, minHeight: 76 },
  swatch: { width: 52, height: 52, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  swatchOn: { borderWidth: 2.5, borderColor: colors.selection },
  filterLabel: { ...font.small, color: colors.textDim, fontSize: 11 },
  inlineSlider: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  inlineLabel: { ...font.small, color: colors.textDim, width: 72 },
  inlineValue: { ...font.mono, color: colors.text, width: 40, textAlign: 'right' },
  input: {
    ...font.body,
    color: colors.text,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    maxHeight: 84,
  },
  colorRow: { gap: 10, paddingVertical: 6 },
  color: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: colors.border },
  colorOn: { borderWidth: 3, borderColor: colors.selection },
  presetRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  recordRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 4 },
  recordBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 3,
    borderColor: colors.text,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordDot: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.danger },
  recordStop: { width: 22, height: 22, borderRadius: 4, backgroundColor: colors.danger },
  recordTitle: { ...font.body, color: colors.text, fontWeight: '600' },
  animRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  styleCard: {
    width: 64,
    height: 52,
    borderRadius: radius.md,
    backgroundColor: colors.surface3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  styleBox: { backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 6, borderRadius: 4, overflow: 'hidden' },
  styleShadow: { textShadowColor: 'rgba(0,0,0,0.55)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 },
  stickerScroll: { maxHeight: 132 },
  stickers: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, paddingVertical: 4 },
  sticker: { width: 46, height: 42, alignItems: 'center', justifyContent: 'center' },
  stickerText: { fontSize: 30 },
  applyAll: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    marginTop: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minHeight: 44,
    borderRadius: radius.md,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  applyAllText: { ...font.small, color: colors.text },
  hint: {
    position: 'absolute',
    top: -44,
    alignSelf: 'center',
    backgroundColor: colors.surface3,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
    zIndex: 10,
  },
  hintText: { ...font.small, color: colors.text },
});
