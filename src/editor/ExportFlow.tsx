import { StudioIcon as Ionicons } from '@/ui/StudioIcon';
import { Directory, Paths } from 'expo-file-system';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { Asset, requestPermissionsAsync } from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, BackHandler, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import {
  buildExportSpec,
  exportBitrate,
  exportSize,
  FRAME_RATES,
  RESOLUTIONS,
  type FrameRate,
  type Resolution,
} from '@/core/export';
import { canvasRatio, totalDuration } from '@/core/timeline';
import type { Project } from '@/core/types';
import { fileUri } from '@/storage/projects';
import { usePreferences } from '@/state/preferences';
import { MotionPressable as Pressable } from '@/ui/MotionPressable';
import { Sheet } from '@/ui/Sheet';
import { font, useAppTheme, useThemedStyles, type AppColors } from '@/ui/theme';
import { useMotionPreferences } from '@/ui/motion';

import { cancelExport, exportVideo } from '../../modules/smile-engine';

type Stage =
  | { kind: 'idle' }
  | { kind: 'running'; progress: number; cancelling: boolean }
  | { kind: 'done'; uri: string; saved: 'yes' | 'denied' | 'failed' };

/** Export settings sheet → progress → result (saved to Photos, share). */
export function ExportFlow({ project, visible, onClose }: { project: Project; visible: boolean; onClose: () => void }) {
  const { colors } = useAppTheme();
  const styles = useThemedStyles(makeStyles);
  const defaultResolution = usePreferences((state) => state.preferences.exportResolution);
  const defaultFps = usePreferences((state) => state.preferences.exportFps);
  const [resolutionOverride, setResolution] = useState<Resolution | null>(null);
  const [fpsOverride, setFps] = useState<FrameRate | null>(null);
  const resolution = resolutionOverride ?? defaultResolution;
  const fps = fpsOverride ?? defaultFps;
  const closeSheet = () => {
    setResolution(null);
    setFps(null);
    onClose();
  };
  const [stage, setStage] = useState<Stage>({ kind: 'idle' });
  const leftApp = useRef(false);
  const reduceMotion = useMotionPreferences();

  const running = stage.kind === 'running';
  useEffect(() => {
    if (!running) return;
    // The export keeps going only while the app is in front: keep the screen on and block the back gesture.
    void activateKeepAwakeAsync('export');
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    // In the background iOS refuses GPU work, so the export would fail anyway: stop it and say why.
    const state = AppState.addEventListener('change', (s) => {
      if (s !== 'background') return;
      leftApp.current = true;
      cancelExport();
    });
    return () => {
      void deactivateKeepAwake('export');
      sub.remove();
      state.remove();
    };
  }, [running]);

  const duration = totalDuration(project.main);
  const size = exportSize(canvasRatio(project), resolution);
  const megabytes = ((exportBitrate(size.width, size.height, fps) + 192_000) * duration) / 8 / 1e6;

  const start = async () => {
    closeSheet();
    leftApp.current = false;
    setStage({ kind: 'running', progress: 0, cancelling: false });
    try {
      // Earlier exports have been saved or shared already; don't let them pile up in the cache.
      const dir = new Directory(Paths.cache, 'exports');
      if (dir.exists) dir.delete();
      dir.create({ intermediates: true });
      const name =
        project.name
          .replace(/[^\w\- ]+/g, '')
          .trim()
          .replace(/\s+/g, '-') || 'video';
      const spec = buildExportSpec(
        project,
        { resolution, fps, output: `${dir.uri.replace(/\/?$/, '/')}${name}-${Date.now()}.mp4` },
        (a) => fileUri(a.path),
      );
      const uri = await exportVideo(spec, (progress) =>
        setStage((s) => (s.kind === 'running' ? { ...s, progress } : s)),
      );
      setStage({ kind: 'done', uri, saved: await saveToPhotos(uri) });
    } catch (e) {
      setStage({ kind: 'idle' });
      const message = e instanceof Error ? e.message : String(e);
      if (leftApp.current)
        Alert.alert('Export stopped', 'Smile Studio was closed during the export. Keep it open and try again.');
      else if (!/cancel/i.test(message)) Alert.alert('Export failed', message);
    }
  };

  const cancel = () => {
    setStage((s) => (s.kind === 'running' ? { ...s, cancelling: true } : s));
    cancelExport();
  };

  return (
    <>
      <Sheet visible={visible} onClose={closeSheet} title="Export video">
        <View style={styles.body}>
          <View style={styles.summary}>
            <View style={styles.summaryIcon}><Ionicons name="film-outline" size={24} color={colors.accentText} /></View>
            <View style={styles.summaryCopy}>
              <Text style={styles.projectName} numberOfLines={1}>{project.name}</Text>
              <Text style={styles.summaryNote}>Choose your export quality</Text>
            </View>
          </View>
          <Text style={styles.label}>Resolution</Text>
          <View style={styles.segment}>
            {RESOLUTIONS.map((r) => (
              <Segment key={r} label={`${r}p`} on={r === resolution} onPress={() => setResolution(r)} />
            ))}
          </View>
          <Text style={styles.label}>Frame rate</Text>
          <View style={styles.segment}>
            {FRAME_RATES.map((f) => (
              <Segment key={f} label={`${f} fps`} on={f === fps} onPress={() => setFps(f)} />
            ))}
          </View>
          <View style={styles.exportFacts}>
            <View style={styles.fact}><Text style={styles.factLabel}>DIMENSIONS</Text><Text style={styles.factValue}>{size.width} × {size.height}</Text></View>
            <View style={styles.factDivider} />
            <View style={styles.fact}><Text style={styles.factLabel}>FORMAT</Text><Text style={styles.factValue}>MP4</Text></View>
            <View style={styles.factDivider} />
            <View style={styles.fact}><Text style={styles.factLabel}>EST. SIZE</Text><Text style={styles.factValue}>{megabytes < 1 ? '<1' : Math.round(megabytes)} MB</Text></View>
          </View>
          <Pressable
            onPress={start}
            disabled={duration <= 0}
            haptic="light"
            style={[styles.primary, duration <= 0 && { opacity: 0.4 }]}
            accessibilityRole="button">
            <Ionicons name="arrow-up" size={20} color={colors.accentInk} />
            <Text style={styles.primaryText}>Export video</Text>
          </Pressable>
        </View>
      </Sheet>

      {stage.kind === 'running' ? (
        <Animated.View entering={reduceMotion ? undefined : FadeIn.duration(200)} style={styles.overlay}>
          <View style={styles.renderIcon}><Ionicons name="film-outline" size={30} color={colors.accentText} /></View>
          <Text style={styles.overlayLabel}>EXPORTING YOUR VIDEO</Text>
          <Text style={styles.percent}>{Math.floor(stage.progress * 100)}<Text style={styles.percentSign}>%</Text></Text>
          <View style={styles.bar}>
            <View style={[styles.barFill, { width: `${Math.max(2, stage.progress * 100)}%` }]} />
          </View>
          <Text style={styles.note}>Exporting… keep Smile Studio open until it finishes.</Text>
          <Pressable onPress={cancel} disabled={stage.cancelling} style={styles.secondary} accessibilityRole="button">
            {stage.cancelling ? (
              <ActivityIndicator color={colors.text} />
            ) : (
              <Text style={styles.secondaryText}>Cancel</Text>
            )}
          </Pressable>
        </Animated.View>
      ) : null}

      {stage.kind === 'done' ? (
        <Animated.View entering={reduceMotion ? undefined : FadeIn.duration(200)} style={styles.overlay}>
          <View style={styles.doneIcon}>
            <Ionicons name="checkmark" size={40} color={colors.accentInk} />
          </View>
          <Text style={styles.doneTitle}>Export complete</Text>
          <Text style={styles.note}>
            {stage.saved === 'yes'
              ? 'Saved to your photo library.'
              : stage.saved === 'denied'
                ? 'Not saved to Photos (no permission). You can still share it.'
                : 'Could not save to Photos. You can still share it.'}
          </Text>
          <Pressable
            onPress={() => Sharing.shareAsync(stage.uri, { mimeType: 'video/mp4', UTI: 'public.mpeg-4' })}
            style={styles.primary}
            accessibilityRole="button">
            <Ionicons name="share-outline" size={20} color={colors.accentInk} />
            <Text style={styles.primaryText}>Share</Text>
          </Pressable>
          <Pressable onPress={() => setStage({ kind: 'idle' })} style={styles.secondary} accessibilityRole="button">
            <Text style={styles.secondaryText}>Done</Text>
          </Pressable>
        </Animated.View>
      ) : null}
    </>
  );
}

