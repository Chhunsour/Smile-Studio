import { create } from 'zustand';

export type ImportProgress = { done: number; total: number };

/** One media-import session across every mounted tab and editor. Never persisted. */
export const useMediaImport = create<{
  busy: boolean;
  progress: ImportProgress | null;
  protectedPaths: ReadonlySet<string>;
}>(() => ({ busy: false, progress: null, protectedPaths: new Set<string>() }));

/** Synchronous acquisition prevents double taps and other mounted screens from opening a second picker. */
export function beginMediaImport(): boolean {
  if (useMediaImport.getState().busy) return false;
  useMediaImport.setState({ busy: true, progress: null });
  return true;
}

export function finishMediaImport() {
  // Keep protection through the awaiting caller's synchronous project save/addClips continuation.
  // Releasing next turn leaves no input-event or garbage-collection gap before assets are referenced.
  setTimeout(() => useMediaImport.setState({ busy: false, progress: null }), 0);
}

/** Keep imported files alive while an editor's debounced save has not referenced them on disk yet. */
export function protectMediaPaths(paths: Iterable<string>) {
  const protectedPaths = new Set(useMediaImport.getState().protectedPaths);
  for (const path of paths) protectedPaths.add(path);
  useMediaImport.setState({ protectedPaths });
}

export function releaseMediaPaths(paths: Iterable<string>) {
  const protectedPaths = new Set(useMediaImport.getState().protectedPaths);
  for (const path of paths) protectedPaths.delete(path);
  useMediaImport.setState({ protectedPaths });
}

/** Call only after a project was saved successfully; the on-disk project now owns these files. */
export function releaseSavedMediaPaths(paths: Iterable<string>) {
  releaseMediaPaths(paths);
}
