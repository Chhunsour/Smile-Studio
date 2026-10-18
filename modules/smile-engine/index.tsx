import { requireNativeView, requireOptionalNativeModule, type NativeModule } from 'expo';
import type { VideoPlayer } from 'expo-video';
import type { ComponentType, ReactNode } from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import type { ColorMatrix } from '../../src/core/color';
import type { AudioAnalysis } from '../../src/core/audio-analysis';
import type { ExportSpec } from '../../src/core/export';

type Events = { onExportProgress: (e: { progress: number }) => void };
declare class SmileEngine extends NativeModule<Events> {
  exportVideo(spec: ExportSpec): Promise<string>;
  cancelExport(): void;
  analyzeAudio?(uri: string, requestId: string): Promise<AudioAnalysis>;
  cancelAudioAnalysis?(requestId: string): void;
  /** Android only. */
  displayName?(uri: string): string | null;
}

// Optional: a build without the native module still edits and plays, just without color or export.
const native = requireOptionalNativeModule<SmileEngine>('SmileEngine');
const available = native != null;

export const canExport = available;

/** Renders `spec` to an MP4 natively; resolves with the file URI. Rejects when cancelled or on failure. */
export async function exportVideo(spec: ExportSpec, onProgress: (progress: number) => void): Promise<string> {
  if (!native) throw new Error('Export needs a development build with the SmileEngine module.');
  const sub = native.addListener('onExportProgress', (e) => onProgress(e.progress));
  try {
    return await native.exportVideo(spec);
  } finally {
    sub.remove();
  }
}

export function cancelExport() {
  native?.cancelExport();
}

/** Decode local media on a native background worker. Older development builds remain usable. */
export async function analyzeAudio(uri: string, signal?: AbortSignal): Promise<AudioAnalysis> {
  if (!native?.analyzeAudio) throw new Error('Audio waveforms and beat detection need a development build with the updated SmileEngine module.');
  if (signal?.aborted) throw new Error('Audio analysis cancelled.');
  const requestId = `wave-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let abort: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const interrupted = new Promise<never>((_resolve, reject) => {
    abort = () => { native.cancelAudioAnalysis?.(requestId); reject(new Error('Audio analysis cancelled.')); };
    signal?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => { native.cancelAudioAnalysis?.(requestId); reject(new Error('This file took too long to analyze. Try a shorter audio file.')); }, 40_000);
  });
  try { return await Promise.race([native.analyzeAudio(uri, requestId), interrupted]); }
  finally { if (timer) clearTimeout(timer); if (abort) signal?.removeEventListener('abort', abort); }
}

/** The user-facing name of a picked file (Android content:// URIs don't contain it), or null if unknown. */
export function displayName(uri: string): string | null {
  return native?.displayName?.(uri) ?? null;
}

type NativeProps = {
  matrix: ColorMatrix;
  player?: number;
  image?: string;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
};
const NativeColorView: ComponentType<NativeProps> | null = available
  ? requireNativeView<NativeProps>('SmileEngine')
  : null;

/**
 * A container (positioned by `style`) that shows `children`, the player's VideoView filling it, color graded by
 * `matrix`. It is the same element whether or not a matrix is set, so toggling a filter never remounts the video.
 *
 * - iOS: a Metal view on top that draws the player's frames through the matrix. It can't be done on the player
 *   item itself: on iOS 27 any AVVideoComposition compositor fails playback (see ios/SmileEngineModule.swift).
 * - Android: the player's TextureView is drawn through a ColorMatrixColorFilter.
 *
 * Like expo-video we pass the player's shared-object id, not the object: React Native freezes view props in
 * development, and a frozen player can no longer be released.
 *
 * Photos pass `image` (a file URI) instead: iOS draws that file through the matrix, Android's container colors its
 * (non-video) children.
 */
export function ColorFrame({
  player,
  image,
  matrix,
  style,
  children,
}: {
  player: VideoPlayer;
  image?: string;
  matrix: ColorMatrix | null;
  style: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  if (!NativeColorView) return <View style={style}>{children}</View>;
  if (Platform.OS === 'android') {
    return (
      <NativeColorView matrix={matrix ?? []} style={style}>
        {children}
      </NativeColorView>
    );
  }
  const id = image ? undefined : (player as unknown as { __expo_shared_object_id__: number }).__expo_shared_object_id__;
  return (
    <View style={style}>
      {children}
      {matrix ? <NativeColorView matrix={matrix} player={id} image={image} style={StyleSheet.absoluteFill} /> : null}
    </View>
  );
}
