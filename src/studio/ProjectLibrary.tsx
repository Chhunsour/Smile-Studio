import { StudioIcon as Ionicons } from '@/ui/StudioIcon';
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { formatTime, totalDuration } from '@/core/timeline';
import type { Project } from '@/core/types';
import { deleteProject, duplicateProject, fileUri, listProjects, saveProject } from '@/storage/projects';
import { Logo } from '@/ui/Logo';
import { MotionPressable as Pressable } from '@/ui/MotionPressable';
import { PromptDialog } from '@/ui/PromptDialog';
import { Sheet, SheetButton } from '@/ui/Sheet';
import { useAppTheme, useThemedStyles, type AppColors } from '@/ui/theme';
import { StudioHomeHeader } from './StudioHomeHeader';
import { useCreateProject } from './useCreateProject';

export function ProjectLibrary({ studio = false }: { studio?: boolean }) {
  const { colors } = useAppTheme();
  const s = useThemedStyles(makeStyles);
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState('');
  const [menuFor, setMenuFor] = useState<Project | null>(null);
  const [renaming, setRenaming] = useState<Project | null>(null);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'recent' | 'name'>('recent');
  const creator = useCreateProject();
  const focused = useRef(false);
  const requestGeneration = useRef(0);
  const refresh = useCallback(() => {
    if (!focused.current) return;
    const request = ++requestGeneration.current;
    listProjects().then(items => {
      if (focused.current && request === requestGeneration.current) { setProjects(items); setError(''); }
    }).catch(() => {
      if (focused.current && request === requestGeneration.current) setError('Your projects could not be loaded. Try again.');
    });
  }, []);
  useFocusEffect(useCallback(() => {
    focused.current = true;
    refresh();
    return () => { focused.current = false; requestGeneration.current++; };
  }, [refresh]));
  const visible = useMemo(() => {
    const items = (projects ?? []).filter(project => project.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())).sort((a, b) => sort === 'recent' ? b.updatedAt - a.updatedAt : a.name.localeCompare(b.name));
    return studio ? items.slice(0, 3) : items;
  }, [projects, search, sort, studio]);

  function confirmDelete(project: Project) {
    Alert.alert(`Delete “${project.name}”?`, 'This removes the draft from this device. Your original photos and videos stay in your library.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete project', style: 'destructive', onPress: async () => {
        try { await deleteProject(project.id); refresh(); }
        catch (e) { Alert.alert('Could not delete project', e instanceof Error ? e.message : String(e)); refresh(); }
      } },
    ]);
  }

  return <SafeAreaView style={s.screen} edges={['top']}>
    <View style={s.header}>
      {studio ? <><Logo size={34} /><Text style={s.brand}>Smile Studio</Text></> : <View style={s.projectsTitle}><Text style={s.pageTitle}>Projects</Text><Text style={s.subtitle}>Your ideas, saved on this device.</Text></View>}
      {!studio && <Pressable style={s.newSmall} disabled={creator.importing} onPress={() => creator.start()} accessibilityLabel="Create new project"><Ionicons name="add" size={24} color={colors.accentInk} /></Pressable>}
      <Pressable style={s.settings} onPress={() => router.push('/settings')} accessibilityLabel="Open settings"><Ionicons name="options-outline" size={22} color={colors.text} /></Pressable>
    </View>
    <FlatList
      data={visible}
      keyExtractor={project => project.id}
      contentContainerStyle={s.content}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      ListHeaderComponent={<>
        {studio && <StudioHomeHeader onStart={creator.start} importing={creator.importing} />}
        {!!error && !!projects?.length && <Pressable style={s.loadWarning} onPress={refresh} accessibilityLabel="Projects could not be refreshed. Retry loading projects"><Ionicons name="refresh-outline" size={18} color={colors.danger} /><Text style={s.loadWarningText}>{error} Showing your last loaded drafts.</Text></Pressable>}
        <View style={s.sectionHeader}><View style={s.sectionLabel}><Text style={s.sectionTitle}>{studio ? 'Pick up where you left off' : 'Your drafts'}</Text>{projects && <View style={s.badge}><Text style={s.badgeText}>{projects.length}</Text></View>}</View>{studio ? <Pressable onPress={() => router.navigate('/projects')} style={s.textAction}><Text style={s.link}>See all</Text><Ionicons name="arrow-forward" size={14} color={colors.accentText} /></Pressable> : <Pressable style={s.textAction} onPress={() => setSort(value => value === 'recent' ? 'name' : 'recent')} accessibilityLabel={`Sort ${sort === 'recent' ? 'by name' : 'by recent edit'}`}><Ionicons name="swap-vertical-outline" size={15} color={colors.textDim} /><Text style={s.sortText}>{sort === 'recent' ? 'Recent' : 'Name'}</Text></Pressable>}</View>
        {!studio && <View style={s.search}><Ionicons name="search-outline" size={19} color={colors.textDim} /><TextInput style={s.searchInput} value={search} onChangeText={setSearch} placeholder="Find a project" placeholderTextColor={colors.textDim} accessibilityLabel="Search projects" autoCorrect={false} returnKeyType="search" />{!!search && <Pressable onPress={() => setSearch('')} style={s.clear} accessibilityLabel="Clear project search"><Ionicons name="close-circle" size={19} color={colors.textDim} /></Pressable>}</View>}
      </>}
      ListEmptyComponent={error ? <View style={s.empty}><Ionicons name="cloud-offline-outline" size={32} color={colors.textDim} /><Text style={s.emptyTitle}>Let’s try that again</Text><Text style={s.emptyText}>{error}</Text><Pressable onPress={refresh} style={s.emptyAction}><Text style={s.link}>Reload projects</Text></Pressable></View> : projects === null ? <ActivityIndicator style={s.loader} color={colors.accentText} accessibilityLabel="Loading projects" /> : <View style={s.empty}><View style={s.emptyIcon}><Ionicons name={search ? 'search-outline' : 'albums-outline'} size={30} color={colors.accentText} /></View><Text style={s.emptyTitle}>{search ? 'No matching drafts' : 'Your next story starts here'}</Text><Text style={s.emptyText}>{search ? 'Try another name or clear your search.' : 'Add a video or photo to start your first project. Your edits save as you go.'}</Text><Pressable disabled={creator.importing} onPress={() => search ? setSearch('') : creator.start()} style={s.emptyAction}><Text style={s.link}>{search ? 'Clear search' : 'Create a project'}</Text><Ionicons name="arrow-forward" size={16} color={colors.accentText} /></Pressable></View>}
      renderItem={({ item }) => <ProjectRow project={item} onMenu={() => setMenuFor(item)} />}
      ListFooterComponent={projects && projects.length > 0 ? <View style={s.deviceNote}><Ionicons name="phone-portrait-outline" size={13} color={colors.textFaint} /><Text style={s.deviceText}>Saved on this device · No account needed</Text></View> : null}
    />
    <Sheet visible={!!menuFor} onClose={() => setMenuFor(null)} title={menuFor?.name}>
      <SheetButton label="Rename" icon={<Ionicons name="pencil-outline" size={20} color={colors.text} />} onPress={() => { setRenaming(menuFor); setMenuFor(null); }} />
      <SheetButton label="Duplicate" icon={<Ionicons name="copy-outline" size={20} color={colors.text} />} onPress={() => { try { if (menuFor) duplicateProject(menuFor); setMenuFor(null); refresh(); } catch (e) { Alert.alert('Could not duplicate project', e instanceof Error ? e.message : String(e)); } }} />
      <SheetButton label="Delete project" destructive icon={<Ionicons name="trash-outline" size={20} color={colors.danger} />} onPress={() => { const project = menuFor; setMenuFor(null); if (project) confirmDelete(project); }} />
    </Sheet>
    <PromptDialog visible={!!renaming} title="Rename project" initialValue={renaming?.name ?? ''} onCancel={() => setRenaming(null)} onConfirm={name => { try { if (renaming) saveProject({ ...renaming, name, updatedAt: Date.now() }); setRenaming(null); refresh(); } catch (e) { Alert.alert('Could not rename project', e instanceof Error ? e.message : String(e)); } }} />
    {creator.overlay}
  </SafeAreaView>;
}

