import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { memo, useMemo, type ComponentProps } from 'react';
import { View, type ColorValue, type StyleProp, type ViewStyle } from 'react-native';

import { studioSvg } from './studio-glyphs';
import { useAppTheme } from './theme';

export type StudioIconName = ComponentProps<typeof Ionicons>['name'];
export type StudioIconProps = {
  name: StudioIconName;
  size?: number;
  color?: ColorValue;
  accent?: string;
  style?: StyleProp<ViewStyle>;
};

/** Identical tool geometry on iOS, Android and web. Icons defer accessibility labels to their buttons. */
export const StudioIcon = memo(function StudioIcon({ name, size = 24, color: suppliedColor, accent, style }: StudioIconProps) {
  const { colors } = useAppTheme();
  const color = suppliedColor ?? colors.text;
  const primary = typeof color === 'string' ? color : colors.text;
  const secondary = accent ?? (primary === colors.accentInk || primary === colors.textFaint || primary === colors.danger ? primary : colors.accentText);
  const uri = useMemo(() => {
    // Native semantic/dynamic colors remain native; the palette's resolved strings use our vectors.
    const svg = typeof color === 'string' ? studioSvg(name, color, secondary) : null;
    return svg ? `data:image/svg+xml;utf8,${encodeURIComponent(svg)}` : null;
  }, [name, color, secondary]);
  return <View pointerEvents="none" accessible={false} style={[{ width: size, height: size, alignItems: 'center', justifyContent: 'center', flexShrink: 0 }, style]}>
    {uri ? <Image source={{ uri }} style={{ width: size, height: size }} contentFit="contain" transition={0} cachePolicy="memory" accessible={false} />
      : <Ionicons name={name} size={size} color={color} accessible={false} />}
  </View>;
});
