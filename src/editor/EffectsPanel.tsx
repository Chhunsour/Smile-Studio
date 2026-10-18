import { StudioIcon as Ionicons } from '@/ui/StudioIcon';
import { useCallback, useState, type ComponentProps } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';

import { applyEffectPreset, EFFECT_CATEGORIES, EFFECT_PRESETS, EFFECTS, normalizeEffects, searchEffects, type EffectCategory, type EffectId, type EffectPreset } from '@/core/effects';
import type { VideoClip } from '@/core/types';
import { useEditor } from '@/state/editor';
import { Slider } from '@/ui/Slider';
import { MotionPressable as Pressable } from '@/ui/MotionPressable';
import { font, radius, useAppTheme, useThemedStyles, type AppColors } from '@/ui/theme';

const unit = (value: number) => { 'worklet'; return value; };
const percent = (value: number) => { 'worklet'; return Math.round(value * 100) / 100; };
const ICONS: Record<EffectId, ComponentProps<typeof Ionicons>['name']> = {
  vignette: 'ellipse-outline', grain: 'apps-outline', scanlines: 'reorder-four-outline', letterbox: 'film-outline',
  lightLeak: 'sunny-outline', bloom: 'sparkles-outline', goldenHour: 'partly-sunny-outline', coolGlow: 'moon-outline',
  dreamy: 'flower-outline', neonFrame: 'scan-outline', filmDust: 'snow-outline', scratches: 'barcode-outline',
  retroFade: 'camera-outline', frost: 'diamond-outline', spotlight: 'aperture-outline',
};
type LibraryTab = 'Effects' | 'Presets' | 'Stack';