function ProjectRow({ project, onMenu }: { project: Project; onMenu: () => void }) {
  const { colors } = useAppTheme();
  const s = useThemedStyles(makeStyles);
  const first = project.main[0] && project.assets[project.main[0].assetId];
  return <View style={s.row}>
    <Pressable onPress={() => router.push({ pathname: '/editor/[id]', params: { id: project.id } })} onLongPress={onMenu} style={s.openProject} accessibilityLabel={`Open ${project.name}`}>
      <View style={s.thumb}>{first?.poster ? <Image source={{ uri: fileUri(first.poster) }} style={StyleSheet.absoluteFill} contentFit="cover" /> : <Ionicons name="film-outline" size={26} color={colors.textFaint} />}<Text style={s.duration}>{formatTime(totalDuration(project.main))}</Text></View>
      <View style={s.projectCopy}><Text numberOfLines={1} style={s.projectName}>{project.name}</Text><Text style={s.projectMeta}>{relativeTime(project.updatedAt)}</Text><Text style={s.projectDetail}>{project.main.length} clip{project.main.length === 1 ? '' : 's'} <Text style={s.separator}> · </Text> {project.aspect === 'original' ? 'Original' : project.aspect}</Text></View>
    </Pressable>
    <Pressable onPress={onMenu} style={s.more} accessibilityLabel={`Options for ${project.name}`}><Ionicons name="ellipsis-horizontal" size={20} color={colors.textDim} /></Pressable>
  </View>;
}