/** Saves a file to the photo library (asks for add-only access). */
export async function saveToPhotos(uri: string): Promise<'yes' | 'denied' | 'failed'> {
  try {
    const permission = await requestPermissionsAsync(true);
    if (!permission.granted) return 'denied';
    await Asset.create(uri);
    return 'yes';
  } catch (e) {
    console.warn('Save to Photos failed', e);
    return 'failed';
  }
}

function Segment({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  const { colors } = useAppTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <Pressable
      onPress={onPress}
      active={on}
      style={[styles.segmentItem, on && styles.segmentOn]}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}>
      <Text style={[styles.segmentText, on && { color: colors.accentText }]}>{label}</Text>
    </Pressable>
  );
}

const makeStyles = (colors: AppColors) => StyleSheet.create({
  body: { paddingHorizontal: 4, gap: 10 },
  summary: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingBottom: 16, marginBottom: 5, borderBottomWidth: 1, borderBottomColor: colors.border },
  summaryIcon: { width: 48, height: 48, borderRadius: 15, backgroundColor: colors.accentSoft, borderWidth: 1, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center' },
  summaryCopy: { flex: 1, gap: 5 },
  projectName: { ...font.body, color: colors.text, fontWeight: '600', fontSize: 14 },
  summaryNote: { ...font.small, color: colors.textDim, fontSize: 11 },
  label: { ...font.small, fontWeight: '600', color: colors.textDim, marginTop: 7, marginBottom: 3 },
  segment: { flexDirection: 'row', gap: 8 },
  segmentItem: { flex: 1, minHeight: 48, borderRadius: 13, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  segmentOn: { backgroundColor: colors.accentSoft, borderColor: colors.accentText },
  segmentText: { ...font.body, color: colors.textDim, fontSize: 13, fontWeight: '600' },
  exportFacts: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 5, paddingVertical: 17, borderRadius: 13, backgroundColor: colors.surface, marginTop: 9, marginBottom: 4 },
  fact: { flex: 1, alignItems: 'center', gap: 7 },
  factLabel: { fontSize: 8, letterSpacing: 0.8, fontWeight: '600', color: colors.textDim },
  factValue: { ...font.mono, fontSize: 11, color: colors.text },
  factDivider: { width: 1, height: 22, backgroundColor: colors.border },
  primary: { minHeight: 54, paddingVertical: 12, borderRadius: 15, backgroundColor: colors.accent, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, alignSelf: 'stretch', marginTop: 6 },
  primaryText: { ...font.h2, fontSize: 15, color: colors.accentInk },
  overlay: { ...StyleSheet.absoluteFill, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 18 },
  renderIcon: { width: 72, height: 72, borderRadius: 24, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  overlayLabel: { color: colors.textDim, fontSize: 10, fontWeight: '600', letterSpacing: 1.8 },
  percent: { fontSize: 72, fontWeight: '600', letterSpacing: -3, color: colors.text, fontVariant: ['tabular-nums'] },
  percentSign: { fontSize: 30, color: colors.accentText, letterSpacing: 0 },
  bar: { alignSelf: 'stretch', height: 5, borderRadius: 3, backgroundColor: colors.surface3, overflow: 'hidden', marginTop: 2, marginBottom: 4 },
  barFill: { height: '100%', backgroundColor: colors.accent },
  note: { ...font.body, fontSize: 13, lineHeight: 21, color: colors.textDim, textAlign: 'center', marginBottom: 8 },
  secondary: { minHeight: 50, minWidth: 140, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 15, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', alignSelf: 'stretch' },
  secondaryText: { ...font.body, color: colors.text, fontSize: 14, fontWeight: '600' },
  doneIcon: { width: 80, height: 80, borderRadius: 28, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  doneTitle: { ...font.title, color: colors.text, fontSize: 26, fontWeight: '600' },
});
