import { Directory, File, Paths } from 'expo-file-system';

import type { ID, Project } from '@/core/types';
import { releaseSavedMediaPaths, useMediaImport } from '@/state/import';

// Async project scans must never delete files using a snapshot predating a successful write/delete.
let storageRevision = 0;

function ensureDir(name: string): Directory {
  const dir = new Directory(Paths.document, name);
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

export const projectsDir = () => ensureDir('projects');
export const mediaDir = () => ensureDir('media');
const projectFile = (id: ID) => new File(projectsDir(), `${id}.json`);

/** Resolve a document-relative path (as stored in the project) to a file:// URI. */
export const fileUri = (relPath: string) => new File(Paths.document, relPath).uri;

export const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

function parse(json: string): Project {
  const p = JSON.parse(json);
  if (!p?.id || !Array.isArray(p.main)) throw new Error('Unsupported project file');
  // schema 1 -> 2: overlays and audio tracks were added.
  if (p.schema === 1) return { ...p, schema: 2, texts: [], audio: [] };
  if (p.schema !== 2) throw new Error(`Unsupported project version ${p.schema}`);
  return p as Project;
}

async function readAll(): Promise<{ projects: Project[]; unreadable: number }> {
  const projects: Project[] = [];
  let unreadable = 0;
  for (const entry of projectsDir().list()) {
    if (!(entry instanceof File) || !entry.name.endsWith('.json')) continue;
    try {
      projects.push(parse(await entry.text()));
    } catch (e) {
      unreadable++;
      console.warn(`Skipping unreadable project ${entry.name}`, e);
    }
  }
  return { projects, unreadable };
}

export async function listProjects(): Promise<Project[]> {
  const { projects } = await readAll();
  return projects.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function loadProject(id: ID): Promise<Project | null> {
  const f = projectFile(id);
  return f.exists ? parse(await f.text()) : null;
}

/** Atomic save: write a temp file, then rename over the real one so a crash never leaves a half-written project. */
export function saveProject(p: Project) {
  const tmp = new File(projectsDir(), `${p.id}.json.tmp`);
  if (tmp.exists) tmp.delete();
  tmp.create();
  tmp.write(JSON.stringify(p));
  tmp.moveSync(projectFile(p.id), { overwrite: true });
  storageRevision++;
  releaseSavedMediaPaths(Object.values(p.assets).flatMap((asset) => asset.poster ? [asset.path, asset.poster] : [asset.path]));
}

export function createProject(name: string, assets: Project['assets'], main: Project['main']): Project {
  const now = Date.now();
  const p: Project = {
    schema: 2,
    id: newId(),
    name,
    createdAt: now,
    updatedAt: now,
    aspect: 'original',
    assets,
    main,
    texts: [],
    audio: [],
  };
  saveProject(p);
  return p;
}

export function duplicateProject(p: Project): Project {
  const now = Date.now();
  // Media is shared between projects (see gcMedia), so duplicating is just a new document.
  const copy: Project = { ...p, id: newId(), name: `${p.name} copy`, createdAt: now, updatedAt: now };
  saveProject(copy);
  return copy;
}

export async function deleteProject(id: ID) {
  const f = projectFile(id);
  if (f.exists) {
    f.delete();
    storageRevision++;
  }
  await gcMedia();
}

/** Delete media files no project references any more. */
export async function gcMedia() {
  if (useMediaImport.getState().busy) return;
  const revision = storageRevision;
  const { projects, unreadable } = await readAll();
  if (useMediaImport.getState().busy || revision !== storageRevision) return;
  // A project we can't read (corrupt, or from a newer app version) may still own media: don't touch anything.
  if (unreadable) return;
  const used = new Set<string>();
  for (const p of projects) {
    for (const a of Object.values(p.assets)) {
      used.add(a.path);
      if (a.poster) used.add(a.poster);
    }
  }
  // Read pending imports after the async scan; new editor media may still await its autosave.
  const imports = useMediaImport.getState();
  if (imports.busy || revision !== storageRevision) return;
  for (const path of imports.protectedPaths) used.add(path);
  for (const entry of mediaDir().list()) {
    if (entry instanceof File && !used.has(`media/${entry.name}`)) {
      try {
        entry.delete();
      } catch (e) {
        console.warn('Could not delete unused media', entry.name, e);
      }
    }
  }
}

/** Drop assets no clip uses any more. Undo history is gone once the editor closes, so they're safe to forget. */
export function pruneAssets(p: Project): Project {
  const used = new Set([...p.main, ...p.audio].map((c) => c.assetId));
  const assets = Object.fromEntries(Object.entries(p.assets).filter(([id]) => used.has(id)));
  return Object.keys(assets).length === Object.keys(p.assets).length ? p : { ...p, assets };
}
