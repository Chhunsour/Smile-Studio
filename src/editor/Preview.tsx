import { Image } from 'expo-image';
import { VideoView, type VideoPlayer } from 'expo-video';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { ColorFrame } from '../../modules/smile-engine';
import { colorMatrix } from '@/core/color';
import {
  clipDuration,
  clipStarts,
  crossfadeWeight,
  fadeGain,
  fitFrame,
  kenBurnsScale,
  textAnimAt,
  transitionLength,
} from '@/core/timeline';
import type { ID, MediaAsset, TextOverlay, Transform, VideoClip } from '@/core/types';
import type { PlaybackEngine } from '@/playback/engine';
import { selectionKind, useEditor } from '@/state/editor';
import { fileUri } from '@/storage/projects';
import { fontStyle } from '@/ui/fonts';
import { StudioIcon as Ionicons } from '@/ui/StudioIcon';
import { font, useAppTheme, useThemedStyles, type AppColors } from '@/ui/theme';
import { EffectsOverlay } from './EffectsOverlay';

/** Uncommitted gesture applied on top of the stored transform: pixels, scale factor, degrees. */
type Live = { id: ID; kind: 'text' | 'clip'; dx: number; dy: number; scale: number; rot: number } | null;
/** The thing canvas gestures manipulate: center and half-size in canvas pixels, rotation in degrees. */
type Target = { id: ID; kind: 'text' | 'clip'; cx: number; cy: number; hw: number; hh: number; rot: number } | null;
/** Where a clip sits on the timeline and the crossfades it takes part in (cut time + length), for its layer. */
type Placement = {
  index: number;
  start: number;
  duration: number;
  xin: { cut: number; d: number } | null;
  xout: { cut: number; d: number } | null;
};

export const IDENTITY_TRANSFORM: Transform = { x: 0, y: 0, scale: 1, rotation: 0, flip: false };
const HANDLE_R = 26;
const NO_CLIPS: VideoClip[] = [];
const NO_TEXTS: TextOverlay[] = [];
const NO_ASSETS: Record<ID, MediaAsset> = {};

/** Blur radius of the 'blur' background as a fraction of the canvas width (the exporters use the same). */
export const BACKGROUND_BLUR = 0.04;

/** Rotate a local offset by `deg` and add the center. */
function corner(t: NonNullable<Target>, lx: number, ly: number) {
  'worklet';
  const r = (t.rot * Math.PI) / 180;
  return { x: t.cx + lx * Math.cos(r) - ly * Math.sin(r), y: t.cy + lx * Math.sin(r) + ly * Math.cos(r) };
}