export function EffectsPanel({ clip, onClose }: { clip: VideoClip; onClose: () => void }) {
  const { colors, isDark } = useAppTheme();
  const s = useThemedStyles(createStyles);
  const { height } = useWindowDimensions();
  const [selected, setSelected] = useState<EffectId>('vignette');
  const [tab, setTab] = useState<LibraryTab>('Effects');
  const [category, setCategory] = useState<EffectCategory>('All');
  const [query, setQuery] = useState('');
  const [stackPresets, setStackPresets] = useState(false);
  const [status, setStatus] = useState('');
  const settings = normalizeEffects(clip.effects);
  const effect = EFFECTS.find(item => item.id === selected)!;
  const active = EFFECTS.filter(item => settings[item.id] > 0);
  const matches = searchEffects(query, category);
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const presets = EFFECT_PRESETS.filter(preset => terms.every(term => `${preset.name} ${preset.description}`.toLowerCase().includes(term)));

  const changeEffect = useCallback((id: EffectId, value: number, coalesce = false) => {
    const editor = useEditor.getState();
    const current = editor.project?.main.find(item => item.id === clip.id);
    if (!current) return;
    editor.updateClip(clip.id, { effects: { ...normalizeEffects(current.effects), [id]: Math.min(1, Math.max(0, value)) } },
      coalesce ? `effect-${clip.id}-${id}` : undefined);
  }, [clip.id]);
  const commitIntensity = useCallback((value: number) => changeEffect(selected, value, true), [changeEffect, selected]);
  const selectEffect = (id: EffectId) => {
    setSelected(id);
    const definition = EFFECTS.find(item => item.id === id)!;
    const current = useEditor.getState().project?.main.find(item => item.id === clip.id);
    if (!normalizeEffects(current?.effects)[id]) {
      changeEffect(id, definition.defaultIntensity);
      setStatus(`${definition.name} added`);
    }
  };
  const applyPreset = (preset: EffectPreset) => {
    const editor = useEditor.getState();
    const current = editor.project?.main.find(item => item.id === clip.id);
    if (!current) return;
    editor.updateClip(clip.id, { effects: applyEffectPreset(preset, current.effects, stackPresets) });
    setSelected(EFFECTS.find(item => (preset.effects[item.id] ?? 0) > 0)!.id);
    setStatus(`${preset.name} ${stackPresets ? 'added to stack' : 'applied'}`);
  };
  const applyToAll = () => {
    const editor = useEditor.getState();
    const current = editor.project?.main.find(item => item.id === clip.id);
    if (!current || !editor.project) return;
    editor.updateAllClips({ effects: normalizeEffects(current.effects) });
    setStatus(`Effects applied to ${editor.project.main.length} clips`);
  };

  return <View style={[s.panel, { maxHeight: Math.min(400, height * .45) }]}>
    <View style={s.heading}>
      <View style={s.titleRow}><Ionicons name="sparkles-outline" size={20} color={colors.accentText} /><Text style={s.title}>Effects</Text><Text style={s.count}>{EFFECTS.length}</Text></View>
      <Pressable onPress={onClose} style={s.done} accessibilityRole="button" accessibilityLabel="Done editing effects"><Text style={s.doneText}>Done</Text></Pressable>
    </View>
    <View style={s.tabs}>
      {(['Effects', 'Presets', 'Stack'] as const).map(item => <Pressable key={item} onPress={() => setTab(item)}
        active={tab === item}
        accessibilityRole="tab" accessibilityState={{ selected: tab === item }} style={[s.tab, tab === item && s.tabSelected]}>
        <Text style={[s.label, tab === item && s.accent]}>{item}{item === 'Stack' ? ` (${active.length})` : ''}</Text>
      </Pressable>)}
    </View>
    <ScrollView style={s.library} contentContainerStyle={s.libraryContent} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
      {tab !== 'Stack' ? <View style={s.search}>
        <Ionicons name="search-outline" size={17} color={colors.textDim} />
        <TextInput value={query} onChangeText={setQuery} placeholder={tab === 'Presets' ? 'Search presets' : 'Search effects, retro, glow…'}
          accessibilityLabel={tab === 'Presets' ? 'Search effect presets' : 'Search effects'} placeholderTextColor={colors.textFaint}
          style={s.searchInput} autoCapitalize="none" autoCorrect={false} keyboardAppearance={isDark ? 'dark' : 'light'} returnKeyType="search" maxLength={80} />
        {query ? <Pressable onPress={() => setQuery('')} accessibilityRole="button" accessibilityLabel="Clear search" style={s.clear}>
          <Ionicons name="close-circle" size={18} color={colors.textDim} />
        </Pressable> : null}
      </View> : null}
      {tab === 'Effects' ? <>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips} keyboardShouldPersistTaps="handled">
          {EFFECT_CATEGORIES.map(item => <Pressable key={item} onPress={() => setCategory(item)} accessibilityRole="button"
            active={category === item}
            accessibilityState={{ selected: category === item }} style={[s.category, category === item && s.categorySelected]}>
            <Text style={[s.detail, category === item && s.accent]}>{item}</Text>
          </Pressable>)}
        </ScrollView>
        {matches.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips} keyboardShouldPersistTaps="handled">
          {matches.map(item => <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`${item.name}${settings[item.id] ? ', active' : ', add effect'}`}
            active={selected === item.id}
            accessibilityHint={item.description} accessibilityState={{ selected: selected === item.id }} onPress={() => selectEffect(item.id)}
            style={[s.effectCard, selected === item.id && s.effectSelected]}>
            <View style={[s.effectIcon, selected === item.id && s.effectIconSelected]}><Ionicons name={ICONS[item.id]} size={25} color={selected === item.id || settings[item.id] > 0 ? colors.accentText : colors.text} />
              {settings[item.id] > 0 ? <View style={s.activeDot} /> : null}
            </View>
            <Text style={s.cardName} numberOfLines={2}>{item.name}</Text>
          </Pressable>)}
        </ScrollView> : <Text style={s.empty}>No effects found. Try another search or category.</Text>}
      </> : null}
      {tab === 'Presets' ? <>
        <Pressable onPress={() => setStackPresets(value => !value)} style={s.presetMode} accessibilityRole="switch"
          accessibilityLabel="Add presets to the current effect stack" accessibilityState={{ checked: stackPresets }}>
          <Ionicons name={stackPresets ? 'checkbox' : 'square-outline'} size={20} color={stackPresets ? colors.accentText : colors.textDim} />
          <Text style={s.label}>Add to current stack</Text>
        </Pressable>
        <Text style={s.detail}>{stackPresets ? 'Keeps your other effects. Matching effects use the preset intensity.' : 'Tap a preset to replace this clip’s effects. Undo restores your previous look.'}</Text>
        {presets.map(preset => <Pressable key={preset.id} onPress={() => applyPreset(preset)} style={s.preset}
          accessibilityRole="button" accessibilityLabel={`Apply ${preset.name} preset`} accessibilityHint={preset.description}>
          <View style={s.presetIcon}><Ionicons name="sparkles-outline" size={22} color={colors.accentText} /></View>
          <View style={s.presetCopy}><Text style={s.label}>{preset.name}</Text><Text style={s.detail}>{preset.description}</Text></View>
          <Ionicons name="add-circle-outline" size={22} color={colors.accentText} />
        </Pressable>)}
        {!presets.length ? <Text style={s.empty}>No presets found. Try another search.</Text> : null}
      </> : null}
      {tab === 'Stack' ? <>
        <Text style={s.detail}>{active.length ? 'Tap an effect to adjust it. Remove effects individually with ×.' : 'Your clip has no effects yet. Choose an effect or a preset to start.'}</Text>
        {active.map(item => <View key={item.id} style={[s.stackRow, selected === item.id && s.stackSelected]}>
          <Pressable onPress={() => setSelected(item.id)} style={s.stackSelect} accessibilityRole="button"
            active={selected === item.id}
            accessibilityLabel={`Adjust ${item.name}, ${Math.round(settings[item.id] * 100)} percent`} accessibilityState={{ selected: selected === item.id }}>
            <Ionicons name={ICONS[item.id]} size={22} color={selected === item.id ? colors.accentText : colors.text} />
            <Text style={[s.label, s.stackName]}>{item.name}</Text><Text style={s.value}>{Math.round(settings[item.id] * 100)}%</Text>
          </Pressable>
          <Pressable onPress={() => { changeEffect(item.id, 0); setStatus(`${item.name} removed`); }} style={s.remove}
            accessibilityRole="button" accessibilityLabel={`Remove ${item.name}`}><Ionicons name="close" size={20} color={colors.textDim} /></Pressable>
        </View>)}
      </> : null}
    {tab !== 'Presets' ? <View style={s.intensity}>
      <View style={s.heading}><Text style={s.label}>{effect.name}</Text>
        <Pressable onPress={() => { changeEffect(selected, settings[selected] ? 0 : effect.defaultIntensity); setStatus(`${effect.name} ${settings[selected] ? 'removed' : 'added'}`); }}
          accessibilityRole="button" accessibilityLabel={`${settings[selected] ? 'Remove' : 'Add'} ${effect.name}`} style={s.toggle}>
          <Text style={s.accent}>{settings[selected] ? 'Remove' : 'Add effect'}</Text>
        </Pressable>
      </View>
      <Text style={s.detail} numberOfLines={2}>{effect.description}</Text>
      <View style={s.sliderRow}>
        <Pressable onPress={() => commitIntensity(Math.max(0, settings[selected] - .1))} style={s.step} accessibilityRole="button"
          accessibilityLabel={`Decrease ${effect.name} intensity`} disabled={settings[selected] <= 0} accessibilityState={{ disabled: settings[selected] <= 0 }}>
          <Ionicons name="remove" size={20} color={settings[selected] > 0 ? colors.text : colors.textFaint} />
        </Pressable>
        <View style={s.slider} accessible accessibilityRole="adjustable" accessibilityLabel={`${effect.name} intensity`}
          accessibilityValue={{ min: 0, max: 100, now: Math.round(settings[selected] * 100) }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={event => commitIntensity(settings[selected] + (event.nativeEvent.actionName === 'increment' ? .1 : -.1))}>
          <Slider key={selected} value={settings[selected]} toNorm={unit} fromNorm={percent} onCommit={commitIntensity} />
        </View>
        <Pressable onPress={() => commitIntensity(Math.min(1, settings[selected] + .1))} style={s.step} accessibilityRole="button"
          accessibilityLabel={`Increase ${effect.name} intensity`} disabled={settings[selected] >= 1} accessibilityState={{ disabled: settings[selected] >= 1 }}>
          <Ionicons name="add" size={20} color={settings[selected] < 1 ? colors.text : colors.textFaint} />
        </Pressable>
        <Text style={s.percent}>{Math.round(settings[selected] * 100)}%</Text>
      </View>
    </View> : null}
    </ScrollView>
    <View style={s.actions}>
      <Pressable onPress={() => { useEditor.getState().updateClip(clip.id, { effects: undefined }); setStatus('Clip effects reset'); }}
        style={[s.action, !active.length && s.disabled]} accessibilityRole="button" accessibilityLabel="Reset all effects on this clip"
        disabled={!active.length} accessibilityState={{ disabled: !active.length }}><Text style={s.label}>Reset clip</Text></Pressable>
      <Pressable onPress={applyToAll} style={[s.action, s.apply]} accessibilityRole="button" accessibilityLabel="Apply this effect stack to every clip">
        <Ionicons name="copy-outline" size={16} color={colors.accentInk} /><Text style={[s.label, s.ink]}>Apply to all</Text>
      </Pressable>
    </View>
    {status ? <Text style={s.status} accessibilityLiveRegion="polite" numberOfLines={2}>{status}</Text> : null}
  </View>;
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  panel: { paddingHorizontal: 16, paddingVertical: 10, gap: 8, flexShrink: 1, backgroundColor: colors.surface },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 30 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 }, title: { ...font.h2, color: colors.text },
  count: { ...font.mono, color: colors.textDim, backgroundColor: colors.surface3, borderRadius: radius.sm, paddingHorizontal: 7, paddingVertical: 3 }, done: { minHeight: 44, minWidth: 60, paddingHorizontal: 12, justifyContent: 'center', alignItems: 'center', borderRadius: radius.md, backgroundColor: colors.accentSoft },
  doneText: { ...font.small, fontWeight: '700', color: colors.accentText }, tabs: { flexDirection: 'row', backgroundColor: colors.surface2, borderRadius: radius.md, padding: 3, borderWidth: 1, borderColor: colors.border },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 44, borderRadius: radius.sm },
  tabSelected: { backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.borderStrong }, label: { ...font.small, color: colors.text },
  accent: { ...font.small, color: colors.accentText }, ink: { color: colors.accentInk },
  library: { flexShrink: 1 }, libraryContent: { gap: 8, paddingBottom: 2 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: radius.md, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, paddingLeft: 12 },
  searchInput: { ...font.small, color: colors.text, flex: 1, minHeight: 44, paddingVertical: 10 }, clear: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  chips: { gap: 8 }, category: { minHeight: 44, minWidth: 44, paddingHorizontal: 12, justifyContent: 'center', borderRadius: radius.md, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border },
  categorySelected: { backgroundColor: colors.accentSoft, borderColor: '#766539' }, detail: { ...font.small, color: colors.textDim, lineHeight: 17 },
  effectCard: { width: 92, minHeight: 90, alignItems: 'center', justifyContent: 'center', gap: 7, padding: 8, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface2 },
  effectSelected: { borderColor: colors.selection, backgroundColor: colors.accentSoft }, effectIcon: { position: 'relative', width: 44, height: 40, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.borderStrong },
  effectIconSelected: { backgroundColor: colors.accentSoft, borderColor: '#766539' },
  activeDot: { position: 'absolute', width: 6, height: 6, borderRadius: 3, right: 4, top: 4, backgroundColor: colors.accent },
  cardName: { ...font.small, color: colors.text, textAlign: 'center', lineHeight: 15 }, empty: { ...font.small, color: colors.textDim, paddingVertical: 20, lineHeight: 18 },
  presetMode: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 },
  preset: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: radius.md, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border, padding: 10 },
  presetIcon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surfaceRaised },
  presetCopy: { flex: 1, gap: 3 }, stackRow: { flexDirection: 'row', alignItems: 'center', borderRadius: radius.md, backgroundColor: colors.surface2, borderWidth: 1, borderColor: 'transparent' },
  stackSelected: { borderColor: '#766539', backgroundColor: colors.accentSoft }, stackSelect: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, padding: 12, minHeight: 44 },
  stackName: { flex: 1 }, remove: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  value: { ...font.mono, color: colors.accentText }, intensity: { gap: 2 }, toggle: { paddingHorizontal: 8, minHeight: 44, justifyContent: 'center' },
  sliderRow: { flexDirection: 'row', alignItems: 'center', gap: 4 }, slider: { flex: 1, paddingVertical: 2 },
  step: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, percent: { ...font.mono, color: colors.accentText, width: 40, textAlign: 'right' },
  actions: { flexDirection: 'row', gap: 8 }, action: { flex: 1, minHeight: 44, borderRadius: radius.md, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.borderStrong, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  apply: { backgroundColor: colors.accent, borderColor: colors.selection }, disabled: { opacity: .4 }, status: { ...font.small, color: colors.textDim, lineHeight: 16 },
});
