import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { memo, useCallback, useLayoutEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  useAnimatedReaction,
  useAnimatedStyle,
  useDerivedValue,
  useFrameCallback,
  useSharedValue,
  withDecay,
  withSpring,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { editCaption, isCaption } from '@/core/captions';
import {
  assignLanes,
  audioEnd,
  clipDuration,
  clipStarts,
  fadeLengths,
  formatTime,
  MIN_CLIP,
  totalDuration,
  trimAudio,
  trimText,
} from '@/core/timeline';
import type { AudioClip, ID, MediaAsset, TextOverlay, VideoClip } from '@/core/types';
import { sampleWaveform } from '@/core/audio-analysis';
import type { PlaybackEngine } from '@/playback/engine';
import { frameAt, useFilmStrips, type FilmStrip } from '@/playback/thumbnails';
import { useWaveform } from '@/playback/waveforms';
import { useEditor } from '@/state/editor';
import { fileUri } from '@/storage/projects';
import { MotionPressable as Pressable } from '@/ui/MotionPressable';
import { StudioIcon as Ionicons } from '@/ui/StudioIcon';
import { font, radius, useAppTheme, useThemedStyles, type AppColors } from '@/ui/theme';

/** Filmstrip picture for source time `src`: the photo itself, or the nearest generated video frame. */
function tileSource(asset: MediaAsset | undefined, strip: FilmStrip | undefined, src: number) {
  if (asset?.kind === 'image') return { uri: fileUri(asset.path) };
  return frameAt(strip, src) ?? null;
}

const RULER_H = 26;
const TRACK_TOP = 38;
const TRACK_H = 58;
const TILE_W = 42;
const HANDLE_W = 16;
const HANDLE_HIT = 34;
const SNAP_PX = 10;
const MIN_PPS = 2;
const MAX_PPS = 400;
const DEFAULT_PPS = 56;
const CLIP_GAP = 2;
const REORDER_GAP = 6;
const LANES_TOP = TRACK_TOP + TRACK_H + 10;
const LANE_H = 30;
const LANE_GAP = 4;
const NO_CLIPS: VideoClip[] = [];
const NO_TEXTS: TextOverlay[] = [];
const NO_AUDIO: AudioClip[] = [];
const NO_MARKERS: number[] = [];
const NO_ASSETS: Record<ID, MediaAsset> = {};

/** A text or audio item on an overlay lane, in timeline seconds and row pixels. */
type Ov = { id: ID; kind: 'text' | 'audio'; start: number; end: number; y: number; minStart: number; maxEnd: number };
/** Live (uncommitted) move/trim of an overlay. */
type OvDrag = { id: ID; startDelta: number; endDelta: number } | null;
/** Pan modes. */
const SCROLL = 0;
const TRIM_IN = 1;
const TRIM_OUT = 2;
const REORDER = 3;
const OV_MOVE = 4;
const OV_START = 5;
const OV_END = 6;

type Item = { id: ID; index: number; start: number; dur: number };
/** Live (uncommitted) trim preview, in timeline seconds. */
type TrimPreview = {
  id: ID;
  index: number;
  startDelta: number;
  durDelta: number;
  shiftAfter: number;
} | null;
type Sel = {
  id: ID;
  index: number;
  assetId: ID;
  start: number;
  in: number;
  out: number;
  speed: number;
  assetDuration: number;
} | null;

const clamp = (v: number, lo: number, hi: number) => {
  'worklet';
  return Math.min(Math.max(v, lo), hi);
};

/** Live geometry of a clip on the track (seconds), including any trim being dragged. */
function liveGeometry(layout: Item[], trim: TrimPreview, id: ID) {
  'worklet';
  const it = layout.find((l) => l.id === id);
  if (!it) return { start: 0, dur: 0 };
  let start = it.start;
  let dur = it.dur;
  if (trim) {
    if (trim.id === id) {
      start += trim.startDelta;
      dur += trim.durDelta;
    } else if (it.index > trim.index) {
      start += trim.shiftAfter;
    }
  }
  return { start, dur };
}

export function Timeline({
  engine,
  onAdd,
  onAddText,
  onAddAudio,
}: {
  engine: PlaybackEngine;
  onAdd: () => void;
  onAddText: () => void;
  onAddAudio: () => void;
}) {
  const { colors } = useAppTheme();
  const styles = useThemedStyles(createStyles);
  const { width: W } = useWindowDimensions();
  // Null-safe: the store is cleared while this screen is still unmounting.
  const main = useEditor((s) => s.project?.main ?? NO_CLIPS);
  const assets = useEditor((s) => s.project?.assets ?? NO_ASSETS);
  const texts = useEditor((s) => s.project?.texts ?? NO_TEXTS);
  const audio = useEditor((s) => s.project?.audio ?? NO_AUDIO);
  const markers = useEditor((s) => s.project?.markers ?? NO_MARKERS);
  const selectedId = useEditor((s) => s.selectedId);
  const strips = useFilmStrips();
  const time = engine.time;

  const starts = useMemo(() => clipStarts(main), [main]);
  const total = totalDuration(main);

  // Overlay lanes: texts first, then audio. An empty section keeps one row for its "Add" placeholder.
  const textLanes = useMemo(() => assignLanes(texts.map((t) => ({ id: t.id, start: t.start, end: t.end }))), [texts]);
  const audioLanes = useMemo(
    () => assignLanes(audio.map((a) => ({ id: a.id, start: a.start, end: audioEnd(a) }))),
    [audio],
  );
  const textRows = Math.max(1, textLanes.count);
  const audioRows = Math.max(1, audioLanes.count);
  const rowY = (row: number) => LANES_TOP + row * (LANE_H + LANE_GAP);
  const textY = (lane: number) => rowY(lane);
  const audioY = (lane: number) => rowY(textRows + lane);
  const height = rowY(textRows + audioRows) + 6;
  const overlays = useMemo<Ov[]>(
    () => [
      ...texts.map((t) => ({
        id: t.id,
        kind: 'text' as const,
        start: t.start,
        end: t.end,
        y: LANES_TOP + textLanes.lanes[t.id] * (LANE_H + LANE_GAP),
        minStart: 0,
        maxEnd: Infinity,
      })),
      ...audio.map((a) => ({
        id: a.id,
        kind: 'audio' as const,
        start: a.start,
        end: audioEnd(a),
        y: LANES_TOP + (textRows + audioLanes.lanes[a.id]) * (LANE_H + LANE_GAP),
        // The left edge can reveal source back to 0, the right edge up to the end of the file.
        minStart: Math.max(0, a.start - a.in),
        maxEnd: a.start + ((assets[a.assetId]?.duration ?? a.out) - a.in),
      })),
    ],
    [texts, audio, assets, textLanes, audioLanes, textRows],
  );

  const pps = useSharedValue(DEFAULT_PPS);
  const [committedPps, setCommittedPps] = useState(DEFAULT_PPS);
  const [viewT, setViewT] = useState(0);
  const layout = useSharedValue<Item[]>([]);
  const trim = useSharedValue<TrimPreview>(null);
  const sel = useSharedValue<Sel>(null);
  const totalSV = useSharedValue(total);
  const ovLayout = useSharedValue<Ov[]>([]);
  const ovDrag = useSharedValue<OvDrag>(null);
  const selOv = useSharedValue<Ov | null>(null);
  /** Edges overlays snap to (clip cuts, other overlays), tagged with their owner so an item ignores itself. */
  const snapTargets = useSharedValue<{ t: number; id: ID }[]>([]);
  const markerTimes = useSharedValue<number[]>([]);
  const rows = useSharedValue({ textRows: 1, audioRows: 1, hasTexts: false, hasAudio: false });

  // Gesture scratch state (UI thread).
  const mode = useSharedValue(0); // 0 = scroll, 1 = trim in-point, 2 = trim out-point, 3 = reorder drag
  const panActive = useSharedValue(false);
  const scrubbing = useSharedValue(false);
  const gestureGen = useSharedValue(0);
  const startTime = useSharedValue(0);
  const basePps = useSharedValue(DEFAULT_PPS);
  const trimValue = useSharedValue(0);
  const lastPeek = useSharedValue(-1);
  const snapped = useSharedValue(false);

  // Reorder mode.
  const [reorderFrom, setReorderFrom] = useState<number | null>(null);
  const reorderActive = useSharedValue(false);
  const reorderFromSV = useSharedValue(0);
  const reorderX = useSharedValue(0);
  const reorderX0 = useSharedValue(0);
  const tile = Math.max(30, Math.min(56, (W - 32) / Math.max(main.length, 1) - REORDER_GAP));
  const reorderTo = useDerivedValue(() =>
    clamp(Math.round((reorderX.value - reorderX0.value - tile / 2) / (tile + REORDER_GAP)), 0, main.length - 1),
  );

  // Commit layout and clear the live trim in the same JS tick so the UI thread never sees a half-applied edit.
  useLayoutEffect(() => {
    layout.set(
      main.map((c, i) => ({
        id: c.id,
        index: i,
        start: starts[i],
        dur: clipDuration(c),
      })),
    );
    trim.set(null);
    totalSV.set(total);
  }, [main, starts, total, layout, trim, totalSV]);

  useLayoutEffect(() => {
    ovLayout.set(overlays);
    ovDrag.set(null);
    selOv.set(overlays.find((o) => o.id === selectedId) ?? null);
    snapTargets.set([
      ...starts.map((t) => ({ t, id: '' })),
      { t: total, id: '' },
      ...markers.filter(t => Number.isFinite(t) && t >= 0 && t <= total).map(t => ({ t, id: '' })),
      ...overlays.flatMap((o) => [
        { t: o.start, id: o.id },
        { t: o.end, id: o.id },
      ]),
    ]);
    rows.set({ textRows, audioRows, hasTexts: texts.length > 0, hasAudio: audio.length > 0 });
    markerTimes.set(markers.filter(t => Number.isFinite(t) && t >= 0 && t <= total));
  }, [
    overlays,
    selectedId,
    starts,
    total,
    textRows,
    audioRows,
    texts.length,
    audio.length,
    ovLayout,
    ovDrag,
    selOv,
    snapTargets,
    markers,
    markerTimes,
    rows,
  ]);

  useLayoutEffect(() => {
    const i = main.findIndex((c) => c.id === selectedId);
    const c = main[i];
    sel.set(
      c
        ? {
            id: c.id,
            index: i,
            assetId: c.assetId,
            start: starts[i],
            in: c.in,
            out: c.out,
            speed: c.speed,
            assetDuration: assets[c.assetId]?.duration ?? c.out,
          }
        : null,
    );
  }, [main, starts, selectedId, assets, sel]);

  // --- JS-side callbacks invoked from worklets ---------------------------------------------
  // Engine methods are stable across renders, so these callbacks (and the gestures below) are too.
  const { isPlaying, seek, setScrubbing, peek, pause } = engine;
  const onScrub = useCallback((t: number) => !isPlaying() && seek(t), [isPlaying, seek]);
  const haptic = useCallback(() => Haptics.selectionAsync(), []);
  const seekMarker = useCallback((marker: number) => {
    pause(); cancelAnimation(time);
    const duration = totalDuration(useEditor.getState().project?.main ?? []);
    const target = Math.max(0, Math.min(duration, marker));
    time.set(target); seek(target);
  }, [pause, time, seek]);
  const markerMenu = useCallback((marker: number) => {
    Alert.alert('Timeline marker', `At ${formatTime(marker)} (${marker.toFixed(2)} s). Markers do not change your clips.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Go to marker', onPress: () => seekMarker(marker) },
      { text: 'Remove marker', style: 'destructive', onPress: () => useEditor.getState().edit(p => {
        const current = p.markers ?? [];
        const next = current.filter(t => Math.abs(t - marker) > .001);
        return next.length === current.length ? p : { ...p, markers: next };
      }) },
    ]);
  }, [seekMarker]);
  const commitTrim = useCallback(
    (id: ID, edge: 'in' | 'out', value: number) => {
      setScrubbing(false);
      useEditor.getState().trim(id, edge, value);
    },
    [setScrubbing],
  );
  const onTap = useCallback(
    (id: ID | null) => {
      const { selectedId: cur, select, project } = useEditor.getState();
      const next = id && id !== cur ? id : null;
      select(next);
      // A text is only visible inside its time range: bring the playhead there so it shows in the preview.
      const text = project?.texts.find((t) => t.id === next);
      if (text) {
        const t = engine.currentTime();
        if (t < text.start || t >= text.end) {
          const to = Math.min(text.start + 0.01, Math.max(0, totalDuration(project!.main) - 0.01));
          engine.time.set(to);
          seek(to);
        }
      }
    },
    [engine, seek],
  );
  const onAddRow = useCallback(
    (kind: 'text' | 'audio') => (kind === 'text' ? onAddText() : onAddAudio()),
    [onAddText, onAddAudio],
  );
  const commitOverlay = useCallback(
    (id: ID, mode: number, startDelta: number, endDelta: number) => {
      setScrubbing(false);
      const { edit } = useEditor.getState();
      try { edit((p) => {
        const text = p.texts.find((t) => t.id === id);
        if (text) {
          const next =
            mode === OV_MOVE
              ? { ...text, start: text.start + startDelta, end: text.end + startDelta }
              : mode === OV_START
                ? trimText(text, 'start', text.start + startDelta)
                : trimText(text, 'end', text.end + endDelta);
          if (isCaption(text)) return editCaption(p, id, { start: next.start, end: next.end });
          return { ...p, texts: p.texts.map((t) => (t.id === id ? next : t)) };
        }
        const a = p.audio.find((x) => x.id === id);
        if (!a) return p;
        const dur = p.assets[a.assetId]?.duration ?? a.out;
        const next =
          mode === OV_MOVE
            ? { ...a, start: Math.max(0, a.start + startDelta) }
            : mode === OV_START
              ? trimAudio(a, 'start', a.start + startDelta, dur)
              : trimAudio(a, 'end', audioEnd(a) + endDelta, dur);
        return { ...p, audio: p.audio.map((x) => (x.id === id ? next : x)) };
      }); }
      catch (cause) { ovDrag.set(null); Alert.alert('Could not change caption timing', cause instanceof Error ? cause.message : String(cause)); }
    },
    [setScrubbing, ovDrag],
  );
  const beginReorder = useCallback(
    (index: number) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      pause();
      setReorderFrom(index);
    },
    [pause],
  );
  const endReorder = useCallback((from: number, to: number) => {
    setReorderFrom(null);
    if (from !== to) useEditor.getState().move(from, to);
  }, []);

  // Seek the preview while the user scrubs (including the momentum phase).
  useAnimatedReaction(
    () => time.value,
    (t, prev) => {
      if (scrubbing.value && t !== prev) scheduleOnRN(onScrub, t);
    },
  );
  // Re-center the thumbnail/ruler virtualization window every half screen.
  useAnimatedReaction(
    () => Math.floor((time.value * pps.value) / (W / 2)),
    (bucket, prev) => {
      if (bucket !== prev) scheduleOnRN(setViewT, time.value);
    },
  );

  // Built once per layout-relevant change, never per render: replacing a gesture mid-drag can drop its end event.
  const gesture = useMemo(() => {
    // --- Hit testing --------------------------------------------------------------------------
    const inTrack = (y: number) => {
      'worklet';
      return y >= TRACK_TOP - 8 && y <= TRACK_TOP + TRACK_H + 8;
    };
    const hitClip = (x: number) => {
      'worklet';
      const tx = time.value + (x - W / 2) / pps.value;
      for (const it of layout.value) if (tx >= it.start && tx < it.start + it.dur) return it;
      return null;
    };
    const hitOverlay = (x: number, y: number) => {
      'worklet';
      const tx = time.value + (x - W / 2) / pps.value;
      for (const o of ovLayout.value) {
        if (y >= o.y && y <= o.y + LANE_H && tx >= o.start && tx < o.end) return o;
      }
      return null;
    };
    const hitMarker = (x: number, y: number) => {
      'worklet';
      if (y > TRACK_TOP - 6) return null;
      const target = time.value + (x - W / 2) / pps.value;
      let nearest: number | null = null, distance = 14 / pps.value;
      for (const marker of markerTimes.value) {
        if (Math.abs(marker - target) < distance) { nearest = marker; distance = Math.abs(marker - target); }
      }
      return nearest;
    };
    /** Which "Add" placeholder row (if any) a point is on. */
    const placeholderAt = (x: number, y: number) => {
      'worklet';
      if (x < W / 2) return null;
      const r = rows.value;
      const inRow = (row: number) =>
        y >= LANES_TOP + row * (LANE_H + LANE_GAP) && y <= LANES_TOP + row * (LANE_H + LANE_GAP) + LANE_H;
      if (!r.hasTexts && inRow(0)) return 'text';
      if (!r.hasAudio && inRow(r.textRows)) return 'audio';
      return null;
    };
    const overlayModeAt = (x: number, y: number) => {
      'worklet';
      const o = selOv.value;
      if (!o || y < o.y - 6 || y > o.y + LANE_H + 6) return SCROLL;
      const left = W / 2 + (o.start - time.value) * pps.value;
      const right = W / 2 + (o.end - time.value) * pps.value;
      if (Math.abs(x - (left - HANDLE_W / 2)) < HANDLE_HIT / 2) return OV_START;
      if (Math.abs(x - (right + HANDLE_W / 2)) < HANDLE_HIT / 2) return OV_END;
      if (x > left && x < right) return OV_MOVE;
      return SCROLL;
    };
    /** Snap a time to the playhead or another item's edge (not `own`); returns [time, didSnap]. */
    const snapTime = (t: number, own: ID): [number, boolean] => {
      'worklet';
      const thr = SNAP_PX / pps.value;
      let best = t;
      let bestD = thr;
      if (Math.abs(time.value - t) < bestD) {
        best = time.value;
        bestD = Math.abs(time.value - t);
      }
      for (const s of snapTargets.value) {
        if (s.id === own) continue;
        const d = Math.abs(s.t - t);
        if (d < bestD) {
          best = s.t;
          bestD = d;
        }
      }
      return [best, best !== t];
    };
    const handleAt = (x: number, y: number) => {
      'worklet';
      const ov = overlayModeAt(x, y);
      if (ov !== SCROLL) return ov;
      const c = sel.value;
      if (!c || !inTrack(y)) return SCROLL;
      const left = W / 2 + (c.start - time.value) * pps.value;
      const right = left + ((c.out - c.in) / c.speed) * pps.value;
      if (Math.abs(x - (left - HANDLE_W / 2)) < HANDLE_HIT / 2) return TRIM_IN;
      if (Math.abs(x - (right + HANDLE_W / 2)) < HANDLE_HIT / 2) return TRIM_OUT;
      return SCROLL;
    };

    // --- Gestures -----------------------------------------------------------------------------
    const pan = Gesture.Pan()
      .maxPointers(1)
      .activeOffsetX([-8, 8])
      .onBegin((e) => {
        mode.set(handleAt(e.x, e.y));
      })
      .onStart(() => {
        panActive.set(true);
        if (reorderActive.value) {
          mode.set(REORDER); // the long press already picked up a clip: this pan just drags it
          return;
        }
        gestureGen.set(gestureGen.value + 1);
        cancelAnimation(time);
        lastPeek.set(-1);
        snapped.set(false);
        startTime.set(time.value);
        scrubbing.set(mode.value === SCROLL);
        scheduleOnRN(setScrubbing, true);
      })
      .onUpdate((e) => {
        if (mode.value === REORDER) {
          reorderX.set(e.x);
          return;
        }
        if (mode.value === SCROLL) {
          time.set(clamp(startTime.value - e.translationX / pps.value, 0, totalSV.value));
          return;
        }
        if (mode.value >= OV_MOVE) {
          const o = selOv.value;
          if (!o) return;
          const dt = e.translationX / pps.value;
          let sd = 0;
          let ed = 0;
          let didSnap = false;
          if (mode.value === OV_MOVE) {
            const len = o.end - o.start;
            const ns = Math.max(0, o.start + dt);
            const [a, snapA] = snapTime(ns, o.id);
            const [b, snapB] = snapTime(ns + len, o.id);
            const start = snapA && (!snapB || Math.abs(a - ns) <= Math.abs(b - len - ns)) ? a : snapB ? b - len : ns;
            sd = ed = Math.max(0, start) - o.start;
            didSnap = snapA || snapB;
          } else if (mode.value === OV_START) {
            const [t, sn] = snapTime(o.start + dt, o.id);
            sd = clamp(t, o.minStart, o.end - MIN_CLIP) - o.start;
            didSnap = sn;
          } else {
            const [t, sn] = snapTime(o.end + dt, o.id);
            ed = clamp(t, o.start + MIN_CLIP, o.maxEnd) - o.end;
            didSnap = sn;
          }
          if (didSnap && !snapped.value) scheduleOnRN(haptic);
          snapped.set(didSnap);
          ovDrag.set({ id: o.id, startDelta: sd, endDelta: ed });
          return;
        }
        const c = sel.value;
        if (!c) return;
        const dt = e.translationX / pps.value;
        let value: number;
        let edgeT: number;
        let isSnapped = false;
        if (mode.value === TRIM_IN) {
          value = clamp(c.in + dt * c.speed, 0, c.out - MIN_CLIP * c.speed);
          edgeT = c.start + (value - c.in) / c.speed;
          const [target, didSnap] = snapTime(edgeT, c.id);
          if (didSnap) value = clamp(c.in + (target - c.start) * c.speed, 0, c.out - MIN_CLIP * c.speed);
          isSnapped = didSnap && Math.abs(c.start + (value - c.in) / c.speed - target) < 1e-6;
          const d = (value - c.in) / c.speed;
          trim.set({
            id: c.id,
            index: c.index,
            startDelta: d,
            durDelta: -d,
            shiftAfter: 0,
          });
        } else {
          value = clamp(c.out + dt * c.speed, c.in + MIN_CLIP * c.speed, c.assetDuration);
          edgeT = c.start + (value - c.in) / c.speed;
          const [target, didSnap] = snapTime(edgeT, c.id);
          if (didSnap) value = clamp(c.in + (target - c.start) * c.speed, c.in + MIN_CLIP * c.speed, c.assetDuration);
          isSnapped = didSnap && Math.abs(c.start + (value - c.in) / c.speed - target) < 1e-6;
          const d = (value - c.out) / c.speed;
          trim.set({
            id: c.id,
            index: c.index,
            startDelta: 0,
            durDelta: d,
            shiftAfter: d,
          });
        }
        if (isSnapped && !snapped.value) scheduleOnRN(haptic);
        snapped.set(isSnapped);
        trimValue.set(value);
        if (Math.abs(value - lastPeek.value) > 1 / 30) {
          lastPeek.set(value);
          scheduleOnRN(peek, c.assetId, value);
        }
      })
      .onFinalize(() => {
        panActive.set(false);
      })
      .onEnd((e) => {
        if (mode.value === REORDER) return; // committed by the long press finalizer
        if (mode.value >= OV_MOVE) {
          const d = ovDrag.value;
          if (d) scheduleOnRN(commitOverlay, d.id, mode.value, d.startDelta, d.endDelta);
          else scheduleOnRN(setScrubbing, false);
          return;
        }
        if (mode.value !== SCROLL) {
          const c = sel.value;
          if (c && trim.value) scheduleOnRN(commitTrim, c.id, mode.value === TRIM_IN ? 'in' : 'out', trimValue.value);
          else scheduleOnRN(setScrubbing, false);
          return;
        }
        const gen = gestureGen.value;
        time.set(
          withDecay(
            {
              velocity: -e.velocityX / pps.value,
              clamp: [0, totalSV.value],
              deceleration: 0.995,
            },
            () => {
              if (gestureGen.value !== gen) return; // a newer gesture took over
              scrubbing.set(false);
              scheduleOnRN(setScrubbing, false);
            },
          ),
        );
      });

    const pinch = Gesture.Pinch()
      .onStart(() => {
        basePps.set(pps.value);
      })
      .onUpdate((e) => {
        pps.set(clamp(basePps.value * e.scale, MIN_PPS, MAX_PPS));
      })
      .onEnd(() => {
        scheduleOnRN(setCommittedPps, pps.value);
        scheduleOnRN(setViewT, time.value);
      });

    // Up to the long press below, so no press length falls between the two.
    const tap = Gesture.Tap()
      .maxDuration(350)
      .onEnd((e, success) => {
        if (!success) return;
        const marker = hitMarker(e.x, e.y);
        if (marker !== null) return scheduleOnRN(seekMarker, marker);
        const add = placeholderAt(e.x, e.y);
        if (add) return scheduleOnRN(onAddRow, add);
        const ov = e.y > LANES_TOP - 4 ? hitOverlay(e.x, e.y) : null;
        if (ov) return scheduleOnRN(onTap, ov.id);
        const it = inTrack(e.y) ? hitClip(e.x) : null;
        scheduleOnRN(onTap, it ? it.id : null);
      });

    // Long press picks a clip up for reordering; the pan above then drags it. Finalize always drops it.
    // Large maxDistance: on iOS a long press is cancelled once the finger travels past it, even after it has
    // activated, which would drop the clip mid-drag. A scroll that starts first still wins via `panActive`.
    const reorder = Gesture.LongPress()
      .minDuration(350)
      .maxDistance(100000)
      .onStart((e) => {
        if (panActive.value) return; // already scrolling/trimming
        const marker = hitMarker(e.x, e.y);
        if (marker !== null) { scheduleOnRN(markerMenu, marker); return; }
        const it = inTrack(e.y) ? hitClip(e.x) : null;
        if (!it) return;
        reorderActive.set(true);
        reorderFromSV.set(it.index);
        reorderX.set(e.x);
        reorderX0.set(e.x - it.index * (tile + REORDER_GAP) - tile / 2);
        scheduleOnRN(beginReorder, it.index);
      })
      .onFinalize(() => {
        if (!reorderActive.value) return;
        reorderActive.set(false);
        scheduleOnRN(endReorder, reorderFromSV.value, reorderTo.value);
      });

    return Gesture.Simultaneous(pinch, reorder, Gesture.Race(pan, tap));
    // Shared values are stable refs; listing them keeps the hooks linter happy.
  }, [
    W,
    tile,
    time,
    pps,
    layout,
    trim,
    sel,
    totalSV,
    mode,
    panActive,
    scrubbing,
    gestureGen,
    startTime,
    basePps,
    trimValue,
    lastPeek,
    snapped,
    reorderActive,
    reorderFromSV,
    reorderX,
    reorderX0,
    reorderTo,
    setScrubbing,
    peek,
    haptic,
    commitTrim,
    onTap,
    beginReorder,
    endReorder,
    ovLayout,
    ovDrag,
    selOv,
    snapTargets,
    rows,
    onAddRow,
    commitOverlay,
    markerTimes,
    seekMarker,
    markerMenu,
  ]);

  // Auto-scroll the reorder strip when dragging near the screen edges.
  useFrameCallback(() => {
    if (!reorderActive.value) return;
    const rowW = main.length * (tile + REORDER_GAP);
    if (reorderX.value < 48 && reorderX0.value < 16) reorderX0.set(reorderX0.value + 6);
    else if (reorderX.value > W - 48 && reorderX0.value + rowW > W - 16) reorderX0.set(reorderX0.value - 6);
  });

  const contentStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: W / 2 - time.value * pps.value }],
  }));
  const trackDim = useAnimatedStyle(() => ({
    opacity: reorderActive.value ? 0.15 : 1,
  }));

  // Virtualization window in timeline seconds.
  const winStart = viewT - (1.5 * W) / committedPps;
  const winEnd = viewT + (1.5 * W) / committedPps;
  const selected = main.find((c) => c.id === selectedId);
  const selectedOv = overlays.find((o) => o.id === selectedId);

  return (
    <View style={[styles.root, { height }]}>
      <GestureDetector gesture={gesture}>
        <View style={StyleSheet.absoluteFill} collapsable={false}>
          <Animated.View style={[styles.content, contentStyle]}>
            <Ruler total={total} pps={pps} committedPps={committedPps} winStart={winStart} winEnd={winEnd} />
            {markers.filter(marker => marker >= Math.max(0, winStart) && marker <= Math.min(total, winEnd)).map(marker => (
              <Marker key={marker} time={marker} pps={pps} onSeek={seekMarker} onMenu={markerMenu} />
            ))}
            <Animated.View style={trackDim}>
              {main.map((c, i) => (
                <TrackClip
                  key={c.id}
                  clip={c}
                  start={starts[i]}
                  asset={assets[c.assetId]}
                  strip={strips[c.assetId]}
                  pps={pps}
                  committedPps={committedPps}
                  layout={layout}
                  trim={trim}
                  winStart={winStart}
                  winEnd={winEnd}
                  selected={c.id === selectedId}
                />
              ))}
              {selected ? <SelectionFrame id={selected.id} pps={pps} layout={layout} trim={trim} /> : null}
            </Animated.View>
            {texts.map((t) => (
              <OverlayBar
                key={t.id}
                ov={overlays.find((o) => o.id === t.id)!}
                label={t.text || ' '}
                icon="text"
                pps={pps}
                drag={ovDrag}
                selected={t.id === selectedId}
              />
            ))}
            {audio.map((a) => (
              <OverlayBar
                key={a.id}
                ov={overlays.find((o) => o.id === a.id)!}
                label={assets[a.assetId]?.name ?? 'Audio'}
                icon={a.volume === 0 ? 'volume-mute' : 'musical-notes'}
                pps={pps}
                drag={ovDrag}
                selected={a.id === selectedId}
                fadeIn={a.fadeIn}
                fadeOut={a.fadeOut}
                asset={assets[a.assetId]}
                audioClip={a}
                committedPps={committedPps}
                winStart={winStart}
                winEnd={winEnd}
              />
            ))}
            {selectedOv ? <OverlayFrame ov={selectedOv} pps={pps} drag={ovDrag} /> : null}
          </Animated.View>

          {texts.length === 0 ? <Placeholder y={textY(0)} x={W / 2 + 6} icon="text" label="Add text" /> : null}
          {audio.length === 0 ? (
            <Placeholder y={audioY(0)} x={W / 2 + 6} icon="musical-notes" label="Add audio" />
          ) : null}

          {reorderFrom !== null ? (
            <ReorderStrip
              main={main}
              strips={strips}
              assets={assets}
              from={reorderFrom}
              tile={tile}
              x={reorderX}
              x0={reorderX0}
              to={reorderTo}
            />
          ) : null}

          <View pointerEvents="none" style={[styles.playhead, { left: W / 2 - 1, height: height - RULER_H }]}>
            <View style={styles.playheadKnob} />
          </View>
        </View>
      </GestureDetector>

      {/* Outside the detector: otherwise the timeline's tap gesture wins and cancels this Pressable. */}
      <Pressable
        onPress={onAdd}
        haptic="light"
        accessibilityRole="button"
        accessibilityLabel="Add media"
        accessibilityHint="Add another video or photo to the timeline"
        style={styles.add}>
        <Ionicons name="add" size={24} color={colors.accentInk} />
      </Pressable>
    </View>
  );
}

const TrackClip = memo(function TrackClip({
  clip,
  start,
  asset,
  strip,
  pps,
  committedPps,
  layout,
  trim,
  winStart,
  winEnd,
  selected,
}: {
  clip: VideoClip;
  start: number;
  asset: MediaAsset | undefined;
  strip: FilmStrip | undefined;
  pps: SharedValue<number>;
  committedPps: number;
  layout: SharedValue<Item[]>;
  trim: SharedValue<TrimPreview>;
  winStart: number;
  winEnd: number;
  selected: boolean;
}) {
  const { colors } = useAppTheme();
  const styles = useThemedStyles(createStyles);
  const id = clip.id;
  const box = useAnimatedStyle(() => {
    const g = liveGeometry(layout.value, trim.value, id);
    return {
      left: g.start * pps.value,
      width: Math.max(0, g.dur * pps.value - CLIP_GAP),
    };
  });
  // Keep frames pinned in timeline space while the in-point is dragged, so the edge "reveals" footage.
  const inner = useAnimatedStyle(() => {
    const t = trim.value;
    return {
      transform: [{ translateX: t && t.id === id ? -t.startDelta * pps.value : 0 }],
    };
  });

  // Frames cover the whole source file (so trimming outwards shows real footage), virtualized to the window.
  const sourceOrigin = start - clip.in / clip.speed; // timeline time of source t=0
  const assetDur = asset?.duration ?? clip.out;
  const firstK = Math.max(0, Math.floor(((Math.max(winStart, start - 30) - sourceOrigin) * committedPps) / TILE_W));
  const lastK = Math.min(
    Math.ceil(((assetDur / clip.speed) * committedPps) / TILE_W),
    Math.ceil(((Math.min(winEnd, start + clipDuration(clip) + 30) - sourceOrigin) * committedPps) / TILE_W),
  );
  const tiles = [];
  for (let k = firstK; k < lastK; k++) {
    const src = (((k + 0.5) * TILE_W) / committedPps) * clip.speed;
    tiles.push(
      <Image
        key={k}
        source={tileSource(asset, strip, src)}
        style={[styles.tile, { left: k * TILE_W }]}
        contentFit="cover"
        transition={120}
        recyclingKey={`${clip.assetId}:${k}`}
      />,
    );
  }

  return (
    <Animated.View style={[styles.clip, box]}>
      <Animated.View
        style={[styles.tiles, { left: (-clip.in / clip.speed) * committedPps }, inner]}
        pointerEvents="none">
        {tiles}
      </Animated.View>
      {asset?.kind === 'video' && start <= winEnd && start + clipDuration(clip) >= winStart ? (
        <Animated.View pointerEvents="none" style={[styles.mainWaveform, inner]}>
          <SourceWaveform asset={asset} sourceIn={clip.in} speed={clip.speed} start={start} pps={pps} committedPps={committedPps} winStart={winStart} winEnd={winEnd} height={14} />
        </Animated.View>
      ) : null}
      {clip.speed !== 1 || clip.volume === 0 ? (
        <View style={styles.badges}>
          {clip.speed !== 1 ? <Text style={styles.badge}>{clip.speed.toFixed(clip.speed < 1 ? 2 : 1)}x</Text> : null}
          {clip.volume === 0 ? <Ionicons name="volume-mute" size={11} color="#fff" style={styles.badge} /> : null}
        </View>
      ) : null}
      <FadeMarks duration={clipDuration(clip)} fadeIn={clip.fadeIn} fadeOut={clip.fadeOut} pps={pps} />
      {clip.transition ? (
        <View style={styles.xfade}>
          <Ionicons name="git-compare-outline" size={12} color={colors.accentInk} />
        </View>
      ) : null}
      {selected ? null : <View style={styles.clipShade} />}
    </Animated.View>
  );
});

function SelectionFrame({
  id,
  pps,
  layout,
  trim,
}: {
  id: ID;
  pps: SharedValue<number>;
  layout: SharedValue<Item[]>;
  trim: SharedValue<TrimPreview>;
}) {
  const styles = useThemedStyles(createStyles);
  const style = useAnimatedStyle(() => {
    const g = liveGeometry(layout.value, trim.value, id);
    return {
      left: g.start * pps.value - HANDLE_W,
      width: g.dur * pps.value - CLIP_GAP + HANDLE_W * 2,
    };
  });
  return (
    <Animated.View pointerEvents="none" style={[styles.frame, style]}>
      <View style={[styles.handle, styles.handleLeft]}>
        <View style={styles.grip} />
      </View>
      <View style={styles.frameMid} />
      <View style={[styles.handle, styles.handleRight]}>
        <View style={styles.grip} />
      </View>
    </Animated.View>
  );
}

/** Dark wedges over the faded-in / faded-out ends of a clip. */
function FadeMarks({
  duration,
  fadeIn,
  fadeOut,
  pps,
}: {
  duration: number;
  fadeIn?: number;
  fadeOut?: number;
  pps: SharedValue<number>;
}) {
  const styles = useThemedStyles(createStyles);
  const [fi, fo] = fadeLengths(duration, fadeIn, fadeOut);
  const left = useAnimatedStyle(() => ({ width: fi * pps.value }));
  const right = useAnimatedStyle(() => ({ width: fo * pps.value }));
  return (
    <>
      {fi > 0 ? (
        <Animated.View pointerEvents="none" style={[styles.fade, { left: 0 }, left]}>
          <LinearGradient colors={FADE_COLORS} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.fill} />
        </Animated.View>
      ) : null}
      {fo > 0 ? (
        <Animated.View pointerEvents="none" style={[styles.fade, { right: 0 }, right]}>
          <LinearGradient colors={FADE_COLORS} start={{ x: 1, y: 0 }} end={{ x: 0, y: 0 }} style={styles.fill} />
        </Animated.View>
      ) : null}
    </>
  );
}

const FADE_COLORS = ['rgba(0,0,0,0.7)', 'rgba(0,0,0,0)'] as const;

const OverlayBar = memo(function OverlayBar({
  ov,
  label,
  icon,
  pps,
  drag,
  selected,
  fadeIn,
  fadeOut,
  asset,
  audioClip,
  committedPps = DEFAULT_PPS,
  winStart = 0,
  winEnd = 0,
}: {
  ov: Ov;
  label: string;
  icon: 'text' | 'musical-notes' | 'volume-mute';
  pps: SharedValue<number>;
  drag: SharedValue<OvDrag>;
  selected: boolean;
  fadeIn?: number;
  fadeOut?: number;
  asset?: MediaAsset;
  audioClip?: AudioClip;
  committedPps?: number;
  winStart?: number;
  winEnd?: number;
}) {
  const { colors } = useAppTheme();
  const styles = useThemedStyles(createStyles);
  const { id, start, end, y, kind } = ov;
  const style = useAnimatedStyle(() => {
    const d = drag.value && drag.value.id === id ? drag.value : null;
    const s = start + (d ? d.startDelta : 0);
    const e = end + (d ? d.endDelta : 0);
    return { left: s * pps.value, width: Math.max(2, (e - s) * pps.value - CLIP_GAP) };
  });
  const waveShift = useAnimatedStyle(() => {
    const d = drag.value && drag.value.id === id ? drag.value : null;
    // Moving keeps the source fixed; trimming the left edge reveals the matching source samples.
    return { transform: [{ translateX: d && d.startDelta !== d.endDelta ? -d.startDelta * pps.value : 0 }] };
  });
  return (
    <Animated.View
      style={[
        styles.ov,
        { top: y },
        kind === 'text' ? styles.ovText : styles.ovAudio,
        selected && styles.ovSelected,
        style,
      ]}>
      {kind === 'audio' && audioClip && start <= winEnd && end >= winStart ? (
        <Animated.View pointerEvents="none" style={[styles.audioWaveform, waveShift]}>
          <SourceWaveform
            asset={asset}
            sourceIn={audioClip.in}
            speed={1}
            start={start}
            pps={pps}
            committedPps={committedPps}
            winStart={winStart}
            winEnd={winEnd}
            height={22}
          />
        </Animated.View>
      ) : null}
      <FadeMarks duration={end - start} fadeIn={fadeIn} fadeOut={fadeOut} pps={pps} />
      <Ionicons name={icon} size={14} color={kind === 'text' ? colors.accentText : '#A6CBD9'} />
      <Text style={styles.ovLabel} numberOfLines={1}>
        {label}
      </Text>
    </Animated.View>
  );
});

/** Source-aligned bars are sampled only inside the virtualized window, with one animated parent per clip. */
const SourceWaveform = memo(function SourceWaveform({
  asset, sourceIn, speed, start, pps, committedPps, winStart, winEnd, height,
}: {
  asset: MediaAsset | undefined;
  sourceIn: number;
  speed: number;
  start: number;
  pps: SharedValue<number>;
  committedPps: number;
  winStart: number;
  winEnd: number;
  height: number;
}) {
  const styles = useThemedStyles(createStyles);
  const { analysis } = useWaveform(asset);
  const from = Math.max(0, sourceIn + (winStart - start) * speed);
  const to = Math.min(analysis?.duration ?? 0, sourceIn + (winEnd - start) * speed);
  const width = Math.max(0, (to - from) / speed * committedPps);
  const bars = useMemo(() => analysis ? sampleWaveform(analysis, from, to, Math.min(320, Math.ceil(width / 3))) : [], [analysis, from, to, width]);
  const box = useAnimatedStyle(() => {
    const scale = pps.value / committedPps;
    return { left: (from - sourceIn) / speed * pps.value + width * (scale - 1) / 2, transform: [{ scaleX: scale }] };
  });
  if (!analysis || !bars.length) return null;
  return (
    <Animated.View pointerEvents="none" accessible={false} style={[styles.waveformBars, { width, height }, box]}>
      {bars.map((bar, index) => (
        <View key={index} style={{
          position: 'absolute', left: index / bars.length * width,
          width: Math.max(1, width / bars.length - 1), height: Math.sqrt(bar.peak) * height,
          top: (height - Math.sqrt(bar.peak) * height) / 2, backgroundColor: '#A6CBD9', opacity: .35,
        }}>
          <View style={{
            position: 'absolute', top: (Math.sqrt(bar.peak) - Math.sqrt(bar.rms)) * height / 2,
            width: '100%', height: Math.sqrt(bar.rms) * height, backgroundColor: '#DFEDF2',
          }} />
        </View>
      ))}
    </Animated.View>
  );
});

function Marker({ time, pps, onSeek, onMenu }: {
  time: number;
  pps: SharedValue<number>;
  onSeek: (time: number) => void;
  onMenu: (time: number) => void;
}) {
  const styles = useThemedStyles(createStyles);
  const style = useAnimatedStyle(() => ({ left: time * pps.value - 16 }));
  return (
    <Animated.View
      accessible
      accessibilityRole="button"
      accessibilityLabel={`Marker at ${time.toFixed(2)} seconds`}
      accessibilityHint="Activate to seek. Use marker options to remove it."
      accessibilityActions={[{ name: 'activate', label: 'Go to marker' }, { name: 'options', label: 'Marker options' }]}
      onAccessibilityTap={() => onSeek(time)}
      onAccessibilityAction={event => event.nativeEvent.actionName === 'activate' ? onSeek(time) : onMenu(time)}
      style={[styles.marker, style]}>
      <View style={styles.markerDiamond} />
    </Animated.View>
  );
}

function OverlayFrame({ ov, pps, drag }: { ov: Ov; pps: SharedValue<number>; drag: SharedValue<OvDrag> }) {
  const styles = useThemedStyles(createStyles);
  const { id, start, end, y } = ov;
  const style = useAnimatedStyle(() => {
    const d = drag.value && drag.value.id === id ? drag.value : null;
    const s = start + (d ? d.startDelta : 0);
    const e = end + (d ? d.endDelta : 0);
    return { left: s * pps.value - HANDLE_W, width: (e - s) * pps.value - CLIP_GAP + HANDLE_W * 2 };
  });
  return (
    <Animated.View pointerEvents="none" style={[styles.frame, { top: y - 2, height: LANE_H + 4 }, style]}>
      <View style={[styles.handle, styles.handleLeft]}>
        <View style={[styles.grip, { height: 12 }]} />
      </View>
      <View style={styles.frameMid} />
      <View style={[styles.handle, styles.handleRight]}>
        <View style={[styles.grip, { height: 12 }]} />
      </View>
    </Animated.View>
  );
}

function Placeholder({ x, y, icon, label }: { x: number; y: number; icon: 'text' | 'musical-notes'; label: string }) {
  const { colors } = useAppTheme();
  const styles = useThemedStyles(createStyles);
  return (
    <View pointerEvents="none" style={[styles.placeholder, { left: x, top: y }]}>
      <Ionicons name={icon} size={15} color={colors.textDim} />
      <Text style={styles.placeholderText}>{label}</Text>
    </View>
  );
}

function Ruler({
  total,
  pps,
  committedPps,
  winStart,
  winEnd,
}: {
  total: number;
  pps: SharedValue<number>;
  committedPps: number;
  winStart: number;
  winEnd: number;
}) {
  const styles = useThemedStyles(createStyles);
  // Pick a label step that leaves at least ~70px between labels.
  const step = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600].find((s) => s * committedPps >= 70) ?? 600;
  const marks: number[] = [];
  const end = Math.min(winEnd, total + step);
  for (let t = Math.max(0, Math.floor(winStart / step) * step); t <= end; t += step) marks.push(t);
  return (
    <View style={styles.ruler} pointerEvents="none">
      {marks.map((t) => (
        <RulerMark key={t} t={t} step={step} pps={pps} />
      ))}
    </View>
  );
}

function RulerMark({ t, step, pps }: { t: number; step: number; pps: SharedValue<number> }) {
  const styles = useThemedStyles(createStyles);
  const label = useAnimatedStyle(() => ({ left: t * pps.value - 20 }));
  const dot = useAnimatedStyle(() => ({
    left: (t + step / 2) * pps.value - 1.5,
  }));
  return (
    <>
      <Animated.Text style={[styles.rulerLabel, label]}>{formatTime(t)}</Animated.Text>
      <Animated.View style={[styles.rulerDot, dot]} />
    </>
  );
}

function ReorderStrip({
  main,
  strips,
  assets,
  from,
  tile,
  x,
  x0,
  to,
}: {
  main: VideoClip[];
  strips: Record<ID, FilmStrip>;
  assets: Record<ID, MediaAsset>;
  from: number;
  tile: number;
  x: SharedValue<number>;
  x0: SharedValue<number>;
  to: SharedValue<number>;
}) {
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { top: TRACK_TOP + (TRACK_H - tile) / 2 }]}>
      {main.map((c, i) => (
        <ReorderTile
          key={c.id}
          index={i}
          from={from}
          tile={tile}
          x={x}
          x0={x0}
          to={to}
          frame={tileSource(assets[c.assetId], strips[c.assetId], c.in)}
        />
      ))}
    </View>
  );
}

function ReorderTile({
  index,
  from,
  tile,
  x,
  x0,
  to,
  frame,
}: {
  index: number;
  from: number;
  tile: number;
  x: SharedValue<number>;
  x0: SharedValue<number>;
  to: SharedValue<number>;
  frame: ReturnType<typeof tileSource>;
}) {
  const { colors } = useAppTheme();
  const styles = useThemedStyles(createStyles);
  const style = useAnimatedStyle(() => {
    const slot = tile + REORDER_GAP;
    if (index === from) {
      return {
        left: x.value - tile / 2,
        zIndex: 2,
        transform: [{ scale: withSpring(1.12) }],
      };
    }
    let shift = 0;
    if (from < to.value && index > from && index <= to.value) shift = -slot;
    if (from > to.value && index < from && index >= to.value) shift = slot;
    return {
      left: x0.value + index * slot,
      zIndex: 1,
      transform: [{ translateX: withSpring(shift, { damping: 20, stiffness: 260 }) }],
    };
  });
  return (
    <Animated.View
      style={[
        styles.reorderTile,
        { width: tile, height: tile },
        index === from && { borderColor: colors.selection, borderWidth: 2 },
        style,
      ]}>
      <Image source={frame} style={StyleSheet.absoluteFill} contentFit="cover" />
    </Animated.View>
  );
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  root: { width: '100%', overflow: 'hidden', backgroundColor: colors.surface },
  content: { ...StyleSheet.absoluteFill },
  ruler: { position: 'absolute', top: 0, left: 0, height: RULER_H },
  rulerLabel: {
    ...font.mono,
    position: 'absolute',
    top: 6,
    width: 40,
    textAlign: 'center',
    fontSize: 10,
    color: colors.textDim,
  },
  rulerDot: {
    position: 'absolute',
    top: 12,
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: colors.textFaint,
  },
  clip: {
    position: 'absolute',
    top: TRACK_TOP,
    height: TRACK_H,
    borderRadius: 7,
    overflow: 'hidden',
    backgroundColor: colors.surface3,
  },
  tiles: { position: 'absolute', top: 0, bottom: 0 },
  mainWaveform: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 16, backgroundColor: 'rgba(0,0,0,0.4)' },
  audioWaveform: { position: 'absolute', top: 4, left: 0, right: 0, height: 22 },
  waveformBars: { position: 'absolute', top: 0 },
  marker: { position: 'absolute', top: 0, width: 32, height: 32, zIndex: 3 },
  markerDiamond: { position: 'absolute', top: 21, left: 12, width: 8, height: 8, borderRadius: 1, backgroundColor: colors.accent, transform: [{ rotate: '45deg' }] },
  tile: { position: 'absolute', top: 0, width: TILE_W, height: TRACK_H },
  fade: { position: 'absolute', top: 0, bottom: 0 },
  fill: { ...StyleSheet.absoluteFill },
  clipShade: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(7,10,14,0.15)',
  },
  badges: {
    position: 'absolute',
    left: 4,
    top: 4,
    flexDirection: 'row',
    gap: 3,
  },
  /** Crossfade marker on the clip's left edge (its cut with the previous clip). */
  xfade: {
    position: 'absolute',
    left: 2,
    bottom: 4,
    width: 20,
    height: 20,
    borderRadius: 6,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    ...font.mono,
    fontSize: 10,
    color: '#fff',
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
    overflow: 'hidden',
  },
  frame: {
    position: 'absolute',
    top: TRACK_TOP - 2,
    height: TRACK_H + 4,
    flexDirection: 'row',
  },
  frameMid: {
    flex: 1,
    borderTopWidth: 2,
    borderBottomWidth: 2,
    borderColor: colors.selection,
  },
  handle: {
    width: HANDLE_W,
    backgroundColor: colors.selection,
    alignItems: 'center',
    justifyContent: 'center',
  },
  handleLeft: { borderTopLeftRadius: 6, borderBottomLeftRadius: 6 },
  handleRight: { borderTopRightRadius: 6, borderBottomRightRadius: 6 },
  grip: { width: 3, height: 18, borderRadius: 1.5, backgroundColor: colors.accentInk },
  playhead: {
    position: 'absolute',
    top: RULER_H - 4,
    width: 2,
    backgroundColor: colors.text,
    borderRadius: 1,
  },
  playheadKnob: {
    position: 'absolute',
    top: -4,
    left: -3,
    width: 8,
    height: 8,
    borderRadius: 2,
    backgroundColor: colors.text,
  },
  add: {
    position: 'absolute',
    right: 12,
    top: TRACK_TOP + (TRACK_H - 44) / 2,
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: colors.accent,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.28,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  ov: {
    position: 'absolute',
    height: LANE_H,
    borderRadius: radius.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 7,
    overflow: 'hidden',
  },
  ovText: { backgroundColor: colors.accentSoft },
  ovAudio: { backgroundColor: colors.surfaceRaised },
  ovSelected: { backgroundColor: colors.accentSoft },
  ovLabel: { ...font.small, color: colors.text, fontSize: 11, flexShrink: 1 },
  placeholder: {
    position: 'absolute',
    height: LANE_H,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 10,
    borderRadius: radius.sm,
    backgroundColor: colors.surface2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  placeholderText: { ...font.small, color: colors.textDim, fontSize: 11 },
  reorderTile: {
    position: 'absolute',
    top: 0,
    borderRadius: radius.sm,
    overflow: 'hidden',
    backgroundColor: colors.surface3,
  },
});