/** The project canvas: fits the largest box of `ratio` into the available space and stacks the layers. */
export function Preview({ engine, ratio, empty }: { engine: PlaybackEngine; ratio: number; empty: boolean }) {
  const { colors } = useAppTheme();
  const styles = useThemedStyles(createStyles);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const W = Math.min(box.w, box.h * ratio);
  const H = W / ratio;

  const main = useEditor((s) => s.project?.main ?? NO_CLIPS);
  const texts = useEditor((s) => s.project?.texts ?? NO_TEXTS);
  const assets = useEditor((s) => s.project?.assets ?? NO_ASSETS);
  const selectedId = useEditor((s) => s.selectedId);
  const background = useEditor((s) => s.project?.background ?? '#000000');
  const clipsById = useMemo(() => Object.fromEntries(main.map((c) => [c.id, c])), [main]);
  const placements = useMemo(() => {
    const starts = clipStarts(main);
    // A crossfade needs two views, so pieces of the same file (one shared player) just cut in the preview.
    const xfade = (i: number) => {
      const d = transitionLength(main, i);
      return d > 0 && main[i - 1].assetId !== main[i].assetId ? { cut: starts[i], d } : null;
    };
    return Object.fromEntries(
      main.map((c, i): [ID, Placement] => [
        c.id,
        { index: i, start: starts[i], duration: clipDuration(c), xin: xfade(i), xout: i + 1 < main.length ? xfade(i + 1) : null },
      ]),
    );
  }, [main]);
  const shownClipId = engine.views.find((v) => v.assetId === engine.activeAssetId)?.clipId ?? null;

  const live = useSharedValue<Live>(null);

  // Android: a paused TextureView is blank after a resize until the player seeks; re-seek in place.
  const { redraw } = engine;
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const t = setTimeout(redraw, 150);
    return () => clearTimeout(t);
  }, [W, H, engine.views, engine.activeAssetId, redraw]);
  const target = useSharedValue<Target>(null);
  const [textSizes, setTextSizes] = useState<Record<ID, { w: number; h: number }>>({});

  // Clear the live gesture in the same commit that renders the stored result.
  useLayoutEffect(() => {
    live.set(null);
  }, [texts, main, live]);

  // What canvas gestures act on: the selected text, or the selected clip if it's the one on screen.
  useEffect(() => {
    const text = texts.find((t) => t.id === selectedId);
    if (text) {
      const sz = textSizes[text.id] ?? { w: 120, h: 40 };
      target.set({
        id: text.id,
        kind: 'text',
        cx: text.x * W,
        cy: text.y * H,
        hw: sz.w / 2,
        hh: sz.h / 2,
        rot: text.rotation,
      });
      return;
    }
    const clip = selectedId && selectedId === shownClipId ? clipsById[selectedId] : undefined;
    const asset = clip && assets[clip.assetId];
    if (clip && asset && W > 0) {
      const t = clip.transform ?? IDENTITY_TRANSFORM;
      const f = fitFrame(asset, clip.crop, W, H);
      target.set({
        id: clip.id,
        kind: 'clip',
        cx: W / 2 + t.x * W,
        cy: H / 2 + t.y * H,
        hw: (f.w * t.scale) / 2,
        hh: (f.h * t.scale) / 2,
        rot: t.rotation,
      });
      return;
    }
    target.set(null);
  }, [selectedId, texts, clipsById, assets, shownClipId, W, H, target, textSizes]);

  const onTextSize = useCallback((id: ID, w: number, h: number) => {
    setTextSizes((all) => {
      const prev = all[id];
      return prev && Math.abs(prev.w - w) < 0.5 && Math.abs(prev.h - h) < 0.5 ? all : { ...all, [id]: { w, h } };
    });
  }, []);

  // --- JS handlers -------------------------------------------------------------------------------
  const hitText = useCallback(
    (x: number, y: number) => {
      const t = engine.currentTime();
      for (let i = texts.length - 1; i >= 0; i--) {
        const o = texts[i];
        if (t < o.start || t >= o.end) continue;
        const sz = textSizes[o.id] ?? { w: 120, h: 40 };
        const r = (-o.rotation * Math.PI) / 180;
        const dx = x - o.x * W;
        const dy = y - o.y * H;
        const lx = dx * Math.cos(r) - dy * Math.sin(r);
        const ly = dx * Math.sin(r) + dy * Math.cos(r);
        if (Math.abs(lx) <= sz.w / 2 + 12 && Math.abs(ly) <= sz.h / 2 + 12) return o;
      }
      return null;
    },
    [engine, texts, textSizes, W, H],
  );

  const onTap = useCallback(
    (x: number, y: number) => {
      const { select, remove, selectedId: cur, project } = useEditor.getState();
      const tgt = target.value;
      if (tgt?.kind === 'text') {
        const del = corner(tgt, -tgt.hw, -tgt.hh);
        if (Math.hypot(x - del.x, y - del.y) < HANDLE_R) return remove(tgt.id);
      }
      const hit = hitText(x, y);
      if (hit) return select(hit.id);
      if (selectionKind(project, cur) === 'clip' && cur === shownClipId) return select(null);
      select(shownClipId);
    },
    [hitText, shownClipId, target],
  );

  const onDoubleTap = useCallback(
    (x: number, y: number) => {
      const hit = hitText(x, y);
      if (!hit) return;
      useEditor.getState().select(hit.id);
      useEditor.getState().setPanel('text');
    },
    [hitText],
  );

  const commit = useCallback(
    (l: Live) => {
      if (!l || W <= 0) return;
      const { project, updateText, updateClip } = useEditor.getState();
      if (!project) return;
      if (l.kind === 'text') {
        const o = project.texts.find((t) => t.id === l.id);
        if (!o) return;
        updateText(o.id, {
          x: o.x + l.dx / W,
          y: o.y + l.dy / H,
          size: Math.min(0.5, Math.max(0.02, o.size * l.scale)),
          rotation: o.rotation + l.rot,
        });
      } else {
        const c = project.main.find((m) => m.id === l.id);
        if (!c) return;
        const t = c.transform ?? IDENTITY_TRANSFORM;
        updateClip(c.id, {
          transform: {
            ...t,
            x: t.x + l.dx / W,
            y: t.y + l.dy / H,
            scale: Math.min(10, Math.max(0.1, t.scale * l.scale)),
            rotation: t.rotation + l.rot,
          },
        });
      }
    },
    [W, H],
  );

  // --- Gestures (UI thread) ----------------------------------------------------------------------
  const panDx = useSharedValue(0);
  const panDy = useSharedValue(0);
  const pinch = useSharedValue(1);
  const twist = useSharedValue(0);
  const cornerMode = useSharedValue(false);
  const cornerStart = useSharedValue({ x: 0, y: 0 });
  const activeCount = useSharedValue(0);
  /** Which of pan / pinch / rotation (bits 1, 2, 4) are active, so a cancelled one still counts as ended. */
  const activeBits = useSharedValue(0);

  const gesture = useMemo(() => {
    const begin = (bit: number) => {
      'worklet';
      activeBits.set(activeBits.value | bit);
      if (activeCount.value === 0) {
        panDx.set(0);
        panDy.set(0);
        pinch.set(1);
        twist.set(0);
      }
      activeCount.set(activeCount.value + 1);
    };
    const publish = () => {
      'worklet';
      const t = target.value;
      if (!t) return;
      live.set({ id: t.id, kind: t.kind, dx: panDx.value, dy: panDy.value, scale: pinch.value, rot: twist.value });
    };
    const end = (bit: number) => {
      'worklet';
      if (!(activeBits.value & bit)) return;
      activeBits.set(activeBits.value & ~bit);
      activeCount.set(Math.max(0, activeCount.value - 1));
      if (activeCount.value === 0 && target.value) scheduleOnRN(commit, live.value);
    };

    const pan = Gesture.Pan()
      .onBegin((e) => {
        const t = target.value;
        if (!t || t.kind !== 'text') return cornerMode.set(false);
        const c = corner(t, t.hw, t.hh);
        cornerMode.set(Math.hypot(e.x - c.x, e.y - c.y) < HANDLE_R);
        cornerStart.set({ x: e.x - t.cx, y: e.y - t.cy });
      })
      .onStart(() => begin(1))
      .onUpdate((e) => {
        const t = target.value;
        if (!t) return;
        if (cornerMode.value) {
          // One-finger scale + rotate around the center, from the bottom-right handle.
          const sx = cornerStart.value.x;
          const sy = cornerStart.value.y;
          const cx = sx + e.translationX;
          const cy = sy + e.translationY;
          pinch.set(Math.max(0.1, Math.hypot(cx, cy) / Math.max(1, Math.hypot(sx, sy))));
          twist.set(((Math.atan2(cy, cx) - Math.atan2(sy, sx)) * 180) / Math.PI);
        } else {
          panDx.set(e.translationX);
          panDy.set(e.translationY);
        }
        publish();
      })
      .onFinalize(() => end(1));

    const pinchG = Gesture.Pinch()
      .onStart(() => begin(2))
      .onUpdate((e) => {
        pinch.set(e.scale);
        publish();
      })
      .onFinalize(() => end(2));

    const rotateG = Gesture.Rotation()
      .onStart(() => begin(4))
      .onUpdate((e) => {
        twist.set((e.rotation * 180) / Math.PI);
        publish();
      })
      .onFinalize(() => end(4));

    const tap = Gesture.Tap().onEnd((e, success) => success && scheduleOnRN(onTap, e.x, e.y));
    const doubleTap = Gesture.Tap()
      .numberOfTaps(2)
      .onEnd((e, success) => success && scheduleOnRN(onDoubleTap, e.x, e.y));

    return Gesture.Simultaneous(pan, pinchG, rotateG, Gesture.Exclusive(doubleTap, tap));
  }, [
    activeBits,
    activeCount,
    commit,
    cornerMode,
    cornerStart,
    live,
    onDoubleTap,
    onTap,
    panDx,
    panDy,
    pinch,
    target,
    twist,
  ]);

  return (
    <View
      style={styles.area}
      onLayout={(e) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      <View style={styles.viewport}>
        {W > 0 && H > 0 ? (
          <GestureDetector gesture={gesture}>
            <View
              style={[styles.canvas, { width: W, height: H }, (empty || background !== 'blur') && { backgroundColor: empty ? colors.surface : background }]}
              collapsable={false}>
              {engine.views.map((v) => {
                const clip = v.clipId ? clipsById[v.clipId] : undefined;
                return (
                  <ClipLayer
                    key={v.assetId}
                    player={v.player}
                    clip={clip}
                    placement={clip ? placements[clip.id] : undefined}
                    time={engine.time}
                    asset={assets[v.assetId]}
                    W={W}
                    H={H}
                    background={background}
                    active={v.assetId === engine.activeAssetId}
                    selected={!!clip && clip.id === selectedId}
                    live={live}
                  />
                );
              })}
              {texts.map((o) => (
                <TextLayer
                  key={o.id}
                  o={o}
                  W={W}
                  H={H}
                  time={engine.time}
                  live={live}
                  selected={o.id === selectedId}
                  // A selected text shows its settled look so it can be edited mid-animation, except while playing.
                  settled={o.id === selectedId && !engine.playing}
                  onSize={onTextSize}
                />
              ))}
              {empty ? (
                <View pointerEvents="none" style={styles.emptyState}>
                  <View style={styles.emptyIcon}>
                    <Ionicons name="film-outline" size={30} color={colors.accentText} />
                  </View>
                  <Text style={styles.empty}>Your canvas awaits</Text>
                  <Text style={styles.emptyHint}>Add a video or photo to begin</Text>
                </View>
              ) : null}
            </View>
          </GestureDetector>
        ) : null}
      </View>
    </View>
  );
}