function relativeTime(timestamp: number) {
  const seconds = Math.max(0, (Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'Edited just now';
  if (seconds < 3600) return `Edited ${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `Edited ${Math.floor(seconds / 3600)} h ago`;
  if (seconds < 172800) return 'Edited yesterday';
  return `Edited ${new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

const makeStyles = (c: AppColors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bg }, header: { paddingHorizontal: 22, paddingTop: 12, paddingBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 10 }, brand: { fontSize: 21, fontWeight: '700', letterSpacing: -.7, color: c.text, flex: 1 }, settings: { width: 44, height: 44, borderRadius: 16, backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center' }, projectsTitle: { flex: 1, paddingVertical: 8, gap: 6 }, pageTitle: { fontSize: 30, fontWeight: '700', letterSpacing: -1, color: c.text }, subtitle: { fontSize: 12, color: c.textDim }, newSmall: { width: 44, height: 44, borderRadius: 16, backgroundColor: c.accent, justifyContent: 'center', alignItems: 'center' },
  content: { paddingHorizontal: 22, paddingBottom: 26, maxWidth: 760, width: '100%', alignSelf: 'center' }, sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 4, marginBottom: 11 }, sectionLabel: { flexDirection: 'row', alignItems: 'center', gap: 7, flexShrink: 1 }, sectionTitle: { fontSize: 17, fontWeight: '700', letterSpacing: -.4, color: c.text, flexShrink: 1 }, badge: { minWidth: 23, paddingHorizontal: 6, height: 23, borderRadius: 8, backgroundColor: c.surface3, justifyContent: 'center', alignItems: 'center' }, badgeText: { fontSize: 11, fontWeight: '600', color: c.textDim }, textAction: { minHeight: 44, paddingHorizontal: 3, flexDirection: 'row', gap: 5, alignItems: 'center' }, link: { color: c.accentText, fontSize: 12, fontWeight: '700' }, sortText: { color: c.textDim, fontSize: 12 },
  search: { minHeight: 48, paddingLeft: 13, flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: c.surface, borderRadius: 15, marginBottom: 18 }, searchInput: { flex: 1, color: c.text, fontSize: 14, paddingVertical: 13 }, clear: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: c.surface, borderRadius: 18, marginBottom: 10, padding: 9 }, openProject: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, minWidth: 0 }, thumb: { width: 69, height: 76, backgroundColor: c.surface2, borderRadius: 12, overflow: 'hidden', justifyContent: 'center', alignItems: 'center' }, duration: { position: 'absolute', bottom: 5, right: 5, fontSize: 9, fontWeight: '600', fontVariant: ['tabular-nums'], color: '#FFFFFF', backgroundColor: '#151A18C9', paddingHorizontal: 5, paddingVertical: 3, borderRadius: 5, overflow: 'hidden' }, projectCopy: { flex: 1, gap: 5 }, projectName: { fontSize: 14, fontWeight: '600', color: c.text, letterSpacing: -.2 }, projectMeta: { color: c.textDim, fontSize: 11 }, projectDetail: { color: c.textDim, fontSize: 10, marginTop: 2 }, separator: { color: c.textFaint }, more: { width: 44, height: 50, alignItems: 'center', justifyContent: 'center' },
  loadWarning: { flexDirection: 'row', gap: 9, alignItems: 'center', padding: 13, borderRadius: 14, backgroundColor: c.surface, marginBottom: 12, minHeight: 44 }, loadWarningText: { color: c.danger, fontSize: 12, lineHeight: 18, flex: 1 },
  empty: { alignItems: 'center', paddingHorizontal: 22, paddingVertical: 27, gap: 10, backgroundColor: c.surface, borderRadius: 22 }, emptyIcon: { width: 60, height: 60, backgroundColor: c.accentSoft, borderRadius: 21, alignItems: 'center', justifyContent: 'center', marginBottom: 5 }, emptyTitle: { color: c.text, fontSize: 17, fontWeight: '600', textAlign: 'center' }, emptyText: { color: c.textDim, fontSize: 13, lineHeight: 20, textAlign: 'center', maxWidth: 280 }, emptyAction: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 8 }, loader: { padding: 40 }, deviceNote: { flexDirection: 'row', gap: 5, alignItems: 'center', justifyContent: 'center', marginTop: 14 }, deviceText: { color: c.textFaint, fontSize: 10 },
});
