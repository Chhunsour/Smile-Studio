import { DEFAULT_COLOR, type FilterId } from './color.ts';
import type { ClipEffects } from './effects.ts';
import { totalDuration } from './timeline.ts';
import type { AspectRatio, Project, TextOverlay } from './types.ts';

export interface EditTemplate {
  id: string;
  name: string;
  description: string;
  aspect: AspectRatio;
  filter: FilterId;
  accent: string;
  effects: ClipEffects;
  title: string;
  font: TextOverlay['font'];
  animation: TextOverlay['animIn'];
  transition: number;
}

export const EDIT_TEMPLATES: readonly EditTemplate[] = [
  { id: 'daily', name: 'Daily vlog', description: 'Clean color, soft cuts, a simple opening title.', aspect: '9:16', filter: 'clean', accent: '#DBECE4', effects: {}, title: 'A little of my day', font: 'sans', animation: 'fade', transition: .3 },
  { id: 'cinema', name: 'Cinematic', description: 'Cool cinema color, film grain and widescreen bars.', aspect: '16:9', filter: 'cinema', accent: '#82B6C0', effects: { grain: .25, letterbox: .5, vignette: .25 }, title: 'A story worth telling', font: 'serif', animation: 'fade', transition: .5 },
  { id: 'travel', name: 'Travel diary', description: 'Warm sunlight and a handwritten-feeling title.', aspect: '9:16', filter: 'sunset', accent: '#F5BA89', effects: { lightLeak: .2 }, title: 'Somewhere new', font: 'serif', animation: 'slide', transition: .4 },
  { id: 'food', name: 'Food story', description: 'Fresh color and an easy-to-read recipe headline.', aspect: '4:5', filter: 'vivid', accent: '#B6D995', effects: {}, title: 'Made with love', font: 'rounded', animation: 'pop', transition: .2 },
  { id: 'retro', name: 'Retro memories', description: 'Faded film, texture and warm light leaks.', aspect: '3:4', filter: 'retro', accent: '#D4B78E', effects: { grain: .5, vignette: .35, lightLeak: .25 }, title: 'The good days', font: 'mono', animation: 'fade', transition: .5 },
  { id: 'product', name: 'Product spotlight', description: 'Square framing, crisp contrast and a bold headline.', aspect: '1:1', filter: 'clean', accent: '#FFD23F', effects: { vignette: .2 }, title: 'Meet your new favorite', font: 'condensed', animation: 'pop', transition: .2 },
  { id: 'night', name: 'Night out', description: 'Deep contrast and a bright pink opening title.', aspect: '9:16', filter: 'noir', accent: '#FF87B9', effects: { vignette: .45, grain: .2 }, title: 'After hours', font: 'condensed', animation: 'slide', transition: .15 },
  { id: 'khmer', name: 'អនុស្សាវរីយ៍', description: 'A warm Cambodian memory, with an editable Khmer title.', aspect: '9:16', filter: 'amber', accent: '#FFD23F', effects: { lightLeak: .15, vignette: .15 }, title: 'អនុស្សាវរីយ៍ល្អៗ', font: 'sans', animation: 'fade', transition: .4 },
];

export function applyEditTemplate(project: Project, templateId: string, title: string, id: () => string): Project {
  const template = EDIT_TEMPLATES.find(item => item.id === templateId);
  if (!template) throw new Error('Choose a template to continue.');
  const duration = totalDuration(project.main);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('Add a video or photo before applying a template.');
  const content = title.trim().slice(0, 300);
  const existingTitle = project.texts.find(text => text.templateTitle);
  const overlay: TextOverlay = {
    id: content ? existingTitle?.id ?? id() : '', start: 0, end: Math.min(3, duration), text: content,
    font: template.font, color: template.accent, opacity: 1, box: false,
    x: .5, y: .38, size: template.font === 'condensed' ? .09 : .065, rotation: 0,
    animIn: template.animation, animOut: 'fade',
    templateTitle: true,
  };
  return {
    ...project, aspect: template.aspect, background: '#000000',
    main: project.main.map((clip, index) => ({
      ...clip, color: { ...DEFAULT_COLOR, filter: template.filter, intensity: .8 },
      effects: { ...template.effects }, transition: index ? template.transition : undefined,
    })),
    texts: content ? [...project.texts.filter(text => !text.templateTitle), overlay] : project.texts.filter(text => !text.templateTitle),
  };
}
