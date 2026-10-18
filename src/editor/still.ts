import { Directory, Paths } from 'expo-file-system';
import { getThumbnailAsync } from 'expo-video-thumbnails';

import { buildExportSpec, sliceSpec } from '@/core/export';
import type { Project } from '@/core/types';
import { fileUri } from '@/storage/projects';

import { canExport, exportVideo } from '../../modules/smile-engine';

/** Rendered length of the slice the frame is taken from; a few frames so every encoder emits at least one. */
const SLICE = 0.25;

/**
 * The frame at timeline time `t` exactly as an export draws it (crop, color, transform, fades, and texts unless
 * `withText` is false), as a 1080p JPEG. Renders a tiny slice through the native exporter and takes its first frame,
 * so it can never drift from what export produces.
 */
export async function renderStill(project: Project, t: number, withText: boolean) {
  if (!canExport) throw new Error('Rendering frames needs a development build with the SmileEngine module.');
  const dir = new Directory(Paths.cache, 'stills');
  if (dir.exists) dir.delete();
  dir.create({ intermediates: true });
  const full = buildExportSpec(
    withText ? project : { ...project, texts: [] },
    { resolution: 1080, fps: 30, output: `${dir.uri.replace(/\/?$/, '/')}still-${Date.now()}.mp4` },
    (a) => fileUri(a.path),
  );
  const from = Math.max(0, Math.min(t, full.duration - 0.1));
  const video = await exportVideo(sliceSpec(full, from, SLICE), () => {});
  return getThumbnailAsync(video, { time: 0, quality: 0.95 });
}
