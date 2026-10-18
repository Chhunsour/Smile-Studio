import { Alert } from 'react-native';
import { create } from 'zustand';

import { duplicateCaption, isCaption } from '@/core/captions';
import { locate, moveItem, newClip, splitAt, splitAudio, splitText, trimClip } from '@/core/timeline';
import type { AspectRatio, AudioClip, ID, MediaAsset, Project, TextOverlay, VideoClip } from '@/core/types';
import { newId } from '@/storage/projects';

const HISTORY_LIMIT = 100;
/** Placeholder content of a new text layer; the text panel starts empty instead of showing it. */
export const DEFAULT_TEXT = 'Your text';
/** Edits with the same coalesce key this close together (ms) share one undo step (typing, slider drags). */
const COALESCE_MS = 1500;

export type SelectionKind = 'clip' | 'text' | 'audio';
export type Panel =
  | 'speed'
  | 'volume'
  | 'ratio'
  | 'crop'
  | 'rotate'
  | 'filters'
  | 'adjust'
  | 'text'
  | 'fade'
  | 'animate'
  | 'voiceover'
  | 'style'
  | 'stickers'
  | 'captions'
  | 'effects'
  | 'sounds'
  | 'audioTools'
  | 'templates'
  | 'timing'
  | 'transition';

interface EditorState {
  project: Project | null;
  past: Project[];
  future: Project[];
  selectedId: ID | null;
  /** Last coalescable edit, see `edit`. */
  lastEdit: { key: string; at: number } | null;
  /** Open bottom panel (tool settings), shared so the preview and timeline can open one too. */
  panel: Panel | null;
  setPanel(panel: Panel | null): void;

  open(p: Project): void;
  close(): void;
  /**
   * Apply an edit as one undo step. Return the same object to make it a no-op. Passing `coalesce` merges
   * consecutive edits with the same key into a single undo step.
   */
  edit(fn: (p: Project) => Project, coalesce?: string): void;
  undo(): void;
  redo(): void;
  select(id: ID | null): void;

  addClips(assets: MediaAsset[], atIndex?: number): void;
  split(t: number): boolean;
  /** Freeze frame: split the main track at `t` and put a photo clip of `asset` there; selects it. */
  insertStill(t: number, asset: MediaAsset): void;
  /** Split the text or audio clip `id` at timeline time `t`; selects the right half. */
  splitOverlay(id: ID, t: number): boolean;
  trim(id: ID, edge: 'in' | 'out', value: number): void;
  move(from: number, to: number): void;
  duplicate(id: ID): void;
  remove(id: ID): void;
  updateClip(id: ID, patch: Partial<Omit<VideoClip, 'id' | 'assetId'>>, coalesce?: string): void;
  /** Set the same properties (look, fades) on every clip of the main track, as one undo step. */
  updateAllClips(patch: Partial<Omit<VideoClip, 'id' | 'assetId'>>): void;
  setAspect(aspect: AspectRatio): void;
  setBackground(background: string): void;

  /** `patch` overrides the defaults (stickers, styled templates). */
  addText(at: number, duration: number, patch?: Partial<Omit<TextOverlay, 'id'>>): ID;
  updateText(id: ID, patch: Partial<Omit<TextOverlay, 'id'>>, coalesce?: string): void;
  addAudio(asset: MediaAsset, at: number): ID;
  updateAudio(id: ID, patch: Partial<Omit<AudioClip, 'id' | 'assetId'>>, coalesce?: string): void;
}

export function selectionKind(p: Project | null, id: ID | null): SelectionKind | null {
  if (!p || !id) return null;
  if (p.main.some((c) => c.id === id)) return 'clip';
  if (p.texts.some((t) => t.id === id)) return 'text';
  if (p.audio.some((a) => a.id === id)) return 'audio';
  return null;
}