const ClipLayer = memo(function ClipLayer({
  player,
  clip,
  placement,
  time,
  asset,
  W,
  H,
  background,
  active,
  selected,
  live,
}: {
  player: VideoPlayer;
  clip: VideoClip | undefined;
  placement: Placement | undefined;
  time: SharedValue<number>;
  asset: MediaAsset | undefined;
  W: number;
  H: number;
  background: string;
  active: boolean;
  selected: boolean;
  live: SharedValue<Live>;
}) {
  const styles = useThemedStyles(createStyles);
  const t = clip?.transform ?? IDENTITY_TRANSFORM;
  const crop = clip?.crop ?? { x: 0, y: 0, w: 1, h: 1 };
  const frame = fitFrame(asset ?? { width: W, height: H }, crop, W, H);
  const fullW = frame.w / crop.w;
  const fullH = frame.h / crop.h;
  const id = clip?.id;
  const matrix = useMemo(() => colorMatrix(clip?.color), [clip?.color]);
  const still = asset?.kind === 'image' ? fileUri(asset.path) : undefined;
  const fullFrame = {
    position: 'absolute' as const,
    left: -crop.x * fullW,
    top: -crop.y * fullH,
    width: fullW,
    height: fullH,
  };

  const kenBurns = !!clip?.kenBurns;
  const visibility = useAnimatedStyle(() => {
    const now = time.value;
    // In a crossfade the incoming clip is drawn over the outgoing one (higher zIndex) at the incoming weight.
    let opacity = active ? 1 : 0;
    const xin = placement?.xin;
    const xout = placement?.xout;
    const w = xin ? crossfadeWeight(now, xin.cut, xin.d) : null;
    if (w !== null) opacity = w;
    else if (xout && crossfadeWeight(now, xout.cut, xout.d) !== null) opacity = 1;
    return { opacity };
  });
  const style = useAnimatedStyle(() => {
    const l = live.value && live.value.id === id ? live.value : null;
    let s = t.scale * (l ? l.scale : 1);
    if (kenBurns && placement) s *= kenBurnsScale(time.value - placement.start, placement.duration);
    return {
      transform: [
        { translateX: t.x * W + (l ? l.dx : 0) },
        { translateY: t.y * H + (l ? l.dy : 0) },
        { rotate: `${t.rotation + (l ? l.rot : 0)}deg` },
        { scaleX: t.flip ? -s : s },
        { scaleY: s },
      ],
    };
  });
  const fade = useAnimatedStyle(() => ({
    opacity: placement ? 1 - fadeGain(time.value - placement.start, placement.duration, clip?.fadeIn ?? 0, clip?.fadeOut ?? 0) : 0,
  }));

  return (
    <Animated.View
      pointerEvents="none"
      needsOffscreenAlphaCompositing
      style={[StyleSheet.absoluteFill, { zIndex: placement?.index ?? 0 }, visibility]}>
      {background === 'blur' && clip ? (
        <BlurBackground clip={clip} asset={asset} W={W} H={H} />
      ) : <View style={[StyleSheet.absoluteFill, { backgroundColor: background === 'blur' ? '#000000' : background }]} />}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.frame,
          { left: (W - frame.w) / 2, top: (H - frame.h) / 2, width: frame.w, height: frame.h },
          selected && active && styles.frameSelected,
          style,
        ]}>
        <ColorFrame player={player} image={still} matrix={matrix} style={fullFrame}>
          {still ? (
            <Image source={{ uri: still }} contentFit="fill" style={StyleSheet.absoluteFill} />
          ) : (
            <VideoView
              player={player}
              nativeControls={false}
              contentFit="fill"
              surfaceType="textureView"
              allowsPictureInPicture={false}
              allowsVideoFrameAnalysis={false}
              style={StyleSheet.absoluteFill}
            />
          )}
        </ColorFrame>
      </Animated.View>
      {clip ? <EffectsOverlay settings={clip.effects} seedId={clip.assetId} width={W} height={H} /> : null}
      {clip && (clip.fadeIn || clip.fadeOut) ? <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.sceneFade, fade]} /> : null}
    </Animated.View>
  );
});

