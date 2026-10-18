import { Directory, File, Paths } from 'expo-file-system';
import { synthesizeSound, type SoundId } from '@/core/sounds';

export function soundFile(id: SoundId): File {
  const dir = new Directory(Paths.cache, 'smile-sounds-v1');
  dir.create({ intermediates: true, idempotent: true });
  const file = new File(dir, `${id}.wav`);
  if (!file.exists) { file.create(); file.write(synthesizeSound(id)); }
  return file;
}
