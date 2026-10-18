import { useEffect, useRef, useState } from 'react';

import { extractableVideoClip, extractVideoAudio } from '@/core/audio-editing';
import type { ID } from '@/core/types';
import type { PlaybackEngine } from '@/playback/engine';
import { analyzeAsset } from '@/playback/waveforms';
import { useEditor } from '@/state/editor';
import { newId } from '@/storage/projects';

/** Shared by the clip toolbar, tool search and audio panel. One tap is one undoable edit. */
export function useExtractAudio(engine: PlaybackEngine) {
  const [extracting, setExtracting] = useState(false);
  const pending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const extract = async (clipId: ID): Promise<boolean> => {
    if (pending.current) return false;
    const editor = useEditor.getState();
    const project = editor.project;
    if (!project) return false;
    // Validate speed and source before decoding, without creating an edit or an ID.
    const clip = extractableVideoClip(project, clipId);
    const asset = project.assets[clip.assetId];
    editor.select(clipId);
    engine.pause();
    pending.current = true;
    setExtracting(true);
    try {
      const analysis = await analyzeAsset(asset);
      if (!mounted.current) return false;
      const current = useEditor.getState();
      if (current.project?.id !== project.id || current.selectedId !== clipId) return false;
      const source = current.project.main.find(item => item.id === clipId);
      if (!source || source.assetId !== asset.id || current.project.assets[asset.id]?.path !== asset.path) {
        throw new Error('This video changed. Select the clip and try again.');
      }
      const audioId = newId();
      current.edit(value => extractVideoAudio(value, clipId, () => audioId, analysis));
      current.select(audioId);
      current.setPanel('audioTools');
      return true;
    } catch (cause) {
      if (!mounted.current || useEditor.getState().project?.id !== project.id || useEditor.getState().selectedId !== clipId) return false;
      throw cause;
    } finally {
      pending.current = false;
      if (mounted.current) setExtracting(false);
    }
  };

  return { extract, extracting };
}