const mapById = <T extends { id: ID }>(list: T[], id: ID, fn: (x: T) => T) =>
  list.map((x) => (x.id === id ? fn(x) : x));

export const useEditor = create<EditorState>((set, get) => ({
  project: null,
  past: [],
  future: [],
  selectedId: null,
  lastEdit: null,
  panel: null,
  setPanel: (panel) => set({ panel }),

  open: (project) => set({ project, past: [], future: [], selectedId: null, lastEdit: null, panel: null }),
  close: () => set({ project: null, past: [], future: [], selectedId: null, lastEdit: null, panel: null }),

  edit: (fn, coalesce) =>
    set((s) => {
      if (!s.project) return s;
      const next = fn(s.project);
      if (next === s.project) return s;
      const now = Date.now();
      const merge = coalesce && s.lastEdit?.key === coalesce && now - s.lastEdit.at < COALESCE_MS && s.past.length;
      return {
        project: { ...next, updatedAt: now },
        // When merging, keep the state from before the first edit of the burst as the undo point.
        past: merge ? s.past : [...s.past.slice(-(HISTORY_LIMIT - 1)), s.project],
        future: [],
        lastEdit: coalesce ? { key: coalesce, at: now } : null,
      };
    }),

  undo: () =>
    set((s) => {
      const prev = s.past.at(-1);
      if (!prev || !s.project) return s;
      return {
        project: { ...prev, updatedAt: Date.now() },
        past: s.past.slice(0, -1),
        future: [s.project, ...s.future],
        selectedId: selectionKind(prev, s.selectedId) ? s.selectedId : null,
        lastEdit: null,
      };
    }),

  redo: () =>
    set((s) => {
      const [next, ...rest] = s.future;
      if (!next || !s.project) return s;
      return {
        project: { ...next, updatedAt: Date.now() },
        past: [...s.past, s.project],
        future: rest,
        selectedId: selectionKind(next, s.selectedId) ? s.selectedId : null,
        lastEdit: null,
      };
    }),

  select: (selectedId) =>
    set((s) => ({ selectedId, lastEdit: null, panel: selectedId === s.selectedId ? s.panel : null })),

  addClips: (assets, atIndex) =>
    get().edit((p) => {
      const clips = assets.map((a) => newClip(a, newId()));
      const main = p.main.slice();
      main.splice(atIndex ?? main.length, 0, ...clips);
      return { ...p, assets: { ...p.assets, ...Object.fromEntries(assets.map((a) => [a.id, a])) }, main };
    }),

  split: (t) => {
    const p = get().project;
    const main = p && splitAt(p.main, t, newId());
    if (!main) return false;
    get().edit((proj) => ({ ...proj, main }));
    return true;
  },

  insertStill: (t, asset) => {
    const still = newClip(asset, newId());
    get().edit((p) => {
      // Split first so the still sits exactly at the playhead (no split when t is on, or very near, a cut).
      const main = splitAt(p.main, t, newId()) ?? p.main;
      const hit = locate(main, t);
      const at = !hit ? 0 : t - hit.start < 0.05 ? hit.index : hit.index + 1;
      const next = main.slice();
      next.splice(at, 0, still);
      return { ...p, assets: { ...p.assets, [asset.id]: asset }, main: next };
    });
    set({ selectedId: still.id });
  },

  splitOverlay: (id, t) => {
    const p = get().project;
    const text = p?.texts.find((x) => x.id === id);
    const audio = p?.audio.find((x) => x.id === id);
    const parts = text ? splitText(text, t, newId()) : audio ? splitAudio(audio, t, newId()) : null;
    if (!parts) return false;
    const replace = <T extends { id: ID }>(list: T[], [l, r]: T[]) =>
      list.flatMap((x) => (x.id === id ? [l, r] : [x]));
    get().edit((proj) =>
      text
        ? { ...proj, texts: replace(proj.texts, parts as TextOverlay[]) }
        : { ...proj, audio: replace(proj.audio, parts as AudioClip[]) },
    );
    set({ selectedId: parts[1].id });
    return true;
  },

  trim: (id, edge, value) =>
    get().edit((p) => ({
      ...p,
      main: mapById(p.main, id, (c) => trimClip(c, edge, value, p.assets[c.assetId]?.duration ?? c.out)),
    })),

  move: (from, to) => get().edit((p) => (from === to ? p : { ...p, main: moveItem(p.main, from, to) })),

  duplicate: (id) => {
    const copyId = newId();
    const original = get().project?.texts.find((text) => text.id === id);
    if (original && isCaption(original)) {
      try {
        get().edit((p) => duplicateCaption(p, id, () => copyId));
        set({ selectedId: copyId });
      } catch (cause) { Alert.alert('Could not duplicate caption', cause instanceof Error ? cause.message : String(cause)); }
      return;
    }
    get().edit((p) => {
      const i = p.main.findIndex((c) => c.id === id);
      if (i >= 0) {
        const main = p.main.slice();
        main.splice(i + 1, 0, { ...p.main[i], id: copyId });
        return { ...p, main };
      }
      // Overlays: the copy starts where the original ends.
      const t = p.texts.find((x) => x.id === id);
      if (t) return { ...p, texts: [...p.texts, { ...t, id: copyId, start: t.end, end: t.end + (t.end - t.start) }] };
      const a = p.audio.find((x) => x.id === id);
      if (a) return { ...p, audio: [...p.audio, { ...a, id: copyId, start: a.start + (a.out - a.in) }] };
      return p;
    });
    set({ selectedId: copyId });
  },

  remove: (id) => {
    get().edit((p) => ({
      ...p,
      main: p.main.filter((c) => c.id !== id),
      texts: p.texts.filter((t) => t.id !== id),
      audio: p.audio.filter((a) => a.id !== id),
    }));
    set({ selectedId: null });
  },

  updateClip: (id, patch, coalesce) =>
    get().edit(
      (p) => ({ ...p, main: mapById(p.main, id, (c) => ({ ...c, ...patch })) }),
      coalesce && `${id}:${coalesce}`,
    ),

  updateAllClips: (patch) => get().edit((p) => ({ ...p, main: p.main.map((c) => ({ ...c, ...patch })) })),

  setAspect: (aspect) => get().edit((p) => (p.aspect === aspect ? p : { ...p, aspect })),
  setBackground: (background) =>
    get().edit((p) => ((p.background ?? '#000000') === background ? p : { ...p, background })),

  addText: (at, duration, patch) => {
    const text: TextOverlay = {
      id: newId(),
      start: at,
      end: at + duration,
      text: DEFAULT_TEXT,
      font: 'sans',
      color: '#FFFFFF',
      opacity: 1,
      box: false,
      x: 0.5,
      y: 0.5,
      size: 0.08,
      rotation: 0,
      ...patch,
    };
    get().edit((p) => ({ ...p, texts: [...p.texts, text] }));
    set({ selectedId: text.id });
    return text.id;
  },

  updateText: (id, patch, coalesce) =>
    get().edit(
      (p) => ({ ...p, texts: mapById(p.texts, id, (t) => ({ ...t, ...patch })) }),
      coalesce && `${id}:${coalesce}`,
    ),

  addAudio: (asset, at) => {
    const clip: AudioClip = { id: newId(), assetId: asset.id, start: at, in: 0, out: asset.duration, volume: 1 };
    get().edit((p) => ({ ...p, assets: { ...p.assets, [asset.id]: asset }, audio: [...p.audio, clip] }));
    set({ selectedId: clip.id });
    return clip.id;
  },

  updateAudio: (id, patch, coalesce) =>
    get().edit(
      (p) => ({ ...p, audio: mapById(p.audio, id, (a) => ({ ...a, ...patch })) }),
      coalesce && `${id}:${coalesce}`,
    ),
}));