/**
 * The clip on screen, scaled to cover the canvas and blurred, behind it.
 * ponytail: one still per clip (the photo, or the video's poster frame), not the live video, and without the clip's
 * color look; the export blurs every frame. (Filmstrip frames would be closer, but expo-image doesn't blur those
 * in-memory images.) Render the player into a second view if the difference shows.
 */
function BlurBackground({ clip, asset, W, H }: { clip: VideoClip; asset: MediaAsset | undefined; W: number; H: number }) {
  const file = asset?.kind === 'image' ? asset.path : asset?.poster;
  if (!asset || !file || asset.width <= 0 || asset.height <= 0) return null;
  const source = { uri: fileUri(file) };
  const c = clip.crop ?? { x: 0, y: 0, w: 1, h: 1 };
  const k = Math.max(W / (asset.width * c.w), H / (asset.height * c.h));
  const fw = asset.width * k;
  const fh = asset.height * k;
  return (
    <Image
      source={source}
      // expo-image blurs in source pixels; posters and photos are full size, so convert from canvas points.
      blurRadius={(BACKGROUND_BLUR * W) / k}
      contentFit="fill"
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: W / 2 - (c.x + c.w / 2) * fw,
        top: H / 2 - (c.y + c.h / 2) * fh,
        width: fw,
        height: fh,
      }}
    />
  );
}

