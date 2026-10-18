import { router } from 'expo-router';
import { Alert } from 'react-native';

import { applyEditTemplate, EDIT_TEMPLATES } from '@/core/templates';
import { newClip } from '@/core/timeline';
import type { AspectRatio } from '@/core/types';
import { usePreferences } from '@/state/preferences';
import { createProject, newId, saveProject } from '@/storage/projects';
import { useImport } from '@/ui/useImport';

export function useCreateProject() {
  const importer = useImport();
  const defaultAspect = usePreferences(state => state.preferences.defaultAspect);
  async function start(aspect: AspectRatio = defaultAspect, templateId?: string) {
    try {
      const assets = await importer.run();
      if (!assets.length) return;
      const date = new Date();
      const name = `Project ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
      let project = { ...createProject(name, Object.fromEntries(assets.map(asset => [asset.id, asset])), assets.map(asset => newClip(asset, newId()))), aspect };
      const template = EDIT_TEMPLATES.find(item => item.id === templateId);
      if (template) project = applyEditTemplate(project, template.id, template.title, newId);
      saveProject(project);
      router.push({ pathname: '/editor/[id]', params: { id: project.id } });
    } catch (error) {
      Alert.alert('Could not create project', error instanceof Error ? error.message : String(error));
    }
  }
  return { start, importing: importer.importing, overlay: importer.overlay };
}
