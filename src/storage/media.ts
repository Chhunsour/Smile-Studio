import * as ImagePicker from 'expo-image-picker';
import { File, Paths } from 'expo-file-system';
import { createVideoPlayer } from 'expo-video';
import { getThumbnailAsync } from 'expo-video-thumbnails';

import { PHOTO_MAX } from '@/core/timeline';
import type { MediaAsset } from '@/core/types';
import { waitReady } from '@/playback/player-utils';
import { protectMediaPaths, releaseMediaPaths } from '@/state/import';

import { displayName } from '../../modules/smile-engine';
import { mediaDir, newId } from './projects';

/** Keep this much free space after an import so the OS and later exports still have room. */
const DISK_HEADROOM = 300 * 1024 * 1024;

/** Photos are stored at most this many pixels on the long side (enough for 1080p export with zoom). */
const PHOTO_LONG_SIDE = 2560;

export async function pickMedia(): Promise<ImagePicker.ImagePickerAsset[]> {
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['videos', 'images'],
    allowsMultipleSelection: true,
    selectionLimit: 0,
    orderedSelection: true,
    // Hand us the original file instead of transcoding it (much faster for long clips).
    preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current,
  });
  if (res.canceled) return [];
  return res.assets;
}

/**
 * Copies a picked photo into app storage as an upright JPEG (HEIC and EXIF rotation would otherwise need handling
 * in every player and exporter), scaled down to PHOTO_LONG_SIDE.
 */
export async function importPhoto(picked: Pick<ImagePicker.ImagePickerAsset, 'uri' | 'width' | 'height' | 'fileName'>) {
  let savedUri = picked.uri;
  let savedWidth = picked.width || 1080;
  let savedHeight = picked.height || 1920;
  let usedManipulator = false;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ImageManipulator, SaveFormat } = require('expo-image-manipulator');
    const scale = Math.min(1, PHOTO_LONG_SIDE / Math.max(picked.width || 1, picked.height || 1));
    const ctx = ImageManipulator.manipulate(picked.uri);
    if (scale < 1) ctx.resize(picked.width >= picked.height ? { width: PHOTO_LONG_SIDE } : { height: PHOTO_LONG_SIDE });
    const image = await ctx.renderAsync();
    const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.92 });
    savedUri = saved.uri;
    savedWidth = saved.width;
    savedHeight = saved.height;
    usedManipulator = true;
  } catch {
    // ImageManipulator native module is optional or not linked yet
  }

  const id = newId();
  const dest = new File(mediaDir(), `${id}.jpg`);
  const src = new File(savedUri);
  if (usedManipulator) {
    src.moveSync(dest);
  } else {
    src.copy(dest);
  }
  const path = `media/${dest.name}`;
  return {
    id,
    kind: 'image',
    path,
    poster: path,
    name: picked.fileName ?? 'Photo',
    duration: PHOTO_MAX,
    width: savedWidth,
    height: savedHeight,
  } satisfies MediaAsset;
}

/** Copies a picked video into app storage and extracts a poster frame. */
export async function importVideo(picked: ImagePicker.ImagePickerAsset): Promise<MediaAsset> {
  if (picked.type === 'image' || picked.type === 'livePhoto') return importPhoto(picked);
  const src = new File(picked.uri);
  const size = picked.fileSize ?? (src.exists ? src.size : 0);
  if (size && Paths.availableDiskSpace < size + DISK_HEADROOM) {
    throw new Error('Not enough free storage to import this video. Free up some space and try again.');
  }

  const id = newId();
  const ext = (picked.fileName ?? picked.uri).split('.').pop()?.toLowerCase() || 'mp4';
  const dest = new File(mediaDir(), `${id}.${ext}`);
  // The picker hands us a private cache copy, so moving it is safe and avoids doubling disk usage.
  try {
    src.moveSync(dest);
  } catch {
    src.copySync(dest);
  }

  let duration = picked.duration ? picked.duration / 1000 : 0;
  if (!duration) duration = await probeDuration(dest.uri);
  if (!(duration > 0)) {
    dest.delete();
    throw new Error(`"${picked.fileName ?? 'Video'}" could not be read.`);
  }

  const thumb = await getThumbnailAsync(dest.uri, { time: Math.min(500, duration * 500), quality: 0.7 });
  const poster = new File(mediaDir(), `${id}.jpg`);
  new File(thumb.uri).moveSync(poster);

  return {
    id,
    kind: 'video',
    path: `media/${dest.name}`,
    poster: `media/${poster.name}`,
    name: picked.fileName ?? 'Video',
    duration,
    // The poster is rendered with the track transform applied, so its size is the display size.
    width: thumb.width || picked.width,
    height: thumb.height || picked.height,
  };
}

async function probeDuration(uri: string): Promise<number> {
  const player = createVideoPlayer({ uri });
  try {
    await waitReady(player);
    return player.duration;
  } finally {
    player.release();
  }
}

/** Let the user pick an audio file (music, voiceover). Returns null when cancelled. */
export async function pickAudio(): Promise<File | null> {
  const res = await File.pickFileAsync({ mimeTypes: ['audio/*'] });
  return res.canceled ? null : res.result;
}

/** Copy a picked audio file into app storage. */
export async function importAudio(src: File, displayAs?: string): Promise<MediaAsset> {
  const size = src.exists ? src.size : 0;
  if (size && Paths.availableDiskSpace < size + DISK_HEADROOM) {
    throw new Error('Not enough free storage to import this audio file.');
  }
  const name = displayAs ?? ((src.uri.startsWith('content:') && displayName(src.uri)) || src.name);
  const id = newId();
  const ext = /\.(\w+)$/.exec(displayAs ? src.name : name)?.[1].toLowerCase() ?? 'm4a';
  const dest = new File(mediaDir(), `${id}.${ext}`);
  const path = `media/${dest.name}`;
  protectMediaPaths([path]);
  try {
    src.copySync(dest);
    const duration = await probeDuration(dest.uri).catch(() => 0);
    if (!Number.isFinite(duration) || duration <= 0) throw new Error(`"${name}" could not be read as audio.`);
    return { id, kind: 'audio', path, name, duration, width: 0, height: 0 };
  } catch (cause) {
    try {
      if (dest.exists) dest.delete();
    } catch (cleanupError) {
      console.warn('Could not remove an incomplete audio import', cleanupError);
    } finally {
      releaseMediaPaths([path]);
    }
    throw cause;
  }
}

/** Import several videos / photos in order, reporting progress. Failed files are skipped and reported. */
export async function importVideos(
  picked: ImagePicker.ImagePickerAsset[],
  onProgress?: (done: number, total: number) => void,
): Promise<{ assets: MediaAsset[]; errors: string[] }> {
  const assets: MediaAsset[] = [];
  const errors: string[] = [];
  for (let i = 0; i < picked.length; i++) {
    onProgress?.(i, picked.length);
    try {
      assets.push(await importVideo(picked[i]));
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  onProgress?.(picked.length, picked.length);
  return { assets, errors };
}