const TextLayer = memo(function TextLayer({
  o,
  W,
  H,
  time,
  live,
  selected,
  settled,
  onSize,
}: {
  o: TextOverlay;
  W: number;
  H: number;
  time: SharedValue<number>;
  live: SharedValue<Live>;
  selected: boolean;
  settled: boolean;
  onSize: (id: ID, w: number, h: number) => void;
}) {
  const { colors } = useAppTheme();
  const styles = useThemedStyles(createStyles);
  const visible = useAnimatedStyle(() => {
    const t = time.value;
    return { opacity: t >= o.start && t < o.end ? (settled ? 1 : textAnimAt(o, t).alpha) : 0 };
  });
  const moving = useAnimatedStyle(() => {
    const l = live.value && live.value.id === o.id ? live.value : null;
    const a = settled ? null : textAnimAt(o, time.value);
    return {
      transform: [
        { translateX: (o.x - 0.5) * W + (l ? l.dx : 0) },
        { translateY: (o.y - 0.5 + (a ? a.dy : 0)) * H + (l ? l.dy : 0) },
        { rotate: `${o.rotation + (l ? l.rot : 0)}deg` },
        { scale: (l ? l.scale : 1) * (a ? a.scale : 1) },
      ],
    };
  });
  const px = o.size * W;

  return (
    <Animated.View pointerEvents="none" style={[styles.anchor, visible]}>
      <Animated.View
        style={[{ opacity: o.opacity }, selected && styles.textSelected, moving]}
        onLayout={(e) => onSize(o.id, e.nativeEvent.layout.width, e.nativeEvent.layout.height)}>
        <Text
          style={[
            fontStyle(o.font),
            { fontSize: px, lineHeight: px * 1.2, color: o.color, textAlign: 'center', maxWidth: W * 0.9 },
            o.box
              ? {
                  backgroundColor: 'rgba(0,0,0,0.6)',
                  paddingHorizontal: px * 0.35,
                  paddingVertical: px * 0.12,
                  borderRadius: px * 0.25,
                  overflow: 'hidden',
                }
              : styles.textShadow,
          ]}>
          {o.text || ' '}
        </Text>
        {selected ? (
          <>
            <View style={[styles.handle, styles.handleDelete]}>
              <Ionicons name="close" size={14} color={colors.accentInk} />
            </View>
            <View style={[styles.handle, styles.handleScale]}>
              <Ionicons name="resize" size={14} color={colors.accentInk} />
            </View>
          </>
        ) : null}
      </Animated.View>
    </Animated.View>
  );
});

