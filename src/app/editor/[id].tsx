import { StudioIcon as Ionicons } from '@/ui/StudioIcon';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, { useAnimatedProps } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { canvasRatio, locate, totalDuration } from '@/core/timeline';
import type { AudioClip, ID, MediaAsset, VideoClip } from '@/core/types';
import { ExportFlow } from '@/editor/ExportFlow';
import { Preview } from '@/editor/Preview';
import { Timeline } from '@/editor/Timeline';
import { Toolbar, type TextStyle } from '@/editor/Toolbar';
import { usePlaybackEngine, type PlaybackEngine } from '@/playback/engine';
import { finishVoiceovers, hasPendingVoiceover } from '@/playback/voiceover-session';
import { requestFilmStrip } from '@/playback/thumbnails';
import { useEditor } from '@/state/editor';
import { importAudio, pickAudio } from '@/storage/media';
import { gcMedia, loadProject, pruneAssets, saveProject } from '@/storage/projects';
import { MotionPressable as Pressable } from '@/ui/MotionPressable';
import { PromptDialog } from '@/ui/PromptDialog';
import { font, radius, useAppTheme, useThemedStyles, type AppColors } from '@/ui/theme';
import { useImport } from '@/ui/useImport';

const AUTOSAVE_MS = 400;
const NO_CLIPS: VideoClip[] = [];
const NO_ASSETS: Record<ID, MediaAsset> = {};
const NO_AUDIO: AudioClip[] = [];

