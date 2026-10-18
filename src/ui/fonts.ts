import { Platform, type TextStyle } from 'react-native';

import type { FontId } from '@/core/types';

/** System fonts only: always available, and they fall back to the OS fonts for Khmer and other scripts. */
export const FONTS: { id: FontId; label: string; style: TextStyle }[] = [
  { id: 'sans', label: 'Sans', style: { fontWeight: '800' } },
  {
    id: 'serif',
    label: 'Serif',
    style: { fontFamily: Platform.select({ ios: 'Georgia', default: 'serif' }), fontWeight: '700' },
  },
  {
    id: 'mono',
    label: 'Mono',
    style: { fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), fontWeight: '700' },
  },
  {
    id: 'rounded',
    label: 'Rounded',
    style: { fontFamily: Platform.select({ ios: 'ui-rounded', default: 'sans-serif-medium' }), fontWeight: '800' },
  },
  {
    id: 'condensed',
    label: 'Condensed',
    style: {
      fontFamily: Platform.select({ ios: 'AvenirNextCondensed-Heavy', default: 'sans-serif-condensed' }),
      fontWeight: '700',
    },
  },
];

export const fontStyle = (id: FontId) => FONTS.find((f) => f.id === id)?.style ?? FONTS[0].style;

export const TEXT_COLORS = [
  '#FFFFFF',
  '#000000',
  '#FFD23F',
  '#FF4F7B',
  '#FF8A3D',
  '#4ADE80',
  '#38BDF8',
  '#A78BFA',
  '#F472B6',
  '#94A3B8',
];
