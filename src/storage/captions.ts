import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { exportSrt, MAX_SUBTITLE_BYTES } from '@/core/captions';
import type { Project } from '@/core/types';

/** SDK 57 returns a cancellation result; selecting a file never changes the project itself. */
export async function pickSubtitleFile(): Promise<{ name: string; text: string } | null> {
  const picked = await File.pickFileAsync({ multipleFiles: false });
  if (picked.canceled) return null;
  const file = picked.result;
  if (!/\.(srt|vtt|txt)$/i.test(file.name)) throw new Error('Choose an SRT or WebVTT subtitle file.');
  if (file.size <= 0 || file.size > MAX_SUBTITLE_BYTES) throw new Error('Subtitle files must be non-empty and smaller than 1 MB.');
  return { name: file.name, text: await file.text() };
}

export async function shareCaptionFile(project: Project): Promise<void> {
  const text = exportSrt(project);
  if (!(await Sharing.isAvailableAsync())) throw new Error('File sharing is unavailable on this device. Your captions are still saved in the project.');
  const folder = new Directory(Paths.cache, 'caption-exports');
  if (!folder.exists) folder.create({ idempotent: true, intermediates: true });
  const name = project.name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').trim().slice(0, 64) || 'Smile Studio';
  const file = new File(folder, `${name}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.srt`);
  file.create({ overwrite: false });
  file.write(text);
  // Keep this cache file after the sheet closes: Android receivers may read the URI after shareAsync resolves.
  await Sharing.shareAsync(file.uri, { mimeType: 'application/x-subrip', UTI: 'public.plain-text', dialogTitle: 'Share captions (SRT)' });
}