export default function EditorScreen() {
  const { colors } = useAppTheme();
  const styles = useThemedStyles(makeStyles);
  const { id } = useLocalSearchParams<{ id: string }>();
  const project = useEditor((s) => s.project);
  const [failed, setFailed] = useState(false);
  const navigation = useNavigation();

  // A native recorder outlives its panel while saving. Complete every pending take before leaving this project.
  useEffect(() => {
    let leaving = false;
    return navigation.addListener('beforeRemove', (event) => {
      if (hasPendingVoiceover()) {
        event.preventDefault();
        if (!leaving) {
          leaving = true;
          void finishVoiceovers().then(() => navigation.dispatch(event.data.action)).catch((error) => {
            Alert.alert('Could not finish voiceover', String(error));
          }).finally(() => { leaving = false; });
        }
        return;
      }
      const p = useEditor.getState().project;
      if (p && p.id === id) saveProject(pruneAssets(p));
    });
  }, [navigation, id]);

  // Load the project, and on leave: final save (with unused media dropped) + media GC.
  useEffect(() => {
    let alive = true;
    loadProject(id)
      .then((p) => {
        if (!alive) return;
        if (p) useEditor.getState().open(p);
        else setFailed(true);
      })
      .catch((e) => {
        console.warn(e);
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
      const p = useEditor.getState().project;
      if (p && p.id === id) {
        try {
          saveProject(pruneAssets(p));
        } catch (e) {
          console.warn('Final save failed', e);
        }
        void gcMedia().catch((e) => console.warn('Media cleanup failed', e));
      }
      useEditor.getState().close();
    };
  }, [id]);

  // Autosave: debounce edits, and flush immediately when the app goes to the background.
  useEffect(() => {
    if (!project) return;
    const save = () => {
      try {
        saveProject(project);
      } catch (e) {
        Alert.alert('Could not save project', e instanceof Error ? e.message : String(e));
      }
    };
    const timer = setTimeout(save, AUTOSAVE_MS);
    const sub = AppState.addEventListener('change', (state) => state !== 'active' && save());
    return () => {
      clearTimeout(timer);
      sub.remove();
    };
  }, [project]);

  useEffect(() => {
    if (project)
      Object.values(project.assets)
        .filter((a) => a.kind === 'video')
        .forEach(requestFilmStrip);
  }, [project?.assets]); // eslint-disable-line react-hooks/exhaustive-deps

  const engine = usePlaybackEngine(project?.main ?? NO_CLIPS, project?.assets ?? NO_ASSETS, project?.audio ?? NO_AUDIO);

  if (failed) {
    return (
      <SafeAreaView style={[styles.screen, styles.center]}>
        <Text style={styles.errorText}>This project could not be opened.</Text>
        <Pressable onPress={() => router.back()} style={styles.errorBtn} accessibilityRole="button">
          <Text style={styles.errorBtnText}>Back to projects</Text>
        </Pressable>
      </SafeAreaView>
    );
  }
  if (!project || project.id !== id) {
    return (
      <View style={[styles.screen, styles.center]}>
        <ActivityIndicator color={colors.textDim} />
      </View>
    );
  }
  return <Workspace engine={engine} />;
}

function Workspace({ engine }: { engine: PlaybackEngine }) {
  const { colors } = useAppTheme();
  const styles = useThemedStyles(makeStyles);
  const project = useEditor((s) => s.project);
  const panel = useEditor((s) => s.panel);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const [renaming, setRenaming] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [keyboard, setKeyboard] = useState(false);
  const importer = useImport();
  const browsingLibrary = panel === 'effects' || panel === 'templates' || panel === 'sounds' || panel === 'stickers' || panel === 'audioTools';

  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () =>
      setKeyboard(true),
    );
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () =>
      setKeyboard(false),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  if (!project) return null;

  const addMedia = async () => {
    engine.pause();
    const assets = await importer.run();
    const current = useEditor.getState().project;
    if (!assets.length || !current) return;
    const { main } = current;
    // Insert after the clip under the playhead (CapCut-style), or at the end.
    const hit = locate(main, engine.currentTime());
    useEditor.getState().addClips(assets, hit ? hit.index + 1 : main.length);
  };

  /** Adds a text at the playhead; a `style` (preset or sticker) is placed as-is, a plain text opens the editor. */
  const addText = (style?: TextStyle) => {
    engine.pause();
    const { project: p, addText: add, setPanel } = useEditor.getState();
    if (!p) return;
    const total = totalDuration(p.main);
    const dur = total > 0 ? Math.min(3, total) : 3;
    // Start at the playhead, but keep the whole default duration inside the video.
    const at = total > 0 ? Math.max(0, Math.min(engine.currentTime(), total - dur)) : 0;
    add(at, dur, style);
    if (!style) setPanel('text');
  };

  const addAudio = async () => {
    engine.pause();
    try {
      const file = await pickAudio();
      if (!file) return;
      const asset = await importAudio(file);
      const p = useEditor.getState().project;
      if (!p) return;
      const t = engine.currentTime();
      useEditor.getState().addAudio(asset, t >= totalDuration(p.main) - 0.5 ? 0 : t);
    } catch (e) {
      Alert.alert('Could not add audio', e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} hitSlop={6} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Close editor">
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </Pressable>
        <Pressable onPress={() => setRenaming(true)} style={styles.titleWrap} accessibilityRole="button" accessibilityLabel={`Rename project ${project.name}`}>
          <Text style={styles.titleLabel}>PROJECT</Text>
          <View style={styles.titleRow}>
            <Text style={styles.title} numberOfLines={1}>{project.name}</Text>
            <Ionicons name="pencil" size={11} color={colors.textDim} />
          </View>
        </Pressable>
        <Pressable
          onPress={() => {
            engine.pause();
            setExporting(true);
          }}
          disabled={!project.main.length}
          haptic="light"
          style={[styles.exportBtn, !project.main.length && { opacity: 0.4 }]}
          accessibilityRole="button"
          accessibilityLabel="Export video">
          <Ionicons name="arrow-up" size={17} color={colors.accentInk} />
          <Text style={styles.exportText}>Export</Text>
        </Pressable>
      </View>

      <KeyboardAvoidingView style={styles.body} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Preview engine={engine} ratio={canvasRatio(project)} empty={!project.main.length} />

        {keyboard ? null : (
          <View style={styles.controls}>
            <View style={styles.timeRow}>
              <TimeText engine={engine} />
              <Text style={styles.timeTotal}> / {fmt(engine.duration)}</Text>
            </View>
            <Pressable
              onPress={engine.toggle}
              disabled={!project.main.length}
              active={engine.playing}
              haptic="light"
              style={[styles.play, engine.playing && styles.playing, !project.main.length && { opacity: 0.4 }]}
              accessibilityRole="button"
              accessibilityLabel={engine.playing ? 'Pause' : 'Play'}>
              <Ionicons name={engine.playing ? 'pause' : 'play'} size={21} color={engine.playing ? colors.accentInk : colors.accentText} />
            </Pressable>
            <View style={styles.history}>
              <Pressable onPress={useEditor.getState().undo} disabled={!canUndo} style={styles.historyBtn} accessibilityRole="button" accessibilityLabel="Undo">
                <Ionicons name="arrow-undo" size={20} color={canUndo ? colors.text : colors.textFaint} />
              </Pressable>
              <Pressable onPress={useEditor.getState().redo} disabled={!canRedo} style={styles.historyBtn} accessibilityRole="button" accessibilityLabel="Redo">
                <Ionicons name="arrow-redo" size={20} color={canRedo ? colors.text : colors.textFaint} />
              </Pressable>
            </View>
          </View>
        )}

        {/* While typing, the keyboard needs the room: keep the preview and the text panel only. */}
        {keyboard || browsingLibrary ? null : <Timeline engine={engine} onAdd={addMedia} onAddText={addText} onAddAudio={addAudio} />}
        <Toolbar engine={engine} onAdd={addMedia} onAddText={addText} onAddAudio={addAudio} />
      </KeyboardAvoidingView>

      <PromptDialog
        visible={renaming}
        title="Rename project"
        initialValue={project.name}
        onCancel={() => setRenaming(false)}
        onConfirm={(name) => {
          useEditor.getState().edit((p) => ({ ...p, name }));
          setRenaming(false);
        }}
      />
      {importer.overlay}
      <ExportFlow project={project} visible={exporting} onClose={() => setExporting(false)} />
    </SafeAreaView>
  );
}

function fmt(s: number) {
  'worklet';
  const t = Math.max(0, s);
  const m = Math.floor(t / 60);
  const sec = Math.floor(t % 60);
  const tenth = Math.floor((t * 10) % 10);
  return `${m < 10 ? '0' : ''}${m}:${sec < 10 ? '0' : ''}${sec}.${tenth}`;
}

const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

/** Playhead time, updated on the UI thread every frame without re-rendering React. */
function TimeText({ engine }: { engine: PlaybackEngine }) {
  const styles = useThemedStyles(makeStyles);
  const time = engine.time;
  const animatedProps = useAnimatedProps(() => ({ text: fmt(time.value), defaultValue: fmt(time.value) }));
  return (
    <AnimatedTextInput
      editable={false}
      underlineColorAndroid="transparent"
      defaultValue={fmt(0)}
      animatedProps={animatedProps}
      style={styles.timeNow}
    />
  );
}

const makeStyles = (colors: AppColors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center', gap: 16, paddingHorizontal: 24 },
  errorText: { ...font.body, color: colors.textDim },
  errorBtn: { minHeight: 48, backgroundColor: colors.surface2, paddingHorizontal: 18, paddingVertical: 14, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md },
  errorBtnText: { ...font.body, color: colors.text },
  topBar: { minHeight: 64, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 9, paddingHorizontal: 12, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.bg },
  iconBtn: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  exportBtn: { minHeight: 44, paddingHorizontal: 14, borderRadius: 14, backgroundColor: colors.accent, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  exportText: { ...font.body, color: colors.accentInk, fontWeight: '700', fontSize: 13 },
  titleWrap: { flex: 1, minWidth: 0, minHeight: 44, justifyContent: 'center', gap: 5, paddingHorizontal: 3, borderRadius: 10 },
  titleLabel: { color: colors.textDim, fontSize: 8, fontWeight: '600', letterSpacing: 1.6 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { flexShrink: 1, ...font.body, color: colors.text, fontSize: 13, fontWeight: '600', letterSpacing: -0.1 },
  controls: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface },
  timeRow: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  timeNow: { ...font.mono, color: colors.text, fontSize: 11, padding: 0, margin: 0 },
  timeTotal: { ...font.mono, color: colors.textDim, fontSize: 10 },
  play: { width: 46, height: 46, borderRadius: 16, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  playing: { backgroundColor: colors.accent, borderColor: colors.accent },
  history: { flex: 1, flexDirection: 'row', justifyContent: 'flex-end', gap: 2 },
  historyBtn: { width: 44, height: 44, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
});