const createStyles = (colors: AppColors) => StyleSheet.create({
  // Keep the previous canvas size from establishing a minimum height while a tool panel opens.
  area: { flex: 1, minHeight: 0, overflow: 'hidden', marginHorizontal: 12 },
  viewport: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  canvas: {
    backgroundColor: '#000',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: 4,
  },
  frame: { position: 'absolute', overflow: 'hidden' },
  frameSelected: { borderWidth: 1.5, borderColor: colors.selection },
  // Canvas-sized and centered; the text is then translated to its anchor point.
  anchor: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', zIndex: 10000 },
  textSelected: { borderWidth: 1.5, borderColor: colors.selection, borderStyle: 'dashed', padding: 4 },
  textShadow: { textShadowColor: 'rgba(0,0,0,0.55)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 },
  handle: {
    position: 'absolute',
    width: 24,
    height: 24,
    borderRadius: 8,
    backgroundColor: colors.selection,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.accentInk,
    alignItems: 'center',
    justifyContent: 'center',
  },
  handleDelete: { left: -12, top: -12 },
  handleScale: { right: -12, bottom: -12 },
  emptyState: { alignItems: 'center', gap: 8, padding: 20 },
  emptyIcon: {
    width: 58, height: 58, borderRadius: 18, marginBottom: 7,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface2,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  empty: { ...font.body, color: colors.text },
  emptyHint: { ...font.small, color: colors.textDim, textAlign: 'center' },
  sceneFade: { backgroundColor: '#000', zIndex: 2 },
});
